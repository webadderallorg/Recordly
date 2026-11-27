use crate::pipewire_capture::{Anchor, PauseState};
use recordly_portal_cursor::telemetry;
use std::fs::{self, File};
use std::io::Read;
use std::os::unix::fs::FileTypeExt;
use std::process::Command;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

const EV_SYN: u16 = 0;
const SYN_REPORT: u16 = 0;
const SYN_DROPPED: u16 = 3;
const EV_KEY: u16 = 1;
const EV_ABS: u16 = 3;
const ABS_X: u16 = 0;
const ABS_Y: u16 = 1;

const BTN_LEFT: u16 = 0x110;
const BTN_RIGHT: u16 = 0x111;
const BTN_MIDDLE: u16 = 0x112;
const BTN_TOOL_FINGER: u16 = 0x145;
const BTN_TOOL_QUINTTAP: u16 = 0x148;
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
const TOOL_QUINTTAP_BIT: u8 = 1 << 4;

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

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) enum TapButtonMap {
    #[default]
    Lrm,
    Lmr,
}

type TouchEdge = (Instant, Option<(f64, f64)>);

#[derive(Debug, Default)]
pub(crate) struct TouchTapTracker {
    geometry: TouchpadGeometry,
    button_map: TapButtonMap,
    dropping: bool,
    cur_x: Option<i32>,
    cur_y: Option<i32>,
    tool_bits: u8,
    touch_down: bool,
    pending_touch_down: Option<TouchEdge>,
    pending_touch_up: Option<TouchEdge>,
    physical_buttons_held: u8,
    pending_physical_button: bool,
    active: Option<ActiveTap>,
}

impl TouchTapTracker {
    #[cfg(test)]
    pub(crate) fn new(geometry: TouchpadGeometry) -> Self {
        Self::with_button_map(geometry, TapButtonMap::default())
    }

    pub(crate) fn with_button_map(geometry: TouchpadGeometry, button_map: TapButtonMap) -> Self {
        Self {
            geometry,
            button_map,
            ..Self::default()
        }
    }

    pub(crate) fn is_touching(&self) -> bool {
        self.touch_down || self.active.is_some()
    }

    fn reset_after_drop(&mut self) {
        self.dropping = true;
        self.tool_bits = 0;
        self.touch_down = false;
        self.pending_touch_down = None;
        self.pending_touch_up = None;
        self.physical_buttons_held = 0;
        self.pending_physical_button = false;
        self.active = None;
    }

    fn set_tool_bit(&mut self, bit: u8, active: bool) {
        if active {
            self.tool_bits |= bit;
        } else {
            self.tool_bits &= !bit;
        }
    }

