use std::fs;
use std::path::PathBuf;
use std::process::Command;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PixelFormat {
    Rgb24,
    Rgba,
    Bgra,
    Argb,
    Abgr,
    Rgbx,
    Bgrx,
    Xrgb,
    Xbgr,
}

impl PixelFormat {
    pub fn from_spa(raw: u32) -> Option<Self> {
        Some(match raw {
            7 => Self::Rgbx,
            8 => Self::Bgrx,
            9 => Self::Xrgb,
            10 => Self::Xbgr,
            11 => Self::Rgba,
            12 => Self::Bgra,
            13 => Self::Argb,
            14 => Self::Abgr,
            15 => Self::Rgb24,
            _ => return None,
        })
    }

    pub fn gst_format_name(self) -> &'static str {
        match self {
            Self::Rgb24 => "RGB",
            Self::Rgba => "RGBA",
            Self::Bgra => "BGRA",
            Self::Argb => "ARGB",
            Self::Abgr => "ABGR",
            Self::Rgbx => "RGBx",
            Self::Bgrx => "BGRx",
            Self::Xrgb => "xRGB",
            Self::Xbgr => "xBGR",
        }
    }

    pub fn bytes_per_pixel(self) -> usize {
        match self {
            Self::Rgb24 => 3,
            _ => 4,
        }
    }

    pub fn to_i420(self, width: u32, height: u32, data: &[u8]) -> Option<Vec<u8>> {
        let pixel_count = (width as usize).checked_mul(height as usize)?;
        let bpp = self.bytes_per_pixel();
        if data.len() < pixel_count.checked_mul(bpp)? {
            return None;
        }
        let mut luma = vec![0u8; pixel_count];
        let chroma_count = (width.div_ceil(2) as usize).checked_mul(height.div_ceil(2) as usize)?;
        let mut u_plane = vec![0u8; chroma_count];
        let mut v_plane = vec![0u8; chroma_count];

        for y in 0..height as usize {
            for x in 0..width as usize {
                let offset = (y * width as usize + x) * bpp;
                let pixel = &data[offset..offset + bpp];
                let (r, g, b) = match self {
                    Self::Rgb24 => (pixel[0], pixel[1], pixel[2]),
                    Self::Rgba => (pixel[0], pixel[1], pixel[2]),
                    Self::Bgra => (pixel[2], pixel[1], pixel[0]),
                    Self::Argb => (pixel[1], pixel[2], pixel[3]),
                    Self::Abgr => (pixel[3], pixel[2], pixel[1]),
                    Self::Rgbx => (pixel[0], pixel[1], pixel[2]),
                    Self::Bgrx => (pixel[2], pixel[1], pixel[0]),
                    Self::Xrgb => (pixel[1], pixel[2], pixel[3]),
                    Self::Xbgr => (pixel[3], pixel[2], pixel[1]),
                };
                let r = r as i32;
                let g = g as i32;
                let b = b as i32;
                let luma_value = ((66 * r + 129 * g + 25 * b + 128) >> 8) + 16;
                luma[y * width as usize + x] = luma_value.clamp(0, 255) as u8;

                if x % 2 == 0 && y % 2 == 0 {
                    let u_value = ((-38 * r - 74 * g + 112 * b + 128) >> 8) + 128;
                    let v_value = ((112 * r - 94 * g - 18 * b + 128) >> 8) + 128;
                    let index = (y / 2) * (width.div_ceil(2) as usize) + (x / 2);
                    u_plane[index] = u_value.clamp(0, 255) as u8;
                    v_plane[index] = v_value.clamp(0, 255) as u8;
                }
            }
        }

        let mut output = Vec::with_capacity(pixel_count + 2 * chroma_count);
        output.extend_from_slice(&luma);
        output.extend_from_slice(&u_plane);
        output.extend_from_slice(&v_plane);
        Some(output)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DecodedCursor {
    pub width: u32,
    pub height: u32,
    pub hotspot_x: i32,
    pub hotspot_y: i32,
    pub rgba: Vec<u8>,
}

pub fn decode_bitmap(
    format: PixelFormat,
    width: u32,
    height: u32,
    stride: i32,
    hotspot_x: i32,
    hotspot_y: i32,
    data: &[u8],
) -> Option<DecodedCursor> {
    if width == 0 || height == 0 || stride == 0 {
        return None;
    }
    let bytes_per_pixel = match format {
        PixelFormat::Rgb24 => 3,
        _ => 4,
    };
    let stride_abs = stride.unsigned_abs() as usize;
    if stride_abs < width as usize * bytes_per_pixel {
        return None;
    }
    let needed = stride_abs.checked_mul(height as usize)?;
    if data.len() < needed {
        return None;
    }

    let mut rgba = vec![0u8; width as usize * height as usize * 4];
    for row in 0..height as usize {
        let source_row = if stride > 0 {
            row
        } else {
            height as usize - 1 - row
        };
        let row_start = source_row * stride_abs;
        for column in 0..width as usize {
            let offset = row_start + column * bytes_per_pixel;
            let pixel = &data[offset..offset + bytes_per_pixel];
            let (red, green, blue, alpha) = match format {
                PixelFormat::Rgb24 => (pixel[0], pixel[1], pixel[2], u8::MAX),
                PixelFormat::Rgba => (pixel[0], pixel[1], pixel[2], pixel[3]),
                PixelFormat::Bgra => (pixel[2], pixel[1], pixel[0], pixel[3]),
                PixelFormat::Argb => (pixel[1], pixel[2], pixel[3], pixel[0]),
                PixelFormat::Abgr => (pixel[3], pixel[2], pixel[1], pixel[0]),
                PixelFormat::Rgbx => (pixel[0], pixel[1], pixel[2], u8::MAX),
                PixelFormat::Bgrx => (pixel[2], pixel[1], pixel[0], u8::MAX),
                PixelFormat::Xrgb => (pixel[1], pixel[2], pixel[3], u8::MAX),
                PixelFormat::Xbgr => (pixel[3], pixel[2], pixel[1], u8::MAX),
            };
            let target = (row * width as usize + column) * 4;
            rgba[target..target + 4].copy_from_slice(&[red, green, blue, alpha]);
        }
    }

    Some(DecodedCursor {
        width,
        height,
        hotspot_x,
        hotspot_y,
        rgba,
    })
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct XcursorImage {
    pub width: u32,
    pub height: u32,
    pub xhot: u32,
    pub yhot: u32,
    pub pixels: Vec<u32>,
}

const XCURSOR_IMAGE_TYPE: u32 = 0xfffd_0002;
const XCURSOR_IMAGE_HEADER_SIZE: u32 = 36;

pub fn parse_xcursor(data: &[u8]) -> Option<Vec<XcursorImage>> {
    if data.len() < 16 || &data[0..4] != b"Xcur" {
        return None;
    }
    let header_size = read_u32(data, 4)? as usize;
    let toc_count = read_u32(data, 12)? as usize;
    if header_size < 16 {
        return None;
    }

    let mut images = Vec::new();
    for index in 0..toc_count {
        let toc = header_size + index * 12;
        let chunk_type = read_u32(data, toc)?;
        if chunk_type != XCURSOR_IMAGE_TYPE {
            continue;
        }
        let position = read_u32(data, toc + 8)? as usize;
        if read_u32(data, position)? != XCURSOR_IMAGE_HEADER_SIZE {
            continue;
        }
        if read_u32(data, position + 4)? != XCURSOR_IMAGE_TYPE {
            continue;
        }
        let width = read_u32(data, position + 16)?;
        let height = read_u32(data, position + 20)?;
        let xhot = read_u32(data, position + 24)?;
        let yhot = read_u32(data, position + 28)?;
        let count = (width as usize).checked_mul(height as usize)?;
        let pixel_start = position + XCURSOR_IMAGE_HEADER_SIZE as usize;
        let pixel_bytes = count.checked_mul(4)?;
        let slice = data.get(pixel_start..pixel_start + pixel_bytes)?;
        let pixels = slice
            .chunks_exact(4)
            .map(|chunk| u32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]))
            .collect();
        images.push(XcursorImage {
            width,
            height,
            xhot,
            yhot,
            pixels,
        });
    }

    if images.is_empty() {
        None
    } else {
        Some(images)
    }
}

