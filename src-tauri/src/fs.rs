//! 文件系统基础操作：列出目录下的子文件夹、创建文件夹、重命名文件夹
//!
//! 这些操作主要提供给前端内嵌的"文件管理器"组件使用，
//! 让用户在高级模式下手动选择迁移后存放的目录。

use crate::error::{AppError, AppResult};
use std::path::{Path, PathBuf};

/// 单个文件夹条目
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct FolderEntry {
    /// 短名（如 "Program Files"）
    pub name: String,
    /// 完整绝对路径
    pub path: String,
}

/// 列出指定目录下的**所有直接子文件夹**（不包含文件）。
///
/// 跳过：
/// - 无权限访问的目录
/// - 隐藏/系统目录（以防用户误操作）
/// - 重解析点（SymbolicLink / Junction），避免形成循环
pub fn list_subfolders(dir: &str) -> AppResult<Vec<FolderEntry>> {
    let base = Path::new(dir);
    // 要求输入路径必须是绝对路径且存在
    if !base.is_absolute() {
        return Err(format!("路径必须为绝对路径：{dir}").into());
    }
    let mut out: Vec<FolderEntry> = Vec::new();

    for entry in std::fs::read_dir(base)? {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };
        let ft = match entry.file_type() {
            Ok(t) => t,
            Err(_) => continue,
        };
        // 只要真实文件夹（不包含 symlink / junction，防止循环）
        if !ft.is_dir() || ft.is_symlink() {
            continue;
        }
        // 跳过带隐藏属性或系统属性的目录
        #[cfg(windows)]
        {
            use windows::Win32::Storage::FileSystem::{
                FILE_ATTRIBUTE_HIDDEN, FILE_ATTRIBUTE_SYSTEM,
            };
            let path_w =
                windows::core::HSTRING::from(entry.path().as_os_str().to_string_lossy().as_ref());
            let attrs = unsafe {
                windows::Win32::Storage::FileSystem::GetFileAttributesW(&path_w)
            };
            if attrs == u32::MAX {
                continue;
            }
            let is_hidden_or_system =
                (attrs & (FILE_ATTRIBUTE_HIDDEN.0 | FILE_ATTRIBUTE_SYSTEM.0)) != 0;
            let dot_start = entry
                .file_name()
                .to_str()
                .map(|s| s.starts_with('.'))
                .unwrap_or(false);
            if is_hidden_or_system || dot_start {
                continue;
            }
        }
        #[cfg(not(windows))]
        {
            let dot_start = entry
                .file_name()
                .to_str()
                .map(|s| s.starts_with('.'))
                .unwrap_or(false);
            if dot_start {
                continue;
            }
        }

        let name = entry
            .file_name()
            .to_string_lossy()
            .to_string();
        let path = entry.path().to_string_lossy().to_string();
        out.push(FolderEntry { name, path });
    }

    // 按名称不区分大小写排序
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(out)
}

/// 在指定父目录下创建一个新文件夹，返回新文件夹的绝对路径。
pub fn create_folder(parent: &str, name: &str) -> AppResult<String> {
    let parent = Path::new(parent);
    if !parent.is_absolute() {
        return Err(format!("父目录必须为绝对路径：{parent:?}").into());
    }
    // Windows 非法文件名字符过滤
    let cleaned = clean_folder_name(name);
    if cleaned.is_empty() {
        return Err(AppError::from("文件夹名不能为空".to_string()));
    }
    let target = parent.join(&cleaned);
    if target.exists() {
        return Err(format!("文件夹已存在：{}", target.display()).into());
    }
    std::fs::create_dir(&target)?;
    Ok(target.to_string_lossy().to_string())
}

/// 重命名一个文件夹（仅支持同目录下改名，不支持移动）。
pub fn rename_folder(old_path: &str, new_name: &str) -> AppResult<String> {
    let old = PathBuf::from(old_path);
    if !old.is_absolute() {
        return Err(format!("原路径必须为绝对路径：{old_path}").into());
    }
    if !old.is_dir() {
        return Err(format!("不是文件夹：{}", old.display()).into());
    }
    let parent = old
        .parent()
        .ok_or_else(|| format!("非法路径（无父目录）：{}", old.display()))?;
    let cleaned = clean_folder_name(new_name);
    if cleaned.is_empty() {
        return Err(AppError::from("新文件夹名不能为空".to_string()));
    }
    let new_path = parent.join(&cleaned);
    if new_path.exists() {
        return Err(format!("同名文件夹已存在：{}", new_path.display()).into());
    }
    std::fs::rename(&old, &new_path)?;
    Ok(new_path.to_string_lossy().to_string())
}

fn clean_folder_name(name: &str) -> String {
    let s = name.trim();
    // Windows 下非法字符：\ / : * ? " < > |
    let mut out = String::with_capacity(s.len());
    for ch in s.chars() {
        match ch {
            '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => continue,
            c => out.push(c),
        }
    }
    // 末尾不能是空格或点（Windows 限制）
    let out = out.trim_end_matches(&[' ', '.'][..]).to_string();
    // 过滤 Windows 保留名
    let reserved = [
        "CON", "PRN", "AUX", "NUL",
        "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
        "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
    ];
    if reserved.iter().any(|r| r.eq_ignore_ascii_case(&out)) {
        return String::new();
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clean_name_removes_invalid_chars() {
        assert_eq!(clean_folder_name("a/b:c*d?e\"f<g>h|i"), "abcdefghi");
    }

    #[test]
    fn clean_name_trims_trailing_space_and_dot() {
        assert_eq!(clean_folder_name("test ..  "), "test");
    }

    #[test]
    fn clean_name_rejects_reserved() {
        assert_eq!(clean_folder_name("CON"), "");
        assert_eq!(clean_folder_name("lpt1"), "");
    }
}
