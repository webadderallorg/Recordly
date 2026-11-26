use crate::pipewire_capture::{Anchor, PauseState};
use recordly_portal_cursor::telemetry;
use std::fs::{self, File};
use std::io::Read;
use std::os::unix::fs::FileTypeExt;
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;

const EV_SYN: u16 = 0;
const SYN_REPORT: u16 = 0;
const EV_KEY: u16 = 1;
const EV_ABS: u16 = 3;
const ABS_X: u16 = 0;
const ABS_Y: u16 = 1;

const BTN_LEFT: u16 = 0x110;
const BTN_RIGHT: u16 = 0x111;
const BTN_MIDDLE: u16 = 0x112;
const BTN_TOOL_FINGER: u16 = 0x145;
const BTN_TOUCH: u16 = 0x14a;
const BTN_TOOL_DOUBLETAP: u16 = 0x14d;
const BTN_TOOL_TRIPLETAP: u16 = 0x14e;
const BTN_TOOL_QUADTAP: u16 = 0x14f;
const INPUT_PROP_DIRECT_BIT: u16 = 1;

const DOUBLE_CLICK_WINDOW_MS: u128 = 350;
const DOUBLE_CLICK_DISTANCE: f64 = 0.04;
const TAP_MAX_DURATION_MS: u128 = 220;
const TAP_MAX_MOVE_MM: f64 = 3.0;
const TAP_MAX_MOVE_NORM: f64 = 0.03;
const TAP_MAX_CURSOR_DRIFT: f64 = 0.015;

const TOOL_FINGER_BIT: u8 = 1 << 0;
const TOOL_DOUBLETAP_BIT: u8 = 1 << 1;
const TOOL_TRIPLETAP_BIT: u8 = 1 << 2;
const TOOL_QUADTAP_BIT: u8 = 1 << 3;

#[derive(Clone, Copy, Debug, Default)]
pub(crate) struct AbsAxis {
    pub min: i32,
    pub max: i32,
    pub resolution: i32,
}

#[derive(Clone, Copy, Debug, Default)]
pub(crate) struct TouchpadGeometry {
    pub x: Option<AbsAxis>,
    pub y: Option<AbsAxis>,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct CompletedTap {
    pub button_code: u16,
    pub down_at: Instant,
    pub down_cursor: (f64, f64),
    pub up_at: Instant,
    pub up_cursor: (f64, f64),
}

#[derive(Clone, Copy, Debug)]
struct ActiveTap {
    down_at: Instant,
    down_cursor: (f64, f64),
    start_x: Option<i32>,
    start_y: Option<i32>,
    moved: bool,
    saw_physical_button: bool,
    max_fingers: u8,
}

#[derive(Debug, Default)]
pub(crate) struct TouchTapTracker {
    geometry: TouchpadGeometry,
    cur_x: Option<i32>,
    cur_y: Option<i32>,
    tool_bits: u8,
    touch_down: bool,
    pending_touch_down: Option<(Instant, (f64, f64))>,
    pending_touch_up: Option<(Instant, (f64, f64))>,
    physical_buttons_held: u8,
    pending_physical_button: bool,
    active: Option<ActiveTap>,
}

impl TouchTapTracker {
    pub(crate) fn new(geometry: TouchpadGeometry) -> Self {
        Self {
            geometry,
            ..Self::default()
        }
    }

    pub(crate) fn is_touching(&self) -> bool {
        self.touch_down || self.active.is_some()
    }

    fn set_tool_bit(&mut self, bit: u8, active: bool) {
        if active {
            self.tool_bits |= bit;
        } else {
            self.tool_bits &= !bit;
        }
    }

    fn current_fingers(&self) -> u8 {
        if self.tool_bits & TOOL_QUADTAP_BIT != 0 {
            4
        } else if self.tool_bits & TOOL_TRIPLETAP_BIT != 0 {
            3
        } else if self.tool_bits & TOOL_DOUBLETAP_BIT != 0 {
            2
        } else {
            u8::from(self.tool_bits & TOOL_FINGER_BIT != 0)
        }
    }

