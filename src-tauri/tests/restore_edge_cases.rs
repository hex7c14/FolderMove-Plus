//! 逼出「还原后目标目录还在」的真实条件。
//!
//! 正常路径已经验证是干净的（见 `restore.rs`），所以这里专挑异常输入：
//! 只读文件、目录带只读属性、目标里混进链接、清理阶段被占用等。

#![cfg(windows)]

use std::fs;
use std::path::{Path, PathBuf};

use foldermove_plus_lib::testkit;
use foldermove_plus_lib::testkit::{force_remove_tree, is_junction, move_request};

// ---------- 沙箱（与 restore.rs 同款，带 subst 盘符） ----------

const DRIVE_CANDIDATES: &[&str] = &[
    "X:", "Y:", "Z:", "W:", "V:", "U:", "T:", "S:", "R:", "Q:", "P:", "O:", "N:", "M:", "L:",
    "K:", "J:", "I:", "H:", "G:", "F:",
];

struct Sandbox {
    root: PathBuf,
    drive: Option<String>,
}

impl Sandbox {
    fn new(name: &str) -> Self {
        let root = std::env::temp_dir().join(format!("fmp-edge-{}-{}", name, std::process::id()));
        let _ = force_remove_tree(&root);
        fs::create_dir_all(&root).unwrap();
        let dst = root.join("dst");
        fs::create_dir_all(&dst).unwrap();
        let drive = mount(&dst);
        Self { root, drive }
    }

    fn ready(&self) -> bool {
        self.drive.is_some()
    }

    fn original(&self) -> PathBuf {
        self.root.join("src/app/FakeApp")
    }

    fn target_root(&self) -> PathBuf {
        match &self.drive {
            Some(d) => PathBuf::from(format!("{}\\chosen", d)),
            None => self.root.join("dst/chosen"),
        }
    }

    fn target(&self) -> PathBuf {
        self.target_root().join("FakeApp")
    }
}

impl Drop for Sandbox {
    fn drop(&mut self) {
        if let Some(d) = &self.drive {
            let _ = std::process::Command::new("subst").arg(d).arg("/D").status();
        }
        // 只读属性会挡住删除，先清掉
        clear_readonly_recursive(&self.root);
        let _ = force_remove_tree(&self.root);
    }
}

fn mount(dir: &Path) -> Option<String> {
    for letter in DRIVE_CANDIDATES {
        if Path::new(&format!("{}\\", letter)).exists() {
            continue;
        }
        let ok = std::process::Command::new("subst")
            .arg(letter)
            .arg(dir)
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false);
        if ok && Path::new(&format!("{}\\", letter)).exists() {
            return Some((*letter).to_string());
        }
    }
    None
}

fn clear_readonly_recursive(dir: &Path) {
    let Ok(rd) = fs::read_dir(dir) else { return };
    for e in rd.flatten() {
        let p = e.path();
        if let Ok(md) = fs::metadata(&p) {
            let mut perm = md.permissions();
            if perm.readonly() {
                #[allow(clippy::permissions_set_readonly_false)]
                perm.set_readonly(false);
                let _ = fs::set_permissions(&p, perm);
            }
        }
        if p.is_dir() {
            clear_readonly_recursive(&p);
        }
    }
}

fn make_fake_app(dir: &Path) {
    fs::create_dir_all(dir.join("sub/deep")).unwrap();
    fs::write(dir.join("app.exe"), b"binary").unwrap();
    fs::write(dir.join("sub/data.bin"), vec![7u8; 8192]).unwrap();
    fs::write(dir.join("sub/deep/nested.txt"), b"nested").unwrap();
}

fn entries(dir: &Path) -> Vec<String> {
    let mut v: Vec<String> = fs::read_dir(dir)
        .map(|it| {
            it.filter_map(|e| e.ok())
                .map(|e| e.file_name().to_string_lossy().to_string())
                .collect()
        })
        .unwrap_or_default();
    v.sort();
    v
}

/// 走一遍移动，返回 (沙箱, 原位置, 目标)
fn do_move(name: &str) -> Option<(Sandbox, PathBuf, PathBuf)> {
    let sb = Sandbox::new(name);
    if !sb.ready() {
        eprintln!("跳过 {name}：subst 不可用");
        return None;
    }
    let original = sb.original();
    let target_root = sb.target_root();
    let target = sb.target();
    make_fake_app(&original);
    let req = move_request("FakeApp", &original, &target_root);
    testkit::move_app_inner("edge", &req, &testkit::no_progress, testkit::test_copy_mode())
        .unwrap_or_else(|e| panic!("移动失败: {e}"));
    Some((sb, original, target))
}

