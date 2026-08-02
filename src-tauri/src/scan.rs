use std::collections::HashSet;
use std::path::{Path, PathBuf};

use winreg::enums::*;
use winreg::{HKEY, RegKey};

use crate::disk;
use crate::error::AppResult;
use crate::icon;
use crate::models::AppInfo;

const UNINSTALL_PATH_64: &str = r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall";
const UNINSTALL_PATH_32: &str = r"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall";

/// 扫描所有可被移动的已安装软件（走注册表/控制面板卸载机制）
pub fn scan_apps() -> AppResult<Vec<AppInfo>> {
    let mut seen: HashSet<String> = HashSet::new();
    let mut apps: Vec<AppInfo> = Vec::new();

    scan_registry(&mut apps, &mut seen);

    apps.sort_by(|a, b| a.display_name.to_lowercase().cmp(&b.display_name.to_lowercase()));
    Ok(apps)
}

/// 注册表扫描（与控制面板"程序和功能"显示逻辑一致）
fn scan_registry(apps: &mut Vec<AppInfo>, seen: &mut HashSet<String>) {
    let sources: [(HKEY, &str); 3] = [
        (HKEY_LOCAL_MACHINE, UNINSTALL_PATH_64),
        (HKEY_LOCAL_MACHINE, UNINSTALL_PATH_32),
        (HKEY_CURRENT_USER, UNINSTALL_PATH_64),
    ];

    for (hive, path) in sources {
        let root = RegKey::predef(hive);
        let parent = match root.open_subkey_with_flags(path, KEY_READ) {
            Ok(k) => k,
            Err(_) => continue,
        };
        for name_res in parent.enum_keys() {
            let sub_name = match name_res {
                Ok(n) => n,
                Err(_) => continue,
            };
            let sub = match parent.open_subkey_with_flags(&sub_name, KEY_READ) {
                Ok(k) => k,
                Err(_) => continue,
            };

            // ===== 控制面板过滤逻辑 =====

            // 1. 系统组件（WMP、.NET Framework 等自带组件）— 控制面板不显示
            let system_component: u32 = sub.get_value("SystemComponent").unwrap_or(0);
            if system_component != 0 {
                continue;
            }

            // 2. 更新补丁 / 安全更新 — 控制面板不显示
            let release_type: String = sub.get_value("ReleaseType").unwrap_or_default();
            if is_update_or_hotfix(&release_type) {
                continue;
            }

            // 3. 父键存在 — 说明是某软件的子组件，不是独立程序
            let parent_key: String = sub.get_value("ParentKeyName").unwrap_or_default();
            if !parent_key.trim().is_empty() {
                continue;
            }

            // 4. WindowsInstaller 补丁
            let windows_installer: u32 = sub.get_value("WindowsInstaller").unwrap_or(0);
            let no_remove: u32 = sub.get_value("NoRemove").unwrap_or(0);
            if no_remove != 0 && windows_installer != 0 {
                // NoRemove=1 且 MSI 安装：通常是系统级 MSI 组件
                continue;
            }

            let display_name: String = sub.get_value("DisplayName").unwrap_or_default();
            if display_name.trim().is_empty() {
                continue;
            }

            // 排除本工具自身（防止用户把 FolderMove-Plus 装在 C 盘时被扫出来）
            if is_self(&display_name) {
                continue;
            }

            // ===== 安装路径获取（多级回退）=====

            let install_location_raw: String =
                sub.get_value("InstallLocation").unwrap_or_default();
            let display_icon: String = sub.get_value("DisplayIcon").unwrap_or_default();
            let uninstall_string: String = sub.get_value("UninstallString").unwrap_or_default();

            let install_location: Option<String> = if !install_location_raw.trim().is_empty() {
                Some(expand_env(&install_location_raw))
            } else {
                // InstallLocation 为空时从 DisplayIcon / UninstallString 推断
                infer_install_location(&display_icon)
                    .or_else(|| infer_install_location(&uninstall_string))
            };

            let loc = match install_location {
                Some(ref l) => normalize_path(l),
                None => continue,
            };
            if loc.is_empty() || !is_valid_install_dir(&loc) {
                continue;
            }
            if !seen.insert(loc.to_lowercase()) {
                continue;
            }

            // 二次校验：目录必须实际存在
            if !Path::new(&loc).is_dir() {
                seen.remove(&loc.to_lowercase());
                continue;
            }

            let publisher: String = sub.get_value("Publisher").unwrap_or_default();
            let version: String = sub.get_value("DisplayVersion").unwrap_or_default();
            let install_date: String = sub.get_value("InstallDate").unwrap_or_default();

            // EstimatedSize（KB）
            let est_kb: u32 = sub.get_value("EstimatedSize").unwrap_or(0);
            let estimated_size_bytes = (est_kb as u64) * 1024;

            let (is_movable, reason, is_linked, risk_level, risk_reason) = classify(&loc, &display_name);

            let icon = icon::extract_best_effort(&display_icon);
            let source_drive = disk::drive_of(&loc).unwrap_or_default();

            // 工具目标是释放 C 盘空间，仅保留 C 盘安装的软件
            if !source_drive.eq_ignore_ascii_case("C:\\") {
                continue;
            }

            apps.push(AppInfo {
                id: sub_name,
                display_name,
                publisher: if publisher.trim().is_empty() {
                    None
                } else {
                    Some(publisher)
                },
                version: if version.trim().is_empty() {
                    None
                } else {
                    Some(version)
                },
                install_location: loc.clone(),
                source_drive,
                estimated_size_bytes,
                install_date: if install_date.trim().is_empty() {
                    None
                } else {
                    Some(install_date)
                },
                icon,
                is_movable,
                is_already_linked: is_linked,
                not_movable_reason: reason,
                risk_level,
                risk_reason,
                source: "registry".into(),
            });
        }
    }
}