fn read_u32(data: &[u8], offset: usize) -> Option<u32> {
    let bytes = data.get(offset..offset + 4)?;
    Some(u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]))
}

#[derive(Debug, Clone)]
pub struct ThemeCursor {
    pub name: String,
    pub images: Vec<XcursorImage>,
}

pub fn load_theme(theme: &str) -> Vec<ThemeCursor> {
    for directory in theme_cursor_dirs(theme) {
        let Ok(entries) = fs::read_dir(&directory) else {
            continue;
        };
        let mut cursors = Vec::new();
        for entry in entries.flatten() {
            let path = entry.path();
            let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
                continue;
            };
            let Ok(data) = fs::read(&path) else {
                continue;
            };
            if let Some(images) = parse_xcursor(&data) {
                cursors.push(ThemeCursor {
                    name: name.to_owned(),
                    images,
                });
            }
        }
        if !cursors.is_empty() {
            return cursors;
        }
    }
    Vec::new()
}

fn theme_cursor_dirs(theme: &str) -> Vec<PathBuf> {
    let mut roots: Vec<PathBuf> = Vec::new();
    if let Some(data_home) = std::env::var_os("XDG_DATA_HOME") {
        roots.push(PathBuf::from(data_home).join("icons"));
    }
    if let Some(home) = std::env::var_os("HOME") {
        roots.push(PathBuf::from(&home).join(".icons"));
        roots.push(PathBuf::from(&home).join(".local/share/icons"));
    }
    let data_dirs =
        std::env::var("XDG_DATA_DIRS").unwrap_or_else(|_| "/usr/local/share:/usr/share".to_owned());
    for dir in data_dirs.split(':').filter(|dir| !dir.is_empty()) {
        roots.push(PathBuf::from(dir).join("icons"));
    }
    roots
        .into_iter()
        .map(|root| root.join(theme).join("cursors"))
        .collect()
}

