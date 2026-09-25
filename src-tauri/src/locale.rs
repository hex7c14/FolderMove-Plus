//! 系统界面语言探测 + 按语言给窗口标题。
//!
//! 为什么要在 Rust 侧做这件事：窗口一创建就带着标题，用户第一眼看到的就是
//! 正确语言，不依赖 WebView 是否加载完，也不依赖前端有没有拿到
//! `core:window:allow-set-title` 权限。前端仍会在切换语言时用
//! `getCurrentWindow().setTitle()` 更新它（那是运行时行为，必须走 IPC）。
//!
//! ⚠️ 这里的语言码必须与 `src/i18n/locales/*.json` 一一对应，
//! 新增语言时两处一起改。

/// 支持的界面语言（与前端 `Locale` 联合类型一致）
const SUPPORTED: [&str; 4] = ["zh-CN", "en-US", "zh-TW", "ja-JP"];

/// 各语言的窗口标题（就是各语言包里的 `app.title`）
const TITLES: [(&str, &str); 4] = [
    ("zh-CN", "FolderMove-Plus"),
    ("en-US", "FolderMove-Plus"),
    ("zh-TW", "FolderMove-Plus"),
    ("ja-JP", "FolderMove-Plus"),
];

const FALLBACK: &str = "zh-CN";

/// 取系统界面语言，返回受支持的其中一个（如 "zh-CN"）。
///
/// 用 `GetUserDefaultLocaleName` 而不是 `GetSystemDefaultLocaleName`：
/// 前者跟随「用户偏好的显示语言」，后者是系统安装语言，多语言机器上前者才对。
pub fn system_locale() -> String {
    let name = user_default_locale().unwrap_or_default();
    normalize_locale_tag(&name)
}

/// 按系统语言给窗口标题。
pub fn window_title() -> String {
    title_for(&system_locale())
}

/// 某个语言对应的窗口标题，未知语言回退到兜底语言
pub fn title_for(locale: &str) -> String {
    TITLES
        .iter()
        .find(|(code, _)| *code == locale)
        .map(|(_, title)| (*title).to_string())
        .unwrap_or_else(|| {
            TITLES
                .iter()
                .find(|(code, _)| *code == FALLBACK)
                .map(|(_, t)| (*t).to_string())
                .unwrap_or_else(|| "FolderMove-Plus".to_string())
        })
}

/// 把 `GetUserDefaultLocaleName` 返回的标签归一化到受支持的语言。
///
/// 例："zh-Hans-CN" → "zh-CN"，"zh-Hant-TW" / "zh-HK" → "zh-TW"，
/// "en-GB" → "en-US"，"ja" → "ja-JP"，"de-DE" → 兜底 "zh-CN"。
pub fn normalize_locale_tag(tag: &str) -> String {
    let lower = tag.trim().to_ascii_lowercase().replace('_', "-");
    if lower.is_empty() {
        return FALLBACK.to_string();
    }

    // 完全匹配
    if let Some(hit) = SUPPORTED.iter().find(|c| c.to_ascii_lowercase() == lower) {
        return (*hit).to_string();
    }

    let lang = lower.split('-').next().unwrap_or("");

    // 中文分简繁：Hant / TW / HK / MO 归繁体，其余归简体
    if lang == "zh" {
        let traditional = lower.contains("hant")
            || lower.contains("-tw")
            || lower.contains("-hk")
            || lower.contains("-mo");
        return if traditional { "zh-TW" } else { "zh-CN" }.to_string();
    }

    // 其余按主语言匹配第一个支持的同语种
    SUPPORTED
        .iter()
        .find(|c| c.split('-').next().unwrap_or("").eq_ignore_ascii_case(lang))
        .map(|c| (*c).to_string())
        .unwrap_or_else(|| FALLBACK.to_string())
}

#[cfg(windows)]
fn user_default_locale() -> Option<String> {
    use windows::Win32::Globalization::GetUserDefaultLocaleName;

    // windows crate 0.58 没导出 LOCALE_NAME_MAX_LENGTH，按 Win32 文档取 85
    // （语言标签最长 84 个字符 + 终止符）
    const LOCALE_NAME_MAX_LENGTH: usize = 85;

    let mut buf = [0u16; LOCALE_NAME_MAX_LENGTH];
    let len = unsafe { GetUserDefaultLocaleName(&mut buf) };
    if len <= 1 {
        // 返回 0 表示失败，1 表示只有一个空终止符
        return None;
    }
    let s = String::from_utf16_lossy(&buf[..(len as usize - 1)]);
    if s.is_empty() {
        None
    } else {
        Some(s)
    }
}

#[cfg(not(windows))]
fn user_default_locale() -> Option<String> {
    // 非 Windows 平台（仅为让代码能编译过）用环境变量兜底
    std::env::var("LANG").ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_chinese_variants() {
        assert_eq!(normalize_locale_tag("zh-Hans-CN"), "zh-CN");
        assert_eq!(normalize_locale_tag("zh-CN"), "zh-CN");
        assert_eq!(normalize_locale_tag("zh"), "zh-CN");
        assert_eq!(normalize_locale_tag("zh-Hant-TW"), "zh-TW");
        assert_eq!(normalize_locale_tag("zh-TW"), "zh-TW");
        assert_eq!(normalize_locale_tag("zh-HK"), "zh-TW");
        assert_eq!(normalize_locale_tag("zh-MO"), "zh-TW");
    }

    #[test]
    fn normalizes_other_languages() {
        assert_eq!(normalize_locale_tag("en-US"), "en-US");
        assert_eq!(normalize_locale_tag("en-GB"), "en-US");
        assert_eq!(normalize_locale_tag("ja"), "ja-JP");
        assert_eq!(normalize_locale_tag("ja-JP"), "ja-JP");
        assert_eq!(normalize_locale_tag("de-DE"), FALLBACK);
        assert_eq!(normalize_locale_tag(""), FALLBACK);
    }

    #[test]
    fn every_supported_locale_has_a_title() {
        for code in SUPPORTED {
            assert_eq!(title_for(code), "FolderMove-Plus");
        }
        // 未知语言回退到兜底语言的标题，而不是空串
        assert!(!title_for("de-DE").is_empty());
    }
}
