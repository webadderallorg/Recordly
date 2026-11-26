use serde::Serialize;
use std::fs;
use std::io::Write;
use std::path::Path;

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
}

impl Sample {
    pub fn new(time_ms: u64, cx: f64, cy: f64) -> Self {
        Self {
            time_ms,
            cx,
            cy,
            interaction_type: None,
            mouse_button: None,
            cursor_type: None,
        }
    }

    pub fn with_cursor_type(mut self, cursor_type: impl Into<String>) -> Self {
        self.cursor_type = Some(cursor_type.into());
        self
    }

    pub fn with_interaction_type(mut self, interaction_type: impl Into<String>) -> Self {
        self.interaction_type = Some(interaction_type.into());
        self
    }

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

pub fn to_json(samples: &[Sample]) -> String {
    serde_json::to_string_pretty(&Document {
        version: VERSION,
        samples,
    })
    .expect("cursor telemetry serialization cannot fail")
}

pub fn write_document(path: &Path, samples: &[Sample]) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let temporary = path.with_extension("cursor.json.tmp");
    let mut file = fs::File::create(&temporary)?;
    file.write_all(to_json(samples).as_bytes())?;
    file.write_all(b"\n")?;
    file.sync_all()?;
    fs::rename(temporary, path)
}

#[derive(Debug, Clone, PartialEq)]
pub struct RawSample {
    pub pts_ns: i64,
    pub cx: f64,
    pub cy: f64,
    pub cursor_type: Option<String>,
    pub interaction_type: Option<String>,
    pub mouse_button: Option<u8>,
}

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
        })
        .collect()
}

pub fn normalize_samples(samples: &mut Vec<Sample>) {
    samples.sort_by_key(|sample| sample.time_ms);
    samples.dedup_by(|left, right| {
        left.time_ms == right.time_ms
            && left.cx == right.cx
            && left.cy == right.cy
            && left.cursor_type == right.cursor_type
            && left.interaction_type == right.interaction_type
            && left.mouse_button == right.mouse_button
    });
}

pub fn map_pts_to_time_ms(
    pts_ns: i64,
    anchor_pts_ns: i64,
    anchor_epoch_ms: i64,
    start_epoch_ms: Option<i64>,
) -> u64 {
    let delta_ms = (pts_ns - anchor_pts_ns) as f64 / 1_000_000.0;
    let start_ms = start_epoch_ms.unwrap_or(anchor_epoch_ms);
    let time_ms = anchor_epoch_ms as f64 + delta_ms - start_ms as f64;
    time_ms.max(0.0).round() as u64
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
                interaction_type: None,
                mouse_button: None,
            },
            RawSample {
                pts_ns: 1_500_000_000,
                cx: 0.3,
                cy: 0.4,
                cursor_type: Some("text".to_owned()),
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
    fn falls_back_to_anchor_when_start_epoch_is_unset() {
        let raw = vec![RawSample {
            pts_ns: 2_000_000_000,
            cx: 0.5,
            cy: 0.5,
            cursor_type: None,
            interaction_type: None,
            mouse_button: None,
        }];
        let samples = resolve_samples(&raw, 1_000_000_000, 1_700_000_000_000, 0);
        assert_eq!(samples[0].time_ms, 1000);
    }
}
