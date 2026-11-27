use serde::Serialize;
use std::fs;
use std::io::Write;
use std::path::Path;
use std::time::Instant;

pub const VERSION: u32 = 2;

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Sample {
    #[serde(rename = "timeMs")]
    pub time_ms: u64,
    pub cx: f64,
    pub cy: f64,
    #[serde(rename = "interactionType", skip_serializing_if = "Option::is_none")]
    pub interaction_type: Option<String>,
    #[serde(rename = "mouseButton", skip_serializing_if = "Option::is_none")]
    pub mouse_button: Option<u8>,
    #[serde(rename = "cursorType", skip_serializing_if = "Option::is_none")]
    pub cursor_type: Option<String>,
    #[serde(rename = "cursorVisible", skip_serializing_if = "Option::is_none")]
    pub cursor_visible: Option<bool>,
}

impl Sample {
    #[must_use]
    pub fn new(time_ms: u64, cx: f64, cy: f64) -> Self {
        Self {
            time_ms,
            cx,
            cy,
            interaction_type: None,
            mouse_button: None,
            cursor_type: None,
            cursor_visible: None,
        }
    }

    #[must_use]
    pub fn with_cursor_type(mut self, cursor_type: impl Into<String>) -> Self {
        self.cursor_type = Some(cursor_type.into());
        self
    }

    #[must_use]
    pub fn with_interaction_type(mut self, interaction_type: impl Into<String>) -> Self {
        self.interaction_type = Some(interaction_type.into());
        self
    }

    #[must_use]
    pub fn with_mouse_button(mut self, mouse_button: u8) -> Self {
        self.mouse_button = Some(mouse_button);
        self
    }
}

#[derive(Serialize)]
struct Document<'a> {
    version: u32,
    samples: &'a [Sample],
}

/// Serializes cursor telemetry samples into formatted JSON.
///
/// # Panics
///
/// Panics if serializing the fixed cursor document schema fails.
#[must_use]
pub fn to_json(samples: &[Sample]) -> String {
    serde_json::to_string_pretty(&Document {
        version: VERSION,
        samples,
    })
    .expect("cursor telemetry serialization cannot fail")
}

/// Atomically writes cursor telemetry samples to `path`.
///
/// # Errors
///
/// Returns an I/O error if creating parent directories, serializing/writing the file, syncing it,
/// or renaming it into place fails.
pub fn write_document(path: &Path, samples: &[Sample]) -> std::io::Result<()> {
    if let Some(parent) = path.parent()
        && !parent.as_os_str().is_empty()
    {
        fs::create_dir_all(parent)?;
    }
    let (temporary, mut file) = create_unique_temp_file(path)?;
    let write_result = (|| -> std::io::Result<()> {
        serde_json::to_writer_pretty(
            &mut file,
            &Document {
                version: VERSION,
                samples,
            },
        )?;
        file.write_all(b"\n")?;
        file.sync_all()?;
        Ok(())
    })();
    if let Err(error) = write_result {
        let _ = fs::remove_file(&temporary);
        return Err(error);
    }
    drop(file);
    if let Err(error) = fs::rename(&temporary, path) {
        let _ = fs::remove_file(&temporary);
        return Err(error);
    }
    Ok(())
}

fn create_unique_temp_file(destination: &Path) -> std::io::Result<(std::path::PathBuf, fs::File)> {
    let parent = destination
        .parent()
        .filter(|dir| !dir.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    let pid = std::process::id();
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |duration| duration.as_nanos());
    for attempt in 0..32u32 {
        let candidate = parent.join(format!(".cursor-telemetry.{pid}.{nanos}.{attempt}.tmp"));
        match fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&candidate)
        {
            Ok(file) => return Ok((candidate, file)),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
            Err(error) => return Err(error),
        }
    }
    Err(std::io::Error::new(
        std::io::ErrorKind::AlreadyExists,
        "failed to create a unique temporary telemetry file",
    ))
}

#[derive(Debug, Clone, PartialEq)]
pub struct RawSample {
    pub pts_ns: i64,
    pub cx: f64,
    pub cy: f64,
    pub cursor_type: Option<String>,
    pub cursor_visible: Option<bool>,
    pub interaction_type: Option<String>,
    pub mouse_button: Option<u8>,
}

#[derive(Clone, Copy, PartialEq)]
pub struct CursorSnapshot {
    pub position: (f64, f64),
    pub cursor_type: &'static str,
}

/// Cursor updates in observation order on the same monotonic timeline as evdev.
#[derive(Default)]
pub struct CursorHistory {
    observations: Vec<(Instant, Option<CursorSnapshot>)>,
}

impl CursorHistory {
    pub fn record(&mut self, observed_at: Instant, cursor: Option<CursorSnapshot>) {
        if cursor != self.current() {
            self.observations.push((observed_at, cursor));
        }
    }

    #[must_use]
    pub fn current(&self) -> Option<CursorSnapshot> {
        self.observations.last().and_then(|(_, cursor)| *cursor)
    }

