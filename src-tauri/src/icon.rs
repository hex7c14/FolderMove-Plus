//! 应用图标提取模块。
//!
//! 输入是注册表 Uninstall 键里的 `DisplayIcon` 字符串，输出是 **PNG 字节的
//! base64**（不含 `data:` 前缀，前端自行拼接）。任何一步失败都返回 `None`，
//! 由前端回退到字母头像占位。
//!
//! 提取策略（按顺序尝试）：
//! 1. 目标是图片文件（.png/.jpg/.jpeg/.bmp/.gif）：读取文件（.png 原样透传，其余解码后缩放并重编码）
//! 2. `SHDefExtractIconW` 请求 64x64 图标
//! 3. `ExtractIconExW` 取大图标（一般 32x32）
//! 4. `HICON` → 32bpp 自顶向下 DIB（DrawIconEx 合成 AND 掩码）→ RGBA8 → PNG

use std::ffi::OsStr;
use std::os::windows::ffi::OsStrExt;

use windows::core::PCWSTR;
use windows::Win32::Foundation::{HANDLE, HWND};
use windows::Win32::Graphics::Gdi::{
    CreateCompatibleDC, CreateDIBSection, DeleteDC, DeleteObject, GetDC, GetDIBits, GetObjectW,
    ReleaseDC, SelectObject, BITMAP, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, HBITMAP,
    HDC, HGDIOBJ,
};
use windows::Win32::UI::Shell::{ExtractIconExW, SHDefExtractIconW};
use windows::Win32::UI::WindowsAndMessaging::{
    DestroyIcon, DrawIconEx, GetIconInfo, HICON, ICONINFO, DI_NORMAL,
};

/// 支持的图片扩展名（这些直接按图片文件处理）
const IMAGE_EXTS: [&str; 5] = ["png", "jpg", "jpeg", "bmp", "gif"];

/// 图标输出边长上限
const MAX_ICON_SIZE: u32 = 64;

// ============================================================
// 对外入口
// ============================================================

/// 从 `DisplayIcon` 字符串尽力提取图标，返回 PNG 字节的 base64（无 data: 前缀）。
pub fn extract_best_effort(display_icon: &str) -> Option<String> {
    let (path, index) = parse_display_icon(display_icon);
    if path.is_empty() {
        return None;
    }
    extract_impl(&path, index)
}

/// 实际提取流程
fn extract_impl(path: &str, index: i32) -> Option<String> {
    if is_image_path(path) {
        return extract_from_image_file(path);
    }

    let (hicon, _strategy) = acquire_hicon(path, index)?;
    let rgba = hicon_to_rgba(hicon);

    // HICON 用完即销毁（上面的转换已不再需要它）
    let _ = unsafe { DestroyIcon(hicon) };

    let (width, height, pixels) = rgba?;
    let png = encode_png(&pixels, width, height)?;
    Some(base64_encode(&png))
}

// ============================================================
// DisplayIcon 解析
// ============================================================

/// 解析 `DisplayIcon`：剥离外层引号、剥离末尾的 `,<索引>`，返回 (路径, 索引)。
///
/// 真实样例：
/// - `C:\Program Files\Tencent\QQNT\QQ.exe,0`
/// - `C:\Program Files\App\app.exe,-101`
/// - `"C:\Program Files\App\app.exe",0`
/// - 没有索引的裸路径
///
/// 路径本身可以合法包含逗号，因此只取**最后一个**逗号，且仅当其后缀形如
/// `-?digits` 时才当作索引剥离。
fn parse_display_icon(raw: &str) -> (String, i32) {
    let mut s = raw.trim();
    if s.is_empty() {
        return (String::new(), 0);
    }

    // 剥离成对的外层双引号（循环剥离以容忍 `""path""` 这类脏数据）
    loop {
        let bytes = s.as_bytes();
        if bytes.len() >= 2 && bytes[0] == b'"' && bytes[bytes.len() - 1] == b'"' {
            s = s[1..s.len() - 1].trim();
        } else {
            break;
        }
    }

    let (mut path, mut index) = (s, 0i32);
    if let Some(pos) = s.rfind(',') {
        let tail = s[pos + 1..].trim();
        let digits = tail.strip_prefix('-').unwrap_or(tail);
        if !digits.is_empty() && digits.bytes().all(|b| b.is_ascii_digit()) {
            if let Ok(v) = tail.parse::<i32>() {
                path = s[..pos].trim();
                index = v;
            }
        }
    }

    // 剩下若还有残留引号（如未闭合的情况），一并去掉
    let path = path.trim().trim_matches('"').trim();
    (path.to_string(), index)
}