/// 从 DisplayIcon / UninstallString 字符串推断安装目录。
///
/// DisplayIcon 例：`C:\Program Files\Tencent\QQNT\QQ.exe,0`
/// UninstallString 例：`"C:\Program Files\App\uninst.exe" /S`
fn infer_install_location(s: &str) -> Option<String> {
    let s = s.trim();
    if s.is_empty() {
        return None;
    }

    // 去掉末尾图标索引 ",N" 或 ",-N"（DisplayIcon 特有）
    let s = strip_icon_index(s);

    // 提取可执行文件路径
    let exe_path = if s.starts_with('"') {
        // 引号包裹：取引号内
        s.split('"').nth(1).unwrap_or("")
    } else {
        // 不带引号：定位 .exe 结束位置
        let lower = s.to_lowercase();
        if let Some(pos) = lower.find(".exe") {
            &s[..pos + 4]
        } else {
            // 没有 .exe：取第一个空白前内容
            s.split_whitespace().next().unwrap_or("")
        }
    };

    if exe_path.is_empty() {
        return None;
    }

    let p = Path::new(exe_path);

    // 跳过系统命令（MsiExec / rundll32 / regsvr32 / schtasks / cmd / powershell）
    if let Some(name) = p.file_name().and_then(|n| n.to_str()) {
        if is_system_executable(name) {
            return None;
        }
    }

    // 是文件 → 取父目录
    if p.is_file() {
        let parent = match p.parent() {
            Some(par) => par,
            None => return None,
        };
        let parent_str = parent.to_string_lossy().to_string();

        // 若父目录名是 bin/exec/lib/exe 等常见子目录，再向上取一级
        let final_dir = smart_parent(&parent_str);
        if is_valid_install_dir(&final_dir) && Path::new(&final_dir).is_dir() {
            return Some(final_dir);
        }
        // 回退：直接用 exe 父目录
        if is_valid_install_dir(&parent_str) {
            return Some(parent_str);
        }
        return None;
    }

    // 本身是目录
    if p.is_dir() {
        let dir_str = p.to_string_lossy().to_string();
        if is_valid_install_dir(&dir_str) {
            return Some(dir_str);
        }
    }

    None
}

/// 去掉 DisplayIcon 末尾的图标索引（`,0` / `,-200`）
fn strip_icon_index(s: &str) -> &str {
    if let Some(idx) = s.rfind(',') {
        let tail = &s[idx + 1..];
        if tail.chars().all(|c| c.is_ascii_digit() || c == '-' || c == ' ') {
            return s[..idx].trim();
        }
    }
    s
}