    fn exceeded_move_threshold(&self, start_x: Option<i32>, start_y: Option<i32>) -> bool {
        let dx = self
            .cur_x
            .zip(start_x)
            .map_or(0.0, |(cur, start)| f64::from((cur - start).abs()));
        let dy = self
            .cur_y
            .zip(start_y)
            .map_or(0.0, |(cur, start)| f64::from((cur - start).abs()));
        if dx == 0.0 && dy == 0.0 {
            return false;
        }
        if let (Some(ax), Some(ay)) = (self.geometry.x, self.geometry.y)
            && ax.resolution > 0
            && ay.resolution > 0
        {
            let mm_x = dx / f64::from(ax.resolution);
            let mm_y = dy / f64::from(ay.resolution);
            return mm_x.hypot(mm_y) > TAP_MAX_MOVE_MM;
        }
        let norm_x = self
            .geometry
            .x
            .and_then(|ax| (ax.max > ax.min).then_some(dx / f64::from(ax.max - ax.min)))
            .unwrap_or(0.0);
        let norm_y = self
            .geometry
            .y
            .and_then(|ay| (ay.max > ay.min).then_some(dy / f64::from(ay.max - ay.min)))
            .unwrap_or(0.0);
        norm_x.hypot(norm_y) > TAP_MAX_MOVE_NORM
    }