    fn current_fingers(&self) -> u8 {
        if self.tool_bits & TOOL_QUINTTAP_BIT != 0 {
            5
        } else if self.tool_bits & TOOL_QUADTAP_BIT != 0 {
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
        let dx = self.cur_x.zip(start_x).map_or(0.0, |(cur, start)| {
            (f64::from(cur) - f64::from(start)).abs()
        });
        let dy = self.cur_y.zip(start_y).map_or(0.0, |(cur, start)| {
            (f64::from(cur) - f64::from(start)).abs()
        });
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
            .and_then(|ax| (ax.max > ax.min).then(|| dx / (f64::from(ax.max) - f64::from(ax.min))))
            .unwrap_or(0.0);
        let norm_y = self
            .geometry
            .y
            .and_then(|ay| (ay.max > ay.min).then(|| dy / (f64::from(ay.max) - f64::from(ay.min))))
            .unwrap_or(0.0);
        norm_x.hypot(norm_y) > TAP_MAX_MOVE_NORM
    }

    pub(crate) fn handle_event(
        &mut self,
        event_type: u16,
        code: u16,
        value: i32,
        instant: Instant,
        cursor: impl Into<Option<(f64, f64)>>,
    ) -> Option<CompletedTap> {
        if event_type == EV_SYN && code == SYN_DROPPED {
            self.reset_after_drop();
            return None;
        }
        if self.dropping {
            if event_type == EV_SYN && code == SYN_REPORT {
                self.dropping = false;
            }
            return None;
        }
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
                BTN_TOOL_QUINTTAP => self.set_tool_bit(TOOL_QUINTTAP_BIT, value != 0),
                BTN_TOUCH => {
                    if value != 0 {
                        if !self.touch_down {
                            self.touch_down = true;
                            self.pending_touch_down = Some((instant, cursor.into()));
                        }
                    } else if self.touch_down {
                        self.touch_down = false;
                        self.pending_touch_up = Some((instant, cursor.into()));
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
            EV_SYN if code == SYN_REPORT => return self.handle_syn_report(),
            _ => {}
        }
        None
    }

    fn handle_syn_report(&mut self) -> Option<CompletedTap> {
        if let Some((down_at, Some(down_cursor))) = self.pending_touch_down.take() {
            let saw_physical = self.physical_buttons_held > 0 || self.pending_physical_button;
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
        let moved = self
            .active
            .as_ref()
            .is_some_and(|active| self.exceeded_move_threshold(active.start_x, active.start_y));
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
            && let Some(up_cursor) = up_cursor
        {
            let duration_ms = up_at.saturating_duration_since(active.down_at).as_millis();
            let cursor_drift =
                (up_cursor.0 - active.down_cursor.0).hypot(up_cursor.1 - active.down_cursor.1);
            if !active.saw_physical_button
                && !active.moved
                && duration_ms <= TAP_MAX_DURATION_MS
                && cursor_drift <= TAP_MAX_CURSOR_DRIFT
            {
                let button_code = match (active.max_fingers, self.button_map) {
                    (1, _) => BTN_LEFT,
                    (2, TapButtonMap::Lrm) | (3, TapButtonMap::Lmr) => BTN_RIGHT,
                    (3, TapButtonMap::Lrm) | (2, TapButtonMap::Lmr) => BTN_MIDDLE,
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
        None
    }
}

struct ClickContext {
    samples: Arc<Mutex<Vec<telemetry::RawSample>>>,
    anchor: Arc<Mutex<Option<Anchor>>>,
    pause: Arc<Mutex<PauseState>>,
    cursor_history: Arc<Mutex<telemetry::CursorHistory>>,
    verbose: bool,
}

pub fn start(
    samples: &Arc<Mutex<Vec<telemetry::RawSample>>>,
    anchor: &Arc<Mutex<Option<Anchor>>>,
    pause: &Arc<Mutex<PauseState>>,
    cursor_history: &Arc<Mutex<telemetry::CursorHistory>>,
    verbose: bool,
) {
    let Ok(entries) = fs::read_dir("/dev/input") else {
        return;
    };
    let tap_enabled = touchpad_tap_enabled();
    let tap_button_map = if tap_enabled {
        touchpad_tap_button_map()
    } else {
        TapButtonMap::Lrm
    };
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
        let clock = EvdevClock::for_device(&file);
        let tap_tracker = is_touchpad.then(|| {
            TouchTapTracker::with_button_map(query_touchpad_geometry(&file), tap_button_map)
        });
        let context = ClickContext {
            samples: Arc::clone(samples),
            anchor: Arc::clone(anchor),
            pause: Arc::clone(pause),
            cursor_history: Arc::clone(cursor_history),
            verbose,
        };
        std::thread::Builder::new()
            .name(format!("recordly-clicks-{name}"))
            .spawn(move || {
                read_device(file, tap_tracker, &context, clock);
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

#[derive(Clone, Copy)]
struct EvdevClock {
    kernel_time: Duration,
    instant: Instant,
}

impl EvdevClock {
    #[cfg(target_os = "linux")]
    fn for_device(file: &File) -> Option<Self> {
        use std::os::fd::AsRawFd;

        const EVIOCSCLOCKID: u32 = 0x4004_45a0; // _IOW('E', 0xa0, int)
        let clock_id = libc::CLOCK_MONOTONIC;
        let mut now = libc::timespec {
            tv_sec: 0,
            tv_nsec: 0,
        };
        // SAFETY: evdev reads a clockid_t from the valid pointer passed to EVIOCSCLOCKID.
        if unsafe { libc::ioctl(file.as_raw_fd(), EVIOCSCLOCKID as _, &raw const clock_id) } != 0 {
            return None;
        }
        let before = Instant::now();
        // SAFETY: clock_gettime writes to a valid timespec.
        if unsafe { libc::clock_gettime(clock_id, &raw mut now) } != 0 {
            return None;
        }
        let after = Instant::now();
        Some(Self {
            kernel_time: Duration::new(
                u64::try_from(now.tv_sec).ok()?,
                u32::try_from(now.tv_nsec).ok()?,
            ),
            // Bracket the sample so the binding to Instant doesn't include ioctl latency.
            instant: before + after.duration_since(before) / 2,
        })
    }

    #[cfg(not(target_os = "linux"))]
    fn for_device(_file: &File) -> Option<Self> {
        None
    }

    fn event_instant(self, event: &[u8; 24], received_at: Instant) -> Instant {
        // The first two native-endian words of the 64-bit input_event are seconds and microseconds.
        let (Ok(seconds), Ok(micros)) = (
            u64::try_from(i64::from_ne_bytes(event[..8].try_into().unwrap())),
            u32::try_from(i64::from_ne_bytes(event[8..16].try_into().unwrap())),
        ) else {
            return received_at;
        };
        if micros >= 1_000_000 || (seconds == 0 && micros == 0) {
            return received_at;
        }
        let kernel_time = Duration::new(seconds, micros * 1000);
        let event_time = if let Some(elapsed) = kernel_time.checked_sub(self.kernel_time) {
            self.instant.checked_add(elapsed)
        } else {
            self.instant.checked_sub(self.kernel_time - kernel_time)
        };
        event_time.unwrap_or(received_at).min(received_at)
    }
}

#[derive(Clone, Copy)]
struct InputTiming {
    instant: Instant,
    paused: bool,
    paused_ns: i64,
}

struct TapTrackerState {
    down_timing: Option<InputTiming>,
    up_timing: Option<InputTiming>,
}

#[derive(Clone, Copy)]
struct RawInputEvent {
    event_type: u16,
    code: u16,
    value: i32,
    timing: Option<InputTiming>,
}

fn read_input_timing(
    event_type: u16,
    code: u16,
    pause: &Mutex<PauseState>,
    event_instant: impl FnOnce() -> Instant,
) -> Option<InputTiming> {
    if event_type == EV_KEY
        && matches!(code, BTN_TOUCH | BTN_LEFT | BTN_RIGHT | BTN_MIDDLE)
        && let Ok(pause) = pause.lock()
    {
        let instant = event_instant();
        let (paused, paused_ns) = pause.timing_at(instant);
        Some(InputTiming {
            instant,
            paused,
            paused_ns,
        })
    } else {
        None
    }
}

fn handle_tap_tracker_event(
    tracker: &mut TouchTapTracker,
    tap_state: &mut TapTrackerState,
    input: RawInputEvent,
    context: &ClickContext,
    last_left_click: &mut Option<(Instant, f64, f64)>,
) {
    let position = if input.event_type == EV_KEY && input.code == BTN_TOUCH {
        if input.value != 0 && !tracker.touch_down {
            tap_state.down_timing = input.timing;
            tap_state.up_timing = None;
        } else if input.value == 0 && tracker.touch_down {
            tap_state.up_timing = input.timing;
        }
        input
            .timing
            .and_then(|timing| cursor_position_at(context, timing.instant))
    } else {
        None
    };
    let event_instant = input
        .timing
        .map_or_else(Instant::now, |timing| timing.instant);
    let completed_tap = tracker.handle_event(
        input.event_type,
        input.code,
        input.value,
        event_instant,
        position,
    );
    if !tracker.is_touching() {
        let down = tap_state.down_timing.take();
        let up = tap_state.up_timing.take();
        if let (Some(tap), Some(down), Some(up)) = (completed_tap, down, up)
            && !down.paused
            && !up.paused
            && down.paused_ns == up.paused_ns
        {
            emit_completed_tap(context, tap, down.paused_ns, up.paused_ns, last_left_click);
        }
    }
}

fn release_pressed_buttons(
    pressed_positions: &mut [Option<(f64, f64)>; 3],
    context: &ClickContext,
    last_left_click: &mut Option<(Instant, f64, f64)>,
    instant: Instant,
) {
    if !pressed_positions.iter().any(Option::is_some) {
        return;
    }
    let Ok(pause) = context.pause.lock() else {
        return;
    };
    let (_, accumulated_paused_ns) = pause.timing_at(instant);
    // A release may have been lost. End recorded presses before exiting or syncing
    // so the editor cannot keep rendering a held button through later footage.
    for (position, code) in pressed_positions
        .iter_mut()
        .zip([BTN_LEFT, BTN_RIGHT, BTN_MIDDLE])
    {
        if let Some(cursor) = position.take() {
            emit_button_event(
                context,
                ButtonSampleInput {
                    code,
                    value: 0,
                    event_instant: instant,
                    cursor,
                    accumulated_paused_ns,
                },
                last_left_click,
            );
        }
    }
}

fn handle_pointer_button_event(
    raw: RawInputEvent,
    pressed_positions: &mut [Option<(f64, f64)>; 3],
    context: &ClickContext,
    last_left_click: &mut Option<(Instant, f64, f64)>,
) {
    if raw.event_type != EV_KEY || (raw.value != 0 && raw.value != 1) {
        return;
    }
    let Some(button) = mouse_button_for_code(raw.code) else {
        return;
    };
    let Some(InputTiming {
        instant: event_instant,
        paused,
        paused_ns,
    }) = raw.timing
    else {
        return;
    };
    let current_pos = || cursor_position_at(context, event_instant);
    let pressed_position = &mut pressed_positions[usize::from(button - 1)];
    let cursor = match raw.value {
        1 if !paused => current_pos(),
        0 => pressed_position.take().map(|position| {
            // Balance a recorded press even if the pointer has left the source.
            if paused {
                position
            } else {
                current_pos().unwrap_or(position)
            }
        }),
        _ => None,
    };
    let Some(cursor) = cursor else {
        return;
    };

    let emitted = emit_button_event(
        context,
        ButtonSampleInput {
            code: raw.code,
            value: raw.value,
            event_instant,
            cursor,
            accumulated_paused_ns: paused_ns,
        },
        last_left_click,
    );
    if raw.value == 1 && emitted {
        *pressed_position = Some(cursor);
    }
}

fn read_device(
    mut file: impl Read,
    mut tap_tracker: Option<TouchTapTracker>,
    context: &ClickContext,
    clock: Option<EvdevClock>,
) {
    let mut buffer = [0u8; 24];
    let mut last_left_click: Option<(Instant, f64, f64)> = None;
    let mut tap_state = TapTrackerState {
        down_timing: None,
        up_timing: None,
    };
    let mut pressed_positions = [None; 3];
    let mut syn_dropping = false;

    loop {
        if file.read_exact(&mut buffer).is_err() {
            release_pressed_buttons(
                &mut pressed_positions,
                context,
                &mut last_left_click,
                Instant::now(),
            );
            return;
        }
        let event_type = u16::from_ne_bytes([buffer[16], buffer[17]]);
        let code = u16::from_ne_bytes([buffer[18], buffer[19]]);
        let value = i32::from_ne_bytes([buffer[20], buffer[21], buffer[22], buffer[23]]);
        let event_instant = || {
            let received_at = Instant::now();
            clock.map_or(received_at, |clock| {
                clock.event_instant(&buffer, received_at)
            })
        };
        let timing = read_input_timing(event_type, code, &context.pause, event_instant);
        let raw = RawInputEvent {
            event_type,
            code,
            value,
            timing,
        };

        if let Some(tracker) = tap_tracker.as_mut()
            && matches!(event_type, EV_SYN | EV_KEY | EV_ABS)
        {
            handle_tap_tracker_event(tracker, &mut tap_state, raw, context, &mut last_left_click);
        }

        if event_type == EV_SYN {
            if code == SYN_DROPPED {
                syn_dropping = true;
                tap_state.down_timing = None;
                tap_state.up_timing = None;
                last_left_click = None;
                release_pressed_buttons(
                    &mut pressed_positions,
                    context,
                    &mut last_left_click,
                    event_instant(),
                );
            } else if code == SYN_REPORT {
                syn_dropping = false;
            }
            continue;
        }
        if !syn_dropping {
            handle_pointer_button_event(raw, &mut pressed_positions, context, &mut last_left_click);
        }
    }
}

#[derive(Clone, Copy)]
struct ButtonSampleInput {
    code: u16,
    value: i32,
    event_instant: Instant,
    cursor: (f64, f64),
    accumulated_paused_ns: i64,
}

fn read_anchor(context: &ClickContext) -> Option<Anchor> {
    context.anchor.lock().ok().and_then(|guard| *guard)
}

fn cursor_position_at(context: &ClickContext, instant: Instant) -> Option<(f64, f64)> {
    context.cursor_history.lock().ok()?.position_at(instant)
}

fn build_button_sample(
    anchor: Anchor,
    input: ButtonSampleInput,
    verbose: bool,
    last_left_click: &mut Option<(Instant, f64, f64)>,
) -> telemetry::RawSample {
    let pts_ns = anchor.input_pts_ns(input.event_instant, input.accumulated_paused_ns);
    let interaction = resolve_click_interaction(
        input.code,
        input.value,
        input.event_instant,
        input.cursor.0,
        input.cursor.1,
        last_left_click,
    );
    let mouse_button = mouse_button_for_code(input.code);

    if verbose {
        eprintln!(
            "[clicks] code={} value={} type={interaction}",
            input.code, input.value
        );
    }

    telemetry::RawSample {
        pts_ns,
        cx: input.cursor.0,
        cy: input.cursor.1,
        cursor_type: None,
        cursor_visible: None,
        interaction_type: Some(interaction.to_owned()),
        mouse_button,
    }
}

fn emit_button_event(
    context: &ClickContext,
    input: ButtonSampleInput,
    last_left_click: &mut Option<(Instant, f64, f64)>,
) -> bool {
    let Some(anchor) = read_anchor(context) else {
        return false;
    };
    if input.event_instant < anchor.instant {
        return false;
    }
    let Ok(mut collected) = context.samples.lock() else {
        return false;
    };
    collected.push(build_button_sample(
        anchor,
        input,
        context.verbose,
        last_left_click,
    ));
    true
}

fn emit_completed_tap(
    context: &ClickContext,
    tap: CompletedTap,
    down_paused_ns: i64,
    up_paused_ns: i64,
    last_left_click: &mut Option<(Instant, f64, f64)>,
) {
    let Some(anchor) = read_anchor(context) else {
        return;
    };
    if tap.down_at < anchor.instant {
        return;
    }
    let down_sample = build_button_sample(
        anchor,
        ButtonSampleInput {
            code: tap.button_code,
            value: 1,
            event_instant: tap.down_at,
            cursor: tap.down_cursor,
            accumulated_paused_ns: down_paused_ns,
        },
        context.verbose,
        last_left_click,
    );
    let up_sample = build_button_sample(
        anchor,
        ButtonSampleInput {
            code: tap.button_code,
            value: 0,
            event_instant: tap.up_at,
            cursor: tap.up_cursor,
            accumulated_paused_ns: up_paused_ns,
        },
        context.verbose,
        last_left_click,
    );

    if let Ok(mut collected) = context.samples.lock() {
        collected.push(down_sample);
        collected.push(up_sample);
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

pub(crate) fn parse_tap_button_map(raw: &str) -> TapButtonMap {
    let normalized = raw.trim().trim_matches('\'').trim();
    if normalized.eq_ignore_ascii_case("lmr") {
        TapButtonMap::Lmr
    } else {
        TapButtonMap::Lrm
    }
}

fn touchpad_tap_button_map() -> TapButtonMap {
    if let Ok(value) = std::env::var("RECORDLY_PORTAL_TOUCHPAD_TAP_BUTTON_MAP")
        && !value.trim().is_empty()
    {
        return parse_tap_button_map(&value);
    }
    Command::new("gsettings")
        .args([
            "get",
            "org.gnome.desktop.peripherals.touchpad",
            "tap-button-map",
        ])
        .output()
        .ok()
        .filter(|output| output.status.success())
        .map_or(TapButtonMap::Lrm, |output| {
            parse_tap_button_map(&String::from_utf8_lossy(&output.stdout))
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

    fn click_context() -> ClickContext {
        ClickContext {
            samples: Arc::new(Mutex::new(Vec::new())),
            anchor: Arc::new(Mutex::new(Some(Anchor {
                pts_ns: 0,
                paused_ns: 0,
                epoch_ms: 0,
                instant: Instant::now(),
            }))),
            pause: Arc::new(Mutex::new(PauseState::default())),
            cursor_history: Arc::new(Mutex::new(telemetry::CursorHistory::default())),
            verbose: false,
        }
    }

    fn record_cursor(context: &ClickContext, at: Instant, position: (f64, f64)) {
        context.cursor_history.lock().unwrap().record(
            at,
            Some(telemetry::CursorSnapshot {
                position,
                cursor_type: "arrow",
            }),
        );
    }

    fn input_event(event_type: u16, code: u16, value: i32) -> [u8; 24] {
        let mut event = [0u8; 24];
        event[16..18].copy_from_slice(&event_type.to_ne_bytes());
        event[18..20].copy_from_slice(&code.to_ne_bytes());
        event[20..24].copy_from_slice(&value.to_ne_bytes());
        event
    }

    #[test]
    fn timestamps_and_positions_buffered_clicks_at_the_kernel_time() {
        let origin = Instant::now() - Duration::from_secs(1);
        let clock = EvdevClock {
            kernel_time: Duration::from_secs(30),
            instant: origin,
        };
        let context = click_context();
        context.anchor.lock().unwrap().as_mut().unwrap().instant =
            origin + Duration::from_millis(40);
        record_cursor(&context, origin + Duration::from_millis(100), (0.2, 0.3));
        record_cursor(&context, origin + Duration::from_millis(150), (0.4, 0.5));
        record_cursor(&context, origin + Duration::from_millis(180), (0.8, 0.9));

        let timed_event = |code, value, seconds: i64, micros: i64| {
            let mut event = input_event(EV_KEY, code, value);
            event[..8].copy_from_slice(&seconds.to_ne_bytes());
            event[8..16].copy_from_slice(&micros.to_ne_bytes());
            event
        };
        let events = [
            timed_event(BTN_RIGHT, 1, 29, 995_000),
            timed_event(BTN_RIGHT, 0, 30, 50_000),
            timed_event(BTN_MIDDLE, 1, 30, 60_000),
            timed_event(BTN_MIDDLE, 0, 30, 70_000),
            timed_event(BTN_LEFT, 1, 30, 120_000),
            timed_event(BTN_LEFT, 0, 30, 175_000),
        ];
        read_device(
            std::io::Cursor::new(events.concat()),
            None,
            &context,
            Some(clock),
        );

        let samples = context.samples.lock().unwrap();
        let recorded: Vec<_> = samples
            .iter()
            .map(|sample| {
                (
                    sample.pts_ns,
                    sample.interaction_type.as_deref(),
                    (sample.cx, sample.cy),
                )
            })
            .collect();
        assert_eq!(
            recorded,
            [
                (80_000_000, Some("click"), (0.2, 0.3)),
                (135_000_000, Some("mouseup"), (0.4, 0.5)),
            ]
        );
    }

    #[test]
    fn uses_the_recorded_cursor_at_each_buffered_touch_edge() {
        let context = click_context();
        let origin = read_anchor(&context).unwrap().instant;
        record_cursor(&context, origin + Duration::from_millis(100), (0.2, 0.3));
        record_cursor(&context, origin + Duration::from_millis(150), (0.21, 0.31));
        record_cursor(&context, origin + Duration::from_millis(180), (0.8, 0.9));

        let mut tracker = TouchTapTracker::new(touchpad_geometry());
        let mut tap_state = TapTrackerState {
            down_timing: None,
            up_timing: None,
        };
        let mut last_left_click = None;
        for (event_type, event_code, value, ms) in [
            (EV_KEY, BTN_TOUCH, 1, 120),
            (EV_SYN, SYN_REPORT, 0, 120),
            (EV_KEY, BTN_TOUCH, 0, 175),
            (EV_SYN, SYN_REPORT, 0, 175),
        ] {
            handle_tap_tracker_event(
                &mut tracker,
                &mut tap_state,
                RawInputEvent {
                    event_type,
                    code: event_code,
                    value,
                    timing: (event_type == EV_KEY).then_some(InputTiming {
                        instant: origin + Duration::from_millis(ms),
                        paused: false,
                        paused_ns: 0,
                    }),
                },
                &context,
                &mut last_left_click,
            );
        }

        let samples = context.samples.lock().unwrap();
        assert_eq!(samples.len(), 2);
        assert_eq!(
            (samples[0].pts_ns, samples[0].cx, samples[0].cy),
            (120_000_000, 0.2, 0.3)
        );
        assert_eq!(
            (samples[1].pts_ns, samples[1].cx, samples[1].cy),
            (175_000_000, 0.21, 0.31)
        );
    }

    #[test]
    fn falls_back_to_receipt_time_for_invalid_or_future_input_times() {
        let instant = Instant::now();
        let clock = EvdevClock {
            kernel_time: Duration::from_secs(30),
            instant,
        };
        let mut event = input_event(EV_KEY, BTN_LEFT, 1);
        let received_at = instant + Duration::from_millis(100);
        assert_eq!(clock.event_instant(&event, received_at), received_at);

        event[..8].copy_from_slice(&30_i64.to_ne_bytes());
        event[8..16].copy_from_slice(&1_000_000_i64.to_ne_bytes());
        assert_eq!(clock.event_instant(&event, received_at), received_at);

        event[..8].copy_from_slice(&31_i64.to_ne_bytes());
        event[8..16].copy_from_slice(&0_i64.to_ne_bytes());
        assert_eq!(clock.event_instant(&event, received_at), received_at);
    }

    #[test]
    fn records_a_click_only_after_a_real_cursor_position_is_known() {
        let context = click_context();
        let event = input_event(EV_KEY, BTN_LEFT, 1);
        read_device(std::io::Cursor::new(event), None, &context, None);
        assert!(context.samples.lock().unwrap().is_empty());

        record_cursor(&context, Instant::now(), (0.2, 0.8));
        read_device(std::io::Cursor::new(event), None, &context, None);
        let samples = context.samples.lock().unwrap();
        assert_eq!(samples.len(), 2);
        assert_eq!(samples[0].interaction_type.as_deref(), Some("click"));
        assert_eq!((samples[0].cx, samples[0].cy), (0.2, 0.8));
        assert_eq!(samples[1].interaction_type.as_deref(), Some("mouseup"));
        assert_eq!((samples[1].cx, samples[1].cy), (0.2, 0.8));
    }

    #[test]
    fn releases_only_recorded_buttons_when_device_disconnects() {
        struct DisconnectingMouse {
            events: Vec<[u8; 24]>,
            index: usize,
        }

        impl Read for DisconnectingMouse {
            fn read(&mut self, output: &mut [u8]) -> std::io::Result<usize> {
                if let Some(event) = self.events.get(self.index) {
                    self.index += 1;
                    output.copy_from_slice(event);
                    return Ok(output.len());
                }
                Err(std::io::Error::new(
                    std::io::ErrorKind::BrokenPipe,
                    "disconnected",
                ))
            }
        }

        let context = click_context();
        record_cursor(&context, Instant::now(), (0.4, 0.6));
        read_device(
            DisconnectingMouse {
                events: vec![
                    input_event(EV_KEY, BTN_LEFT, 1),
                    input_event(EV_KEY, BTN_RIGHT, 1),
                    input_event(EV_KEY, BTN_RIGHT, 0),
                ],
                index: 0,
            },
            None,
            &context,
            None,
        );
        let samples = context.samples.lock().unwrap();
        let recorded: Vec<_> = samples
            .iter()
            .map(|sample| (sample.mouse_button, sample.interaction_type.as_deref()))
            .collect();
        assert_eq!(
            recorded,
            [
                (Some(1), Some("click")),
                (Some(2), Some("right-click")),
                (Some(2), Some("mouseup")),
                (Some(1), Some("mouseup")),
            ],
        );
    }

    #[test]
    fn touchpad_move_threshold_widens_i32_extremes_and_degenerate_bounds() {
        let mut degenerate = TouchTapTracker::new(TouchpadGeometry {
            x: Some(AbsAxis {
                min: i32::MAX,
                max: i32::MIN,
                resolution: 0,
            }),
            y: Some(AbsAxis {
                min: 0,
                max: 0,
                resolution: 0,
            }),
        });
        degenerate.cur_x = Some(i32::MAX);
        degenerate.cur_y = Some(i32::MIN);
        assert!(!degenerate.exceeded_move_threshold(Some(i32::MIN), Some(i32::MAX)));

        let mut wide = TouchTapTracker::new(TouchpadGeometry {
            x: Some(AbsAxis {
                min: i32::MIN,
                max: i32::MAX,
                resolution: 0,
            }),
            y: Some(AbsAxis {
                min: 0,
                max: 100,
                resolution: 0,
            }),
        });
        wide.cur_x = Some(i32::MAX);
        wide.cur_y = Some(0);
        assert!(wide.exceeded_move_threshold(Some(i32::MIN), Some(0)));
    }

    #[test]
    fn balances_recorded_buttons_at_an_evdev_gap() {
        let context = click_context();
        record_cursor(&context, Instant::now(), (0.2, 0.8));
        let events = [
            input_event(EV_KEY, BTN_LEFT, 1),
            input_event(EV_KEY, BTN_RIGHT, 1),
            input_event(EV_SYN, SYN_DROPPED, 0),
            input_event(EV_KEY, BTN_MIDDLE, 1),
            input_event(EV_SYN, SYN_REPORT, 0),
            input_event(EV_KEY, BTN_RIGHT, 0),
            input_event(EV_KEY, BTN_LEFT, 1),
            input_event(EV_KEY, BTN_LEFT, 0),
        ];
        read_device(std::io::Cursor::new(events.concat()), None, &context, None);
        let samples = context.samples.lock().unwrap();
        let recorded: Vec<_> = samples
            .iter()
            .map(|sample| (sample.mouse_button, sample.interaction_type.as_deref()))
            .collect();
        assert_eq!(
            recorded,
            [
                (Some(1), Some("click")),
                (Some(2), Some("right-click")),
                (Some(1), Some("mouseup")),
                (Some(2), Some("mouseup")),
                (Some(1), Some("click")),
                (Some(1), Some("mouseup")),
            ],
        );
    }

    #[test]
    fn balances_a_recorded_press_when_the_cursor_disappears() {
        struct ButtonEvents<'a> {
            buttons: std::array::IntoIter<i32, 2>,
            cursor: &'a Mutex<telemetry::CursorHistory>,
        }

        impl Read for ButtonEvents<'_> {
            fn read(&mut self, output: &mut [u8]) -> std::io::Result<usize> {
                let Some(value) = self.buttons.next() else {
                    return Ok(0);
                };
                self.cursor.lock().unwrap().record(
                    Instant::now(),
                    (value == 1).then_some(telemetry::CursorSnapshot {
                        position: (0.2, 0.8),
                        cursor_type: "arrow",
                    }),
                );
                output.copy_from_slice(&input_event(EV_KEY, BTN_LEFT, value));
                Ok(output.len())
            }
        }

        let context = click_context();
        read_device(
            ButtonEvents {
                buttons: [1, 0].into_iter(),
                cursor: &context.cursor_history,
            },
            None,
            &context,
            None,
        );
        let samples = context.samples.lock().unwrap();
        assert_eq!(samples.len(), 2);
        assert_eq!(samples[1].interaction_type.as_deref(), Some("mouseup"));
        assert_eq!((samples[1].cx, samples[1].cy), (0.2, 0.8));
    }

    #[test]
    fn uses_the_touch_edge_timing_when_a_pause_precedes_the_report() {
        struct TouchEvents<'a> {
            index: usize,
            pause_before_touch_up: bool,
            pause: &'a Mutex<PauseState>,
        }

        impl Read for TouchEvents<'_> {
            fn read(&mut self, output: &mut [u8]) -> std::io::Result<usize> {
                let events = [
                    input_event(EV_KEY, BTN_TOUCH, 1),
                    input_event(EV_SYN, SYN_REPORT, 0),
                    input_event(EV_KEY, BTN_TOUCH, 0),
                    input_event(EV_SYN, SYN_REPORT, 0),
                ];
                let Some(event) = events.get(self.index) else {
                    return Ok(0);
                };
                let pause_at = if self.pause_before_touch_up { 2 } else { 3 };
                if self.index == pause_at {
                    self.pause.lock().unwrap().pause();
                }
                self.index += 1;
                output.copy_from_slice(event);
                Ok(output.len())
            }
        }

        for (pause_before_touch_up, expected_events) in [(false, 2), (true, 0)] {
            let context = click_context();
            record_cursor(&context, Instant::now(), (0.2, 0.8));
            read_device(
                TouchEvents {
                    index: 0,
                    pause_before_touch_up,
                    pause: &context.pause,
                },
                Some(TouchTapTracker::new(touchpad_geometry())),
                &context,
                None,
            );
            assert_eq!(context.samples.lock().unwrap().len(), expected_events);
        }
    }

    #[test]
    fn a_later_cursor_position_does_not_qualify_a_tap_with_unknown_release() {
        let mut tracker = TouchTapTracker::new(touchpad_geometry());
        let now = Instant::now();
        let press_position = (0.0, 0.0);
        tracker.handle_event(EV_KEY, BTN_TOUCH, 1, now, press_position);
        tracker.handle_event(EV_SYN, SYN_REPORT, 0, now, press_position);
        let released_at = now + Duration::from_millis(40);
        tracker.handle_event(EV_KEY, BTN_TOUCH, 0, released_at, None);
        assert_eq!(
            tracker.handle_event(EV_SYN, SYN_REPORT, 0, released_at, press_position),
            None,
        );
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
        let anchor = Anchor {
            pts_ns: 2_000_000_000,
            paused_ns: 3_000_000_000,
            epoch_ms: 0,
            instant: t0,
        };
        assert_eq!(
            anchor.input_pts_ns(t0 + Duration::from_secs(1), anchor.paused_ns),
            anchor.pts_ns + 1_000_000_000
        );
        assert_eq!(
            anchor.input_pts_ns(
                t0 + Duration::from_secs(4),
                anchor.paused_ns + 2_000_000_000
            ),
            anchor.pts_ns + 2_000_000_000
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

    #[test]
    fn touchpad_tap_rejects_five_fingers() {
        let t0 = Instant::now();
        let mut tracker = TouchTapTracker::new(touchpad_geometry());

        tracker.handle_event(EV_KEY, BTN_TOUCH, 1, t0, (0.5, 0.5));
        tracker.handle_event(EV_KEY, BTN_TOOL_QUINTTAP, 1, t0, (0.5, 0.5));
        tracker.handle_event(EV_SYN, SYN_REPORT, 0, t0, (0.5, 0.5));
        tracker.handle_event(
            EV_KEY,
            BTN_TOUCH,
            0,
            t0 + Duration::from_millis(50),
            (0.5, 0.5),
        );
        tracker.handle_event(
            EV_KEY,
            BTN_TOOL_QUINTTAP,
            0,
            t0 + Duration::from_millis(50),
            (0.5, 0.5),
        );
        assert_eq!(
            tracker.handle_event(
                EV_SYN,
                SYN_REPORT,
                0,
                t0 + Duration::from_millis(50),
                (0.5, 0.5)
            ),
            None
        );
    }

    #[test]
    fn honors_gnome_lmr_tap_button_map() {
        assert_eq!(parse_tap_button_map("'lmr'\n"), TapButtonMap::Lmr);
        assert_eq!(parse_tap_button_map("'lrm'\n"), TapButtonMap::Lrm);
        assert_eq!(parse_tap_button_map("'default'"), TapButtonMap::Lrm);
        assert_eq!(parse_tap_button_map(""), TapButtonMap::Lrm);

        let t0 = Instant::now();
        let mut tracker = TouchTapTracker::with_button_map(touchpad_geometry(), TapButtonMap::Lmr);

        tracker.handle_event(EV_KEY, BTN_TOUCH, 1, t0, (0.5, 0.5));
        tracker.handle_event(EV_KEY, BTN_TOOL_FINGER, 1, t0, (0.5, 0.5));
        tracker.handle_event(EV_SYN, SYN_REPORT, 0, t0, (0.5, 0.5));
        let up1 = t0 + Duration::from_millis(60);
        tracker.handle_event(EV_KEY, BTN_TOUCH, 0, up1, (0.5, 0.5));
        tracker.handle_event(EV_KEY, BTN_TOOL_FINGER, 0, up1, (0.5, 0.5));
        assert_eq!(
            tracker
                .handle_event(EV_SYN, SYN_REPORT, 0, up1, (0.5, 0.5))
                .unwrap()
                .button_code,
            BTN_LEFT
        );

        let at2 = t0 + Duration::from_millis(200);
        tracker.handle_event(EV_KEY, BTN_TOUCH, 1, at2, (0.5, 0.5));
        tracker.handle_event(EV_KEY, BTN_TOOL_DOUBLETAP, 1, at2, (0.5, 0.5));
        tracker.handle_event(EV_SYN, SYN_REPORT, 0, at2, (0.5, 0.5));
        let up2 = at2 + Duration::from_millis(60);
        tracker.handle_event(EV_KEY, BTN_TOUCH, 0, up2, (0.5, 0.5));
        tracker.handle_event(EV_KEY, BTN_TOOL_DOUBLETAP, 0, up2, (0.5, 0.5));
        assert_eq!(
            tracker
                .handle_event(EV_SYN, SYN_REPORT, 0, up2, (0.5, 0.5))
                .unwrap()
                .button_code,
            BTN_MIDDLE
        );

        let at3 = t0 + Duration::from_millis(400);
        tracker.handle_event(EV_KEY, BTN_TOUCH, 1, at3, (0.5, 0.5));
        tracker.handle_event(EV_KEY, BTN_TOOL_TRIPLETAP, 1, at3, (0.5, 0.5));
        tracker.handle_event(EV_SYN, SYN_REPORT, 0, at3, (0.5, 0.5));
        let up3 = at3 + Duration::from_millis(60);
        tracker.handle_event(EV_KEY, BTN_TOUCH, 0, up3, (0.5, 0.5));
        tracker.handle_event(EV_KEY, BTN_TOOL_TRIPLETAP, 0, up3, (0.5, 0.5));
        assert_eq!(
            tracker
                .handle_event(EV_SYN, SYN_REPORT, 0, up3, (0.5, 0.5))
                .unwrap()
                .button_code,
            BTN_RIGHT
        );
    }

    #[test]
    fn recovers_from_syn_dropped_without_getting_stuck_on_physical_buttons() {
        let t0 = Instant::now();
        let mut tracker = TouchTapTracker::new(touchpad_geometry());

        // Start a touch with a physical button press whose release gets dropped.
        tracker.handle_event(EV_KEY, BTN_TOUCH, 1, t0, (0.4, 0.4));
        tracker.handle_event(EV_KEY, BTN_TOOL_FINGER, 1, t0, (0.4, 0.4));
        tracker.handle_event(EV_KEY, BTN_LEFT, 1, t0, (0.4, 0.4));
        tracker.handle_event(EV_SYN, SYN_REPORT, 0, t0, (0.4, 0.4));
        assert!(tracker.is_touching());

        // SYN_DROPPED resets held button counts and cancels the incomplete tap.
        assert_eq!(
            tracker.handle_event(
                EV_SYN,
                SYN_DROPPED,
                0,
                t0 + Duration::from_millis(20),
                (0.4, 0.4)
            ),
            None
        );
        assert!(!tracker.is_touching());

        // Events prior to the resync SYN_REPORT are ignored.
        tracker.handle_event(
            EV_KEY,
            BTN_TOUCH,
            1,
            t0 + Duration::from_millis(25),
            (0.4, 0.4),
        );
        tracker.handle_event(
            EV_SYN,
            SYN_REPORT,
            0,
            t0 + Duration::from_millis(30),
            (0.4, 0.4),
        );
        assert!(!tracker.is_touching());

        // Subsequent clean tap works normally instead of staying suppressed.
        let tap_down = t0 + Duration::from_millis(100);
        tracker.handle_event(EV_KEY, BTN_TOUCH, 1, tap_down, (0.4, 0.4));
        tracker.handle_event(EV_KEY, BTN_TOOL_FINGER, 1, tap_down, (0.4, 0.4));
        tracker.handle_event(EV_SYN, SYN_REPORT, 0, tap_down, (0.4, 0.4));
        let tap_up = tap_down + Duration::from_millis(60);
        tracker.handle_event(EV_KEY, BTN_TOUCH, 0, tap_up, (0.4, 0.4));
        tracker.handle_event(EV_KEY, BTN_TOOL_FINGER, 0, tap_up, (0.4, 0.4));
        let completed = tracker
            .handle_event(EV_SYN, SYN_REPORT, 0, tap_up, (0.4, 0.4))
            .unwrap();
        assert_eq!(completed.button_code, BTN_LEFT);
    }

    #[test]
    fn emit_completed_tap_appends_both_edges_with_separate_timestamps_and_positions() {
        let t0 = Instant::now();
        let samples = Arc::new(Mutex::new(Vec::new()));
        let anchor = Arc::new(Mutex::new(None));
        let context = ClickContext {
            samples: Arc::clone(&samples),
            anchor: Arc::clone(&anchor),
            pause: Arc::new(Mutex::new(PauseState::default())),
            cursor_history: Arc::new(Mutex::new(telemetry::CursorHistory::default())),
            verbose: false,
        };
        let tap = CompletedTap {
            button_code: BTN_MIDDLE,
            down_at: t0 + Duration::from_millis(500),
            down_cursor: (0.25, 0.35),
            up_at: t0 + Duration::from_millis(560),
            up_cursor: (0.26, 0.36),
        };
        let mut last_left_click = None;

        emit_completed_tap(&context, tap, 0, 5_000_000, &mut last_left_click);
        assert!(samples.lock().unwrap().is_empty());

        *anchor.lock().unwrap() = Some(Anchor {
            pts_ns: 2_000_000_000,
            paused_ns: 0,
            epoch_ms: 1_700_000_000_000,
            instant: t0,
        });
        emit_completed_tap(&context, tap, 0, 5_000_000, &mut last_left_click);

        let collected = samples.lock().unwrap();
        assert_eq!(collected.len(), 2);
        assert_eq!(collected[0].pts_ns, 2_500_000_000);
        assert_eq!(
            collected[0].interaction_type.as_deref(),
            Some("middle-click")
        );
        assert_eq!(collected[0].mouse_button, Some(3));
        assert!((collected[0].cx - 0.25).abs() < f64::EPSILON);
        assert!((collected[0].cy - 0.35).abs() < f64::EPSILON);

        assert_eq!(collected[1].pts_ns, 2_555_000_000);
        assert_eq!(collected[1].interaction_type.as_deref(), Some("mouseup"));
        assert_eq!(collected[1].mouse_button, Some(3));
        assert!((collected[1].cx - 0.26).abs() < f64::EPSILON);
        assert!((collected[1].cy - 0.36).abs() < f64::EPSILON);
    }
}
