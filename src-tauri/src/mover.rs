use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Duration;

use tauri::{AppHandle, Emitter};

use crate::disk;
use crate::error::{AppError, AppResult};
use crate::junction;
use crate::manifest;
use crate::models::{MoveRecord, MoveRequest, ProgressPayload};

fn emit(app: &AppHandle, id: &str, phase: &str, current: u64, total: u64, msg: impl Into<String>) {
    let _ = app.emit(
        "move-progress",
        ProgressPayload::new(id, phase, current, total, msg),
    );
}

/// 把已安装软件从 original_path 搬到 target_root 下，并在原位创建 junction。
pub fn move_app(req: MoveRequest, app: &AppHandle) -> AppResult<MoveRecord> {
    let id = uuid::Uuid::new_v4().to_string();
    let original = req.original_path.trim().trim_end_matches('\\').to_string();
    let target_root = req.target_root.trim().trim_end_matches('\\').to_string();

    // ---- 校验 ----
    if !Path::new(&original).is_dir() {
        return Err(AppError::PathNotFound(original));
    }
    if junction::is_reparse_point(&original) {
        return Err(AppError::AlreadyLinked(original));
    }
    let src_drive = disk::drive_of(&original)
        .ok_or_else(|| AppError::Other("无法识别源盘符".into()))?;
    let tgt_drive = disk::drive_of(&target_root)
        .ok_or_else(|| AppError::Other("无法识别目标盘符".into()))?;
    if src_drive.eq_ignore_ascii_case(&tgt_drive) {
        return Err(AppError::SameDrive);
    }

    // ---- 计算大小 ----
    emit(app, &id, "computing", 0, 0, "正在计算占用大小…");
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
    emit(
        app,
        &id,
        "copying",
        0,
        total,
        format!("正在复制到 {}", new_path_str),
    );
    robocopy(&original, &new_path_str, &id, total, app)?;
    verify_copy(total, &new_path_str)?;

    // ---- 重命名原目录为 .bak ----
    let bak = format!("{}.foldermove-plus.bak", original);
    let _ = fs::remove_dir_all(&bak);
    if let Err(e) = fs::rename(&original, &bak) {
        let _ = fs::remove_dir_all(&new_path_str);
        return Err(AppError::RenameFailed(e.to_string()));
    }

    // ---- 创建 junction ----
    emit(app, &id, "linking", 0, 0, "正在创建链接…");
    if let Err(e) = junction::create_junction(&original, &new_path_str) {
        let _ = fs::rename(&bak, &original);
        let _ = fs::remove_dir_all(&new_path_str);
        return Err(e);
    }
    if !junction::verify_junction(&original) {
        let _ = junction::delete_junction(&original);
        let _ = fs::rename(&bak, &original);
        let _ = fs::remove_dir_all(&new_path_str);
        return Err(AppError::LinkFailed("junction 校验失败".into()));
    }

    // ---- 删除 .bak（真正释放 C 盘空间）----
    emit(app, &id, "cleaning", 0, 0, "正在清理原文件…");
    let _ = fs::remove_dir_all(&bak);

    let record = MoveRecord {
        id: id.clone(),
        app_name: req.app_name,
        original_path: original,
        new_path: new_path_str,
        moved_at: chrono::Local::now().to_rfc3339(),
        size_bytes: total,
        source_drive: src_drive,
        target_drive: tgt_drive,
    };
    manifest::add(record.clone())?;
    emit(app, &id, "done", total, total, "完成");
    Ok(record)
}

/// 把已移动的软件还原回原位置。
pub fn restore_app(id: &str, app: &AppHandle) -> AppResult<()> {
    let rec = manifest::find(id)?;
    let original = rec.original_path.clone();
    let new_path = rec.new_path.clone();

    if !Path::new(&new_path).is_dir() {
        return Err(AppError::PathNotFound(new_path));
    }
    if !junction::is_reparse_point(&original) {
        return Err(AppError::Other(format!(
            "原路径 {} 不是链接，可能已被手动处理，无法自动还原",
            original
        )));
    }

    // 把 junction 重命名为 .jold（保留指向，腾出原路径槽位）
    let jold = format!("{}.foldermove-plus.jold", original);
    let _ = fs::remove_dir_all(&jold);
    if let Err(e) = fs::rename(&original, &jold) {
        return Err(AppError::LinkFailed(format!("重命名链接失败: {e}")));
    }

    let total = disk::compute_dir_size(&new_path)?;
    emit(
        app,
        id,
        "copying",
        0,
        total,
        format!("回迁到 {}", original),
    );
    let copy_res = robocopy(&new_path, &original, id, total, app).and_then(|_| verify_copy(total, &original));
    if let Err(e) = copy_res {
        // 还原失败：把链接放回，数据仍在 new_path 安全无损
        let _ = fs::rename(&jold, &original);
        return Err(e);
    }

    emit(app, id, "cleaning", 0, 0, "清理目标盘副本…");
    let _ = junction::delete_junction(&jold);
    let _ = fs::remove_dir_all(&new_path);

    manifest::remove(id)?;
    emit(app, id, "done", total, total, "还原完成");
    Ok(())
}

/// 调用 robocopy 完成目录复制，期间按目标盘大小推送进度。
fn robocopy(src: &str, dst: &str, id: &str, total: u64, app: &AppHandle) -> AppResult<()> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    let mut child = Command::new("robocopy")
        .arg(src)
        .arg(dst)
        .args([
            "/E",        // 含空子目录
            "/COPYALL",  // 复制数据/属性/时间戳/ACL/所有者/审核
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
        .map_err(|e| AppError::CopyFailed {
            code: 0,
            detail: format!("启动 robocopy 失败: {e}"),
        })?;

    loop {
        std::thread::sleep(Duration::from_millis(450));
        let cur = disk::compute_dir_size(dst).unwrap_or(0).min(total);
        emit(app, id, "copying", cur, total, "复制中…");
        match child.try_wait() {
            Ok(Some(status)) => {
                emit(app, id, "copying", total, total, "复制完成，校验中…");
                let code = status.code().unwrap_or(-1);
                if code <= 7 {
                    return Ok(());
                }
                return Err(AppError::CopyFailed {
                    code: code as u32,
                    detail: format!(
                        "robocopy 退出码 {}（≥8 表示有文件失败，可能被占用，请先关闭该软件）",
                        code
                    ),
                });
            }
            Ok(None) => continue,
            Err(e) => {
                return Err(AppError::CopyFailed {
                    code: 0,
                    detail: format!("等待 robocopy 结束失败: {e}"),
                });
            }
        }
    }
}

/// 校验：目标大小不应明显小于源大小（允许 5% 误差用于元数据差异）
fn verify_copy(src_total: u64, dst: &str) -> AppResult<()> {
    let dst_size = disk::compute_dir_size(dst)?;
    if dst_size * 20 < src_total * 19 {
        return Err(AppError::VerifyFailed(format!(
            "目标 {} 字节，源约 {} 字节，复制不完整",
            dst_size, src_total
        )));
    }
    Ok(())
}