    pub(crate) fn handle_event(
        &mut self,
        event_type: u16,
        code: u16,
        value: i32,
        instant: Instant,
        cursor: (f64, f64),
    ) -> Option<CompletedTap> {
        match event_type {
            EV_ABS => match code {
                ABS_X => self.cur_x = Some(value),
                ABS_Y => self.cur_y = Some(value),
                _ => {}
            },
            EV_KEY => match code {
                BTN_TOOL_FINGER => self.set_tool_bit(TOOL_FINGER_BIT, value != 0),
                BTN_TOOL_DOUBLETAP => self.set_tool_bit(TOOL_DOUBLETAP_BIT, value != 0),
                BTN_TOOL_TRIPLETAP => self.set_tool_bit(TOOL_TRIPLETAP_BIT, value != 0),
                BTN_TOOL_QUADTAP => self.set_tool_bit(TOOL_QUADTAP_BIT, value != 0),
                BTN_TOUCH => {
                    if value != 0 {
                        if !self.touch_down {
                            self.touch_down = true;
                            self.pending_touch_down = Some((instant, cursor));
                        }
                    } else if self.touch_down {
                        self.touch_down = false;
                        self.pending_touch_up = Some((instant, cursor));
                    }
                }
                BTN_LEFT | BTN_RIGHT | BTN_MIDDLE => {
                    if value == 1 {
                        self.physical_buttons_held = self.physical_buttons_held.saturating_add(1);
                        self.pending_physical_button = true;
                        if let Some(active) = self.active.as_mut() {
                            active.saw_physical_button = true;
                        }
                    } else if value == 0 {
                        self.physical_buttons_held = self.physical_buttons_held.saturating_sub(1);
                    }
                }
                _ => {}
            },
            EV_SYN if code == SYN_REPORT => {
                if let Some((down_at, down_cursor)) = self.pending_touch_down.take() {
                    let saw_physical =
                        self.physical_buttons_held > 0 || self.pending_physical_button;
                    self.active = Some(ActiveTap {
                        down_at,
                        down_cursor,
                        start_x: self.cur_x,
                        start_y: self.cur_y,
                        moved: false,
                        saw_physical_button: saw_physical,
                        max_fingers: self.current_fingers().max(1),
                    });
                }
                self.pending_physical_button = false;

                let fingers = self.current_fingers();
                let moved = self.active.as_ref().is_some_and(|active| {
                    self.exceeded_move_threshold(active.start_x, active.start_y)
                });
                if let Some(active) = self.active.as_mut() {
                    if fingers > active.max_fingers {
                        active.max_fingers = fingers;
                    }
                    if moved {
                        active.moved = true;
                    }
                }

                if let Some((up_at, up_cursor)) = self.pending_touch_up.take()
                    && let Some(active) = self.active.take()
                {
                    let duration_ms = up_at.saturating_duration_since(active.down_at).as_millis();
                    let cursor_drift = (up_cursor.0 - active.down_cursor.0)
                        .hypot(up_cursor.1 - active.down_cursor.1);
                    if !active.saw_physical_button
                        && !active.moved
                        && duration_ms <= TAP_MAX_DURATION_MS
                        && cursor_drift <= TAP_MAX_CURSOR_DRIFT
                    {
                        let button_code = match active.max_fingers {
                            1 => BTN_LEFT,
                            2 => BTN_RIGHT,
                            3 => BTN_MIDDLE,
                            _ => return None,
                        };
                        return Some(CompletedTap {
                            button_code,
                            down_at: active.down_at,
                            down_cursor: active.down_cursor,
                            up_at,
                            up_cursor,
                        });
                    }
                }
            }
            _ => {}
        }
        None
    }
}

struct ClickContext {
    samples: Arc<Mutex<Vec<telemetry::RawSample>>>,
    anchor: Arc<Mutex<Option<Anchor>>>,
    pause: Arc<Mutex<PauseState>>,
    last_position: Arc<Mutex<Option<(f64, f64)>>>,
    cursor_visible: Arc<AtomicBool>,
    verbose: bool,
}

pub fn start(
    samples: &Arc<Mutex<Vec<telemetry::RawSample>>>,
    anchor: &Arc<Mutex<Option<Anchor>>>,
    pause: &Arc<Mutex<PauseState>>,
    last_position: &Arc<Mutex<Option<(f64, f64)>>>,
    cursor_visible: &Arc<AtomicBool>,
    verbose: bool,
) {
    let Ok(entries) = fs::read_dir("/dev/input") else {
        return;
    };
    let tap_enabled = touchpad_tap_enabled();
    let mut matched_devices = 0usize;
    let mut devices = 0usize;
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy().to_string();
        if !name.starts_with("event") {
            continue;
        }
        let path = entry.path();
        let has_buttons = device_has_pointer_buttons(&name);
        let is_touchpad = tap_enabled && device_is_touchpad(&name);
        if !has_buttons && !is_touchpad {
            continue;
        }
        matched_devices += 1;
        let Ok(metadata) = fs::metadata(&path) else {
            continue;
        };
        if !metadata.file_type().is_char_device() {
            continue;
        }
        let Ok(file) = File::open(&path) else {
            continue;
        };
        let tap_tracker = is_touchpad.then(|| TouchTapTracker::new(query_touchpad_geometry(&file)));
        let context = ClickContext {
            samples: Arc::clone(samples),
            anchor: Arc::clone(anchor),
            pause: Arc::clone(pause),
            last_position: Arc::clone(last_position),
            cursor_visible: Arc::clone(cursor_visible),
            verbose,
        };
        std::thread::Builder::new()
            .name(format!("recordly-clicks-{name}"))
            .spawn(move || {
                read_device(file, tap_tracker, &context);
            })
            .ok();
        devices += 1;
    }
    if matched_devices > 0 && devices == 0 {
        eprintln!(
            "[clicks] unable to read any /dev/input/event* pointer device; add your user to the `input` group for Wayland click capture"
        );
    }
    if verbose {
        eprintln!("[clicks] listening on {devices} input devices (tap_enabled={tap_enabled})");
    }
}