fn restore(original: &Path, target: &Path) -> Result<(), String> {
    testkit::restore_inner(
        "edge",
        &original.to_string_lossy(),
        &target.to_string_lossy(),
        &testkit::no_progress,
        testkit::test_copy_mode(),
    )
    .map_err(|e| e.to_string())
}

#[test]
fn readonly_files_do_not_block_target_cleanup() {
    let Some((_sb, original, target)) = do_move("readonly-files") else {
        return;
    };

    // 给目标里的文件加只读属性（真实安装目录里很常见）
    for rel in ["app.exe", "sub/data.bin", "sub/deep/nested.txt"] {
        let p = target.join(rel);
        let mut perm = fs::metadata(&p).unwrap().permissions();
        perm.set_readonly(true);
        fs::set_permissions(&p, perm).unwrap();
    }

    let res = restore(&original, &target);
    assert!(res.is_ok(), "还原应该成功，却报错: {res:?}");

    assert!(
        original.join("app.exe").is_file(),
        "还原后原位置应有文件"
    );
    assert!(
        !target.exists(),
        "只读文件不该导致目标残留，但 {} 还在：{:?}",
        target.display(),
        entries(&target)
    );
}

#[test]
fn readonly_target_dir_does_not_block_cleanup() {
    let Some((_sb, original, target)) = do_move("readonly-dir") else {
        return;
    };

    // 目标目录本身带只读属性
    let mut perm = fs::metadata(&target).unwrap().permissions();
    perm.set_readonly(true);
    fs::set_permissions(&target, perm).unwrap();

    let res = restore(&original, &target);
    assert!(res.is_ok(), "还原应该成功，却报错: {res:?}");
    assert!(
        !target.exists(),
        "目录只读不该导致目标残留，但 {} 还在：{:?}",
        target.display(),
        entries(&target)
    );
}

#[test]
fn nested_junction_inside_target_does_not_block_cleanup() {
    let Some((_sb, original, target)) = do_move("nested-link") else {
        return;
    };

    // 在目标里塞一个指向外部的 junction（模拟软件自带的链接）
    let outside = target.parent().unwrap().join("outside-data");
    fs::create_dir_all(&outside).unwrap();
    fs::write(outside.join("keepme.txt"), b"keep").unwrap();
    let link = target.join("alink");
    let ok = std::process::Command::new("cmd")
        .args(["/C", "mklink", "/J"])
        .arg(&link)
        .arg(&outside)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);
    if !ok {
        eprintln!("跳过嵌套链接断言：mklink 不可用");
    }

    let res = restore(&original, &target);
    assert!(res.is_ok(), "还原应该成功，却报错: {res:?}");

    assert!(
        !target.exists(),
        "内含链接不该导致目标残留，但 {} 还在：{:?}",
        target.display(),
        entries(&target)
    );

    if ok {
        // 关键：删除目标时**不能**顺着嵌套链接把外部数据也删了
        assert!(
            outside.join("keepme.txt").is_file(),
            "外部目录被误删了！删除目标时不应跟随内部链接"
        );
    }
}

#[test]
fn restore_rolls_back_when_copy_fails() {
    let Some((_sb, original, target)) = do_move("rollback") else {
        return;
    };

    // 把目标目录里的内容清空，制造「复制回来之后校验不过」的场景：
    // 源大小远大于目标，verify_copy 会失败
    for e in fs::read_dir(&target).unwrap().flatten() {
        let p = e.path();
        if p.is_dir() {
            let _ = fs::remove_dir_all(&p);
        } else {
            let _ = fs::remove_file(&p);
        }
    }

    let res = restore(&original, &target);
    assert!(res.is_err(), "目标副本为空时不该继续还原（否则等于删数据）");

    // 关键：失败必须发生在「动任何东西」之前 ——
    // 原位置还是好好的 junction，数据也还在
    assert!(
        is_junction(&original),
        "前置校验失败时不该动原位置，实际 {} 已不是 junction",
        original.display()
    );
    assert!(
        target.is_dir(),
        "前置校验失败时不该动目标副本，但 {} 没了",
        target.display()
    );
    // 不应该留下 .jold
    let leftovers: Vec<String> = entries(original.parent().unwrap())
        .into_iter()
        .filter(|n| n.contains("foldermove-plus"))
        .collect();
    assert!(leftovers.is_empty(), "不该留下中间产物：{leftovers:?}");
}
