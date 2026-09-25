use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Duration;

use tauri::{AppHandle, Emitter};

use crate::disk;
use crate::error::{AppError, AppResult, Message};
use crate::junction;
use crate::manifest;
use crate::models::{MoveRecord, MoveRequest, ProgressPayload};

/// 进度上报回调。
///
/// 真正跑的时候由 `move_app` / `restore_app` 传一个往 Tauri 发事件的闭包；
/// 测试里传空实现即可，这样核心的文件操作流程就能被集成测试覆盖，
/// 不用为了发事件去造一个 `AppHandle`。
pub type ProgressFn<'a> = &'a dyn Fn(&str, &str, u64, u64, Message);

/// 什么都不做的进度回调（测试 / 无界面场景）
pub fn no_progress(_: &str, _: &str, _: u64, _: u64, _: Message) {}

/// robocopy 的复制范围。
///
/// `/COPYALL` 会连**审计信息（SACL）**一起复制，而这需要
/// `SeSecurityPrivilege`（"管理审核和安全日志"）。非管理员进程跑
/// `/COPYALL` 会直接以退出码 16 致命失败、**一个文件都不复制**。
///
/// 所以正式路径（应用会自提权）用 `Everything`，
/// 权限受限的调用方（比如没提权跑集成测试）可以退回 `DataAttributesTimestamps`：
/// 数据 / 属性 / 时间戳都保留，只少了 SACL 和所有者。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CopyMode {
    /// `/COPYALL`：数据+属性+时间戳+ACL+所有者+审计
    Everything,
    /// `/COPY:DAT`：数据+属性+时间戳（不需要 SeSecurityPrivilege）
    DataAttributesTimestamps,
}

impl CopyMode {
    fn flag(self) -> &'static str {
        match self {
            CopyMode::Everything => "/COPYALL",
            CopyMode::DataAttributesTimestamps => "/COPY:DAT",
        }
    }
}

/// 按当前进程权限挑复制模式。
///
/// `/COPYALL` 里的「审核」需要 `SeSecurityPrivilege`，也就是管理员。
/// 发布版会自提权所以能拿到；但调试版为了热重载**故意不自提权**，
/// 这时若还硬上 `/COPYALL`，robocopy 会以退出码 16 直接失败——
/// 用户在开发模式下看到的就是「复制阶段失败」，但完全不知道是权限问题。
///
/// 所以这里按权限自动选：没提权就用 `/COPY:DAT`（数据/属性/时间戳，
/// 覆盖实际关心的部分），并打一条日志说明少了什么。
pub fn preferred_copy_mode() -> CopyMode {
    if crate::winutil::is_elevated() {
        CopyMode::Everything
    } else {
        log::warn!(
            "未提权：复制时降级为 /COPY:DAT（不复制 SACL 与所有者）。\
             发布版会自提权，不受影响；调试版这是预期行为。"
        );
        CopyMode::DataAttributesTimestamps
    }
}

/// 某次 robocopy 失败后，是否值得换一种模式重试。
///
/// 退出码 16（`ERROR_FATAL`）在真实场景里最常见的成因就是
/// 「没有 Manage Auditing user right」，也就是 `/COPYALL` 被拒。
/// 这种情况降级到 `/COPY:DAT` 几乎总能成功，而且数据/属性/时间戳都还在，
/// 不复制审计信息对「搬软件」这件事没有任何影响。
fn should_retry_with_fallback(mode: CopyMode, err: &AppError) -> bool {
    mode == CopyMode::Everything && matches!(err, AppError::CopyFailed { code: 16, .. })
}

/// 推送进度事件。`message` 是**消息码 + 参数**，由前端按当前语言翻译。
fn emit(app: &AppHandle, id: &str, phase: &str, current: u64, total: u64, message: Message) {
    let _ = app.emit(
        "move-progress",
        ProgressPayload::new(id, phase, current, total, message),
    );
}

