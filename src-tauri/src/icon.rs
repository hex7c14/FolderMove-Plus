// 图标提取占位模块。
// v1 采用前端字母头像方案（现代、可靠、扫描快）。
// 后续如需真实图标，可在此实现 HICON -> PNG 的提取并返回 base64。

/// 解析 DisplayIcon 字符串（仅返回结构，当前不提取像素）。
pub fn extract_best_effort(_display_icon: &str) -> Option<String> {
    None
}
