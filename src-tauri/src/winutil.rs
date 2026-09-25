//! 零散的 Win32 小工具。
//!
//! 抽出来是因为「当前进程有没有管理员权限」这件事现在有三个地方要问：
//! `main.rs`（要不要自提权重启）、`mover.rs`（复制时能不能带上审计信息）、
//! 以及集成测试（决定用哪种复制模式）。
//! 之前只在 `main.rs` 里有一份私有实现，再抄一份迟早会走样。

/// 判断当前进程是否已提权（管理员）。
///
/// 用 `TokenElevation` 而不是检查用户组：后者在「以管理员身份运行」但被 UAC
/// 剥离令牌的情况下会误判为已提权。
#[cfg(windows)]
pub fn is_elevated() -> bool {
    use windows::Win32::Foundation::{CloseHandle, HANDLE};
    use windows::Win32::Security::{
        GetTokenInformation, TokenElevation, TOKEN_ELEVATION, TOKEN_QUERY,
    };
    use windows::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

    unsafe {
        let mut token = HANDLE::default();
        if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token).is_err() {
            return false;
        }
        let mut elevation = TOKEN_ELEVATION::default();
        let mut ret_len = 0u32;
        let r = GetTokenInformation(
            token,
            TokenElevation,
            Some(&mut elevation as *mut _ as *mut _),
            std::mem::size_of::<TOKEN_ELEVATION>() as u32,
            &mut ret_len,
        );
        let _ = CloseHandle(token);
        r.is_ok() && elevation.TokenIsElevated != 0
    }
}

#[cfg(not(windows))]
pub fn is_elevated() -> bool {
    false
}