/// 判断是否为系统命令行工具（不应作为安装路径来源）
fn is_system_executable(name: &str) -> bool {
    let lower = name.to_lowercase();
    matches!(
        lower.as_str(),
        "msiexec.exe"
            | "rundll32.exe"
            | "regsvr32.exe"
            | "schtasks.exe"
            | "cmd.exe"
            | "powershell.exe"
            | "conhost.exe"
            | "wscript.exe"
            | "cscript.exe"
            | "reg.exe"
            | "icacls.exe"
            | "taskkill.exe"
            | "net.exe"
            | "sc.exe"
    )
}

/// 如果目录名是 bin/exec/lib 等常见子目录，返回上一级目录
fn smart_parent(dir: &str) -> String {
    let p = Path::new(dir);
    if let Some(name) = p.file_name().and_then(|n| n.to_str()) {
        let nl = name.to_lowercase();
        if matches!(
            nl.as_str(),
            "bin" | "exec" | "exe" | "lib" | "libs" | "program"
        ) {
            if let Some(grand) = p.parent() {
                return grand.to_string_lossy().to_string();
            }
        }
    }
    dir.to_string()
}

/// 判断 ReleaseType 是否为更新/补丁（控制面板"已安装更新"中显示，不在程序列表显示）
fn is_update_or_hotfix(release_type: &str) -> bool {
    let r = release_type.trim().to_lowercase();
    matches!(
        r.as_str(),
        "hotfix" | "security update" | "update rollup" | "update" | "critical update"
    )
}

/// 校验目录是否为有效的软件安装目录
fn is_valid_install_dir(path: &str) -> bool {
    // 排除盘根（C:\、D:\）
    if path.len() <= 3 {
        return false;
    }
    let lower = path.to_lowercase();

    // 排除 Windows 系统目录
    if lower.starts_with(r"c:\windows") {
        return false;
    }
    // 排除 Program Files 根目录本身
    if lower == r"c:\program files" || lower == r"c:\program files (x86)" {
        return false;
    }
    // 排除 Common Files（系统共享组件）
    if lower.starts_with(r"c:\program files\common files")
        || lower.starts_with(r"c:\program files (x86)\common files")
    {
        return false;
    }
    // 排除 Internet Explorer / Windows NT 等系统组件目录
    if lower == r"c:\program files\internet explorer"
        || lower == r"c:\program files\windows media player"
        || lower == r"c:\program files\windows nt"
        || lower == r"c:\program files (x86)\internet explorer"
        || lower == r"c:\program files (x86)\windows media player"
        || lower == r"c:\program files (x86)\windows nt"
    {
        return false;
    }
    // 排除 WindowsApps（UWP 应用，无法通过 junction 移动）
    if lower.starts_with(r"c:\program files\windowsapps")
        || lower.starts_with(r"c:\program files (x86)\windowsapps")
    {
        return false;
    }
    true
}

/// 判断目录是否可移动、是否已是链接，并给出风险评级。
fn classify(loc: &str, display_name: &str) -> (bool, Option<String>, bool, String, Option<String>) {
    let p = Path::new(loc);
    if !p.is_dir() {
        return (
            false,
            Some("目录不存在或无法访问".into()),
            false,
            "high".into(),
            Some("目录不可访问".into()),
        );
    }
    let is_linked = crate::junction::is_reparse_point(loc);
    if is_linked {
        return (
            false,
            Some("该目录已是链接，可能之前已移动过".into()),
            true,
            "low".into(),
            Some("已是 Junction 链接，无需再次移动".into()),
        );
    }

    let lower = loc.to_lowercase();

    // 高风险：系统关键目录
    let high_risk_dirs = [
        r"c:\windows",
        r"c:\program files\windowsapps",
        r"c:\program files (x86)\windowsapps",
        r"c:\$windows.~bt",
        r"c:\$windows.~ws",
        r"c:\windows.old",
        r"c:\programdata\microsoft\windows",
        r"c:\windows\system32",
        r"c:\windows\syswow64",
    ];
    for b in high_risk_dirs {
        if lower == b || lower.starts_with(&format!("{}\\", b)) {
            return (
                true,
                None,
                false,
                "high".into(),
                Some("系统关键目录，移动后可能影响系统稳定性，强烈建议谨慎".into()),
            );
        }
    }

    // 高风险：驱动 / 运行库（被其他软件依赖，移动易引发连锁问题）
    if is_driver_or_runtime(display_name, &lower) {
        return (
            true,
            None,
            false,
            "high".into(),
            Some("驱动或运行库，被系统或其他软件依赖，移动后可能导致依赖软件异常".into()),
        );
    }

    // 中风险：Program Files / Program Files (x86) / ProgramData
    if lower.starts_with(r"c:\program files")
        || lower.starts_with(r"c:\programdata")
    {
        return (
            true,
            None,
            false,
            "medium".into(),
            Some("位于系统级安装目录，移动需管理员权限，建议先退出软件".into()),
        );
    }

    // 低风险：用户目录下的软件
    if let Some(local) = env_path("LOCALAPPDATA") {
        if lower.starts_with(&local.to_string_lossy().to_lowercase()) {
            return (
                true,
                None,
                false,
                "low".into(),
                Some("位于用户目录，移动风险较低".into()),
            );
        }
    }
    if let Some(roaming) = env_path("APPDATA") {
        if lower.starts_with(&roaming.to_string_lossy().to_lowercase()) {
            return (
                true,
                None,
                false,
                "low".into(),
                Some("位于用户目录，移动风险较低".into()),
            );
        }
    }

    // 默认中等风险
    (true, None, false, "medium".into(), Some("常规安装目录".into()))
}

