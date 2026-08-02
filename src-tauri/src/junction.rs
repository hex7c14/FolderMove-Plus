use std::ffi::OsStr;
use std::os::windows::ffi::OsStrExt;
use std::os::windows::fs::MetadataExt;
use std::path::Path;

use windows::core::PCWSTR;
use windows::Win32::Foundation::{CloseHandle, HANDLE};
use windows::Win32::Storage::FileSystem::{
    CreateFileW, RemoveDirectoryW, FILE_FLAG_BACKUP_SEMANTICS, FILE_FLAG_OPEN_REPARSE_POINT,
    FILE_SHARE_DELETE, FILE_SHARE_READ, FILE_SHARE_WRITE, OPEN_EXISTING,
};
use windows::Win32::System::IO::DeviceIoControl;

use crate::error::{AppError, AppResult};

const IO_REPARSE_TAG_MOUNT_POINT: u32 = 0xA000_0003;
const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
const GENERIC_WRITE: u32 = 0x4000_0000;
// FSCTL_SET_REPARSE_POINT = CTL_CODE(FILE_DEVICE_FILE_SYSTEM, 41, METHOD_BUFFERED, FILE_ANY_ACCESS)
const FSCTL_SET_REPARSE_POINT: u32 = 0x0009_00A4;

fn os_wide(s: &str) -> Vec<u16> {
    OsStr::new(s).encode_wide().chain(std::iter::once(0)).collect()
}

/// 判断路径是否是 reparse point（junction / symlink）
pub fn is_reparse_point(path: &str) -> bool {
    match std::fs::symlink_metadata(path) {
        Ok(m) => m.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0,
        Err(_) => false,
    }
}

/// 在 link_path 处创建一个指向 target_path 的 NTFS junction。
/// 调用前需保证 link_path 不存在。
pub fn create_junction(link_path: &str, target_path: &str) -> AppResult<()> {
    // 1. 先建空目录
    std::fs::create_dir(link_path)
        .map_err(|e| AppError::LinkFailed(format!("创建目录失败: {e}")))?;

    // 2. 以 reparse 语义打开
    let wide = os_wide(link_path);
    let handle = unsafe {
        CreateFileW(
            PCWSTR(wide.as_ptr()),
            GENERIC_WRITE,
            FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
            None,
            OPEN_EXISTING,
            FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT,
            None,
        )
    };
    let handle: HANDLE = handle
        .map_err(|e| AppError::LinkFailed(format!("打开目录失败: {e}")))?;

    // 3. 设置 reparse point
    let buf = build_mount_point_buffer(target_path);
    let r = unsafe {
        DeviceIoControl(
            handle,
            FSCTL_SET_REPARSE_POINT,
            Some(buf.as_ptr() as *const _),
            buf.len() as u32,
            None,
            0,
            None,
            None,
        )
    };
    let _ = unsafe { CloseHandle(handle) };

    if r.is_err() {
        // 设置失败：删掉刚才建的空目录，避免残留
        let _ = std::fs::remove_dir(link_path);
        return Err(AppError::LinkFailed(format!(
            "FSCTL_SET_REPARSE_POINT 失败: {:?}",
            r.err()
        )));
    }
    Ok(())
}

/// 删除一个 junction（仅删除链接本身，不影响其指向的目标内容）
pub fn delete_junction(link_path: &str) -> AppResult<()> {
    let wide = os_wide(link_path);
    unsafe {
        RemoveDirectoryW(PCWSTR(wide.as_ptr()))
            .map_err(|e| AppError::LinkFailed(format!("RemoveDirectoryW 失败: {e}")))?;
    }
    Ok(())
}

/// 验证 junction：本身是 reparse point，且能作为目录被访问（目标真实存在）
pub fn verify_junction(link_path: &str) -> bool {
    is_reparse_point(link_path) && Path::new(link_path).is_dir()
}

/// 构造 mount point reparse data buffer（按字节布局）
fn build_mount_point_buffer(target: &str) -> Vec<u8> {
    // substitute name 使用 NT 路径前缀 \??\
    let substitute: Vec<u16> = format!(r"\??\{}", target).encode_utf16().collect();
    let print: Vec<u16> = target.encode_utf16().collect();

    let sub_len = (substitute.len() * 2) as u16;
    let print_len = (print.len() * 2) as u16;
    let sub_offset: u16 = 0;
    let print_offset: u16 = sub_len + 2;

    // PathBuffer = substitute + \0 + print + \0
    let path_buf_bytes = sub_len as usize + 2 + print_len as usize + 2;
    // ReparseDataLength = 8 (4 个 u16 字段) + PathBuffer 字节数
    let data_len: u16 = (8 + path_buf_bytes) as u16;

    let mut buf: Vec<u8> = Vec::with_capacity(8 + path_buf_bytes);
    buf.extend_from_slice(&IO_REPARSE_TAG_MOUNT_POINT.to_le_bytes());
    buf.extend_from_slice(&data_len.to_le_bytes());
    buf.extend_from_slice(&0u16.to_le_bytes()); // Reserved
    buf.extend_from_slice(&sub_offset.to_le_bytes());
    buf.extend_from_slice(&sub_len.to_le_bytes());
    buf.extend_from_slice(&print_offset.to_le_bytes());
    buf.extend_from_slice(&print_len.to_le_bytes());
    for w in &substitute {
        buf.extend_from_slice(&w.to_le_bytes());
    }
    buf.extend_from_slice(&0u16.to_le_bytes());
    for w in &print {
        buf.extend_from_slice(&w.to_le_bytes());
    }
    buf.extend_from_slice(&0u16.to_le_bytes());
    buf
}
