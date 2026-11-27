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
    #[must_use]
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

    #[must_use]
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

    #[must_use]
    pub fn bytes_per_pixel(self) -> usize {
        match self {
            Self::Rgb24 => 3,
            _ => 4,
        }
    }

    #[must_use]
    pub fn to_i420(self, width: u32, height: u32, data: &[u8], stride: i32) -> Option<Vec<u8>> {
        if width == 0 || height == 0 {
            return None;
        }
        let width_usize = usize::try_from(width).ok()?;
        let height_usize = usize::try_from(height).ok()?;
        let bpp = self.bytes_per_pixel();
        let row_bytes = width_usize.checked_mul(bpp)?;
        let row_stride = stride.unsigned_abs() as usize;
        let required = (height_usize - 1)
            .checked_mul(row_stride)?
            .checked_add(row_bytes)?;
        if row_stride < row_bytes || data.len() < required {
            return None;
        }

        // Match GStreamer's default GST_VIDEO_FORMAT_I420 plane strides and offsets
        // (rows padded to 4-byte multiples, luma height rounded up to an even row count).
        let y_stride = width_usize.checked_next_multiple_of(4)?;
        let y_height = height_usize.checked_next_multiple_of(2)?;
        let y_plane_size = y_stride.checked_mul(y_height)?;
        let uv_stride = width_usize.div_ceil(2).checked_next_multiple_of(4)?;
        let uv_height = height_usize.div_ceil(2);
        let uv_plane_size = uv_stride.checked_mul(uv_height)?;
        let total_size = y_plane_size.checked_add(uv_plane_size.checked_mul(2)?)?;

        let mut output = vec![0u8; total_size];
        let (luma, chroma) = output.split_at_mut(y_plane_size);
        let (u_plane, v_plane) = chroma.split_at_mut(uv_plane_size);

        for y in 0..height_usize {
            let src_row = if stride >= 0 { y } else { height_usize - 1 - y };
            let src_row_base = src_row * row_stride;
            let dst_row_base = y * y_stride;
            for x in 0..width_usize {
                let offset = src_row_base + x * bpp;
                let pixel = &data[offset..offset + bpp];
                let (r, g, b) = match self {
                    Self::Rgb24 | Self::Rgba | Self::Rgbx => (pixel[0], pixel[1], pixel[2]),
                    Self::Bgra | Self::Bgrx => (pixel[2], pixel[1], pixel[0]),
                    Self::Argb | Self::Xrgb => (pixel[1], pixel[2], pixel[3]),
                    Self::Abgr | Self::Xbgr => (pixel[3], pixel[2], pixel[1]),
                };
                let r = i32::from(r);
                let g = i32::from(g);
                let b = i32::from(b);
                let luma_value = ((66 * r + 129 * g + 25 * b + 128) >> 8) + 16;
                luma[dst_row_base + x] = clamp_u8(luma_value);

                if x % 2 == 0 && y % 2 == 0 {
                    let u_value = ((-38 * r - 74 * g + 112 * b + 128) >> 8) + 128;
                    let v_value = ((112 * r - 94 * g - 18 * b + 128) >> 8) + 128;
                    let index = (y / 2) * uv_stride + (x / 2);
                    u_plane[index] = clamp_u8(u_value);
                    v_plane[index] = clamp_u8(v_value);
                }
            }
        }

        Some(output)
    }
}

fn clamp_u8(value: i32) -> u8 {
    u8::try_from(value.clamp(0, 255)).unwrap_or(0)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DecodedCursor {
    pub width: u32,
    pub height: u32,
    pub hotspot_x: i32,
    pub hotspot_y: i32,
    pub rgba: Vec<u8>,
}

#[must_use]
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
                PixelFormat::Rgb24 | PixelFormat::Rgbx => (pixel[0], pixel[1], pixel[2], u8::MAX),
                PixelFormat::Rgba => (pixel[0], pixel[1], pixel[2], pixel[3]),
                PixelFormat::Bgra => (pixel[2], pixel[1], pixel[0], pixel[3]),
                PixelFormat::Argb => (pixel[1], pixel[2], pixel[3], pixel[0]),
                PixelFormat::Abgr => (pixel[3], pixel[2], pixel[1], pixel[0]),
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

#[must_use]
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

#[must_use]
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

#[must_use]
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

#[must_use]
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

#[must_use]
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
        let Some(image) = closest_size_image(&theme_cursor.images, cursor) else {
            continue;
        };
        let score = alpha_difference_scaled(cursor, image);
        match best {
            Some((best_score, _)) if best_score <= score => {}
            _ => best = Some((score, recordly_type)),
        }
    }
    let (score, recordly_type) = best?;
    (score <= MAX_SCALED_ALPHA_SCORE).then_some(recordly_type)
}