/// 扩展名是否属于「直接按图片文件处理」的类型
fn is_image_path(path: &str) -> bool {
    match extension_lower(path) {
        Some(ext) => IMAGE_EXTS.contains(&ext.as_str()),
        None => false,
    }
}

/// 取小写扩展名（不含点）
fn extension_lower(path: &str) -> Option<String> {
    let dot = path.rfind('.')?;
    // 目录里的点不算扩展名
    if let Some(sep) = path.rfind(['\\', '/']) {
        if dot < sep {
            return None;
        }
    }
    let ext = &path[dot + 1..];
    if ext.is_empty() || ext.len() > 8 {
        return None;
    }
    Some(ext.to_ascii_lowercase())
}

// ============================================================
// 策略 1：图片文件
// ============================================================

/// 从图片文件提取：`.png` 原样透传（无损且最快），其余格式解码后统一重编码为 PNG。
fn extract_from_image_file(path: &str) -> Option<String> {
    let bytes = std::fs::read(path).ok()?;
    if bytes.is_empty() {
        return None;
    }

    // PNG 原样 base64（简单且无损）
    if extension_lower(path).as_deref() == Some("png") && bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Some(base64_encode(&bytes));
    }

    // 其余格式解码 → 必要时缩小到 64 以内（保持宽高比，Lanczos3）→ 重编码 PNG
    let img = image::load_from_memory(&bytes).ok()?;
    let (w, h) = (img.width(), img.height());
    if w == 0 || h == 0 {
        return None;
    }
    let img = if w > MAX_ICON_SIZE || h > MAX_ICON_SIZE {
        img.resize(
            MAX_ICON_SIZE,
            MAX_ICON_SIZE,
            image::imageops::FilterType::Lanczos3,
        )
    } else {
        img
    };
    let rgba = img.to_rgba8();
    let png = encode_png(rgba.as_raw(), rgba.width(), rgba.height())?;
    Some(base64_encode(&png))
}

// ============================================================
// 策略 2/3：拿到 HICON
// ============================================================

/// 依次尝试 SHDefExtractIconW（64x64）与 ExtractIconExW（大图标）取得 HICON，
/// 同时返回实际命中的策略名（仅用于诊断/测试）。
/// 调用方负责销毁返回的 HICON。
fn acquire_hicon(path: &str, index: i32) -> Option<(HICON, &'static str)> {
    let wide: Vec<u16> = OsStr::new(path)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let pcw = PCWSTR(wide.as_ptr());

    unsafe {
        // 首选：系统默认提取器，请求 64x64
        let mut large = HICON::default();
        let hr = SHDefExtractIconW(pcw, index, 0, Some(&mut large), None, MAX_ICON_SIZE);
        if hr.is_ok() && !large.is_invalid() {
            return Some((large, "SHDefExtractIconW(64x64)"));
        }
        // hr 失败时 large 的值不可信，若看似有效也一并释放，避免泄漏
        if !large.is_invalid() {
            let _ = DestroyIcon(large);
        }

        // 回退：经典 ExtractIconExW（大图标，通常 32x32）
        let mut fallback = HICON::default();
        let count = ExtractIconExW(pcw, index, Some(&mut fallback), None, 1);
        if count > 0 && !fallback.is_invalid() {
            return Some((fallback, "ExtractIconExW(large)"));
        }
        if !fallback.is_invalid() {
            let _ = DestroyIcon(fallback);
        }
    }

    None
}

