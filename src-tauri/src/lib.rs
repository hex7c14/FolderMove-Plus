mod disk;
mod error;
mod fs;
mod icon;
mod junction;
mod manifest;
mod models;
mod mover;
mod proc;
mod scan;

use fs::FolderEntry;
use models::{AppInfo, DriveInfo, MoveRecord, MoveRequest};
use proc::{KillResult, ProcInfo};
use tauri::AppHandle;

#[tauri::command]
async fn scan_apps() -> Result<Vec<AppInfo>, String> {
    tauri::async_runtime::spawn_blocking(scan::scan_apps)
        .await
        .map_err(|e| format!("{e}"))?
        .map_err(Into::into)
}

#[tauri::command]
async fn list_drives() -> Result<Vec<DriveInfo>, String> {
    tauri::async_runtime::spawn_blocking(disk::list_drives)
        .await
        .map_err(|e| format!("{e}"))?
        .map_err(Into::into)
}

#[tauri::command]
fn get_default_target(source_drive: String) -> Option<String> {
    if let Ok(drives) = disk::list_drives() {
        for d in drives {
            if d.drive_type == "Fixed" && !d.letter.eq_ignore_ascii_case(&source_drive) {
                return Some(format!("{}FolderMove-Plus", d.letter));
            }
        }
    }
    None
}

#[tauri::command]
async fn compute_size(path: String) -> Result<u64, String> {
    tauri::async_runtime::spawn_blocking(move || disk::compute_dir_size(&path))
        .await
        .map_err(|e| format!("{e}"))?
        .map_err(Into::into)
}

#[tauri::command]
async fn move_app(req: MoveRequest, app: AppHandle) -> Result<MoveRecord, String> {
    tauri::async_runtime::spawn_blocking(move || mover::move_app(req, &app))
        .await
        .map_err(|e| format!("{e}"))?
        .map_err(Into::into)
}

#[tauri::command]
async fn restore_app(id: String, app: AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || mover::restore_app(&id, &app))
        .await
        .map_err(|e| format!("{e}"))?
        .map_err(Into::into)
}

#[tauri::command]
fn list_moved() -> Result<Vec<MoveRecord>, String> {
    manifest::load().map_err(Into::into)
}

/// 检测某目录下仍有进程占用的可执行文件
#[tauri::command]
async fn check_processes(path: String) -> Result<Vec<ProcInfo>, String> {
    tauri::async_runtime::spawn_blocking(move || proc::list_processes_in_dir(&path))
        .await
        .map_err(|e| format!("{e}"))?
        .map_err(Into::into)
}

/// 结束指定 pid 的进程
#[tauri::command]
async fn kill_processes(pids: Vec<u32>) -> Result<KillResult, String> {
    tauri::async_runtime::spawn_blocking(move || proc::kill_processes(pids))
        .await
        .map_err(|e| format!("{e}"))?
        .map_err(Into::into)
}

/// 列出指定目录下的直接子文件夹（仅文件夹，不包含文件；自动跳过隐藏/系统目录）
#[tauri::command]
async fn list_folders(dir: String) -> Result<Vec<FolderEntry>, String> {
    tauri::async_runtime::spawn_blocking(move || fs::list_subfolders(&dir))
        .await
        .map_err(|e| format!("{e}"))?
        .map_err(Into::into)
}

/// 在指定父目录下创建一个新文件夹
#[tauri::command]
async fn create_folder(parent: String, name: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || fs::create_folder(&parent, &name))
        .await
        .map_err(|e| format!("{e}"))?
        .map_err(Into::into)
}

/// 重命名一个文件夹（仅支持同目录改名，不跨目录移动）
#[tauri::command]
async fn rename_folder(old_path: String, new_name: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || fs::rename_folder(&old_path, &new_name))
        .await
        .map_err(|e| format!("{e}"))?
        .map_err(Into::into)
}

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            scan_apps,
            list_drives,
            get_default_target,
            compute_size,
            move_app,
            restore_app,
            list_moved,
            check_processes,
            kill_processes,
            list_folders,
            create_folder,
            rename_folder,
        ])
        .run(tauri::generate_context!())
        .expect("启动 FolderMove-Plus 失败");
}
