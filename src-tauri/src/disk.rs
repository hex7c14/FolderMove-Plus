use std::ffi::OsStr;
use std::os::windows::ffi::OsStrExt;
use std::os::windows::fs::MetadataExt;
use std::path::Path;

use windows::core::PCWSTR;
use windows::Win32::Storage::FileSystem::{
    GetDiskFreeSpaceExW, GetDriveTypeW, GetLogicalDriveStringsW, GetVolumeInformationW,
};

use crate::error::AppError;
use crate::error::AppResult;
use crate::models::DriveInfo;

const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;

// GetDriveTypeW 返回值常量（windows crate 0.58 未直接导出）
const DRIVE_REMOVABLE: u32 = 2;
const DRIVE_FIXED: u32 = 3;
const DRIVE_REMOTE: u32 = 4;
const DRIVE_CDROM: u32 = 5;
const DRIVE_RAMDISK: u32 = 6;

/// 枚举所有本地固定/可移动盘
pub fn list_drives() -> AppResult<Vec<DriveInfo>> {
    let mut buf = [0u16; 512];
    let len = unsafe { GetLogicalDriveStringsW(Some(&mut buf)) };
    if len == 0 {
        return Ok(vec![]);
    }
    let raw: Vec<u16> = buf[..len as usize].to_vec();

    let mut drives = Vec::new();
    let mut start = 0usize;
    while start < raw.len() {
        let mut end = start;
        while end < raw.len() && raw[end] != 0 {
            end += 1;
        }
        if end == start {
            break;
        }
        let s = String::from_utf16_lossy(&raw[start..end]);
        if let Ok(info) = query_drive(&s) {
            drives.push(info);
        }
        start = end + 1;
    }
    Ok(drives)
}

fn query_drive(root: &str) -> AppResult<DriveInfo> {
    let wide: Vec<u16> = OsStr::new(root).encode_wide().chain(std::iter::once(0)).collect();
    let ptr = PCWSTR(wide.as_ptr());

    let dt = unsafe { GetDriveTypeW(ptr) };
    let drive_type = match dt {
        DRIVE_FIXED => "Fixed",
        DRIVE_REMOVABLE => "Removable",
        DRIVE_REMOTE => "Network",
        DRIVE_CDROM => "CDRom",
        DRIVE_RAMDISK => "RamDisk",
        _ => "Unknown",
    };

    let mut free_bytes: u64 = 0;
    let mut total_bytes: u64 = 0;
    let mut avail_bytes: u64 = 0;
    let _ = unsafe {
        GetDiskFreeSpaceExW(
            ptr,
            Some(&mut free_bytes as *mut u64),
            Some(&mut total_bytes as *mut u64),
            Some(&mut avail_bytes as *mut u64),
        )
    };

    let mut label_buf = [0u16; 261];
    let label = match unsafe {
        GetVolumeInformationW(
            ptr,
            Some(&mut label_buf),
            None,
            None,
            None,
            None,
        )
    } {
        Ok(_) => {
            let len = label_buf
                .iter()
                .position(|&c| c == 0)
                .unwrap_or(label_buf.len());
            if len > 0 {
                Some(String::from_utf16_lossy(&label_buf[..len]))
            } else {
                None
            }
        }
        Err(_) => None,
    };

    Ok(DriveInfo {
        letter: root.to_string(),
        label,
        drive_type: drive_type.to_string(),
        total_bytes,
        free_bytes,
    })
}

/// 给定任意路径，返回它所在的盘符，例如 "C:\\"
pub fn drive_of(path: &str) -> Option<String> {
    let p = Path::new(path);
    // 若是相对路径，先拼接到当前工作目录
    let abs = if p.is_absolute() {
        p.to_path_buf()
    } else {
        std::env::current_dir().ok()?.join(p)
    };
    let s = abs.to_string_lossy();
    // canonicalize 会引入 \\?\ 前缀，这里只用绝对路径字符串本身
    let chars: Vec<char> = s.chars().collect();
    if chars.len() >= 2 && chars[1] == ':' {
        // 规范化为 "C:\\"
        return Some(format!("{}:\\", chars[0].to_ascii_uppercase()));
    }
    // 兜底：从原始字符串直接取首字符
    let raw_chars: Vec<char> = path.trim().chars().collect();
    if raw_chars.len() >= 2 && raw_chars[1] == ':' {
        return Some(format!("{}:\\", raw_chars[0].to_ascii_uppercase()));
    }
    None
}

/// 查询指定盘符可用空间
pub fn free_bytes_of(drive_root: &str) -> AppResult<u64> {
    let wide: Vec<u16> = OsStr::new(drive_root)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let ptr = PCWSTR(wide.as_ptr());
    let mut free_bytes: u64 = 0;
    let mut total_bytes: u64 = 0;
    let mut avail_bytes: u64 = 0;
    unsafe {
        GetDiskFreeSpaceExW(
            ptr,
            Some(&mut free_bytes as *mut u64),
            Some(&mut total_bytes as *mut u64),
            Some(&mut avail_bytes as *mut u64),
        )
        .map_err(|e| AppError::Windows(format!("GetDiskFreeSpaceExW: {e}")))?;
    }
    Ok(free_bytes)
}

/// 递归计算目录占用字节数（不跟随 reparse point）
pub fn compute_dir_size(path: &str) -> AppResult<u64> {
    let start = std::path::PathBuf::from(path);
    let mut total: u64 = 0;
    let mut stack: Vec<std::path::PathBuf> = vec![start];
    while let Some(dir) = stack.pop() {
        let rd = match std::fs::read_dir(&dir) {
            Ok(r) => r,
            Err(_) => continue,
        };
        for entry in rd.flatten() {
            let meta = match entry.metadata() {
                Ok(m) => m,
                Err(_) => continue,
            };
            let is_reparse = meta.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0;
            if meta.is_file() {
                total += meta.len();
            } else if meta.is_dir() && !is_reparse {
                stack.push(entry.path());
            }
        }
    }
    Ok(total)
}