    #[must_use]
    pub fn position_at(&self, instant: Instant) -> Option<(f64, f64)> {
        let end = self
            .observations
            .partition_point(|(observed_at, _)| *observed_at <= instant);
        self.observations[..end]
            .last()
            .and_then(|(_, cursor)| cursor.map(|snapshot| snapshot.position))
    }
}

#[derive(Clone, Copy, Default)]
pub struct RecordedCursor {
    visible: Option<bool>,
    position: (f64, f64),
}

impl RecordedCursor {
    #[must_use]
    pub fn sample(&mut self, pts_ns: i64, cursor: Option<CursorSnapshot>) -> Option<RawSample> {
        let visible = cursor.is_some();
        let visibility_changed = self.visible != Some(visible);
        self.visible = Some(visible);
        if let Some(cursor) = cursor {
            self.position = cursor.position;
        } else if !visibility_changed {
            return None;
        }

        Some(RawSample {
            pts_ns,
            cx: self.position.0,
            cy: self.position.1,
            cursor_type: cursor.map(|snapshot| snapshot.cursor_type.to_owned()),
            cursor_visible: visibility_changed.then_some(visible),
            interaction_type: None,
            mouse_button: None,
        })
    }
}

#[must_use]
pub fn resolve_samples(
    raw: &[RawSample],
    anchor_pts_ns: i64,
    anchor_epoch_ms: i64,
    start_epoch_ms: i64,
) -> Vec<Sample> {
    let start = if start_epoch_ms > 0 {
        start_epoch_ms
    } else {
        anchor_epoch_ms
    };
    raw.iter()
        .map(|item| Sample {
            time_ms: map_pts_to_time_ms(item.pts_ns, anchor_pts_ns, anchor_epoch_ms, Some(start)),
            cx: item.cx,
            cy: item.cy,
            interaction_type: item.interaction_type.clone(),
            mouse_button: item.mouse_button,
            cursor_type: item.cursor_type.clone(),
            cursor_visible: item.cursor_visible,
        })
        .collect()
}

pub fn normalize_samples(samples: &mut Vec<Sample>) {
    samples.sort_by_key(|sample| sample.time_ms);
    samples.dedup_by(|left, right| {
        left.time_ms == right.time_ms
            && left.cx.to_bits() == right.cx.to_bits()
            && left.cy.to_bits() == right.cy.to_bits()
            && left.cursor_type == right.cursor_type
            && left.cursor_visible == right.cursor_visible
            && left.interaction_type == right.interaction_type
            && left.mouse_button == right.mouse_button
    });
}