/// 规范化 Windows 绝对路径：
/// - 去掉首尾空白
/// - 统一使用反斜杠分隔
/// - 合并连续分隔符
/// - **关键修复**：盘符根 "D:" 恢复为 "D:\\"（否则 PathBuf::join 会按相对路径处理，导致 D:Foo 这种错误）
fn normalize_absolute_path(s: &str) -> AppResult<String> {
    let trimmed = s.trim();
    if trimmed.is_empty() {
        return Err(AppError::PathEmpty);
    }
    // 替换所有正斜杠为反斜杠
    let mut norm: String = trimmed.chars().map(|c| if c == '/' { '\\' } else { c }).collect();
    // 合并连续反斜杠（保留 UNC 前缀 \\ 的合法性这里不做通用处理，软件安装路径都在本地盘）
    let mut collapsed = String::with_capacity(norm.len());
    let mut prev_backslash = false;
    for c in norm.chars() {
        if c == '\\' {
            if !prev_backslash {
                collapsed.push(c);
            }
            prev_backslash = true;
        } else {
            collapsed.push(c);
            prev_backslash = false;
        }
    }
    norm = collapsed;
    // 去掉末尾多余的反斜杠（**保留盘符根 "\\"**）
    while norm.len() > 3 && norm.ends_with('\\') {
        norm.pop();
    }
    // 如果形如 "D:"，补反斜杠变成 "D:\\"
    let bytes: Vec<char> = norm.chars().collect();
    if bytes.len() == 2 && bytes[1] == ':' && bytes[0].is_ascii_alphabetic() {
        norm.push('\\');
    }
    // 基本校验：绝对路径
    if !Path::new(&norm).is_absolute() {
        return Err(AppError::PathNotAbsolute(norm));
    }
    Ok(norm)
}

/// 把已安装软件从 original_path 搬到 target_root 下，并在原位创建 junction。
pub fn move_app(req: MoveRequest, app: &AppHandle) -> AppResult<MoveRecord> {
    let id = uuid::Uuid::new_v4().to_string();
    let report: ProgressFn = &|phase, msg_id, current, total, message| {
        emit(app, msg_id, phase, current, total, message)
    };
    move_app_inner(&id, &req, report, preferred_copy_mode())
}

/// 移动的核心实现（不依赖 Tauri，可被集成测试直接调用）。
///
/// `report(phase, id, current, total, message)`：`id` 是为了让进度事件
/// 能带上同一次移动的 uuid，测试里通常忽略它。
pub fn move_app_inner(
    id: &str,
    req: &MoveRequest,
    report: ProgressFn,
    copy_mode: CopyMode,
) -> AppResult<MoveRecord> {
    let original = normalize_absolute_path(&req.original_path)?;
    let target_root = normalize_absolute_path(&req.target_root)?;

    // ---- 校验 ----
    if !Path::new(&original).is_dir() {
        return Err(AppError::PathNotFound(original));
    }
    if junction::is_reparse_point(&original) {
        return Err(AppError::AlreadyLinked(original));
    }
    let src_drive =
        disk::drive_of(&original).ok_or(AppError::SourceDriveUnknown)?;
    let tgt_drive =
        disk::drive_of(&target_root).ok_or(AppError::TargetDriveUnknown)?;
    if src_drive.eq_ignore_ascii_case(&tgt_drive) {
        return Err(AppError::SameDrive);
    }

    // ---- 计算大小 ----
    report("computing", id, 0, 0, Message::plain("computingSize"));
    let total = disk::compute_dir_size(&original)?;

    // ---- 空间检查（留 5% 余量）----
    let needed = total + (total / 20).max(1024 * 1024);
    let free = disk::free_bytes_of(&tgt_drive)?;
    if free < needed {
        return Err(AppError::InsufficientSpace {
            needed,
            available: free,
        });
    }

    // ---- 构造目标路径 target_root\<basename>，避免重名 ----
    let basename = Path::new(&original)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("App");
    fs::create_dir_all(&target_root)?;
    let mut new_path = PathBuf::from(&target_root).join(basename);
    let mut n = 2;
    while new_path.exists() {
        new_path = PathBuf::from(&target_root).join(format!("{}_{}", basename, n));
        n += 1;
    }
    let new_path_str = new_path.to_string_lossy().into_owned();

    // ---- 复制 ----
    report(
        "copying",
        id,
        0,
        total,
        Message::with("copyingTo", serde_json::json!({ "path": new_path_str })),
    );
    robocopy_with_fallback(&original, &new_path_str, id, total, report, copy_mode)?;
    verify_copy(total, &new_path_str)?;

    // ---- 重命名原目录为 .bak ----
    let bak = format!("{}.foldermove-plus.bak", original);
    let _ = fs::remove_dir_all(&bak);
    if let Err(e) = fs::rename(&original, &bak) {
        let _ = fs::remove_dir_all(&new_path_str);
        return Err(AppError::RenameFailed(e.to_string()));
    }

    // ---- 创建 junction ----
    report("linking", id, 0, 0, Message::plain("linking"));
    if let Err(e) = junction::create_junction(&original, &new_path_str) {
        let _ = fs::rename(&bak, &original);
        let _ = fs::remove_dir_all(&new_path_str);
        return Err(e);
    }
    if !junction::verify_junction(&original) {
        let _ = junction::delete_junction(&original);
        let _ = fs::rename(&bak, &original);
        let _ = fs::remove_dir_all(&new_path_str);
        return Err(AppError::link_failed_code("verifyFailed"));
    }

    // ---- 删除 .bak（真正释放 C 盘空间）----
    report("cleaning", id, 0, 0, Message::plain("cleaningOriginal"));
    let _ = fs::remove_dir_all(&bak);

    let record = MoveRecord {
        id: id.to_string(),
        app_name: req.app_name.clone(),
        original_path: original,
        new_path: new_path_str,
        moved_at: chrono::Local::now().to_rfc3339(),
        size_bytes: total,
        source_drive: src_drive,
        target_drive: tgt_drive,
    };
    manifest::add(record.clone())?;
    report("done", id, total, total, Message::plain("done"));
    Ok(record)
}