/// 判断软件是否为本工具自身（FolderMove-Plus），避免扫描时把自己列出来。
fn is_self(display_name: &str) -> bool {
    let name = display_name.to_lowercase();
    let aliases = ["foldermove-plus", "foldermove plus", "foldermove+"];
    aliases.iter().any(|a| name == *a || name.contains(a))
}

/// 判断软件是否为驱动程序或运行库（VC++ Redistributable、.NET Runtime 等）。
///
/// 这类软件被系统或其他应用依赖，移动后极易引发依赖方异常，统一标记为高风险。
/// 双重口径：
/// - 名称关键字：DisplayName 含 driver / runtime / redistributable 等
/// - 路径关键字：安装目录含 \drivers\、\runtime\、\redist\ 等
fn is_driver_or_runtime(display_name: &str, lower_loc: &str) -> bool {
    let name = display_name.to_lowercase();

    // 名称关键字（覆盖中英文常见命名）
    let name_keywords = [
        "driver",
        "drivers",
        "驱动",
        "runtime",
        "redistributable",
        "redist",
        "运行库",
        "运行时",
        "visual c++",
        "vc++",
        "vc redist",
        "microsoft .net",
        ".net runtime",
        ".net framework",
        "java runtime",
        "jre",
        "jdk",
        "python runtime",
        "node.js runtime",
        "adobe air",
        "shockwave",
        "directx runtime",
        "physx",
    ];
    for kw in name_keywords {
        if name.contains(kw) {
            return true;
        }
    }

    // 路径关键字（避免误伤名为 "Driver" 的普通软件，路径佐证更可靠）
    let path_keywords = [
        r"\drivers\",
        r"\runtime\",
        r"\redist\",
        r"\redistributable\",
        r"\vc\",
        r"\vc++\",
        r"\dotnet\",
    ];
    for kw in path_keywords {
        if lower_loc.contains(kw) {
            return true;
        }
    }

    false
}

fn normalize_path(p: &str) -> String {
    let mut s = p.trim().to_string();
    if s.starts_with('"') && s.ends_with('"') && s.len() >= 2 {
        s = s[1..s.len() - 1].to_string();
    }
    if s.starts_with('\'') && s.ends_with('\'') && s.len() >= 2 {
        s = s[1..s.len() - 1].to_string();
    }
    while s.len() > 3 && s.ends_with('\\') {
        s.pop();
    }
    s
}

fn expand_env(s: &str) -> String {
    if !s.contains('%') {
        return s.to_string();
    }
    let chars: Vec<char> = s.chars().collect();
    let mut out = String::new();
    let mut i = 0;
    while i < chars.len() {
        if chars[i] == '%' {
            let mut j = i + 1;
            while j < chars.len() && chars[j] != '%' {
                j += 1;
            }
            if j < chars.len() && j > i + 1 {
                let name: String = chars[i + 1..j].iter().collect();
                if let Ok(val) = std::env::var(&name) {
                    out.push_str(&val);
                    i = j + 1;
                    continue;
                }
            }
        }
        out.push(chars[i]);
        i += 1;
    }
    out
}

fn env_path(name: &str) -> Option<PathBuf> {
    std::env::var_os(name).map(PathBuf::from)
}
