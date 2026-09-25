//! 移动 / 还原流程的集成测试。
//!
//! 在临时目录里真实走一遍「复制 → 重命名 → 建 junction → 清理 → 还原 → 清理」，
//! 调用的就是发布时跑的那两个函数（`move_app_inner` / `restore_inner`），
//! 只把进度回调换成空实现。
//!
//! 「目标盘」用 `subst` 映射成一个独立盘符——正式逻辑里有「原位置与目标
//! 必须在不同盘」的校验，测试不能绕过它，否则测的就不是真实路径了。
//!
//! 这组测试守的是一个具体 bug：**搬完再还原，目标盘的副本应被删干净**。

#![cfg(windows)]

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use foldermove_plus_lib::testkit;
use foldermove_plus_lib::testkit::{force_remove_tree, is_junction, move_request};

/// 候选盘符：挑一个当前没被占用的映射成沙箱目录
const DRIVE_CANDIDATES: &[&str] = &[
    "X:", "Y:", "Z:", "W:", "V:", "U:", "T:", "S:", "R:", "Q:", "P:", "O:", "N:", "M:", "L:",
    "K:", "J:", "I:", "H:", "G:", "F:",
];

/// 临时工作区 + 一个 subst 出来的目标盘符
struct Sandbox {
    root: PathBuf,
    /// subst 出来的盘符（如 "X:"），没有则为 None，测试会跳过
    drive: Option<String>,
}

impl Sandbox {
    fn new(name: &str) -> Self {
        let root = std::env::temp_dir().join(format!("fmp-it-{}-{}", name, std::process::id()));
        let _ = force_remove_tree(&root);
        fs::create_dir_all(&root).expect("创建沙箱失败");

        let target_dir = root.join("dst");
        fs::create_dir_all(&target_dir).expect("创建目标目录失败");
        let drive = subst_mount(&target_dir).map(|d| d.to_string());

        Self { root, drive }
    }

    /// 假的「软件安装目录」（原位置，在系统盘）
    fn original(&self) -> PathBuf {
        self.root.join("src").join("app").join("FakeApp")
    }

    /// 假的「高级模式下选的存放目录」——位于 subst 出来的另一个盘
    fn target_root(&self) -> PathBuf {
        match &self.drive {
            Some(d) => PathBuf::from(format!("{}\\chosen", d)),
            None => self.root.join("dst").join("chosen"),
        }
    }

    fn target(&self) -> PathBuf {
        self.target_root().join("FakeApp")
    }

    fn has_separate_drive(&self) -> bool {
        self.drive.is_some()
    }
}

impl Drop for Sandbox {
    fn drop(&mut self) {
        if let Some(d) = &self.drive {
            let _ = subst_unmount(d);
        }
        let _ = force_remove_tree(&self.root);
    }
}

/// 把 dir 映射到一个空闲盘符，返回盘符（如 "X:"）
fn subst_mount(dir: &Path) -> Option<String> {
    for letter in DRIVE_CANDIDATES {
        if Path::new(&format!("{}\\", letter)).exists() {
            continue;
        }
        let out = Command::new("subst")
            .arg(letter)
            .arg(dir)
            .output()
            .ok()?;
        if out.status.success() && Path::new(&format!("{}\\", letter)).exists() {
            return Some((*letter).to_string());
        }
    }
    None
}

fn subst_unmount(letter: &str) -> std::io::Result<()> {
    Command::new("subst").arg(letter).arg("/D").status().map(|_| ())
}

fn make_fake_app(dir: &Path) {
    fs::create_dir_all(dir.join("sub").join("deep")).unwrap();
    fs::write(dir.join("app.exe"), b"binary").unwrap();
    fs::write(dir.join("sub").join("data.bin"), vec![7u8; 8192]).unwrap();
    fs::write(dir.join("sub").join("deep").join("nested.txt"), b"nested").unwrap();
}

/// 列出直接子项名字（含文件）
fn entries(dir: &Path) -> Vec<String> {
    let mut v: Vec<String> = fs::read_dir(dir)
        .map(|it| {
            it.filter_map(|e| e.ok())
                .map(|e| e.file_name().to_string_lossy().to_string())
                .collect()
        })
        .unwrap_or_else(|_| Vec::new());
    v.sort();
    v
}

fn describe(dir: &Path) -> String {
    format!(
        "{} (存在={}, 子项={:?})",
        dir.display(),
        dir.exists(),
        entries(dir)
    )
}