/// 把已移动的软件还原回原位置。
pub fn restore_app(id: &str, app: &AppHandle) -> AppResult<()> {
    let rec = manifest::find(id)?;
    let report: ProgressFn =
        &|phase, msg_id, current, total, message| emit(app, msg_id, phase, current, total, message);
    restore_inner(
        id,
        &rec.original_path,
        &rec.new_path,
        report,
        preferred_copy_mode(),
    )?;
    manifest::remove(id)
}

/// 还原的核心实现（不依赖 Tauri，可被集成测试直接调用）。
pub fn restore_inner(
    id: &str,
    original: &str,
    new_path: &str,
    report: ProgressFn,
    copy_mode: CopyMode,
) -> AppResult<()> {
    let original = original.to_string();
    let new_path = new_path.to_string();

    // ---- 先做所有「只读」的前置校验，再动任何东西 ----
    // 顺序很重要：一旦把 junction 改名成 .jold，原位置就空出来了。
    // 这时如果再失败并直接 return，就会留下「原位置没了、链接也没了」的烂摊子。
    // 所以凡是能动动手指就判断出来的失败，都必须赶在改名之前。
    if !Path::new(&new_path).is_dir() {
        return Err(AppError::PathNotFound(new_path));
    }
    if !junction::is_reparse_point(&original) {
        return Err(AppError::RestoreNotLink(original));
    }
    let total = disk::compute_dir_size(&new_path)?;
    // 目标副本是空的 → 绝不能继续：否则会把原位置铺成一个空目录
    //（等于把软件删了，而且还"删"得很成功）。
    // 走到这一步通常意味着副本被手工删过，或者当初复制就没成功。
    if total == 0 {
        return Err(AppError::TargetEmpty(new_path));
    }

    // 把 junction 重命名为 .jold（保留指向，腾出原路径槽位）
    let jold = format!("{}.foldermove-plus.jold", original);
    let _ = fs::remove_dir_all(&jold);
    if let Err(e) = fs::rename(&original, &jold) {
        return Err(AppError::link_failed(
            e.to_string(),
            "renameLink",
            serde_json::json!({ "error": e.to_string() }),
        ));
    }

    // ---- 从这里开始原位置已空出，任何失败都必须先把链接放回去 ----
    report(
        "copying",
        id,
        0,
        total,
        Message::with("restoringTo", serde_json::json!({ "path": original })),
    );
    let copy_res = robocopy_with_fallback(&new_path, &original, id, total, report, copy_mode)
        .and_then(|_| verify_copy(total, &original));
    if let Err(e) = copy_res {
        // 还原失败：把链接放回，数据仍在 new_path 安全无损
        let _ = fs::rename(&jold, &original);
        return Err(e);
    }

    report("cleaning", id, 0, 0, Message::plain("cleaningTarget"));

    // 这两步**不能**静默忽略失败：
    // 只要有一处没删掉，用户就会看到「还原完了但目录还在、里面还有文件」。
    // 常见失败原因是目录正被资源管理器 / 杀软 / 索引服务占用，
    // 这种多半是瞬时的，所以先重试再报错。
    junction::delete_junction(&jold).map_err(|e| {
        AppError::cleanup_failed(format!("{}", e), serde_json::json!({ "path": jold }))
    })?;
    remove_dir_all_retry(Path::new(&new_path)).map_err(|e| {
        AppError::cleanup_failed(e.to_string(), serde_json::json!({ "path": new_path }))
    })?;

    report("done", id, total, total, Message::plain("restoreDone"));
    Ok(())
}

/// 删除目录，带重试与只读属性兜底。
///
/// Windows 上 `remove_dir_all` 最常见的失败是「目录/文件被占用」（杀软、索引、
/// 资源管理器预览）和「只读属性」。这两种都是瞬时或可修复的，所以：
///   1. 直接删，失败就等一下重试（占用通常是瞬时的）
///   2. 仍然失败 → 递归清掉只读属性再删一次
///
/// 都失败才把错误抛出去，让上层告诉用户「目标副本没删干净」。
fn remove_dir_all_retry(dir: &Path) -> std::io::Result<()> {
    if !dir.exists() {
        return Ok(());
    }

    let mut last_err = None;
    for attempt in 0..4 {
        match fs::remove_dir_all(dir) {
            Ok(()) => return Ok(()),
            Err(e) => last_err = Some(e),
        }
        std::thread::sleep(Duration::from_millis(150 * (attempt + 1) as u64));
    }

    // 最后挣扎一次：清只读属性后重删
    clear_readonly_recursive(dir);
    match fs::remove_dir_all(dir) {
        Ok(()) => Ok(()),
        Err(e) => Err(last_err.unwrap_or(e)),
    }
}