pub fn detect_theme() -> String {
    if let Ok(output) = Command::new("gsettings")
        .args(["get", "org.gnome.desktop.interface", "cursor-theme"])
        .output()
        && output.status.success()
    {
        let value = String::from_utf8_lossy(&output.stdout)
            .trim()
            .trim_matches('\'')
            .to_owned();
        if !value.is_empty() {
            return value;
        }
    }
    std::env::var("XCURSOR_THEME").unwrap_or_else(|_| "Adwaita".to_owned())
}

pub fn recordly_type_for_name(name: &str) -> Option<&'static str> {
    let base = name.trim_end_matches(".cur").trim_end_matches(".ani");
    Some(match base {
        "default" | "left_ptr" | "arrow" | "top_left_arrow" => "arrow",
        "text" | "xterm" | "ibeam" | "vertical-text" => "text",
        "pointer" | "hand2" | "pointing_hand" | "hand" => "pointer",
        "crosshair" | "cross" | "tcross" | "cell" | "precision" => "crosshair",
        "openhand" | "open_hand" | "grab" | "hand1" | "fleur" => "open-hand",
        "closedhand" | "closed_hand" | "grabbing" => "closed-hand",
        "ew-resize" | "sb_h_double_arrow" | "col-resize" | "size_hor" | "h_double_arrow" => {
            "resize-ew"
        }
        "ns-resize" | "sb_v_double_arrow" | "row-resize" | "size_ver" | "v_double_arrow" => {
            "resize-ns"
        }
        "not-allowed" | "crossed_circle" | "forbidden" | "no-drop" => "not-allowed",
        _ => return None,
    })
}