fn closest_size_image<'a>(
    images: &'a [XcursorImage],
    cursor: &DecodedCursor,
) -> Option<&'a XcursorImage> {
    images
        .iter()
        .filter(|image| image.width > 0 && image.height > 0 && hotspot_matches(cursor, image))
        .min_by_key(|image| {
            let distance =
                image.width.abs_diff(cursor.width) + image.height.abs_diff(cursor.height);
            let area = u64::from(image.width) * u64::from(image.height);
            (distance, std::cmp::Reverse(area))
        })
}

fn alpha_difference_scaled(cursor: &DecodedCursor, image: &XcursorImage) -> u64 {
    let dst_w = f64::from(cursor.width);
    let dst_h = f64::from(cursor.height);
    let src_w = f64::from(image.width);
    let src_h = f64::from(image.height);
    let mut total = 0u64;

    for y in 0..cursor.height {
        let fy = (((f64::from(y) + 0.5) * src_h / dst_h) - 0.5).clamp(0.0, src_h - 1.0);
        let row_offset =
            usize::try_from(y).unwrap_or(0) * usize::try_from(cursor.width).unwrap_or(0);
        for x in 0..cursor.width {
            let fx = (((f64::from(x) + 0.5) * src_w / dst_w) - 0.5).clamp(0.0, src_w - 1.0);
            let expected = sample_xcursor_alpha(image, fx, fy);
            let actual = cursor.rgba[(row_offset + usize::try_from(x).unwrap_or(0)) * 4 + 3];
            total += u64::from(expected.abs_diff(actual));
        }
    }

    total / (u64::from(cursor.width) * u64::from(cursor.height)).max(1)
}

fn xcursor_alpha(pixel: u32) -> u8 {
    u8::try_from((pixel >> 24) & 0xff).unwrap_or(0)
}

fn floor_clamped_index(coord: f64, dim: u32) -> usize {
    #[expect(
        clippy::cast_possible_truncation,
        clippy::cast_sign_loss,
        reason = "coord is clamped within [0.0, dim - 1.0]"
    )]
    let index = coord.floor().clamp(0.0, f64::from(dim - 1)) as u32;
    usize::try_from(index).unwrap_or(0)
}

fn round_alpha_to_u8(alpha: f64) -> u8 {
    #[expect(
        clippy::cast_possible_truncation,
        clippy::cast_sign_loss,
        reason = "alpha is clamped within [0.0, 255.0]"
    )]
    let value = alpha.round().clamp(0.0, 255.0) as u8;
    value
}

fn sample_xcursor_alpha(image: &XcursorImage, fx: f64, fy: f64) -> u8 {
    let w = usize::try_from(image.width).unwrap_or(1);
    let h = usize::try_from(image.height).unwrap_or(1);
    let x0 = floor_clamped_index(fx, image.width).min(w - 1);
    let y0 = floor_clamped_index(fy, image.height).min(h - 1);
    let x1 = (x0 + 1).min(w - 1);
    let y1 = (y0 + 1).min(h - 1);
    let tx = fx - f64::from(u32::try_from(x0).unwrap_or(0));
    let ty = fy - f64::from(u32::try_from(y0).unwrap_or(0));
    let alpha_at =
        |x: usize, y: usize| -> f64 { f64::from(xcursor_alpha(image.pixels[y * w + x])) };
    let a00 = alpha_at(x0, y0);
    let a10 = alpha_at(x1, y0);
    let a01 = alpha_at(x0, y1);
    let a11 = alpha_at(x1, y1);
    let top = a00 + (a10 - a00) * tx;
    let bottom = a01 + (a11 - a01) * tx;
    round_alpha_to_u8(top + (bottom - top) * ty)
}

fn hotspot_matches(cursor: &DecodedCursor, image: &XcursorImage) -> bool {
    if image.width == 0 || image.height == 0 {
        return false;
    }
    let expected_x = f64::from(image.xhot) / f64::from(image.width);
    let expected_y = f64::from(image.yhot) / f64::from(image.height);
    let actual_x = f64::from(cursor.hotspot_x) / f64::from(cursor.width);
    let actual_y = f64::from(cursor.hotspot_y) / f64::from(cursor.height);
    (expected_x - actual_x).abs() <= MAX_HOTSPOT_DRIFT
        && (expected_y - actual_y).abs() <= MAX_HOTSPOT_DRIFT
}