fn read_device(mut file: File, mut tap_tracker: Option<TouchTapTracker>, context: &ClickContext) {
    let mut buffer = [0u8; 24];
    let mut last_left_click: Option<(Instant, f64, f64)> = None;
    let mut touch_down_guard: Option<(bool, i64, bool)> = None;

    loop {
        if file.read_exact(&mut buffer).is_err() {
            return;
        }
        let event_type = u16::from_le_bytes([buffer[16], buffer[17]]);
        let code = u16::from_le_bytes([buffer[18], buffer[19]]);
        let value = i32::from_le_bytes([buffer[20], buffer[21], buffer[22], buffer[23]]);
        let event_instant = Instant::now();

        let current_pos = || {
            context
                .last_position
                .lock()
                .ok()
                .and_then(|position| *position)
                .unwrap_or((0.5, 0.5))
        };

        if let Some(tracker) = tap_tracker.as_mut()
            && matches!(event_type, EV_SYN | EV_KEY | EV_ABS)
        {
            let was_touching = tracker.is_touching();
            let completed_tap =
                tracker.handle_event(event_type, code, value, event_instant, current_pos());
            if !was_touching && tracker.is_touching() {
                let (paused, paused_ns) = context
                    .pause
                    .lock()
                    .map_or((true, 0), |pause| pause.snapshot());
                let visible = context.cursor_visible.load(Ordering::SeqCst);
                touch_down_guard = Some((paused, paused_ns, visible));
            } else if !tracker.is_touching() {
                let down_guard = touch_down_guard.take();
                if let Some(tap) = completed_tap
                    && let Some((down_paused, down_paused_ns, down_visible)) = down_guard
                {
                    let (up_paused, up_paused_ns) = context
                        .pause
                        .lock()
                        .map_or((true, 0), |pause| pause.snapshot());
                    let up_visible = context.cursor_visible.load(Ordering::SeqCst);
                    if !down_paused && !up_paused && down_visible && up_visible {
                        emit_button_event(
                            context,
                            tap.button_code,
                            1,
                            tap.down_at,
                            tap.down_cursor,
                            down_paused_ns,
                            &mut last_left_click,
                        );
                        emit_button_event(
                            context,
                            tap.button_code,
                            0,
                            tap.up_at,
                            tap.up_cursor,
                            up_paused_ns,
                            &mut last_left_click,
                        );
                    }
                }
            }
        }

        if event_type != EV_KEY {
            continue;
        }
        if value != 0 && value != 1 {
            continue;
        }
        if !matches!(code, BTN_LEFT | BTN_RIGHT | BTN_MIDDLE) {
            continue;
        }

        let (paused, accumulated_ns) = context
            .pause
            .lock()
            .map_or((true, 0), |pause| pause.snapshot());
        if paused || !context.cursor_visible.load(Ordering::SeqCst) {
            continue;
        }

        emit_button_event(
            context,
            code,
            value,
            event_instant,
            current_pos(),
            accumulated_ns,
            &mut last_left_click,
        );
    }
}

fn emit_button_event(
    context: &ClickContext,
    code: u16,
    value: i32,
    event_instant: Instant,
    (cx, cy): (f64, f64),
    accumulated_paused_ns: i64,
    last_left_click: &mut Option<(Instant, f64, f64)>,
) {
    let Some((anchor_pts, anchor_paused_ns, anchor_instant)) =
        context.anchor.lock().ok().and_then(|guard| {
            guard
                .as_ref()
                .map(|anchor| (anchor.pts_ns, anchor.paused_ns, anchor.instant))
        })
    else {
        return;
    };
    let pts_ns = compute_click_pts_ns(
        anchor_pts,
        anchor_paused_ns,
        anchor_instant,
        event_instant,
        accumulated_paused_ns,
    );
    let interaction =
        resolve_click_interaction(code, value, event_instant, cx, cy, last_left_click);
    let mouse_button = mouse_button_for_code(code);

    if context.verbose {
        eprintln!("[clicks] code={code} value={value} type={interaction}");
    }

    if let Ok(mut collected) = context.samples.lock() {
        collected.push(telemetry::RawSample {
            pts_ns,
            cx,
            cy,
            cursor_type: None,
            interaction_type: Some(interaction.to_owned()),
            mouse_button,
        });
    }
}

fn resolve_click_interaction(
    code: u16,
    value: i32,
    event_instant: Instant,
    cx: f64,
    cy: f64,
    last_left_click: &mut Option<(Instant, f64, f64)>,
) -> &'static str {
    if value == 0 {
        return "mouseup";
    }
    match code {
        BTN_RIGHT => "right-click",
        BTN_MIDDLE => "middle-click",
        _ => {
            let is_double = last_left_click.is_some_and(|(last_time, x, y)| {
                event_instant
                    .saturating_duration_since(last_time)
                    .as_millis()
                    <= DOUBLE_CLICK_WINDOW_MS
                    && ((cx - x).powi(2) + (cy - y).powi(2)).sqrt() <= DOUBLE_CLICK_DISTANCE
            });
            if code == BTN_LEFT {
                *last_left_click = Some((event_instant, cx, cy));
            }
            if is_double { "double-click" } else { "click" }
        }
    }
}