const MAX_ALPHA_SCORE: u64 = 24;
const MAX_SCALED_ALPHA_SCORE: u64 = 36;
const MAX_HOTSPOT_DRIFT: f64 = 0.2;

pub fn classify(cursor: &DecodedCursor, theme: &[ThemeCursor]) -> Option<&'static str> {
    if cursor.width == 0 || cursor.height == 0 {
        return None;
    }
    let mut best: Option<(u64, &'static str)> = None;
    for theme_cursor in theme {
        let Some(recordly_type) = recordly_type_for_name(&theme_cursor.name) else {
            continue;
        };
        for image in &theme_cursor.images {
            if image.width != cursor.width || image.height != cursor.height {
                continue;
            }
            if !hotspot_matches(cursor, image) {
                continue;
            }
            let score = alpha_difference(cursor, image);
            match best {
                Some((best_score, _)) if best_score <= score => {}
                _ => best = Some((score, recordly_type)),
            }
        }
    }
    if let Some((score, recordly_type)) = best
        && score <= MAX_ALPHA_SCORE
    {
        return Some(recordly_type);
    }

    classify_scaled(cursor, theme)
}

fn classify_scaled(cursor: &DecodedCursor, theme: &[ThemeCursor]) -> Option<&'static str> {
    let mut best: Option<(u64, &'static str)> = None;
    for theme_cursor in theme {
        let Some(recordly_type) = recordly_type_for_name(&theme_cursor.name) else {
            continue;
        };
        let Some(image) = closest_size_image(&theme_cursor.images, cursor.width, cursor.height)
        else {
            continue;
        };
        if !hotspot_matches(cursor, image) {
            continue;
        }
        let score = alpha_difference_scaled(cursor, image);
        match best {
            Some((best_score, _)) if best_score <= score => {}
            _ => best = Some((score, recordly_type)),
        }
    }
    let (score, recordly_type) = best?;
    (score <= MAX_SCALED_ALPHA_SCORE).then_some(recordly_type)
}

fn closest_size_image(
    images: &[XcursorImage],
    target_width: u32,
    target_height: u32,
) -> Option<&XcursorImage> {
    images
        .iter()
        .filter(|image| image.width > 0 && image.height > 0)
        .min_by_key(|image| {
            let distance =
                image.width.abs_diff(target_width) + image.height.abs_diff(target_height);
            let area = u64::from(image.width) * u64::from(image.height);
            (distance, std::cmp::Reverse(area))
        })
}

fn alpha_difference_scaled(cursor: &DecodedCursor, image: &XcursorImage) -> u64 {
    let dst_w = cursor.width as f64;
    let dst_h = cursor.height as f64;
    let src_w = image.width as f64;
    let src_h = image.height as f64;
    let mut total = 0u64;

    for y in 0..cursor.height as usize {
        let fy = (((y as f64 + 0.5) * src_h / dst_h) - 0.5).clamp(0.0, src_h - 1.0);
        for x in 0..cursor.width as usize {
            let fx = (((x as f64 + 0.5) * src_w / dst_w) - 0.5).clamp(0.0, src_w - 1.0);
            let expected = sample_xcursor_alpha(image, fx, fy).round() as i32;
            let actual = cursor.rgba[(y * cursor.width as usize + x) * 4 + 3] as i32;
            total += (expected - actual).unsigned_abs() as u64;
        }
    }

    total / (cursor.width as u64 * cursor.height as u64).max(1)
}

