//! 集成测试支撑模块。
//!
//! 这个模块只做两件事：
//!   1. 把 `mover` 里的编排函数重新导出（`tests/` 是独立 crate，够不到私有模块）
//!   2. 提供几个「站在测试视角」才需要的小工具（判断 junction、诊断式删除）
//!
//! ⚠️ 里面**不含任何业务逻辑**——真要调用的是 `mover::move_app_inner` /
//! `mover::restore_inner` 本体，测试跑的必须是发布时跑的那段代码。

pub use crate::mover::{
    move_app_inner, no_progress, restore_inner, CopyMode, ProgressFn,
};
pub use crate::models::MoveRequest;

use std::path::Path;

/// 判断路径是不是 reparse point（junction / symlink）。
///
/// 走的是正式代码里的实现，保证测试和运行时的判据完全一致。
pub fn is_junction(path: &Path) -> bool {
    crate::junction::is_reparse_point(&path.to_string_lossy())
}

/// 测试用例收尾用：把沙箱目录连同里面的 junction 一起删掉。
///
/// 不能直接用 `remove_dir_all`——目录树里若残留 junction，
/// Windows 上的行为不值得赌；这里逐个 entry 处理，遇到链接先删链接本身。
pub fn force_remove_tree(root: &Path) -> std::io::Result<()> {
    if !root.exists() {
        return Ok(());
    }
    if is_junction(root) {
        return crate::junction::delete_junction(&root.to_string_lossy())
            .map_err(|e| std::io::Error::other(e.to_string()));
    }
    for entry in std::fs::read_dir(root)? {
        let entry = entry?;
        let path = entry.path();
        let ft = entry.file_type()?;
        if ft.is_dir() {
            force_remove_tree(&path)?;
        } else {
            let _ = std::fs::remove_file(&path);
        }
    }
    std::fs::remove_dir(root)
}

/// 构造一个移动请求（省得测试里到处写结构体字面量）
pub fn move_request(app_name: &str, original: &Path, target_root: &Path) -> MoveRequest {
    MoveRequest {
        app_name: app_name.to_string(),
        original_path: original.to_string_lossy().to_string(),
        target_root: target_root.to_string_lossy().to_string(),
    }
}

/// 集成测试该用哪种复制模式。
///
/// 正式路径用 `/COPYALL`，但它需要 `SeSecurityPrivilege`（管理员）才能复制
/// 审计信息；**没提权时会以退出码 16 直接失败、一个文件都不复制**。
/// 集成测试默认跑在未提权的进程里，所以固定用 `/COPY:DAT`：
/// 测的仍是同一套流程、同一套文件操作，只是少复制一份 SACL。
pub fn test_copy_mode() -> CopyMode {
    CopyMode::DataAttributesTimestamps
}

/// 判断当前进程是否已提权（管理员）。走的是运行时同一份实现。
pub fn is_elevated() -> bool {
    crate::winutil::is_elevated()
}
