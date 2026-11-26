#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PositionSpace {
    Global,
    StreamLocal,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

pub fn stream_rect(position: Option<(i32, i32)>, size: Option<(i32, i32)>) -> Option<Rect> {
    let (width, height) = size?;
    if width <= 0 || height <= 0 {
        return None;
    }
    let (x, y) = position.unwrap_or((0, 0));
    Some(Rect {
        x,
        y,
        width,
        height,
    })
}

pub fn resolve_space(requested: Option<PositionSpace>) -> PositionSpace {
    requested.unwrap_or(PositionSpace::StreamLocal)
}

pub fn normalize_to_stream(
    cursor: (i32, i32),
    stream: Rect,
    space: PositionSpace,
) -> Option<(f64, f64)> {
    if stream.width <= 0 || stream.height <= 0 {
        return None;
    }
    let local_x = match space {
        PositionSpace::Global => cursor.0 - stream.x,
        PositionSpace::StreamLocal => cursor.0,
    };
    let local_y = match space {
        PositionSpace::Global => cursor.1 - stream.y,
        PositionSpace::StreamLocal => cursor.1,
    };
    let cx = (local_x as f64 / stream.width as f64).clamp(0.0, 1.0);
    let cy = (local_y as f64 / stream.height as f64).clamp(0.0, 1.0);
    Some((cx, cy))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_stream_rect_from_portal_properties() {
        let rect = stream_rect(Some((1920, 0)), Some((1920, 1080))).unwrap();
        assert_eq!(
            rect,
            Rect {
                x: 1920,
                y: 0,
                width: 1920,
                height: 1080
            }
        );
    }

    #[test]
    fn rejects_missing_or_invalid_stream_size() {
        assert_eq!(stream_rect(Some((0, 0)), None), None);
        assert_eq!(stream_rect(Some((0, 0)), Some((0, 1080))), None);
        assert_eq!(stream_rect(Some((0, 0)), Some((1920, -1))), None);
    }

    #[test]
    fn defaults_to_stream_local() {
        assert_eq!(resolve_space(None), PositionSpace::StreamLocal);
        assert_eq!(
            resolve_space(Some(PositionSpace::Global)),
            PositionSpace::Global
        );
        assert_eq!(
            resolve_space(Some(PositionSpace::StreamLocal)),
            PositionSpace::StreamLocal
        );
    }

    #[test]
    fn normalizes_global_cursor_coordinates_against_monitor_offset() {
        let stream = Rect {
            x: 1920,
            y: 0,
            width: 1920,
            height: 1080,
        };
        let (cx, cy) = normalize_to_stream((2880, 540), stream, PositionSpace::Global).unwrap();
        assert!((cx - 0.5).abs() < 1e-9);
        assert!((cy - 0.5).abs() < 1e-9);
    }

    #[test]
    fn normalizes_stream_local_cursor_coordinates() {
        let stream = Rect {
            x: 1920,
            y: 0,
            width: 1920,
            height: 1080,
        };
        let (cx, cy) = normalize_to_stream((960, 540), stream, PositionSpace::StreamLocal).unwrap();
        assert!((cx - 0.5).abs() < 1e-9);
        assert!((cy - 0.5).abs() < 1e-9);
    }

    #[test]
    fn normalizes_physical_stream_pixels_on_hidpi_streams() {
        let stream = Rect {
            x: 0,
            y: 0,
            width: 3840,
            height: 2160,
        };
        let (cx, cy) =
            normalize_to_stream((1920, 1080), stream, PositionSpace::StreamLocal).unwrap();
        assert!((cx - 0.5).abs() < 1e-9);
        assert!((cy - 0.5).abs() < 1e-9);
    }

    #[test]
    fn clamps_cursor_positions_outside_the_stream() {
        let stream = Rect {
            x: 0,
            y: 0,
            width: 1920,
            height: 1080,
        };
        let (cx, cy) = normalize_to_stream((-200, 5000), stream, PositionSpace::Global).unwrap();
        assert_eq!(cx, 0.0);
        assert_eq!(cy, 1.0);
    }
}