fn alpha_difference(cursor: &DecodedCursor, image: &XcursorImage) -> u64 {
    let mut total = 0u64;
    for (index, pixel) in image.pixels.iter().enumerate() {
        let expected = xcursor_alpha(*pixel);
        let actual = cursor.rgba[index * 4 + 3];
        total += u64::from(expected.abs_diff(actual));
    }
    total / (u64::from(cursor.width) * u64::from(cursor.height)).max(1)
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
        let i420 = PixelFormat::Bgra.to_i420(2, 2, &data, 8).unwrap();
        assert_eq!(i420.len(), 16);
        assert_eq!(i420[0], 16);
        assert_eq!(i420[1], 16);
        assert_eq!(i420[4], 235);
        assert_eq!(i420[5], 235);
        assert_eq!(i420[8], 128);
        assert_eq!(i420[12], 128);
    }

    #[test]
    fn reads_padded_and_bottom_up_frames_without_repacking() {
        let bytes = [0, 0, 0, 255, 99, 99, 99, 99, 255, 255, 255, 255];
        let top_down = PixelFormat::Bgra.to_i420(1, 2, &bytes, 8).unwrap();
        let bottom_up = PixelFormat::Bgra.to_i420(1, 2, &bytes, -8).unwrap();
        assert_eq!((top_down[0], top_down[4]), (16, 235));
        assert_eq!((bottom_up[0], bottom_up[4]), (235, 16));
        assert!(PixelFormat::Bgra.to_i420(1, 2, &bytes[..11], 8).is_none());
    }

    #[test]
    fn converts_non_aligned_and_odd_dimensions_to_gstreamer_i420_layout() {
        let white_bgra = |w: u32, h: u32| -> Vec<u8> {
            let count = usize::try_from(w).unwrap() * usize::try_from(h).unwrap();
            let mut data = Vec::with_capacity(count * 4);
            for _ in 0..count {
                data.extend_from_slice(&[255, 255, 255, 255]);
            }
            data
        };

        let buf_1366 = PixelFormat::Bgra
            .to_i420(1366, 768, &white_bgra(1366, 768), 1366 * 4)
            .unwrap();
        assert_eq!(buf_1366.len(), 1_575_936);
        assert_eq!(buf_1366[0], 235);
        assert_eq!(buf_1366[1365], 235);
        assert_eq!(buf_1366[1366], 0);
        assert_eq!(buf_1366[767 * 1368 + 1365], 235);
        assert_eq!(buf_1366[1_050_624], 128);
        assert_eq!(buf_1366[1_313_280], 128);

        let buf_3x3 = PixelFormat::Bgra
            .to_i420(3, 3, &white_bgra(3, 3), 3 * 4)
            .unwrap();
        assert_eq!(buf_3x3.len(), 32);
        assert_eq!(buf_3x3[2 * 4 + 2], 235);
        assert_eq!(buf_3x3[16 + 4 + 1], 128);
        assert_eq!(buf_3x3[24 + 4 + 1], 128);

        let buf_1210 = PixelFormat::Bgra
            .to_i420(1210, 701, &white_bgra(1210, 701), 1210 * 4)
            .unwrap();
        assert_eq!(buf_1210.len(), 1_277_640);
        assert_eq!(buf_1210[850_824], 128);
        assert_eq!(buf_1210[1_064_232], 128);

        assert!(PixelFormat::Bgra.to_i420(0, 10, &[], 0).is_none());
        assert!(PixelFormat::Bgra.to_i420(10, 0, &[], 40).is_none());
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

    fn make_alpha_grid(w: u32, h: u32, alpha_fn: &dyn Fn(u32, u32) -> u8) -> Vec<u32> {
        let mut pixels = Vec::with_capacity((w * h) as usize);
        for y in 0..h {
            for x in 0..w {
                pixels.push((u32::from(alpha_fn(x, y)) << 24) | 0x00ff_ffff);
            }
        }
        pixels
    }

    fn ibeam_alpha(x: u32, y: u32, w: u32, h: u32) -> u8 {
        let cx = w / 2;
        let bar_half = (w / 6).max(1);
        let stem_half = (w / 12).max(1);
        let cap = (h / 8).max(1);
        let in_stem = x >= cx.saturating_sub(stem_half) && x <= cx + stem_half;
        let in_top = y < cap && x >= cx.saturating_sub(bar_half) && x <= cx + bar_half;
        let in_bot = y + cap >= h && x >= cx.saturating_sub(bar_half) && x <= cx + bar_half;
        if in_stem || in_top || in_bot {
            0xff
        } else {
            0x00
        }
    }

    #[test]
    fn classifies_fractionally_scaled_cursors_against_nearest_theme_size() {
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

    #[test]
    fn classifies_scaled_cursor_when_nearest_size_hotspot_mismatches() {
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
        let mismatched_nearest_theme = vec![ThemeCursor {
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
                    xhot: 0,
                    yhot: 0,
                    pixels: make_alpha_grid(48, 48, &|x, y| ibeam_alpha(x, y, 48, 48)),
                },
            ],
        }];
        assert_eq!(
            classify(&scaled_ibeam, &mismatched_nearest_theme),
            Some("text")
        );
    }
}