fn sample_xcursor_alpha(image: &XcursorImage, fx: f64, fy: f64) -> f64 {
    let w = image.width as usize;
    let h = image.height as usize;
    let x0 = (fx.floor() as usize).min(w - 1);
    let y0 = (fy.floor() as usize).min(h - 1);
    let x1 = (x0 + 1).min(w - 1);
    let y1 = (y0 + 1).min(h - 1);
    let tx = fx - x0 as f64;
    let ty = fy - y0 as f64;
    let alpha_at = |x: usize, y: usize| -> f64 { ((image.pixels[y * w + x] >> 24) & 0xff) as f64 };
    let a00 = alpha_at(x0, y0);
    let a10 = alpha_at(x1, y0);
    let a01 = alpha_at(x0, y1);
    let a11 = alpha_at(x1, y1);
    let top = a00 + (a10 - a00) * tx;
    let bottom = a01 + (a11 - a01) * tx;
    top + (bottom - top) * ty
}

fn hotspot_matches(cursor: &DecodedCursor, image: &XcursorImage) -> bool {
    if image.width == 0 || image.height == 0 {
        return false;
    }
    let expected_x = image.xhot as f64 / image.width as f64;
    let expected_y = image.yhot as f64 / image.height as f64;
    let actual_x = cursor.hotspot_x as f64 / cursor.width as f64;
    let actual_y = cursor.hotspot_y as f64 / cursor.height as f64;
    (expected_x - actual_x).abs() <= MAX_HOTSPOT_DRIFT
        && (expected_y - actual_y).abs() <= MAX_HOTSPOT_DRIFT
}