// ============================================================
// HICON -> RGBA8
// ============================================================

/// 把 HICON 渲染成 RGBA8 像素，返回 (宽, 高, 像素)。
///
/// 通过 `DrawIconEx(..., DI_NORMAL)` 把图标画进内存 DC 里的 32bpp 自顶向下
/// DIB section，这样 AND 掩码与颜色位图会被 GDI 正确合成；随后直接从 DIB
/// 内存读 BGRA。
fn hicon_to_rgba(hicon: HICON) -> Option<(u32, u32, Vec<u8>)> {
    // 图标实际尺寸（部分 exe 只有 32x32，SHDefExtractIconW 会返回它）
    let (width, height) = unsafe { icon_bitmap_size(hicon) }?;
    if width == 0 || height == 0 || width > 1024 || height > 1024 {
        return None;
    }

    let (width, height, pixels) = unsafe { render_hicon(hicon, width, height) }?;

    // 超出 64 的图标（如 256x256 PNG 压缩图标）等比缩小
    if width > MAX_ICON_SIZE || height > MAX_ICON_SIZE {
        let img = image::RgbaImage::from_raw(width, height, pixels)?;
        let scaled = image::DynamicImage::ImageRgba8(img)
            .resize(
                MAX_ICON_SIZE,
                MAX_ICON_SIZE,
                image::imageops::FilterType::Lanczos3,
            )
            .to_rgba8();
        return Some((scaled.width(), scaled.height(), scaled.into_raw()));
    }

    Some((width, height, pixels))
}

/// 读取图标位图的实际尺寸
unsafe fn icon_bitmap_size(hicon: HICON) -> Option<(u32, u32)> {
    let mut info = ICONINFO::default();
    if !GetIconInfo(hicon, &mut info).is_ok() {
        return None;
    }

    let mut bmp = BITMAP::default();
    let got = GetObjectW(
        info.hbmColor,
        std::mem::size_of::<BITMAP>() as i32,
        Some(&mut bmp as *mut _ as *mut core::ffi::c_void),
    );

    // 查询完尺寸即可释放 GetIconInfo 产生的两个位图
    let _ = DeleteObject(info.hbmMask);
    let _ = DeleteObject(info.hbmColor);

    if got == 0 || bmp.bmWidth <= 0 || bmp.bmHeight <= 0 {
        return None;
    }
    Some((bmp.bmWidth as u32, bmp.bmHeight as u32))
}