/// 递归清掉只读属性（删除失败时调用；失败本身不致命，尽力而为）
fn clear_readonly_recursive(dir: &Path) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        // 不跟随链接：链接本身不占用多少空间，删链接交给 remove_dir_all
        if entry.file_type().map(|t| t.is_symlink()).unwrap_or(false) {
            continue;
        }
        if let Ok(md) = entry.metadata() {
            let mut perm = md.permissions();
            if perm.readonly() {
                #[allow(clippy::permissions_set_readonly_false)]
                perm.set_readonly(false);
                let _ = fs::set_permissions(&path, perm);
            }
        }
        if path.is_dir() {
            clear_readonly_recursive(&path);
        }
    }
}

/// 复制目录，必要时自动降级重试。
///
/// robocopy 只要报退出码 16（致命错误）就一个文件都没复制，所以重试是安全的
/// （没有"复制了一半"的中间状态需要收拾）。唯一会触发降级的是
/// `/COPYALL` 因缺少审核权限被拒——`should_retry_with_fallback` 里判定了。
fn robocopy_with_fallback(
    src: &str,
    dst: &str,
    id: &str,
    total: u64,
    report: ProgressFn,
    copy_mode: CopyMode,
) -> AppResult<()> {
    match robocopy(src, dst, id, total, report, copy_mode) {
        Ok(()) => Ok(()),
        Err(e) if should_retry_with_fallback(copy_mode, &e) => {
            log::warn!(
                "robocopy 以退出码 16 失败（多半是没有审核权限），降级为 /COPY:DAT 重试一次"
            );
            robocopy(src, dst, id, total, report, CopyMode::DataAttributesTimestamps)
        }
        Err(e) => Err(e),
    }
}

/// 调用 robocopy 完成目录复制，期间按目标盘大小推送进度。
fn robocopy(
    src: &str,
    dst: &str,
    id: &str,
    total: u64,
    report: ProgressFn,
    copy_mode: CopyMode,
) -> AppResult<()> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    let mut child = Command::new("robocopy")
        .arg(src)
        .arg(dst)
        .args([
            "/E",        // 含空子目录
            copy_mode.flag(), // Everything = /COPYALL；降级模式 = /COPY:DAT
            "/DCOPY:DAT",// 目录时间戳
            "/R:2",      // 重试 2 次
            "/W:5",      // 每次等待 5 秒
            "/NFL",      // 不列文件名
            "/NDL",      // 不列目录名
            "/NJH",      // 不显示头
            "/NJS",      // 不显示摘要
            "/NP",       // 不显示进度百分比
            "/MT:16",    // 16 线程
            "/XJ",       // 跳过 junction（避免跟随内部链接）
        ])
        .creation_flags(CREATE_NO_WINDOW)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| {
            AppError::copy_failed(
                0,
                e.to_string(),
                "robocopySpawn",
                serde_json::json!({ "error": e.to_string() }),
            )
        })?;

    loop {
        std::thread::sleep(Duration::from_millis(450));
        let cur = disk::compute_dir_size(dst).unwrap_or(0).min(total);
        report("copying", id, cur, total, Message::plain("copying"));
        match child.try_wait() {
            Ok(Some(status)) => {
                report(
                    "copying",
                    id,
                    total,
                    total,
                    Message::plain("copyingVerify"),
                );
                let code = status.code().unwrap_or(-1);
                if code <= 7 {
                    return Ok(());
                }
                return Err(AppError::copy_failed(
                    code as u32,
                    format!("robocopy exit code {code}"),
                    "robocopyExitCode",
                    serde_json::json!({ "code": code }),
                ));
            }
            Ok(None) => continue,
            Err(e) => {
                return Err(AppError::copy_failed(
                    0,
                    e.to_string(),
                    "robocopyWait",
                    serde_json::json!({ "error": e.to_string() }),
                ));
            }
        }
    }
}

/// 校验：目标大小不应明显小于源大小（允许 5% 误差用于元数据差异）
fn verify_copy(src_total: u64, dst: &str) -> AppResult<()> {
    let dst_size = disk::compute_dir_size(dst)?;
    if dst_size * 20 < src_total * 19 {
        return Err(AppError::VerifyFailed {
            size: dst_size,
            expected: src_total,
        });
    }
    Ok(())
}