fn mouse_button_for_code(code: u16) -> Option<u8> {
    match code {
        BTN_LEFT => Some(1),
        BTN_RIGHT => Some(2),
        BTN_MIDDLE => Some(3),
        _ => None,
    }
}

pub(crate) fn compute_click_pts_ns(
    anchor_pts: i64,
    anchor_paused_ns: i64,
    anchor_instant: Instant,
    event_instant: Instant,
    accumulated_paused_ns: i64,
) -> i64 {
    let elapsed_ns = crate::pipewire_capture::duration_to_ns(
        event_instant.saturating_duration_since(anchor_instant),
    );
    let pause_since_anchor = accumulated_paused_ns.saturating_sub(anchor_paused_ns);
    anchor_pts + elapsed_ns - pause_since_anchor
}

#[repr(C)]
#[derive(Default, Debug, Clone, Copy)]
struct InputAbsInfo {
    value: i32,
    minimum: i32,
    maximum: i32,
    fuzz: i32,
    flat: i32,
    resolution: i32,
}

#[cfg(target_os = "linux")]
fn query_abs_axis(file: &File, code: u16) -> Option<AbsAxis> {
    use std::ffi::{c_int, c_ulong};
    use std::os::fd::AsRawFd;

    const EVIOCGABS_BASE: c_ulong = 0x8018_4540;
    unsafe extern "C" {
        fn ioctl(fd: c_int, request: c_ulong, ...) -> c_int;
    }

    let mut info = InputAbsInfo::default();
    // SAFETY: `file.as_raw_fd()` borrows a valid open evdev descriptor, `EVIOCGABS(code)` writes
    // one kernel `struct input_absinfo`, and `InputAbsInfo` is `#[repr(C)]` layout-compatible.
    let rc = unsafe {
        ioctl(
            file.as_raw_fd(),
            EVIOCGABS_BASE + c_ulong::from(code),
            &raw mut info,
        )
    };
    if rc < 0 {
        return None;
    }
    Some(AbsAxis {
        min: info.minimum,
        max: info.maximum,
        resolution: info.resolution,
    })
}

#[cfg(not(target_os = "linux"))]
fn query_abs_axis(_file: &File, _code: u16) -> Option<AbsAxis> {
    None
}

fn query_touchpad_geometry(file: &File) -> TouchpadGeometry {
    TouchpadGeometry {
        x: query_abs_axis(file, ABS_X),
        y: query_abs_axis(file, ABS_Y),
    }
}

fn touchpad_tap_enabled() -> bool {
    if let Ok(value) = std::env::var("RECORDLY_PORTAL_TOUCHPAD_TAP") {
        let trimmed = value.trim();
        if trimmed == "1" || trimmed.eq_ignore_ascii_case("true") {
            return true;
        }
        if trimmed == "0" || trimmed.eq_ignore_ascii_case("false") {
            return false;
        }
    }
    Command::new("gsettings")
        .args([
            "get",
            "org.gnome.desktop.peripherals.touchpad",
            "tap-to-click",
        ])
        .output()
        .is_ok_and(|output| {
            output.status.success() && String::from_utf8_lossy(&output.stdout).trim() == "true"
        })
}

pub(crate) fn bitmap_has_bit(bitmap: &str, bit: u16) -> bool {
    let words: Vec<&str> = bitmap.split_whitespace().collect();
    let word_bits = usize::BITS as usize;
    let word_idx = (bit as usize) / word_bits;
    let bit_idx = (bit as usize) % word_bits;
    if word_idx >= words.len() {
        return false;
    }
    let hex = words[words.len() - 1 - word_idx];
    usize::from_str_radix(hex, 16).is_ok_and(|value| (value & (1usize << bit_idx)) != 0)
}

pub(crate) fn key_bitmap_has_button(bitmap: &str, code: u16) -> bool {
    bitmap_has_bit(bitmap, code)
}

pub(crate) fn is_touchpad_capabilities(key_bitmap: &str, props_bitmap: &str) -> bool {
    bitmap_has_bit(key_bitmap, BTN_TOUCH)
        && bitmap_has_bit(key_bitmap, BTN_TOOL_FINGER)
        && !bitmap_has_bit(props_bitmap, INPUT_PROP_DIRECT_BIT)
}