/// 创建 32bpp 自顶向下 DIB、DrawIconEx 绘制、读回 BGRA、修正 alpha、转 RGBA。
unsafe fn render_hicon(hicon: HICON, width: u32, height: u32) -> Option<(u32, u32, Vec<u8>)> {
    let stride = width as usize * 4;
    let buf_len = stride.checked_mul(height as usize)?;
    if buf_len == 0 {
        return None;
    }

    let screen_dc: HDC = GetDC(HWND::default());
    if screen_dc.is_invalid() {
        return None;
    }
    let mem_dc = CreateCompatibleDC(screen_dc);
    if mem_dc.is_invalid() {
        let _ = ReleaseDC(HWND::default(), screen_dc);
        return None;
    }

    // 先把像素缓冲准备好，DIB section 会直接写入这块内存
    let mut pixels = vec![0u8; buf_len];

    let mut bmi = BITMAPINFO::default();
    bmi.bmiHeader.biSize = std::mem::size_of::<BITMAPINFOHEADER>() as u32;
    bmi.bmiHeader.biWidth = width as i32;
    bmi.bmiHeader.biHeight = -(height as i32); // 负数 = 自顶向下
    bmi.bmiHeader.biPlanes = 1;
    bmi.bmiHeader.biBitCount = 32;
    bmi.bmiHeader.biCompression = BI_RGB.0;

    let mut bits: *mut core::ffi::c_void = std::ptr::null_mut();
    let dib = match CreateDIBSection(mem_dc, &bmi, DIB_RGB_COLORS, &mut bits, HANDLE::default(), 0)
        .ok()
    {
        Some(h) if !h.is_invalid() => h,
        _ => {
            let _ = DeleteDC(mem_dc);
            let _ = ReleaseDC(HWND::default(), screen_dc);
            return None;
        }
    };

    let old = SelectObject(mem_dc, HGDIOBJ(dib.0));
    let drawn = DrawIconEx(
        mem_dc,
        0,
        0,
        hicon,
        width as i32,
        height as i32,
        0,
        None,
        DI_NORMAL,
    )
    .is_ok();

    // DIB 的内存指针在 DeleteObject 之前一直有效，此处把结果拷出来
    if drawn && !bits.is_null() {
        std::ptr::copy_nonoverlapping(bits as *const u8, pixels.as_mut_ptr(), buf_len);
    }

    let _ = SelectObject(mem_dc, old);
    let _ = DeleteObject(dib);
    let _ = DeleteDC(mem_dc);
    let _ = ReleaseDC(HWND::default(), screen_dc);

    if !drawn {
        return None;
    }

    // alpha 退化（老图标是 32bpp 但 alpha 全 0，或纯色空图）时用 AND 掩码兜底，
    // 否则这些图标会整张全透明。
    let (mut rgba, alpha_missing, blank) = bgra_to_rgba(&pixels);
    if alpha_missing || blank {
        if let Some(mask) = get_mask_alpha(hicon, width, height) {
            if mask.len() == rgba.len() / 4 {
                for (i, m) in mask.iter().enumerate() {
                    rgba[i * 4 + 3] = *m;
                }
            }
        }
    }

    Some((width, height, rgba))
}

/// BGRA → RGBA（交换 byte 0 与 byte 2）。
/// 同时返回 (是否 alpha 全 0, 是否整图只有一种颜色)。
fn bgra_to_rgba(bgra: &[u8]) -> (Vec<u8>, bool, bool) {
    let mut rgba = vec![0u8; bgra.len()];
    let mut alpha_missing = true;
    let mut blank = true;
    let mut first_color: Option<(u8, u8, u8)> = None;

    for (i, px) in bgra.chunks_exact(4).enumerate() {
        let (b, g, r, a) = (px[0], px[1], px[2], px[3]);
        let o = i * 4;
        rgba[o] = r;
        rgba[o + 1] = g;
        rgba[o + 2] = b;
        rgba[o + 3] = a;

        if a != 0 {
            alpha_missing = false;
        }
        match first_color {
            None => first_color = Some((r, g, b)),
            Some(c) if c != (r, g, b) => blank = false,
            _ => {}
        }
    }

    (rgba, alpha_missing, blank)
}

/// 读取 AND 掩码，返回每个像素的 alpha（掩码位为 1 = 透明）
unsafe fn get_mask_alpha(hicon: HICON, width: u32, height: u32) -> Option<Vec<u8>> {
    let mut info = ICONINFO::default();
    if !GetIconInfo(hicon, &mut info).is_ok() {
        return None;
    }

    let result = mask_alpha_from_bitmap(info.hbmMask, width, height);

    let _ = DeleteObject(info.hbmMask);
    let _ = DeleteObject(info.hbmColor);
    result
}

