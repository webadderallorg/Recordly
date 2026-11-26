use crate::pipewire_capture::{Anchor, PauseState};
use recordly_portal_cursor::telemetry;
use std::fs::{self, File};
use std::io::Read;
use std::os::unix::fs::FileTypeExt;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;

const EV_KEY: u16 = 1;
const BTN_LEFT: u16 = 0x110;
const BTN_RIGHT: u16 = 0x111;
const BTN_MIDDLE: u16 = 0x112;
const DOUBLE_CLICK_WINDOW_MS: u128 = 350;
const DOUBLE_CLICK_DISTANCE: f64 = 0.04;

pub fn start(
    samples: Arc<Mutex<Vec<telemetry::RawSample>>>,
    anchor: Arc<Mutex<Option<Anchor>>>,
    pause: Arc<Mutex<PauseState>>,
    last_position: Arc<Mutex<Option<(f64, f64)>>>,
    cursor_visible: Arc<AtomicBool>,
    verbose: bool,
) {
    let Ok(entries) = fs::read_dir("/dev/input") else {
        return;
    };
    let mut devices = 0;
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy().to_string();
        if !name.starts_with("event") {
            continue;
        }
        let path = entry.path();
        if !device_has_pointer_buttons(&name) {
            continue;
        }
        let Ok(metadata) = fs::metadata(&path) else {
            continue;
        };
        if !metadata.file_type().is_char_device() {
            continue;
        }
        let Ok(file) = File::open(&path) else {
            continue;
        };
        let thread_samples = Arc::clone(&samples);
        let thread_anchor = Arc::clone(&anchor);
        let thread_pause = Arc::clone(&pause);
        let thread_position = Arc::clone(&last_position);
        let thread_visible = Arc::clone(&cursor_visible);
        std::thread::Builder::new()
            .name(format!("recordly-clicks-{name}"))
            .spawn(move || {
                read_device(
                    file,
                    thread_samples,
                    thread_anchor,
                    thread_pause,
                    thread_position,
                    thread_visible,
                    verbose,
                );
            })
            .ok();
        devices += 1;
    }
    if verbose {
        eprintln!("[clicks] listening on {devices} input devices");
    }
}

fn read_device(
    mut file: File,
    samples: Arc<Mutex<Vec<telemetry::RawSample>>>,
    anchor: Arc<Mutex<Option<Anchor>>>,
    pause: Arc<Mutex<PauseState>>,
    last_position: Arc<Mutex<Option<(f64, f64)>>>,
    cursor_visible: Arc<AtomicBool>,
    verbose: bool,
) {
    let mut buffer = [0u8; 24];
    let mut last_left_click: Option<(Instant, f64, f64)> = None;

    loop {
        if file.read_exact(&mut buffer).is_err() {
            return;
        }
        let event_type = u16::from_le_bytes([buffer[16], buffer[17]]);
        if event_type != EV_KEY {
            continue;
        }
        let code = u16::from_le_bytes([buffer[18], buffer[19]]);
        let value = i32::from_le_bytes([buffer[20], buffer[21], buffer[22], buffer[23]]);
        if value != 0 && value != 1 {
            continue;
        }
        if !matches!(code, BTN_LEFT | BTN_RIGHT | BTN_MIDDLE) {
            continue;
        }

        let (paused, accumulated_ns) = pause
            .lock()
            .map(|pause| pause.snapshot())
            .unwrap_or((true, 0));
        if paused {
            continue;
        }
        if !cursor_visible.load(Ordering::SeqCst) {
            continue;
        }

        let click_instant = Instant::now();
        let Some((anchor_pts, anchor_instant)) = anchor
            .lock()
            .ok()
            .and_then(|guard| guard.as_ref().map(|anchor| (anchor.pts_ns, anchor.instant)))
        else {
            continue;
        };
        let pts_ns = anchor_pts
            + click_instant
                .saturating_duration_since(anchor_instant)
                .as_nanos() as i64
            - accumulated_ns;

        let (cx, cy) = last_position
            .lock()
            .ok()
            .and_then(|position| *position)
            .unwrap_or((0.5, 0.5));

        let interaction = if value == 0 {
            "mouseup"
        } else {
            match code {
                BTN_RIGHT => "right-click",
                BTN_MIDDLE => "middle-click",
                _ => {
                    let is_double = last_left_click.is_some_and(|(last_time, x, y)| {
                        click_instant.duration_since(last_time).as_millis()
                            <= DOUBLE_CLICK_WINDOW_MS
                            && ((cx - x).powi(2) + (cy - y).powi(2)).sqrt() <= DOUBLE_CLICK_DISTANCE
                    });
                    if is_double { "double-click" } else { "click" }
                }
            }
        };
        if value == 1 && code == BTN_LEFT {
            last_left_click = Some((click_instant, cx, cy));
        }

        if verbose {
            eprintln!("[clicks] code={code} value={value} type={interaction}");
        }

        if let Ok(mut collected) = samples.lock() {
            collected.push(telemetry::RawSample {
                pts_ns,
                cx,
                cy,
                cursor_type: None,
                interaction_type: Some(interaction.to_owned()),
            });
        }
    }
}

pub(crate) fn key_bitmap_has_button(bitmap: &str, code: u16) -> bool {
    let words: Vec<&str> = bitmap.split_whitespace().collect();
    let word_bits = usize::BITS as usize;
    let word_idx = (code as usize) / word_bits;
    let bit_idx = (code as usize) % word_bits;
    if word_idx >= words.len() {
        return false;
    }
    let hex = words[words.len() - 1 - word_idx];
    usize::from_str_radix(hex, 16)
        .map(|value| (value & (1usize << bit_idx)) != 0)
        .unwrap_or(false)
}

fn device_has_pointer_buttons(event_name: &str) -> bool {
    let path = format!("/sys/class/input/{event_name}/device/capabilities/key");
    fs::read_to_string(path)
        .map(|bitmap| {
            key_bitmap_has_button(&bitmap, BTN_LEFT)
                || key_bitmap_has_button(&bitmap, BTN_RIGHT)
                || key_bitmap_has_button(&bitmap, BTN_MIDDLE)
        })
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_pointer_button_bits_in_sysfs_key_bitmap() {
        let word_bits = usize::BITS as usize;
        let word_idx = (BTN_LEFT as usize) / word_bits;
        let bit_idx = (BTN_LEFT as usize) % word_bits;
        let mut words = vec!["0".to_owned(); word_idx + 1];
        words[0] = format!("{:x}", 1usize << bit_idx);
        assert!(key_bitmap_has_button(&words.join(" "), BTN_LEFT));

        #[cfg(target_pointer_width = "64")]
        {
            assert!(key_bitmap_has_button("70000 0 0 0 0", BTN_LEFT));
            assert!(key_bitmap_has_button("70000 0 0 0 0", BTN_RIGHT));
            assert!(key_bitmap_has_button("70000 0 0 0 0", BTN_MIDDLE));
        }
    }

    #[test]
    fn rejects_non_pointer_key_bitmaps_and_invalid_hex() {
        assert!(!key_bitmap_has_button("ffffffff ffffffff ffffffff ffffffff", BTN_LEFT));
        assert!(!key_bitmap_has_button("0 0 0 0 0", BTN_LEFT));
        assert!(!key_bitmap_has_button("", BTN_LEFT));
        assert!(!key_bitmap_has_button("not-hex 0 0 0 0", BTN_LEFT));
    }
}