fn alpha_difference(cursor: &DecodedCursor, image: &XcursorImage) -> u64 {
    let mut total = 0u64;
    for (index, pixel) in image.pixels.iter().enumerate() {
        let expected = (pixel >> 24) as i32;
        let actual = cursor.rgba[index * 4 + 3] as i32;
        total += (expected - actual).unsigned_abs() as u64;
    }
    total / (cursor.width as u64 * cursor.height as u64).max(1)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn solid_cursor(width: u32, height: u32, alpha: u8) -> DecodedCursor {
        let mut rgba = Vec::new();
        for _ in 0..width * height {
            rgba.extend_from_slice(&[10, 20, 30, alpha]);
        }
        DecodedCursor {
            width,
            height,
            hotspot_x: 0,
            hotspot_y: 0,
            rgba,
        }
    }

    fn xcursor_with_image(name: &str, width: u32, height: u32, alpha: u32) -> ThemeCursor {
        let pixels = vec![(alpha << 24) | 0x0010_2030; (width * height) as usize];
        ThemeCursor {
            name: name.to_owned(),
            images: vec![XcursorImage {
                width,
                height,
                xhot: 0,
                yhot: 0,
                pixels,
            }],
        }
    }

    #[test]
    fn converts_bgra_to_i420() {
        let data = [
            0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255, 255, 255, 255, 255, 255,
        ];
        let i420 = PixelFormat::Bgra.to_i420(2, 2, &data).unwrap();
        assert_eq!(i420.len(), 6);
        assert_eq!(i420[0], 16);
        assert_eq!(i420[3], 235);
        assert_eq!(i420[4], 128);
        assert_eq!(i420[5], 128);
    }

    #[test]
    fn decodes_rgba_rows_in_order() {
        let data = [1, 2, 3, 255, 4, 5, 6, 128, 7, 8, 9, 64, 10, 11, 12, 32];
        let decoded = decode_bitmap(PixelFormat::Rgba, 2, 2, 8, 1, 0, &data).unwrap();
        assert_eq!(decoded.rgba[0..4], [1, 2, 3, 255]);
        assert_eq!(decoded.rgba[8..12], [7, 8, 9, 64]);
        assert_eq!(decoded.hotspot_x, 1);
    }

    #[test]
    fn decodes_bgra_channel_order() {
        let data = [30, 20, 10, 200];
        let decoded = decode_bitmap(PixelFormat::Bgra, 1, 1, 4, 0, 0, &data).unwrap();
        assert_eq!(decoded.rgba, vec![10, 20, 30, 200]);
    }

    #[test]
    fn decodes_negative_stride_bottom_up() {
        let data = [10, 0, 0, 255, 20, 0, 0, 255];
        let decoded = decode_bitmap(PixelFormat::Rgba, 1, 2, -4, 0, 0, &data).unwrap();
        assert_eq!(decoded.rgba[0], 20);
        assert_eq!(decoded.rgba[4], 10);
    }

    #[test]
    fn rejects_short_data_and_bad_stride() {
        assert!(decode_bitmap(PixelFormat::Rgba, 2, 2, 8, 0, 0, &[0u8; 4]).is_none());
        assert!(decode_bitmap(PixelFormat::Rgba, 2, 2, 4, 0, 0, &[0u8; 32]).is_none());
    }

    #[test]
    fn parses_an_xcursor_image() {
        let mut data = Vec::new();
        data.extend_from_slice(b"Xcur");
        data.extend_from_slice(&16u32.to_le_bytes());
        data.extend_from_slice(&1u32.to_le_bytes());
        data.extend_from_slice(&1u32.to_le_bytes());
        data.extend_from_slice(&XCURSOR_IMAGE_TYPE.to_le_bytes());
        data.extend_from_slice(&0u32.to_le_bytes());
        data.extend_from_slice(&28u32.to_le_bytes());
        data.extend_from_slice(&36u32.to_le_bytes());
        data.extend_from_slice(&XCURSOR_IMAGE_TYPE.to_le_bytes());
        data.extend_from_slice(&1u32.to_le_bytes());
        data.extend_from_slice(&1u32.to_le_bytes());
        data.extend_from_slice(&2u32.to_le_bytes());
        data.extend_from_slice(&2u32.to_le_bytes());
        data.extend_from_slice(&1u32.to_le_bytes());
        data.extend_from_slice(&1u32.to_le_bytes());
        data.extend_from_slice(&0u32.to_le_bytes());
        data.extend_from_slice(&0xff10_2030u32.to_le_bytes());
        data.extend_from_slice(&0xff40_5060u32.to_le_bytes());
        data.extend_from_slice(&0x8020_3040u32.to_le_bytes());
        data.extend_from_slice(&0x6040_5060u32.to_le_bytes());

        let images = parse_xcursor(&data).unwrap();
        assert_eq!(images.len(), 1);
        assert_eq!(images[0].width, 2);
        assert_eq!(images[0].height, 2);
        assert_eq!(images[0].xhot, 1);
        assert_eq!(images[0].pixels.len(), 4);
    }

    #[test]
    fn rejects_non_xcursor_data() {
        assert!(parse_xcursor(b"not a cursor").is_none());
    }

    #[test]
    fn classifies_matching_theme_cursor() {
        let theme = vec![xcursor_with_image("default", 4, 4, 0xff)];
        let cursor = solid_cursor(4, 4, 0xff);
        assert_eq!(classify(&cursor, &theme), Some("arrow"));
    }

    #[test]
    fn classifies_hand_pointer_and_resize_names() {
        let theme = vec![
            xcursor_with_image("pointer", 4, 4, 0xff),
            xcursor_with_image("ew-resize", 8, 4, 0xff),
        ];
        assert_eq!(classify(&solid_cursor(4, 4, 0xff), &theme), Some("pointer"));
        assert_eq!(
            classify(&solid_cursor(8, 4, 0xff), &theme),
            Some("resize-ew")
        );
    }

    #[test]
    fn falls_back_when_no_candidate_matches() {
        let theme = vec![xcursor_with_image("default", 4, 4, 0x00)];
        assert_eq!(classify(&solid_cursor(4, 4, 0xff), &theme), None);
        assert_eq!(classify(&solid_cursor(16, 16, 0xff), &theme), None);
    }

    #[test]
    fn ignores_unknown_cursor_names() {
        assert_eq!(recordly_type_for_name("wayland-cursor"), None);
        assert_eq!(recordly_type_for_name("pointer"), Some("pointer"));
        assert_eq!(recordly_type_for_name("not-allowed"), Some("not-allowed"));
    }

    #[test]
    fn classifies_fractionally_scaled_cursors_against_nearest_theme_size() {
        let make_alpha_grid = |w: u32, h: u32, alpha_fn: &dyn Fn(u32, u32) -> u8| -> Vec<u32> {
            let mut pixels = Vec::with_capacity((w * h) as usize);
            for y in 0..h {
                for x in 0..w {
                    pixels.push((u32::from(alpha_fn(x, y)) << 24) | 0x00ff_ffff);
                }
            }
            pixels
        };
        let ibeam_alpha = |x: u32, y: u32, w: u32, h: u32| -> u8 {
            let cx = w / 2;
            let bar_half = (w / 6).max(1);
            let stem_half = (w / 12).max(1);
            let cap = (h / 8).max(1);
            let in_stem = x >= cx.saturating_sub(stem_half) && x <= cx + stem_half;
            let in_top = y < cap && x >= cx.saturating_sub(bar_half) && x <= cx + bar_half;
            let in_bot = y + cap >= h && x >= cx.saturating_sub(bar_half) && x <= cx + bar_half;
            if in_stem || in_top || in_bot { 0xff } else { 0x00 }
        };
        let arrow_alpha = |x: u32, y: u32, w: u32, _h: u32| -> u8 {
            if x >= 4 && y >= 4 && x <= y && x < w * 2 / 3 && y < w * 3 / 4 {
                0xff
            } else {
                0x00
            }
        };

        let theme = vec![
            ThemeCursor {
                name: "default".to_owned(),
                images: vec![
                    XcursorImage {
                        width: 24,
                        height: 24,
                        xhot: 4,
                        yhot: 4,
                        pixels: make_alpha_grid(24, 24, &|x, y| arrow_alpha(x, y, 24, 24)),
                    },
                    XcursorImage {
                        width: 48,
                        height: 48,
                        xhot: 8,
                        yhot: 8,
                        pixels: make_alpha_grid(48, 48, &|x, y| arrow_alpha(x, y, 48, 48)),
                    },
                ],
            },
            ThemeCursor {
                name: "text".to_owned(),
                images: vec![
                    XcursorImage {
                        width: 24,
                        height: 24,
                        xhot: 12,
                        yhot: 12,
                        pixels: make_alpha_grid(24, 24, &|x, y| ibeam_alpha(x, y, 24, 24)),
                    },
                    XcursorImage {
                        width: 48,
                        height: 48,
                        xhot: 24,
                        yhot: 24,
                        pixels: make_alpha_grid(48, 48, &|x, y| ibeam_alpha(x, y, 48, 48)),
                    },
                ],
            },
        ];

        // 40x40 fractional HiDPI (1.667x of 24px) matches 48x48 ibeam instead of falling back to arrow.
        let mut rgba = Vec::with_capacity(40 * 40 * 4);
        for y in 0..40 {
            for x in 0..40 {
                let a = ibeam_alpha(x, y, 40, 40);
                rgba.extend_from_slice(&[a, a, a, a]);
            }
        }
        let scaled_ibeam = DecodedCursor {
            width: 40,
            height: 40,
            hotspot_x: 20,
            hotspot_y: 20,
            rgba,
        };
        assert_eq!(classify(&scaled_ibeam, &theme), Some("text"));

        // An unknown shape at 40x40 with matching hotspot still gets rejected rather than misclassified.
        assert_eq!(
            classify(
                &DecodedCursor {
                    hotspot_x: 20,
                    hotspot_y: 20,
                    ..solid_cursor(40, 40, 0xff)
                },
                &theme
            ),
            None
        );
    }
}