/// 用 GetDIBits 把 1bpp 掩码转成 32bpp 缓冲区，再映射为 alpha
unsafe fn mask_alpha_from_bitmap(mask: HBITMAP, width: u32, height: u32) -> Option<Vec<u8>> {
    if mask.is_invalid() || width == 0 || height == 0 {
        return None;
    }

    let stride = width as usize * 4;
    let mut buffer = vec![0u8; stride.checked_mul(height as usize)?];

    let screen_dc: HDC = GetDC(HWND::default());
    if screen_dc.is_invalid() {
        return None;
    }
    let mem_dc = CreateCompatibleDC(screen_dc);
    if mem_dc.is_invalid() {
        let _ = ReleaseDC(HWND::default(), screen_dc);
        return None;
    }

    let old = SelectObject(mem_dc, HGDIOBJ(mask.0));

    let mut bmi = BITMAPINFO::default();
    bmi.bmiHeader.biSize = std::mem::size_of::<BITMAPINFOHEADER>() as u32;
    bmi.bmiHeader.biWidth = width as i32;
    bmi.bmiHeader.biHeight = height as i32; // 正数 = 自底向上，与掩码位图一致
    bmi.bmiHeader.biPlanes = 1;
    bmi.bmiHeader.biBitCount = 32;
    bmi.bmiHeader.biCompression = BI_RGB.0;

    let lines = GetDIBits(
        mem_dc,
        mask,
        0,
        height,
        Some(buffer.as_mut_ptr() as *mut core::ffi::c_void),
        &mut bmi,
        DIB_RGB_COLORS,
    );

    let _ = SelectObject(mem_dc, old);
    let _ = DeleteDC(mem_dc);
    let _ = ReleaseDC(HWND::default(), screen_dc);

    if lines == 0 {
        return None;
    }

    // 掩码位 1 = 透明；GetDIBits 的输出里白色代表 1
    let mut alpha = Vec::with_capacity(width as usize * height as usize);
    for y in 0..height as usize {
        for x in 0..width as usize {
            let idx = y * stride + x * 4;
            let (b, g, r) = (buffer[idx], buffer[idx + 1], buffer[idx + 2]);
            let transparent = ((b as u16 + g as u16 + r as u16) / 3) >= 128;
            alpha.push(if transparent { 0 } else { 255 });
        }
    }

    Some(alpha)
}

// ============================================================
// PNG 编码 / base64
// ============================================================

/// RGBA8 像素 → PNG 字节
fn encode_png(pixels: &[u8], width: u32, height: u32) -> Option<Vec<u8>> {
    if width == 0 || height == 0 {
        return None;
    }
    if pixels.len() != width as usize * height as usize * 4 {
        return None;
    }

    let mut out = Vec::new();
    let encoder = image::codecs::png::PngEncoder::new(&mut out);
    image::ImageEncoder::write_image(
        encoder,
        pixels,
        width,
        height,
        image::ExtendedColorType::Rgba8,
    )
    .ok()?;

    if out.is_empty() {
        None
    } else {
        Some(out)
    }
}

/// 标准 base64（含 `=` 填充），手写以避免引入额外依赖
fn base64_encode(data: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

    let mut out = String::with_capacity((data.len() + 2) / 3 * 4);
    for chunk in data.chunks(3) {
        let b0 = chunk[0];
        let b1 = chunk.get(1).copied().unwrap_or(0);
        let b2 = chunk.get(2).copied().unwrap_or(0);

        let n = ((b0 as u32) << 16) | ((b1 as u32) << 8) | (b2 as u32);
        out.push(TABLE[((n >> 18) & 0x3f) as usize] as char);
        out.push(TABLE[((n >> 12) & 0x3f) as usize] as char);
        if chunk.len() > 1 {
            out.push(TABLE[((n >> 6) & 0x3f) as usize] as char);
        } else {
            out.push('=');
        }
        if chunk.len() > 2 {
            out.push(TABLE[(n & 0x3f) as usize] as char);
        } else {
            out.push('=');
        }
    }
    out
}

// ============================================================
// 测试
// ============================================================

#[cfg(test)]
mod tests {
    use super::*;

    const B64: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

    /// 测试用 base64 解码（严格模式，遇到非法字符返回 None）
    fn base64_decode(s: &str) -> Option<Vec<u8>> {
        let mut out = Vec::new();
        let mut acc: u32 = 0;
        let mut bits = 0u32;

        for ch in s.bytes() {
            if ch == b'=' {
                break;
            }
            let v = B64.iter().position(|&c| c == ch)? as u32;
            acc = (acc << 6) | v;
            bits += 6;
            if bits >= 8 {
                bits -= 8;
                out.push(((acc >> bits) & 0xff) as u8);
            }
        }
        Some(out)
    }