/// 跑一次完整的「移动 → 还原」，返回沙箱和两个路径
fn move_and_restore(name: &str) -> Option<(Sandbox, PathBuf, PathBuf, PathBuf)> {
    let sb = Sandbox::new(name);
    if !sb.has_separate_drive() {
        eprintln!("跳过 {name}：subst 不可用，造不出跨盘场景");
        return None;
    }
    let original = sb.original();
    let target_root = sb.target_root();
    let target = sb.target();

    make_fake_app(&original);
    assert_eq!(entries(&original), vec!["app.exe", "sub"], "假软件的顶层子项");

    let req = move_request("FakeApp", &original, &target_root);
    testkit::move_app_inner("it-move", &req, &testkit::no_progress, testkit::test_copy_mode())
        .unwrap_or_else(|e| panic!("移动失败: {e}"));

    testkit::restore_inner(
        "it-move",
        &original.to_string_lossy(),
        &target.to_string_lossy(),
        &testkit::no_progress,

        testkit::test_copy_mode(),
    )
    .unwrap_or_else(|e| panic!("还原失败: {e}"));

    Some((sb, original, target_root, target))
}

#[test]
fn move_actually_works_across_drives() {
    let sb = Sandbox::new("move-only");
    if !sb.has_separate_drive() {
        eprintln!("跳过：subst 不可用");
        return;
    }
    let original = sb.original();
    let target_root = sb.target_root();
    let target = sb.target();

    make_fake_app(&original);

    let req = move_request("FakeApp", &original, &target_root);
    testkit::move_app_inner("mv", &req, &testkit::no_progress, testkit::test_copy_mode())
        .unwrap_or_else(|e| panic!("移动失败: {e}"));

    assert!(is_junction(&original), "移动后原位置应变成 junction");
    assert!(target.is_dir(), "移动后目标位置应有真实目录");
    assert!(!is_junction(&target), "目标位置应是真实目录而不是链接");
    assert!(
        target.join("sub").join("deep").join("nested.txt").is_file(),
        "目标位置应包含最深层的文件"
    );
    // 隔着 junction 看原位置，内容应与移动前一致
    assert_eq!(
        entries(&original),
        vec!["app.exe", "sub"],
        "隔着 junction 应能看到原来的两个子项，实际 {}",
        describe(&original)
    );
    // 原位置旁边不该留下 .bak
    let leftovers: Vec<String> = entries(original.parent().unwrap())
        .into_iter()
        .filter(|n| n.contains("foldermove-plus"))
        .collect();
    assert!(leftovers.is_empty(), "移动后不应残留中间产物：{leftovers:?}");
}

#[test]
fn restore_leaves_nothing_on_target() {
    let Some((_sb, original, _target_root, target)) = move_and_restore("restore-clean") else {
        return;
    };

    // 原位置：变回真实目录，内容完整
    assert!(original.is_dir(), "还原后原位置应存在");
    assert!(!is_junction(&original), "还原后原位置不应再是 junction");
    assert!(original.join("app.exe").is_file(), "还原后应找回 app.exe");
    assert!(
        original.join("sub").join("deep").join("nested.txt").is_file(),
        "还原后应找回深层文件"
    );
    assert_eq!(entries(&original), vec!["app.exe", "sub"], "还原后内容应与移动前一致");

    // 目标位置：副本必须被删干净 ← 本次要守住的点
    assert!(
        !target.exists(),
        "还原后目标盘的副本应被删除，但它还在：{}",
        describe(&target)
    );
}

#[test]
fn target_root_is_kept_but_emptied() {
    let Some((_sb, _original, target_root, _target)) = move_and_restore("keep-root") else {
        return;
    };

    // 「用户选的目录」本身不归我们删，但里面必须空了
    assert!(target_root.is_dir(), "用户选的目录本身应保留");
    assert!(
        entries(&target_root).is_empty(),
        "用户选的目录里不应再有软件副本，实际 {}",
        describe(&target_root)
    );
}

#[test]
fn no_intermediate_artifacts_after_restore() {
    let Some((_sb, original, _target_root, _target)) = move_and_restore("no-artifacts") else {
        return;
    };

    let parent = original.parent().unwrap();
    let leftovers: Vec<String> = entries(parent)
        .into_iter()
        .filter(|n| n.contains("foldermove-plus"))
        .collect();
    assert!(
        leftovers.is_empty(),
        "还原后原位置旁边不应残留中间产物，实际 {leftovers:?}（{}）",
        describe(parent)
    );

    let inside: Vec<String> = entries(&original)
        .into_iter()
        .filter(|n| n.contains("foldermove-plus"))
        .collect();
    assert!(inside.is_empty(), "原位置内不应残留中间产物：{inside:?}");
}