#[must_use]
pub fn map_pts_to_time_ms(
    pts_ns: i64,
    anchor_pts_ns: i64,
    anchor_epoch_ms: i64,
    start_epoch_ms: Option<i64>,
) -> u64 {
    let delta_ns = i128::from(pts_ns) - i128::from(anchor_pts_ns);
    let offset_ms = if delta_ns >= 0 {
        (delta_ns + 500_000) / 1_000_000
    } else {
        (delta_ns - 500_000) / 1_000_000
    };
    let start_ms = start_epoch_ms.unwrap_or(anchor_epoch_ms);
    let time_ms = i128::from(anchor_epoch_ms) + offset_ms - i128::from(start_ms);
    u64::try_from(time_ms.max(0)).unwrap_or(u64::MAX)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_the_recordly_schema() {
        let samples = vec![
            Sample::new(0, 0.5, 0.5).with_cursor_type("arrow"),
            Sample::new(33, 0.25, 0.75)
                .with_interaction_type("click")
                .with_mouse_button(1),
        ];
        let json: serde_json::Value = serde_json::from_str(&to_json(&samples)).unwrap();
        assert_eq!(json["version"], 2);
        assert_eq!(json["samples"][0]["timeMs"], 0);
        assert_eq!(json["samples"][0]["cursorType"], "arrow");
        assert!(json["samples"][0].get("interactionType").is_none());
        assert!(json["samples"][0].get("mouseButton").is_none());
        assert_eq!(json["samples"][1]["interactionType"], "click");
        assert_eq!(json["samples"][1]["mouseButton"], 1);
        assert!(json["samples"][1].get("cursorType").is_none());
    }

    #[test]
    fn normalizes_order_and_removes_duplicates() {
        let mut samples = vec![
            Sample::new(33, 0.5, 0.5),
            Sample::new(0, 0.1, 0.1),
            Sample::new(33, 0.5, 0.5),
        ];
        normalize_samples(&mut samples);
        assert_eq!(samples.len(), 2);
        assert_eq!(samples[0].time_ms, 0);
        assert_eq!(samples[1].time_ms, 33);
    }

    #[test]
    fn standalone_anchor_maps_first_buffer_to_zero() {
        assert_eq!(
            map_pts_to_time_ms(1_000_000_000, 1_000_000_000, 1_700_000_000_000, None),
            0
        );
    }

    #[test]
    fn recording_start_epoch_shifts_samples() {
        assert_eq!(
            map_pts_to_time_ms(
                1_500_000_000,
                1_000_000_000,
                1_700_000_000_500,
                Some(1_700_000_000_000)
            ),
            1000
        );
    }

    #[test]
    fn clamps_negative_offsets() {
        assert_eq!(
            map_pts_to_time_ms(
                1_000_000_000,
                1_000_000_000,
                1_700_000_000_000,
                Some(1_700_000_001_000)
            ),
            0
        );
    }

    #[test]
    fn resolves_raw_samples_against_video_start_epoch() {
        let raw = vec![
            RawSample {
                pts_ns: 1_000_000_000,
                cx: 0.1,
                cy: 0.2,
                cursor_type: Some("arrow".to_owned()),
                cursor_visible: None,
                interaction_type: None,
                mouse_button: None,
            },
            RawSample {
                pts_ns: 1_500_000_000,
                cx: 0.3,
                cy: 0.4,
                cursor_type: Some("text".to_owned()),
                cursor_visible: None,
                interaction_type: Some("click".to_owned()),
                mouse_button: Some(1),
            },
        ];
        let samples = resolve_samples(&raw, 1_000_000_000, 1_700_000_000_500, 1_700_000_000_000);
        assert_eq!(samples[0].time_ms, 500);
        assert_eq!(samples[1].time_ms, 1000);
        assert_eq!(samples[1].cursor_type.as_deref(), Some("text"));
        assert_eq!(samples[1].mouse_button, Some(1));
    }

    #[test]
    fn saves_visibility_edges_and_omits_visibility_from_ordinary_samples() {
        let mut recorded = RecordedCursor::default();
        let arrow = CursorSnapshot {
            position: (0.25, 0.75),
            cursor_type: "arrow",
        };
        let mut raw = vec![
            recorded.sample(0, None).unwrap(),
            recorded.sample(100_000_000, Some(arrow)).unwrap(),
            recorded.sample(200_000_000, Some(arrow)).unwrap(),
            recorded.sample(300_000_000, None).unwrap(),
        ];
        assert!(recorded.sample(400_000_000, None).is_none());
        raw.push(recorded.sample(500_000_000, Some(arrow)).unwrap());

        let mut samples = resolve_samples(&raw, 0, 0, 0);
        normalize_samples(&mut samples);
        let json: serde_json::Value = serde_json::from_str(&to_json(&samples)).unwrap();
        let samples = json["samples"].as_array().unwrap();
        assert_eq!(samples[0]["cursorVisible"], false);
        assert_eq!(samples[1]["cursorVisible"], true);
        assert!(
            !samples[2]
                .as_object()
                .unwrap()
                .contains_key("cursorVisible")
        );
        assert_eq!(samples[3]["cursorVisible"], false);
        assert_eq!(samples[3]["cx"], 0.25);
        assert_eq!(samples[4]["cursorVisible"], true);
        assert_eq!(samples[4]["cursorType"], "arrow");
    }

    #[test]
    fn falls_back_to_anchor_when_start_epoch_is_unset() {
        let raw = vec![RawSample {
            pts_ns: 2_000_000_000,
            cx: 0.5,
            cy: 0.5,
            cursor_type: None,
            cursor_visible: None,
            interaction_type: None,
            mouse_button: None,
        }];
        let samples = resolve_samples(&raw, 1_000_000_000, 1_700_000_000_000, 0);
        assert_eq!(samples[0].time_ms, 1000);
    }

    #[test]
    fn write_document_uses_unique_temp_without_truncating_sibling_tmp() {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |duration| duration.as_nanos());
        let dir =
            std::env::temp_dir().join(format!("recordly-telemetry-{}-{nanos}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let sibling_tmp = dir.join("capture.cursor.json.tmp");
        fs::write(&sibling_tmp, "preserve-me\n").unwrap();

        let target = dir.join("capture.json");
        let samples = vec![Sample::new(10, 0.25, 0.75).with_cursor_type("arrow")];
        write_document(&target, &samples).unwrap();

        assert_eq!(fs::read_to_string(&sibling_tmp).unwrap(), "preserve-me\n");
        let parsed: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&target).unwrap()).unwrap();
        assert_eq!(parsed["version"], 2);
        assert_eq!(parsed["samples"][0]["timeMs"], 10);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn write_document_supports_max_length_destination_filename() {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |duration| duration.as_nanos());
        let dir = std::env::temp_dir().join(format!(
            "recordly-telemetry-max-{}-{nanos}",
            std::process::id()
        ));
        fs::create_dir_all(&dir).unwrap();

        let max_name = format!("{}.cursor.json", "a".repeat(243));
        assert_eq!(max_name.len(), 255);
        let target = dir.join(max_name);
        let samples = vec![Sample::new(15, 0.5, 0.5).with_cursor_type("arrow")];
        write_document(&target, &samples).unwrap();

        let parsed: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&target).unwrap()).unwrap();
        assert_eq!(parsed["version"], 2);
        assert_eq!(parsed["samples"][0]["timeMs"], 15);

        let _ = fs::remove_dir_all(&dir);
    }
}