    /// 与 extract_impl 相同的流程，但额外返回实际命中的 HICON 策略与像素统计
    fn extract_with_diagnostics(path: &str) -> Option<(String, &'static str, (u32, u32), usize, usize)>
    {
        let (hicon, strategy) = acquire_hicon(path, 0)?;
        let rgba = hicon_to_rgba(hicon);
        let _ = unsafe { DestroyIcon(hicon) };
        let (w, h, pixels) = rgba?;
        let opaque = pixels.chunks_exact(4).filter(|p| p[3] > 0).count();
        let png = encode_png(&pixels, w, h)?;
        Some((base64_encode(&png), strategy, (w, h), opaque, pixels.len() / 4))
    }

    /// 跑一个真实系统 exe，校验返回的是合法 PNG，并返回 PNG 字节
    fn check_system_exe(path: &str) -> Option<Vec<u8>> {
        if !std::path::Path::new(path).exists() {
            println!("跳过（文件不存在）：{path}");
            return None;
        }

        // 先跑带诊断的版本，报告实际命中的提取策略
        match extract_with_diagnostics(path) {
            Some((_, strategy, (w, h), opaque, total)) => {
                println!("{path} 命中策略：{strategy}，像素 {w}x{h}，不透明 {opaque}/{total}");
            }
            None => println!("{path} 诊断提取失败"),
        }

        let b64 = match extract_best_effort(path) {
            Some(v) => v,
            None => {
                println!("提取失败（返回 None）：{path}");
                return None;
            }
        };
        assert!(!b64.is_empty(), "base64 不应为空：{path}");

        let bytes = base64_decode(&b64).expect("base64 解码失败");
        assert!(bytes.starts_with(b"\x89PNG"), "PNG 签名不匹配：{path}");
        println!(
            "{path} -> PNG {} 字节 (base64 {} 字符)",
            bytes.len(),
            b64.len()
        );

        let img = image::load_from_memory(&bytes).expect("PNG 无法被解码");
        println!("   解码尺寸：{}x{}", img.width(), img.height());
        assert!(img.width() > 0 && img.height() > 0, "图标尺寸为 0");

        // 不能整图全透明（alpha 兜底是否生效的硬性检查）
        let rgba = img.to_rgba8();
        assert!(
            rgba.pixels().any(|p| p.0[3] > 0),
            "图标全透明，alpha 兜底失败：{path}"
        );

        Some(bytes)
    }

    #[test]
    fn extracts_icon_from_system_executables() {
        let notepad = check_system_exe(r"C:\Windows\System32\notepad.exe");
        let explorer = check_system_exe(r"C:\Windows\explorer.exe");
        assert!(notepad.is_some(), "notepad.exe 必须能提取出图标");

        let bytes = notepad.or(explorer).expect("至少应有一个系统 exe 提取成功");
        let out_path = std::env::temp_dir().join("fmplus-icon-test.png");
        std::fs::write(&out_path, &bytes).expect("写测试 PNG 失败");
        println!("测试 PNG 绝对路径：{}", out_path.display());
        println!("测试 PNG 字节数：{}", bytes.len());
        assert!(out_path.exists());

        // 额外产出「放大 + 棋盘底」的对照图：让透明区域可见，便于人眼确认不是空白/全黑
        let img = image::load_from_memory(&bytes).unwrap().to_rgba8();
        let (w, h) = (img.width(), img.height());
        let scale = 4u32;
        let mut preview = image::RgbaImage::new(w * scale, h * scale);
        for y in 0..h * scale {
            for x in 0..w * scale {
                let src = img.get_pixel(x / scale, y / scale).0;
                let a = src[3] as u32;
                let tile = (((x / 8) + (y / 8)) % 2) as u32 * 255;
                let bg = 150 + tile / 2; // 深浅相间的棋盘格
                let mut out = [0u8; 4];
                for c in 0..3 {
                    out[c] = ((src[c] as u32 * a + bg * (255 - a)) / 255) as u8;
                }
                out[3] = 255;
                preview.put_pixel(x, y, image::Rgba(out));
            }
        }
        let preview_path = std::env::temp_dir().join("fmplus-icon-test-preview.png");
        preview.save(&preview_path).expect("写对照图失败");
        println!("对照图（4 倍放大 + 棋盘底）绝对路径：{}", preview_path.display());
    }

    #[test]
    fn parses_display_icon_variants() {
        assert_eq!(
            parse_display_icon(r"C:\Program Files\Tencent\QQNT\QQ.exe,0"),
            (r"C:\Program Files\Tencent\QQNT\QQ.exe".to_string(), 0)
        );
        assert_eq!(
            parse_display_icon(r"C:\Program Files\App\app.exe,-101"),
            (r"C:\Program Files\App\app.exe".to_string(), -101)
        );
        assert_eq!(
            parse_display_icon(r#""C:\Program Files\App\app.exe",0"#),
            (r"C:\Program Files\App\app.exe".to_string(), 0)
        );
        // 裸路径无索引
        assert_eq!(
            parse_display_icon(r"C:\Tools\thing.exe"),
            (r"C:\Tools\thing.exe".to_string(), 0)
        );
        // 路径本身含逗号，且末尾不是索引
        assert_eq!(
            parse_display_icon(r"C:\Tools\a,b\thing.exe"),
            (r"C:\Tools\a,b\thing.exe".to_string(), 0)
        );
        // 空串
        assert_eq!(parse_display_icon("   "), (String::new(), 0));
        // 只有索引没有路径
        assert_eq!(parse_display_icon(",0"), (String::new(), 0));
        assert!(extract_best_effort("   ").is_none());
        assert!(extract_best_effort(r"C:\不存在的目录\nope.exe").is_none());
    }

    #[test]
    fn base64_matches_known_vectors() {
        assert_eq!(base64_encode(b""), "");
        assert_eq!(base64_encode(b"f"), "Zg==");
        assert_eq!(base64_encode(b"fo"), "Zm8=");
        assert_eq!(base64_encode(b"foo"), "Zm9v");
        assert_eq!(base64_encode(b"foob"), "Zm9vYg==");
        assert_eq!(base64_encode(b"fooba"), "Zm9vYmE=");
        assert_eq!(base64_encode(b"foobar"), "Zm9vYmFy");
        assert_eq!(base64_encode(&[0xff, 0x00, 0x89]), "/wCJ");
        // PNG 签名可往返
        let png = b"\x89PNG\r\n\x1a\n";
        assert_eq!(base64_decode(&base64_encode(png)).as_deref(), Some(&png[..]));
    }

    /// 反复提取不应泄漏 GDI 句柄（31 个应用连续扫描时的真实风险）
    #[test]
    fn does_not_leak_gdi_handles() {
        use windows::Win32::System::Threading::{
            GetCurrentProcess, GetGuiResources, GR_GDIOBJECTS,
        };

        let path = r"C:\Windows\System32\notepad.exe";
        if !std::path::Path::new(path).exists() {
            println!("跳过（文件不存在）：{path}");
            return;
        }

        let count = || unsafe { GetGuiResources(GetCurrentProcess(), GR_GDIOBJECTS) };

        // 预热一次，避免首次加载带来的噪声
        let _ = extract_best_effort(path);
        let before = count();

        for _ in 0..25 {
            assert!(extract_best_effort(path).is_some());
        }

        let after = count();
        println!("GDI 句柄：提取前 {before}，25 次提取后 {after}");
        assert!(
            after <= before + 2,
            "疑似 GDI 句柄泄漏：{before} -> {after}"
        );
    }
}