fn device_has_pointer_buttons(event_name: &str) -> bool {
    let path = format!("/sys/class/input/{event_name}/device/capabilities/key");
    fs::read_to_string(path).is_ok_and(|bitmap| {
        key_bitmap_has_button(&bitmap, BTN_LEFT)
            || key_bitmap_has_button(&bitmap, BTN_RIGHT)
            || key_bitmap_has_button(&bitmap, BTN_MIDDLE)
    })
}

fn device_is_touchpad(event_name: &str) -> bool {
    let key_path = format!("/sys/class/input/{event_name}/device/capabilities/key");
    let props_path = format!("/sys/class/input/{event_name}/device/properties");
    let Ok(key_bitmap) = fs::read_to_string(key_path) else {
        return false;
    };
    let props_bitmap = fs::read_to_string(props_path).unwrap_or_default();
    is_touchpad_capabilities(&key_bitmap, &props_bitmap)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    fn touchpad_geometry() -> TouchpadGeometry {
        TouchpadGeometry {
            x: Some(AbsAxis {
                min: 0,
                max: 1919,
                resolution: 15,
            }),
            y: Some(AbsAxis {
                min: 0,
                max: 1079,
                resolution: 13,
            }),
        }
    }

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
        assert!(!key_bitmap_has_button(
            "ffffffff ffffffff ffffffff ffffffff",
            BTN_LEFT
        ));
        assert!(!key_bitmap_has_button("0 0 0 0 0", BTN_LEFT));
        assert!(!key_bitmap_has_button("", BTN_LEFT));
        assert!(!key_bitmap_has_button("not-hex 0 0 0 0", BTN_LEFT));
    }

    #[test]
    fn distinguishes_touchpad_from_touchscreen_capabilities() {
        #[cfg(target_pointer_width = "64")]
        {
            assert!(is_touchpad_capabilities("e520 10000 0 0 0 0", "5"));
            assert!(!is_touchpad_capabilities("e520 10000 0 0 0 0", "2"));
            assert!(!is_touchpad_capabilities("70000 0 0 0 0", "0"));
        }
    }

    #[test]
    fn computes_click_pts_without_double_subtracting_countdown_pause() {
        let t0 = Instant::now();
        let pre_anchor_pause = 3_000_000_000;
        let anchor_pts = 2_000_000_000;
        assert_eq!(
            compute_click_pts_ns(
                anchor_pts,
                pre_anchor_pause,
                t0,
                t0 + Duration::from_secs(1),
                pre_anchor_pause
            ),
            anchor_pts + 1_000_000_000
        );
        assert_eq!(
            compute_click_pts_ns(
                anchor_pts,
                pre_anchor_pause,
                t0,
                t0 + Duration::from_secs(4),
                pre_anchor_pause + 2_000_000_000
            ),
            anchor_pts + 2_000_000_000
        );
    }

    #[test]
    fn touchpad_tap_emits_left_right_and_middle_clicks_when_valid() {
        let t0 = Instant::now();
        let mut tracker = TouchTapTracker::new(touchpad_geometry());

        // Single-finger tap where ABS_X/ABS_Y arrive before BTN_TOUCH=1 in the same SYN frame.
        assert_eq!(
            tracker.handle_event(EV_ABS, ABS_X, 500, t0, (0.3, 0.4)),
            None
        );
        assert_eq!(
            tracker.handle_event(EV_ABS, ABS_Y, 400, t0, (0.3, 0.4)),
            None
        );
        assert_eq!(
            tracker.handle_event(EV_KEY, BTN_TOUCH, 1, t0, (0.3, 0.4)),
            None
        );
        assert_eq!(
            tracker.handle_event(EV_KEY, BTN_TOOL_FINGER, 1, t0, (0.3, 0.4)),
            None
        );
        assert_eq!(
            tracker.handle_event(EV_SYN, SYN_REPORT, 0, t0, (0.3, 0.4)),
            None
        );

        let t_up = t0 + Duration::from_millis(80);
        assert_eq!(
            tracker.handle_event(EV_KEY, BTN_TOUCH, 0, t_up, (0.3, 0.4)),
            None
        );
        assert_eq!(
            tracker.handle_event(EV_KEY, BTN_TOOL_FINGER, 0, t_up, (0.3, 0.4)),
            None
        );
        assert_eq!(
            tracker.handle_event(EV_SYN, SYN_REPORT, 0, t_up, (0.3, 0.4)),
            Some(CompletedTap {
                button_code: BTN_LEFT,
                down_at: t0,
                down_cursor: (0.3, 0.4),
                up_at: t_up,
                up_cursor: (0.3, 0.4),
            })
        );

        // Two-finger tap -> BTN_RIGHT.
        let double_at = t0 + Duration::from_millis(300);
        tracker.handle_event(EV_KEY, BTN_TOUCH, 1, double_at, (0.5, 0.5));
        tracker.handle_event(EV_KEY, BTN_TOOL_DOUBLETAP, 1, double_at, (0.5, 0.5));
        tracker.handle_event(EV_SYN, SYN_REPORT, 0, double_at, (0.5, 0.5));
        let double_up = double_at + Duration::from_millis(70);
        tracker.handle_event(EV_KEY, BTN_TOUCH, 0, double_up, (0.5, 0.5));
        tracker.handle_event(EV_KEY, BTN_TOOL_DOUBLETAP, 0, double_up, (0.5, 0.5));
        let two = tracker
            .handle_event(EV_SYN, SYN_REPORT, 0, double_up, (0.5, 0.5))
            .unwrap();
        assert_eq!(two.button_code, BTN_RIGHT);

        // Three-finger tap -> BTN_MIDDLE.
        let triple_at = t0 + Duration::from_millis(700);
        tracker.handle_event(EV_KEY, BTN_TOUCH, 1, triple_at, (0.5, 0.5));
        tracker.handle_event(EV_KEY, BTN_TOOL_TRIPLETAP, 1, triple_at, (0.5, 0.5));
        tracker.handle_event(EV_SYN, SYN_REPORT, 0, triple_at, (0.5, 0.5));
        let triple_up = triple_at + Duration::from_millis(90);
        tracker.handle_event(EV_KEY, BTN_TOUCH, 0, triple_up, (0.5, 0.5));
        tracker.handle_event(EV_KEY, BTN_TOOL_TRIPLETAP, 0, triple_up, (0.5, 0.5));
        let three = tracker
            .handle_event(EV_SYN, SYN_REPORT, 0, triple_up, (0.5, 0.5))
            .unwrap();
        assert_eq!(three.button_code, BTN_MIDDLE);
    }

    #[test]
    fn touchpad_tap_rejects_slides_and_drifts() {
        let t0 = Instant::now();
        let mut tracker = TouchTapTracker::new(touchpad_geometry());

        // > 3mm slide rejected (60 units / 15 units/mm = 4mm).
        tracker.handle_event(EV_ABS, ABS_X, 500, t0, (0.5, 0.5));
        tracker.handle_event(EV_ABS, ABS_Y, 500, t0, (0.5, 0.5));
        tracker.handle_event(EV_KEY, BTN_TOUCH, 1, t0, (0.5, 0.5));
        tracker.handle_event(EV_KEY, BTN_TOOL_FINGER, 1, t0, (0.5, 0.5));
        tracker.handle_event(EV_SYN, SYN_REPORT, 0, t0, (0.5, 0.5));
        tracker.handle_event(
            EV_ABS,
            ABS_X,
            560,
            t0 + Duration::from_millis(30),
            (0.5, 0.5),
        );
        tracker.handle_event(
            EV_SYN,
            SYN_REPORT,
            0,
            t0 + Duration::from_millis(30),
            (0.5, 0.5),
        );
        tracker.handle_event(
            EV_KEY,
            BTN_TOUCH,
            0,
            t0 + Duration::from_millis(60),
            (0.5, 0.5),
        );
        assert_eq!(
            tracker.handle_event(
                EV_SYN,
                SYN_REPORT,
                0,
                t0 + Duration::from_millis(60),
                (0.5, 0.5)
            ),
            None
        );

        // Cursor drift > 0.015 rejected.
        let drift_at = t0 + Duration::from_millis(200);
        tracker.handle_event(EV_KEY, BTN_TOUCH, 1, drift_at, (0.5, 0.5));
        tracker.handle_event(EV_KEY, BTN_TOOL_FINGER, 1, drift_at, (0.5, 0.5));
        tracker.handle_event(EV_SYN, SYN_REPORT, 0, drift_at, (0.5, 0.5));
        tracker.handle_event(
            EV_KEY,
            BTN_TOUCH,
            0,
            drift_at + Duration::from_millis(60),
            (0.53, 0.5),
        );
        assert_eq!(
            tracker.handle_event(
                EV_SYN,
                SYN_REPORT,
                0,
                drift_at + Duration::from_millis(60),
                (0.53, 0.5)
            ),
            None
        );
    }

    #[test]
    fn touchpad_tap_rejects_holds_four_fingers_and_physical_clicks() {
        let t0 = Instant::now();
        let mut tracker = TouchTapTracker::new(touchpad_geometry());

        // Duration > 220ms rejected.
        let hold_at = t0 + Duration::from_millis(500);
        tracker.handle_event(EV_KEY, BTN_TOUCH, 1, hold_at, (0.5, 0.5));
        tracker.handle_event(EV_KEY, BTN_TOOL_FINGER, 1, hold_at, (0.5, 0.5));
        tracker.handle_event(EV_SYN, SYN_REPORT, 0, hold_at, (0.5, 0.5));
        tracker.handle_event(
            EV_KEY,
            BTN_TOUCH,
            0,
            hold_at + Duration::from_millis(260),
            (0.5, 0.5),
        );
        assert_eq!(
            tracker.handle_event(
                EV_SYN,
                SYN_REPORT,
                0,
                hold_at + Duration::from_millis(260),
                (0.5, 0.5)
            ),
            None
        );

        // Four-finger tap rejected.
        let quad_at = t0 + Duration::from_millis(900);
        tracker.handle_event(EV_KEY, BTN_TOUCH, 1, quad_at, (0.5, 0.5));
        tracker.handle_event(EV_KEY, BTN_TOOL_QUADTAP, 1, quad_at, (0.5, 0.5));
        tracker.handle_event(EV_SYN, SYN_REPORT, 0, quad_at, (0.5, 0.5));
        tracker.handle_event(
            EV_KEY,
            BTN_TOUCH,
            0,
            quad_at + Duration::from_millis(50),
            (0.5, 0.5),
        );
        tracker.handle_event(
            EV_KEY,
            BTN_TOOL_QUADTAP,
            0,
            quad_at + Duration::from_millis(50),
            (0.5, 0.5),
        );
        assert_eq!(
            tracker.handle_event(
                EV_SYN,
                SYN_REPORT,
                0,
                quad_at + Duration::from_millis(50),
                (0.5, 0.5)
            ),
            None
        );

        // Physical clickpad BTN_LEFT suppresses duplicate tap.
        let press_at = t0 + Duration::from_millis(1200);
        tracker.handle_event(EV_KEY, BTN_TOUCH, 1, press_at, (0.5, 0.5));
        tracker.handle_event(EV_KEY, BTN_TOOL_FINGER, 1, press_at, (0.5, 0.5));
        tracker.handle_event(
            EV_KEY,
            BTN_LEFT,
            1,
            press_at + Duration::from_millis(10),
            (0.5, 0.5),
        );
        tracker.handle_event(
            EV_SYN,
            SYN_REPORT,
            0,
            press_at + Duration::from_millis(10),
            (0.5, 0.5),
        );
        tracker.handle_event(
            EV_KEY,
            BTN_LEFT,
            0,
            press_at + Duration::from_millis(60),
            (0.5, 0.5),
        );
        tracker.handle_event(
            EV_KEY,
            BTN_TOUCH,
            0,
            press_at + Duration::from_millis(70),
            (0.5, 0.5),
        );
        assert_eq!(
            tracker.handle_event(
                EV_SYN,
                SYN_REPORT,
                0,
                press_at + Duration::from_millis(70),
                (0.5, 0.5)
            ),
            None
        );
    }
}
