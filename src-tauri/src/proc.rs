use std::ffi::OsString;
use std::os::windows::ffi::OsStringExt;

use serde::{Deserialize, Serialize};
use windows::core::PWSTR;
use windows::Win32::Foundation::{CloseHandle, HANDLE};
use windows::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
    TH32CS_SNAPPROCESS,
};
use windows::Win32::System::Threading::{
    OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_FORMAT,
    PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_TERMINATE, TerminateProcess,
};

use crate::error::{AppError, AppResult};

/// 进程信息
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcInfo {
    pub pid: u32,
    pub name: String,
    /// 可执行文件完整路径（若可获取）
    pub exe_path: Option<String>,
}

/// 查找 exe 路径位于 dir 之下（含 dir 自身）的所有进程。
/// 用于移动软件前检测残留进程。
pub fn list_processes_in_dir(dir: &str) -> AppResult<Vec<ProcInfo>> {
    let dir_norm = normalize(dir);
    let dir_lower = dir_norm.to_lowercase();
    if dir_lower.is_empty() {
        return Ok(vec![]);
    }

    let snap: HANDLE = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) }?;
    let mut result: Vec<ProcInfo> = Vec::new();

    let mut entry = PROCESSENTRY32W {
        dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
        ..Default::default()
    };

    let ok = unsafe { Process32FirstW(snap, &mut entry) }.is_ok();
    if ok {
        loop {
            let name = wchar_to_string(&entry.szExeFile);
            let pid = entry.th32ProcessID;

            // 获取完整 exe 路径
            let exe_path = query_exe_path(pid);

            // 判定是否命中目标目录
            let hit = match &exe_path {
                Some(p) => {
                    let p_norm = normalize(p);
                    let p_lower = p_norm.to_lowercase();
                    p_lower == dir_lower || p_lower.starts_with(&format!("{}\\", dir_lower))
                }
                None => false,
            };

            if hit {
                result.push(ProcInfo {
                    pid,
                    name,
                    exe_path,
                });
            }

            if unsafe { Process32NextW(snap, &mut entry) }.is_err() {
                break;
            }
        }
    }

    let _ = unsafe { CloseHandle(snap) };
    Ok(result)
}

/// 结束指定 pid 的进程。
/// 返回 (成功结束的 pid 列表, 未能结束的 pid 与原因)。
pub fn kill_processes(pids: Vec<u32>) -> AppResult<KillResult> {
    let mut killed: Vec<u32> = Vec::new();
    let mut failed: Vec<KillFailure> = Vec::new();

    for pid in pids {
        match terminate(pid) {
            Ok(()) => killed.push(pid),
            Err(e) => failed.push(KillFailure {
                pid,
                reason: e.to_string(),
            }),
        }
    }

    Ok(KillResult { killed, failed })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KillResult {
    pub killed: Vec<u32>,
    pub failed: Vec<KillFailure>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KillFailure {
    pub pid: u32,
    pub reason: String,
}

fn terminate(pid: u32) -> AppResult<()> {
    let handle = unsafe { OpenProcess(PROCESS_TERMINATE, false, pid) }
        .map_err(|e| AppError::Windows(format!("OpenProcess({pid}) 失败: {e}")))?;
    unsafe {
        TerminateProcess(handle, 1)
            .map_err(|e| AppError::Windows(format!("TerminateProcess({pid}) 失败: {e}")))?
    };
    let _ = unsafe { CloseHandle(handle) };
    Ok(())
}

/// 通过 OpenProcess + QueryFullProcessImageNameW 获取进程 exe 完整路径
fn query_exe_path(pid: u32) -> Option<String> {
    let handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) }.ok()?;
    let mut buf = [0u16; 1024];
    let mut len = buf.len() as u32;
    let res = unsafe {
        QueryFullProcessImageNameW(
            handle,
            PROCESS_NAME_FORMAT(0),
            PWSTR(buf.as_mut_ptr()),
            &mut len,
        )
    };
    let _ = unsafe { CloseHandle(handle) };
    res.ok()?;
    let s = wchar_to_string(&buf[..len as usize]);
    if s.is_empty() {
        None
    } else {
        Some(s)
    }
}

fn wchar_to_string(buf: &[u16]) -> String {
    let end = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
    OsString::from_wide(&buf[..end]).to_string_lossy().into_owned()
}

/// 规范化路径：去引号、去尾部反斜杠（保留盘根 "C:\"）
fn normalize(p: &str) -> String {
    let mut s = p.trim().to_string();
    if s.starts_with('"') && s.ends_with('"') && s.len() >= 2 {
        s = s[1..s.len() - 1].to_string();
    }
    while s.len() > 3 && s.ends_with('\\') {
        s.pop();
    }
    s
}
