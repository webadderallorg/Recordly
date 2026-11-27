use crate::video::VideoHandle;
use anyhow::{Context, Result};
use pipewire as pw;
use pw::properties::properties;
use pw::spa;
use pw::spa::buffer::meta::{MetaBitmap, MetaCursor, MetaHeader};
use recordly_portal_cursor::telemetry::{CursorSnapshot, RecordedCursor};
use recordly_portal_cursor::{cursor_shape, geometry, telemetry};
use std::cell::Cell;
use std::collections::HashMap;
use std::fs;
use std::io::Write;
use std::os::fd::OwnedFd;
use std::path::{Path, PathBuf};
use std::rc::Rc;
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

pub enum Command {
    Quit,
    Pause,
    Resume,
    MarkZoom,
}

#[derive(Clone, Copy)]
pub(crate) struct Anchor {
    pub pts_ns: i64,
    pub paused_ns: i64,
    pub epoch_ms: i64,
    pub instant: Instant,
}

impl Anchor {
    pub(crate) fn input_pts_ns(self, event: Instant, accumulated_paused_ns: i64) -> i64 {
        let elapsed_ns = duration_to_ns(event.saturating_duration_since(self.instant));
        self.pts_ns + elapsed_ns - accumulated_paused_ns.saturating_sub(self.paused_ns)
    }
}

struct PauseBoundary {
    instant: Instant,
    paused: bool,
    paused_ns: i64,
}

#[derive(Default)]
pub(crate) struct PauseState {
    boundaries: Vec<PauseBoundary>,
}

impl PauseState {
    pub(crate) fn pause(&mut self) {
        self.set_paused_at(true, Instant::now());
    }

    fn resume(&mut self) {
        self.set_paused_at(false, Instant::now());
    }

    fn set_paused_at(&mut self, paused: bool, instant: Instant) {
        let (was_paused, paused_ns) = self.timing_at(instant);
        if was_paused != paused {
            self.boundaries.push(PauseBoundary {
                instant,
                paused,
                paused_ns,
            });
        }
    }

    pub(crate) fn snapshot(&self) -> (bool, i64) {
        self.boundaries
            .last()
            .map_or((false, 0), |boundary| (boundary.paused, boundary.paused_ns))
    }

    pub(crate) fn timing_at(&self, event_time: Instant) -> (bool, i64) {
        // A buffered input can arrive after either edge of a pause.
        let boundary_index = self
            .boundaries
            .partition_point(|boundary| boundary.instant <= event_time);
        let Some(boundary) = self.boundaries[..boundary_index].last() else {
            return (false, 0);
        };
        let paused_ns = if boundary.paused {
            boundary.paused_ns.saturating_add(duration_to_ns(
                event_time.saturating_duration_since(boundary.instant),
            ))
        } else {
            boundary.paused_ns
        };
        (boundary.paused, paused_ns)
    }
}

pub(crate) fn duration_to_ns(duration: Duration) -> i64 {
    i64::try_from(duration.as_nanos()).unwrap_or(i64::MAX)
}

pub struct CaptureConfig {
    pub node_id: u32,
    pub stream_rect: Option<geometry::Rect>,
    pub start_paused: bool,
    pub position_space: geometry::PositionSpace,
    pub start_epoch_ms: Arc<AtomicI64>,
    pub output: Option<PathBuf>,
    pub cursor_theme: Option<String>,
    pub export_bitmap: Option<PathBuf>,
    pub video: Option<Arc<VideoHandle>>,
    pub print_events: bool,
    pub verbose: bool,
}

type CursorKey = (u32, i32, i32, i32, i32, Option<(u32, u32, u32, i32)>);

const FRAME_INTERVAL_NS: i64 = 33_333_333;
const TIMER_TICK: Duration = Duration::from_millis(10);

struct StartupFrame {
    buffer: crate::video::FrameBuffer,
    raw_pts_ns: i64,
    received_at: Instant,
}

#[derive(Default)]
enum PtsClockMode {
    #[default]
    Undecided,
    Header,
    MonotonicFallback(Instant),
}

#[derive(Default)]
struct PtsClock {
    mode: PtsClockMode,
    last_active_pts: Option<i64>,
}

impl PtsClock {
    fn resolve_raw(&mut self, raw_pts: i64, now: Instant) -> Option<i64> {
        match self.mode {
            PtsClockMode::Header => (raw_pts > 0).then_some(raw_pts),
            PtsClockMode::Undecided if raw_pts > 0 => {
                self.mode = PtsClockMode::Header;
                Some(raw_pts)
            }
            PtsClockMode::Undecided => {
                self.mode = PtsClockMode::MonotonicFallback(now);
                Some(1_000_000_000)
            }
            PtsClockMode::MonotonicFallback(start) => Some(
                1_000_000_000_i64
                    .saturating_add(duration_to_ns(now.saturating_duration_since(start))),
            ),
        }
    }

    fn observe_active(&mut self, pts_ns: i64) {
        self.last_active_pts = Some(self.last_active_pts.map_or(pts_ns, |last| last.max(pts_ns)));
    }

    fn resolve_active(
        &mut self,
        raw_pts: i64,
        paused_ns: i64,
        anchor: Option<Anchor>,
        now: Instant,
    ) -> Option<i64> {
        let resolved = match self.mode {
            PtsClockMode::Undecided | PtsClockMode::Header if raw_pts > 0 => {
                self.mode = PtsClockMode::Header;
                Some(raw_pts.saturating_sub(paused_ns))
            }
            PtsClockMode::Header => {
                let anchor = anchor?;
                let pause_since_anchor = paused_ns.saturating_sub(anchor.paused_ns);
                Some(
                    anchor.pts_ns + duration_to_ns(now.saturating_duration_since(anchor.instant))
                        - pause_since_anchor,
                )
            }
            PtsClockMode::Undecided => {
                self.mode = PtsClockMode::MonotonicFallback(now);
                Some(1_000_000_000_i64.saturating_sub(paused_ns))
            }
            PtsClockMode::MonotonicFallback(start) => Some(
                1_000_000_000_i64
                    .saturating_add(duration_to_ns(now.saturating_duration_since(start)))
                    .saturating_sub(paused_ns),
            ),
        }?;
        let monotonic = self
            .last_active_pts
            .map_or(resolved, |last| resolved.max(last));
        self.last_active_pts = Some(monotonic);
        Some(monotonic)
    }
}

#[derive(Clone, Copy)]
struct RawCursorState {
    position: (i32, i32),
    cursor_type: &'static str,
}

#[derive(Clone)]
struct VideoSync {
    video: Option<Arc<VideoHandle>>,
    timeline: Arc<Mutex<VideoTimeline>>,
    pause: Arc<Mutex<PauseState>>,
    anchor: Arc<Mutex<Option<Anchor>>>,
}

impl VideoSync {
    fn new(
        video: Option<Arc<VideoHandle>>,
        timeline: &Arc<Mutex<VideoTimeline>>,
        pause: &Arc<Mutex<PauseState>>,
        anchor: &Arc<Mutex<Option<Anchor>>>,
    ) -> Self {
        Self {
            video,
            timeline: Arc::clone(timeline),
            pause: Arc::clone(pause),
            anchor: Arc::clone(anchor),
        }
    }
}

#[derive(Default)]
struct VideoTimeline {
    startup_frame: Option<StartupFrame>,
    first_pts: Option<i64>,
    last_frame: Option<crate::video::FrameBuffer>,
    last_pts: Option<i64>,
    last_push: Option<Instant>,
}

struct CaptureState {
    config: CaptureConfig,
    raw_samples: Arc<Mutex<Vec<telemetry::RawSample>>>,
    theme: Vec<cursor_shape::ThemeCursor>,
    type_by_cursor_id: HashMap<u32, Option<&'static str>>,
    current_type: Option<&'static str>,
    video_size: Option<(u32, u32)>,
    video_format: Option<cursor_shape::PixelFormat>,
    ready: bool,
    pts_clock: PtsClock,
    timeline: Arc<Mutex<VideoTimeline>>,
    anchor: Arc<Mutex<Option<Anchor>>>,
    pause: Arc<Mutex<PauseState>>,
    cursor_history: Arc<Mutex<telemetry::CursorHistory>>,
    last_raw_cursor: Option<RawCursorState>,
    buffer_count: u64,
    cursor_meta_count: u64,
    last: Option<CursorKey>,
    recorded_cursor: Rc<Cell<RecordedCursor>>,
    last_media_pts: Rc<Cell<Option<i64>>>,
}

impl CaptureState {
    fn new(
        config: CaptureConfig,
        theme: Vec<cursor_shape::ThemeCursor>,
        raw_samples: &Arc<Mutex<Vec<telemetry::RawSample>>>,
        cursor_history: &Arc<Mutex<telemetry::CursorHistory>>,
        sync: &VideoSync,
        recorded_cursor: Rc<Cell<RecordedCursor>>,
        last_media_pts: Rc<Cell<Option<i64>>>,
    ) -> Self {
        Self {
            config,
            raw_samples: Arc::clone(raw_samples),
            theme,
            type_by_cursor_id: HashMap::new(),
            current_type: None,
            video_size: None,
            video_format: None,
            ready: false,
            pts_clock: PtsClock::default(),
            timeline: Arc::clone(&sync.timeline),
            anchor: Arc::clone(&sync.anchor),
            pause: Arc::clone(&sync.pause),
            cursor_history: Arc::clone(cursor_history),
            last_raw_cursor: None,
            buffer_count: 0,
            cursor_meta_count: 0,
            last: None,
            recorded_cursor,
            last_media_pts,
        }
    }
}

pub fn spawn(
    fd: OwnedFd,
    config: CaptureConfig,
    finished: tokio::sync::oneshot::Sender<()>,
) -> Result<(pw::channel::Sender<Command>, JoinHandle<Result<()>>)> {
    let (sender, receiver) = pw::channel::channel::<Command>();
    let raw_samples = Arc::new(Mutex::new(Vec::<telemetry::RawSample>::new()));
    let anchor = Arc::new(Mutex::new(None::<Anchor>));
    let cursor_history = Arc::new(Mutex::new(telemetry::CursorHistory::default()));
    let mut pause_state = PauseState::default();
    if config.start_paused {
        pause_state.pause();
    }
    let pause = Arc::new(Mutex::new(pause_state));
    let timeline = Arc::new(Mutex::new(VideoTimeline::default()));
    let timer_frame_interval_ns = configure_keepalive_interval_ns();

    crate::clicks::start(
        &raw_samples,
        &anchor,
        &pause,
        &cursor_history,
        config.verbose,
    );

    let thread_context = CaptureThreadContext {
        config,
        raw_samples,
        anchor,
        pause,
        cursor_history,
        timeline,
        timer_frame_interval_ns,
    };

    let handle = std::thread::Builder::new()
        .name("recordly-pipewire-capture".into())
        .spawn(move || {
            let result = run_capture_thread(fd, receiver, thread_context);
            let _ = finished.send(());
            result
        })
        .context("failed to spawn the PipeWire capture thread")?;

    Ok((sender, handle))
}

struct CaptureThreadContext {
    config: CaptureConfig,
    raw_samples: Arc<Mutex<Vec<telemetry::RawSample>>>,
    anchor: Arc<Mutex<Option<Anchor>>>,
    pause: Arc<Mutex<PauseState>>,
    cursor_history: Arc<Mutex<telemetry::CursorHistory>>,
    timeline: Arc<Mutex<VideoTimeline>>,
    timer_frame_interval_ns: i64,
}

fn parse_keepalive_interval_ns(raw: &str) -> i64 {
    raw.trim()
        .parse::<i64>()
        .ok()
        .filter(|millis| *millis >= 0)
        .and_then(|millis| millis.checked_mul(1_000_000))
        .unwrap_or(FRAME_INTERVAL_NS)
}

fn configure_keepalive_interval_ns() -> i64 {
    std::env::var("RECORDLY_PORTAL_CURSOR_KEEPALIVE_MS")
        .ok()
        .as_deref()
        .map_or(FRAME_INTERVAL_NS, parse_keepalive_interval_ns)
}

fn run_capture_thread(
    fd: OwnedFd,
    receiver: pw::channel::Receiver<Command>,
    context: CaptureThreadContext,
) -> Result<()> {
    pw::init();

    let CaptureThreadContext {
        config,
        raw_samples,
        anchor,
        pause,
        cursor_history,
        timeline,
        timer_frame_interval_ns,
    } = context;

    let verbose = config.verbose;
    let output = config.output.clone();
    let start_epoch = Arc::clone(&config.start_epoch_ms);
    let command_video = config.video.clone();
    let timer_video = config.video.clone();

    let theme = load_capture_theme(&config);

    let mainloop =
        pw::main_loop::MainLoopRc::new(None).context("failed to create PipeWire main loop")?;
    let pw_context = pw::context::ContextRc::new(&mainloop, None)
        .context("failed to create PipeWire context")?;
    let core = pw_context
        .connect_fd_rc(fd, None)
        .context("failed to connect to the portal PipeWire remote")?;

    let props = properties! {
        *pw::keys::MEDIA_TYPE => "Video",
        *pw::keys::MEDIA_CATEGORY => "Capture",
        *pw::keys::MEDIA_ROLE => "Screen",
    };
    let stream = pw::stream::StreamBox::new(&core, "recordly-portal-cursor", props)
        .context("failed to create PipeWire stream")?;

    let node_id = config.node_id;
    let command_sync = VideoSync::new(command_video, &timeline, &pause, &anchor);
    let recorded_cursor = Rc::new(Cell::new(RecordedCursor::default()));
    let last_media_pts = Rc::new(Cell::new(None));
    let state = CaptureState::new(
        config,
        theme,
        &raw_samples,
        &cursor_history,
        &command_sync,
        Rc::clone(&recorded_cursor),
        Rc::clone(&last_media_pts),
    );

    let capture_error = Rc::new(Cell::new(None));
    let listener = register_stream_listener(&stream, state, &mainloop, Rc::clone(&capture_error))?;
    connect_stream_to_pod(&stream, node_id)?;

    let _receiver = attach_capture_commands(
        receiver,
        &mainloop,
        command_sync,
        CaptureCommandShared {
            anchor: Arc::clone(&anchor),
            start_epoch: Arc::clone(&start_epoch),
            raw_samples: Arc::clone(&raw_samples),
            cursor_history: Arc::clone(&cursor_history),
            recorded_cursor,
            last_media_pts,
        },
    );
    let _keepalive_timer = attach_keepalive_timer(
        &mainloop,
        VideoSync::new(timer_video, &timeline, &pause, &anchor),
        timer_frame_interval_ns,
        verbose,
    );

    mainloop.run();
    drop(listener);

    if let Some(path) = output.as_deref() {
        write_captured_telemetry(path, &raw_samples, &anchor, &start_epoch, verbose)?;
    }

    if let Some(error) = capture_error.take() {
        anyhow::bail!("{error}");
    }
    Ok(())
}

struct CaptureCommandShared {
    anchor: Arc<Mutex<Option<Anchor>>>,
    start_epoch: Arc<AtomicI64>,
    raw_samples: Arc<Mutex<Vec<telemetry::RawSample>>>,
    cursor_history: Arc<Mutex<telemetry::CursorHistory>>,
    recorded_cursor: Rc<Cell<RecordedCursor>>,
    last_media_pts: Rc<Cell<Option<i64>>>,
}

fn attach_capture_commands(
    receiver: pw::channel::Receiver<Command>,
    mainloop: &pw::main_loop::MainLoopRc,
    command_sync: VideoSync,
    shared: CaptureCommandShared,
) -> pw::channel::AttachedReceiver<'_, Command> {
    let resume_sync = (
        Arc::clone(&shared.anchor),
        shared.start_epoch,
        Arc::clone(&shared.raw_samples),
        Arc::clone(&shared.cursor_history),
        shared.recorded_cursor,
        shared.last_media_pts,
    );
    let zoom_sync = (
        shared.anchor,
        shared.cursor_history,
        shared.raw_samples,
        Cell::new(None),
    );
    attach_command_receiver(
        receiver,
        mainloop,
        command_sync,
        move |first_frame_pts, paused_ns| {
            let (anchor, epoch, samples, cursor, recorded_cursor, last_media_pts) = &resume_sync;
            let pts = if let Some(pts) = first_frame_pts {
                let pts = last_media_pts.get().map_or(pts, |last| pts.max(last));
                report_video_started(anchor, epoch, pts, paused_ns);
                Some(pts)
            } else {
                anchor
                    .lock()
                    .ok()
                    .and_then(|guard| *guard)
                    .map(|anchor| anchor.input_pts_ns(Instant::now(), paused_ns))
                    .map(|pts| last_media_pts.get().map_or(pts, |last| pts.max(last)))
            };
            if let Some(pts) = pts {
                last_media_pts.set(Some(pts));
                if let Ok(cursor) = cursor.lock() {
                    append_cursor_sample(samples, recorded_cursor, pts, cursor.current());
                }
            }
        },
        move |instant, paused_ns| {
            let (anchor, cursor, samples, last_zoom_at) = &zoom_sync;
            if let (Some(anchor), Some(cursor)) = (
                anchor.lock().ok().and_then(|a| *a),
                cursor.lock().ok().and_then(|c| c.current()),
            ) && let Ok(mut collected) = samples.lock()
            {
                append_zoom_marker(
                    &mut collected,
                    last_zoom_at,
                    anchor,
                    cursor,
                    instant,
                    paused_ns,
                );
            }
        },
    )
}

fn load_capture_theme(config: &CaptureConfig) -> Vec<cursor_shape::ThemeCursor> {
    let theme_name = config
        .cursor_theme
        .clone()
        .unwrap_or_else(cursor_shape::detect_theme);
    let theme = cursor_shape::load_theme(&theme_name);
    if config.verbose {
        eprintln!("[shape] theme {theme_name} ({} cursor files)", theme.len());
    }
    theme
}

fn connect_stream_to_pod(stream: &pw::stream::Stream, node_id: u32) -> Result<()> {
    let format_pod_bytes = build_enum_format_pod()?;
    let pod = spa::pod::Pod::from_bytes(&format_pod_bytes)
        .context("failed to parse the serialized EnumFormat pod")?;
    stream
        .connect(
            spa::utils::Direction::Input,
            Some(node_id),
            pw::stream::StreamFlags::AUTOCONNECT | pw::stream::StreamFlags::MAP_BUFFERS,
            &mut [pod],
        )
        .context("failed to connect the PipeWire stream")
}

fn register_stream_listener(
    stream: &pw::stream::Stream,
    state: CaptureState,
    mainloop: &pw::main_loop::MainLoopRc,
    capture_error: Rc<Cell<Option<String>>>,
) -> Result<pw::stream::StreamListener<CaptureState>> {
    let error_loop = mainloop.clone();
    stream
        .add_local_listener_with_user_data(state)
        .state_changed(move |_, state, old, new| {
            if state.config.verbose {
                eprintln!("[pw] state {old:?} -> {new:?}");
            }
            let error = match new {
                pw::stream::StreamState::Error(error) => error,
                pw::stream::StreamState::Unconnected
                    if !matches!(old, pw::stream::StreamState::Unconnected) =>
                {
                    "the PipeWire stream disconnected".to_owned()
                }
                _ => return,
            };
            capture_error.set(Some(error));
            error_loop.quit();
        })
        .param_changed(|stream, state, id, param| {
            handle_param_changed(stream, state, id, param);
        })
        .process(|stream, state| {
            handle_process(stream, state);
        })
        .register()
        .context("failed to register the PipeWire stream listener")
}

fn handle_param_changed(
    stream: &pw::stream::Stream,
    state: &mut CaptureState,
    id: u32,
    param: Option<&spa::pod::Pod>,
) {
    let Some(param) = param else {
        return;
    };
    if id != spa::param::ParamType::Format.as_raw() {
        return;
    }
    let Ok((media_type, media_subtype)) = spa::param::format_utils::parse_format(param) else {
        return;
    };
    if media_type != spa::param::format::MediaType::Video
        || media_subtype != spa::param::format::MediaSubtype::Raw
    {
        return;
    }
    let mut format = spa::param::video::VideoInfoRaw::default();
    if format.parse(param).is_ok() {
        let size = Some((format.size().width, format.size().height));
        let pixel_format = cursor_shape::PixelFormat::from_spa(format.format().as_raw());
        let size_changed = size != state.video_size;
        let format_changed = pixel_format != state.video_format;
        if size_changed || format_changed {
            if let Ok(mut timeline) = state.timeline.lock() {
                timeline.last_frame = None;
                timeline.startup_frame = None;
            }
            state.last = None;
        }
        state.video_size = size;
        state.video_format = pixel_format;
        if size_changed {
            let rect = normalization_rect(state);
            let snapshot =
                normalize_raw_cursor(state.last_raw_cursor, rect, state.config.position_space);
            if let Ok(mut history) = state.cursor_history.lock() {
                history.record(Instant::now(), snapshot);
            }
        }
        if let (Some(video), Some(_pixel_format)) = (&state.config.video, state.video_format) {
            video.set_video_caps("I420", format.size().width, format.size().height);
        }
        if state.config.verbose {
            eprintln!(
                "[pw] video format {:#010x} {}x{}",
                format.format().as_raw(),
                format.size().width,
                format.size().height
            );
        }
        if let Err(error) = request_buffer_metadata(stream) {
            eprintln!("[pw] failed to request buffer metadata: {error:#}");
        }
    }
}

fn build_enum_format_pod() -> Result<Vec<u8>> {
    let format = spa::pod::object!(
        spa::utils::SpaTypes::ObjectParamFormat,
        spa::param::ParamType::EnumFormat,
        spa::pod::property!(
            spa::param::format::FormatProperties::MediaType,
            Id,
            spa::param::format::MediaType::Video
        ),
        spa::pod::property!(
            spa::param::format::FormatProperties::MediaSubtype,
            Id,
            spa::param::format::MediaSubtype::Raw
        ),
        spa::pod::property!(
            spa::param::format::FormatProperties::VideoFormat,
            Choice,
            Enum,
            Id,
            spa::param::video::VideoFormat::BGRx,
            spa::param::video::VideoFormat::BGRx,
            spa::param::video::VideoFormat::BGRA,
            spa::param::video::VideoFormat::RGBA,
            spa::param::video::VideoFormat::RGBx,
            spa::param::video::VideoFormat::RGB,
        ),
        spa::pod::property!(
            spa::param::format::FormatProperties::VideoSize,
            Choice,
            Range,
            Rectangle,
            spa::utils::Rectangle {
                width: 1920,
                height: 1080
            },
            spa::utils::Rectangle {
                width: 1,
                height: 1
            },
            spa::utils::Rectangle {
                width: 16384,
                height: 16384
            }
        ),
        spa::pod::property!(
            spa::param::format::FormatProperties::VideoFramerate,
            Choice,
            Range,
            Fraction,
            spa::utils::Fraction { num: 60, denom: 1 },
            spa::utils::Fraction { num: 0, denom: 1 },
            spa::utils::Fraction {
                num: 1000,
                denom: 1
            }
        ),
    );
    Ok(spa::pod::serialize::PodSerializer::serialize(
        std::io::Cursor::new(Vec::new()),
        &spa::pod::Value::Object(format),
    )
    .context("failed to serialize the EnumFormat pod")?
    .0
    .into_inner())
}

fn active_timeline_pts(
    anchor: Anchor,
    first_pts: i64,
    now: Instant,
    paused_ns: i64,
    last_pts: i64,
) -> i64 {
    let active_elapsed = duration_to_ns(now.saturating_duration_since(anchor.instant))
        .saturating_sub(paused_ns.saturating_sub(anchor.paused_ns));
    let current_pts = anchor.pts_ns.saturating_add(active_elapsed);
    current_pts
        .saturating_sub(first_pts)
        .max(last_pts.saturating_add(1_000_000))
}

fn attach_command_receiver(
    receiver: pw::channel::Receiver<Command>,
    mainloop: &pw::main_loop::MainLoopRc,
    sync: VideoSync,
    on_resume: impl Fn(Option<i64>, i64) + 'static,
    on_zoom: impl Fn(Instant, i64) + 'static,
) -> pw::channel::AttachedReceiver<'_, Command> {
    let quit_loop = mainloop.clone();
    receiver.attach(mainloop.loop_(), move |command| match command {
        Command::Quit => {
            finalize_video(&sync);
            quit_loop.quit();
        }
        Command::Pause => {
            if let Ok(mut state) = sync.pause.lock() {
                state.pause();
            }
            if let Some(video) = &sync.video {
                video.set_paused(true);
            }
            println!("PAUSED");
            let _ = std::io::stdout().flush();
        }
        Command::Resume => {
            if let Ok(mut state) = sync.pause.lock() {
                let (was_paused, _) = state.snapshot();
                state.resume();
                let (_, paused_ns) = state.snapshot();
                let mut first_frame_pts = None;
                if let Some(video) = &sync.video {
                    if let Ok(mut timeline) = sync.timeline.lock()
                        && let Some(frame) = timeline.startup_frame.take()
                    {
                        let pts = frame
                            .raw_pts_ns
                            .saturating_add(duration_to_ns(frame.received_at.elapsed()))
                            .saturating_sub(paused_ns);
                        // Submit the latest available pixels at the resume time. A static
                        // compositor may not send another frame until something changes.
                        if let Ok(queued) =
                            queue_video_frame(video, &mut timeline, frame.buffer, pts)
                            && queued.first
                        {
                            first_frame_pts = Some(queued.media_pts_ns);
                        }
                    }
                    video.set_paused(false);
                }
                if was_paused {
                    on_resume(first_frame_pts, paused_ns);
                }
            }
            println!("RESUMED");
            let _ = std::io::stdout().flush();
        }
        Command::MarkZoom => {
            if let Ok(state) = sync.pause.lock()
                && let (false, paused_ns) = state.snapshot()
                && sync
                    .timeline
                    .lock()
                    .is_ok_and(|timeline| timeline.first_pts.is_some())
            {
                on_zoom(Instant::now(), paused_ns);
            }
        }
    })
}

fn attach_keepalive_timer(
    mainloop: &pw::main_loop::MainLoopRc,
    sync: VideoSync,
    frame_interval_ns: i64,
    verbose: bool,
) -> pw::loop_::TimerSource<'_> {
    let timer = mainloop.loop_().add_timer(move |_| {
        let Some(video) = sync.video.as_deref() else {
            return;
        };
        let (paused, paused_ns) = sync
            .pause
            .lock()
            .map_or((true, 0), |state| state.snapshot());
        let Ok(mut timeline) = sync.timeline.lock() else {
            return;
        };
        if paused {
            timeline.last_push = Some(Instant::now());
            return;
        }
        let Some(last_frame) = timeline.last_frame.clone() else {
            return;
        };
        let Ok(interval_u64) = u64::try_from(frame_interval_ns) else {
            return;
        };
        if interval_u64 == 0 {
            return;
        }
        let last_pts = timeline.last_pts.unwrap_or(0);
        let now = Instant::now();
        let elapsed = now.saturating_duration_since(timeline.last_push.unwrap_or(now));
        if elapsed < Duration::from_nanos(interval_u64) {
            return;
        }
        let anchor = sync.anchor.lock().ok().and_then(|guard| *guard);
        let next_pts = match (anchor, timeline.first_pts) {
            (Some(anchor), Some(first_pts)) => {
                active_timeline_pts(anchor, first_pts, now, paused_ns, last_pts)
            }
            _ => last_pts + frame_interval_ns,
        };
        if video.push_buffer(next_pts, &last_frame).is_ok() {
            if verbose && next_pts % (FRAME_INTERVAL_NS * 30) < FRAME_INTERVAL_NS {
                eprintln!("[video] keepalive active");
            }
            timeline.last_pts = Some(next_pts);
            timeline.last_push = Some(now);
        }
    });
    let _ = timer.update_timer(Some(TIMER_TICK), Some(TIMER_TICK));
    timer
}

fn write_captured_telemetry(
    path: &Path,
    raw_samples: &Arc<Mutex<Vec<telemetry::RawSample>>>,
    anchor: &Arc<Mutex<Option<Anchor>>>,
    start_epoch: &Arc<AtomicI64>,
    verbose: bool,
) -> Result<()> {
    let raw = raw_samples
        .lock()
        .map(|guard| guard.clone())
        .unwrap_or_default();
    let (anchor_pts, anchor_epoch) = anchor
        .lock()
        .ok()
        .and_then(|guard| guard.as_ref().map(|a| (a.pts_ns, a.epoch_ms)))
        .unwrap_or((0, 0));
    let start_epoch_ms = start_epoch.load(Ordering::SeqCst);
    let mut collected = telemetry::resolve_samples(&raw, anchor_pts, anchor_epoch, start_epoch_ms);
    telemetry::normalize_samples(&mut collected);
    telemetry::write_document(path, &collected)
        .with_context(|| format!("failed to write {}", path.display()))?;
    if verbose {
        eprintln!(
            "[telemetry] wrote {} samples to {}",
            collected.len(),
            path.display()
        );
    }
    Ok(())
}

fn cursor_meta_size(width: i32, height: i32) -> i32 {
    let base_bytes = std::mem::size_of::<pw::spa::sys::spa_meta_cursor>()
        + std::mem::size_of::<pw::spa::sys::spa_meta_bitmap>();
    let base = i32::try_from(base_bytes).unwrap_or(i32::MAX);
    base.saturating_add(width.saturating_mul(height).saturating_mul(4))
}

fn meta_property(key: u32, value: spa::pod::Value) -> spa::pod::Property {
    spa::pod::Property {
        key,
        flags: spa::pod::PropertyFlags::empty(),
        value,
    }
}

fn int_choice(value: i32, min: i32, max: i32) -> spa::pod::Value {
    spa::pod::Value::Choice(spa::pod::ChoiceValue::Int(spa::utils::Choice(
        spa::utils::ChoiceFlags::empty(),
        spa::utils::ChoiceEnum::Range {
            default: value,
            min,
            max,
        },
    )))
}

fn serialize_object(object: spa::pod::Object) -> Result<Vec<u8>> {
    let data = spa::pod::serialize::PodSerializer::serialize(
        std::io::Cursor::new(Vec::new()),
        &spa::pod::Value::Object(object),
    )
    .context("failed to serialize a PipeWire param pod")?
    .0
    .into_inner();
    Ok(data)
}

fn request_buffer_metadata(stream: &pw::stream::Stream) -> Result<()> {
    let cursor = cursor_meta_size(64, 64);
    let cursor_min = cursor_meta_size(1, 1);
    let cursor_max = cursor_meta_size(1024, 1024);
    let header =
        i32::try_from(std::mem::size_of::<pw::spa::sys::spa_meta_header>()).unwrap_or(i32::MAX);

    let objects = vec![
        spa::pod::Object {
            type_: spa::utils::SpaTypes::ObjectParamMeta.as_raw(),
            id: spa::param::ParamType::Meta.as_raw(),
            properties: vec![
                meta_property(
                    pw::spa::sys::SPA_PARAM_META_type,
                    spa::pod::Value::Id(spa::utils::Id(pw::spa::sys::SPA_META_Cursor)),
                ),
                meta_property(
                    pw::spa::sys::SPA_PARAM_META_size,
                    int_choice(cursor, cursor_min, cursor_max),
                ),
            ],
        },
        spa::pod::Object {
            type_: spa::utils::SpaTypes::ObjectParamMeta.as_raw(),
            id: spa::param::ParamType::Meta.as_raw(),
            properties: vec![
                meta_property(
                    pw::spa::sys::SPA_PARAM_META_type,
                    spa::pod::Value::Id(spa::utils::Id(pw::spa::sys::SPA_META_Header)),
                ),
                meta_property(
                    pw::spa::sys::SPA_PARAM_META_size,
                    spa::pod::Value::Int(header),
                ),
            ],
        },
        spa::pod::Object {
            type_: spa::utils::SpaTypes::ObjectParamBuffers.as_raw(),
            id: spa::param::ParamType::Buffers.as_raw(),
            properties: vec![meta_property(
                pw::spa::sys::SPA_PARAM_BUFFERS_dataType,
                spa::pod::Value::Int(1 << pw::spa::sys::SPA_DATA_MemPtr),
            )],
        },
    ];

    let buffers: Vec<Vec<u8>> = objects
        .into_iter()
        .map(serialize_object)
        .collect::<Result<Vec<_>>>()?;

    let mut params: Vec<&spa::pod::Pod> = Vec::with_capacity(buffers.len());
    for bytes in &buffers {
        if let Some(pod) = spa::pod::Pod::from_bytes(bytes) {
            params.push(pod);
        }
    }

    stream
        .update_params(&mut params)
        .context("pw_stream_update_params failed")?;
    Ok(())
}

fn normalization_rect(state: &CaptureState) -> Option<geometry::Rect> {
    let pixel_rect = state.video_size.and_then(|(width, height)| {
        geometry::stream_rect(
            None,
            Some((i32::try_from(width).ok()?, i32::try_from(height).ok()?)),
        )
    });
    match state.config.position_space {
        geometry::PositionSpace::Global => state.config.stream_rect.or(pixel_rect),
        geometry::PositionSpace::StreamLocal => pixel_rect.or(state.config.stream_rect),
    }
}

fn ensure_anchor(anchor: &Mutex<Option<Anchor>>, pts: i64, paused_ns: i64) -> Anchor {
    let mut anchor = anchor
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    *anchor.get_or_insert(Anchor {
        pts_ns: pts,
        paused_ns,
        epoch_ms: epoch_now_ms(),
        instant: Instant::now(),
    })
}

fn existing_anchor(state: &CaptureState) -> Option<Anchor> {
    state.anchor.lock().ok().and_then(|anchor| *anchor)
}

fn finalize_video(sync: &VideoSync) {
    let Some(video) = sync.video.as_deref() else {
        return;
    };
    let (paused, paused_ns) = sync
        .pause
        .lock()
        .map_or((true, 0), |pause| pause.snapshot());
    if paused {
        return;
    }
    let Ok(mut timeline) = sync.timeline.lock() else {
        return;
    };
    let Some(last_frame) = timeline.last_frame.clone() else {
        return;
    };
    let last_pts = timeline.last_pts.unwrap_or(0);
    let now = Instant::now();
    let anchor = sync.anchor.lock().ok().and_then(|guard| *guard);
    let next_pts = match (anchor, timeline.first_pts) {
        (Some(anchor), Some(first_pts)) => {
            active_timeline_pts(anchor, first_pts, now, paused_ns, last_pts)
        }
        _ => last_pts + FRAME_INTERVAL_NS,
    };
    if video.push_buffer(next_pts, &last_frame).is_ok() {
        timeline.last_pts = Some(next_pts);
        timeline.last_push = Some(now);
    }
}

fn get_video_frame(
    buffer: &mut pw::buffer::Buffer<'_>,
    state: &CaptureState,
) -> Option<crate::video::FrameBuffer> {
    let (width, height) = state.video_size?;
    let format = state.video_format?;
    let (data, stride) = frame_data(buffer, width, height, format.bytes_per_pixel())?;
    format
        .to_i420(width, height, data, stride)
        .map(VideoHandle::frame_buffer)
}

struct QueuedVideoFrame {
    first: bool,
    media_pts_ns: i64,
}

fn push_video_frame(
    buffer: &mut pw::buffer::Buffer<'_>,
    pts: i64,
    paused_ns: i64,
    state: &mut CaptureState,
) -> Option<i64> {
    let video = state.config.video.as_ref()?;
    let frame = get_video_frame(buffer, state)?;
    let Ok(mut timeline) = state.timeline.lock() else {
        return None;
    };
    match queue_video_frame(video, &mut timeline, frame, pts) {
        Ok(queued) => {
            let media_pts = queued.media_pts_ns;
            if queued.first {
                report_video_started(
                    &state.anchor,
                    &state.config.start_epoch_ms,
                    media_pts,
                    paused_ns,
                );
                if buffer.find_meta::<MetaCursor>().is_none()
                    && let Ok(cursor) = state.cursor_history.lock()
                {
                    append_cursor_sample(
                        &state.raw_samples,
                        &state.recorded_cursor,
                        media_pts,
                        cursor.current(),
                    );
                }
            }
            drop(timeline);
            report_ready(state);
            Some(media_pts)
        }
        Err(error) => {
            if state.config.verbose {
                eprintln!("[video] frame push failed: {error:#}");
            }
            None
        }
    }
}

fn queue_video_frame(
    video: &VideoHandle,
    timeline: &mut VideoTimeline,
    frame: crate::video::FrameBuffer,
    pts: i64,
) -> Result<QueuedVideoFrame> {
    let first = timeline.first_pts.is_none();
    let first_pts = timeline.first_pts.unwrap_or(pts);
    let mut timeline_pts = pts.saturating_sub(first_pts);
    if let Some(last_pts) = timeline.last_pts
        && timeline_pts <= last_pts
    {
        timeline_pts = last_pts.saturating_add(1_000_000);
    }
    video.push_buffer(timeline_pts, &frame)?;
    if first {
        timeline.first_pts = Some(pts);
    }
    timeline.last_frame = Some(frame);
    timeline.last_pts = Some(timeline_pts);
    timeline.last_push = Some(Instant::now());
    Ok(QueuedVideoFrame {
        first,
        media_pts_ns: first_pts.saturating_add(timeline_pts),
    })
}

fn report_video_started(
    anchor: &Mutex<Option<Anchor>>,
    start_epoch: &AtomicI64,
    pts: i64,
    paused_ns: i64,
) {
    let anchor = ensure_anchor(anchor, pts, paused_ns);
    let start_epoch_ms = anchor.epoch_ms + (pts - anchor.pts_ns).div_euclid(1_000_000);
    let _ = start_epoch.compare_exchange(0, start_epoch_ms, Ordering::SeqCst, Ordering::SeqCst);
    println!("VIDEO_START:{start_epoch_ms}");
    let _ = std::io::stdout().flush();
}

fn report_ready(state: &mut CaptureState) {
    if !state.ready {
        state.ready = true;
        println!("READY");
        let _ = std::io::stdout().flush();
    }
}

#[derive(Clone, Copy)]
struct FrameLayout {
    width: u32,
    height: u32,
    bytes_per_pixel: usize,
}

fn slice_valid_frame(
    mapped: &[u8],
    raw_offset: u32,
    chunk_size: u32,
    stride: i32,
    layout: FrameLayout,
) -> Option<(&[u8], i32)> {
    if mapped.is_empty() {
        return None;
    }
    let offset = usize::try_from(raw_offset).ok()? % mapped.len();
    let valid_len = usize::try_from(chunk_size).ok()?.min(mapped.len() - offset);
    let row_bytes = usize::try_from(layout.width)
        .ok()?
        .checked_mul(layout.bytes_per_pixel)?;
    let last_row = usize::try_from(layout.height).ok()?.checked_sub(1)?;
    let row_stride = stride.unsigned_abs() as usize;
    if row_bytes == 0 || row_stride < row_bytes {
        return None;
    }
    let required = last_row.checked_mul(row_stride)?.checked_add(row_bytes)?;
    if valid_len < required {
        return None;
    }
    Some((mapped.get(offset..offset.checked_add(required)?)?, stride))
}

fn frame_data<'a>(
    buffer: &'a mut pw::buffer::Buffer<'_>,
    width: u32,
    height: u32,
    bytes_per_pixel: usize,
) -> Option<(&'a [u8], i32)> {
    let data = buffer.datas_mut().first_mut()?;
    let chunk = data.chunk();
    let chunk_size = chunk.size();
    let raw_offset = chunk.offset();
    let stride = chunk.stride();
    let mapped = data.data()?;
    slice_valid_frame(
        mapped,
        raw_offset,
        chunk_size,
        stride,
        FrameLayout {
            width,
            height,
            bytes_per_pixel,
        },
    )
}

fn handle_process(stream: &pw::stream::Stream, state: &mut CaptureState) {
    let Some(mut buffer) = stream.dequeue_buffer() else {
        return;
    };

    state.buffer_count += 1;
    if state.config.verbose && state.buffer_count.is_multiple_of(60) {
        eprintln!(
            "[cursor] buffers={} with-cursor-meta={}",
            state.buffer_count, state.cursor_meta_count
        );
    }

    let (paused, paused_ns) = state
        .pause
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .snapshot();
    if paused {
        if let Some(cursor) = buffer.find_meta::<MetaCursor>() {
            // Position-only updates after resume can refer to a bitmap sent while paused.
            let _ = cache_cursor(cursor, state);
            // Cache live cursor state while paused, but emit it only on the recording timeline.
            state.last = None;
        }
        let raw_pts = buffer.find_meta::<MetaHeader>().map_or(0, MetaHeader::pts);
        let received_at = Instant::now();
        let mut startup_cached = false;
        if state.config.start_paused
            && state
                .timeline
                .lock()
                .is_ok_and(|timeline| timeline.first_pts.is_none())
            && let Some(frame_buffer) = get_video_frame(&mut buffer, state)
            && let Some(raw_pts_ns) = state.pts_clock.resolve_raw(raw_pts, received_at)
            && let Ok(mut timeline) = state.timeline.lock()
            && timeline.first_pts.is_none()
        {
            // Keep only the latest countdown frame in memory. Do not encode pre-roll.
            timeline.startup_frame = Some(StartupFrame {
                buffer: frame_buffer,
                raw_pts_ns,
                received_at,
            });
            startup_cached = true;
        }
        if startup_cached {
            report_ready(state);
        }
        return;
    }

    let Some(pts) = resolve_buffer_pts(&mut buffer, state, paused_ns) else {
        return;
    };
    let cursor = buffer
        .find_meta::<MetaCursor>()
        .and_then(|cursor| observe_cursor(cursor, state));
    let media_pts = push_video_frame(&mut buffer, pts, paused_ns, state).unwrap_or(pts);
    state.pts_clock.observe_active(media_pts);
    state.last_media_pts.set(Some(media_pts));
    if let Some(cursor) = cursor {
        record_cursor_metadata(cursor, media_pts, paused_ns, state);
    }
}

fn resolve_buffer_pts(
    buffer: &mut pw::buffer::Buffer,
    state: &mut CaptureState,
    paused_ns: i64,
) -> Option<i64> {
    if let Some(pts) = state.last_media_pts.get() {
        state.pts_clock.observe_active(pts);
    }
    if let Ok(timeline) = state.timeline.lock()
        && let (Some(first_pts), Some(last_pts)) = (timeline.first_pts, timeline.last_pts)
    {
        state
            .pts_clock
            .observe_active(first_pts.saturating_add(last_pts));
    }
    let raw_pts = buffer.find_meta::<MetaHeader>().map_or(0, MetaHeader::pts);
    let anchor = existing_anchor(state);
    state
        .pts_clock
        .resolve_active(raw_pts, paused_ns, anchor, Instant::now())
}

enum CursorObservation {
    Hidden,
    Updated {
        key: CursorKey,
        snapshot: Option<CursorSnapshot>,
    },
}

fn observe_cursor(cursor: &MetaCursor, state: &mut CaptureState) -> Option<CursorObservation> {
    state.cursor_meta_count += 1;
    if cursor.id() == 0 {
        let _ = cache_cursor(cursor, state);
        return Some(CursorObservation::Hidden);
    }
    let position = cursor.position();
    let hotspot = cursor.hotspot();
    let bitmap = cursor.bitmap().map(|bitmap| {
        (
            bitmap.format().as_raw(),
            bitmap.size().width,
            bitmap.size().height,
            bitmap.stride(),
        )
    });

    let key = (
        cursor.id(),
        position.x,
        position.y,
        hotspot.x,
        hotspot.y,
        bitmap,
    );
    if state.last == Some(key) && bitmap.is_none() {
        return None;
    }

    let snapshot = cache_cursor(cursor, state);
    Some(CursorObservation::Updated { key, snapshot })
}

fn record_cursor_metadata(
    cursor: CursorObservation,
    pts: i64,
    paused_ns: i64,
    state: &mut CaptureState,
) {
    let CursorObservation::Updated { key, snapshot } = cursor else {
        state.last = None;
        let _ = record_cursor_sample(state, pts, paused_ns, None);
        return;
    };
    if record_cursor_sample(state, pts, paused_ns, snapshot) {
        state.last = Some(key);
    }

    let Some(snapshot) = snapshot else {
        return;
    };
    let cursor_type = snapshot.cursor_type;

    if state.current_type != Some(cursor_type) {
        state.current_type = Some(cursor_type);
        if state.config.print_events {
            println!("STATE:{cursor_type}");
            let _ = std::io::stdout().flush();
        }
    }

    if state.config.print_events {
        let (id, x, y, hotspot_x, hotspot_y, bitmap) = key;
        let bitmap_text = match bitmap {
            None => "-".to_owned(),
            Some((format, width, height, stride)) => {
                format!("{width}x{height}@{format:#010x}+{stride}")
            }
        };
        println!("CURSOR:{pts}:{x}:{y}:{id}:{hotspot_x}:{hotspot_y}:{bitmap_text}");
        let _ = std::io::stdout().flush();
    }
}

fn append_zoom_marker(
    samples: &mut Vec<telemetry::RawSample>,
    last_marker_at: &Cell<Option<Instant>>,
    anchor: Anchor,
    cursor: CursorSnapshot,
    instant: Instant,
    paused_ns: i64,
) {
    if last_marker_at
        .get()
        .is_some_and(|last| instant.saturating_duration_since(last) < Duration::from_millis(500))
    {
        return;
    }
    samples.push(telemetry::RawSample {
        pts_ns: anchor.input_pts_ns(instant, paused_ns),
        cx: cursor.position.0,
        cy: cursor.position.1,
        cursor_type: None,
        cursor_visible: None,
        interaction_type: Some("manual-zoom".to_owned()),
        mouse_button: None,
    });
    last_marker_at.set(Some(instant));
}

fn record_cursor_sample(
    state: &CaptureState,
    pts_ns: i64,
    paused_ns: i64,
    cursor: Option<CursorSnapshot>,
) -> bool {
    // For video captures, wait for the encoded timeline before publishing cursor state.
    if state.config.video.is_none() {
        let _ = ensure_anchor(&state.anchor, pts_ns, paused_ns);
    } else if existing_anchor(state).is_none() {
        return false;
    }
    append_cursor_sample(&state.raw_samples, &state.recorded_cursor, pts_ns, cursor);
    true
}

fn append_cursor_sample(
    samples: &Mutex<Vec<telemetry::RawSample>>,
    recorded_cursor: &Cell<RecordedCursor>,
    pts_ns: i64,
    cursor: Option<CursorSnapshot>,
) {
    let mut recorded = recorded_cursor.get();
    if let Some(sample) = recorded.sample(pts_ns, cursor)
        && let Ok(mut collected) = samples.lock()
    {
        collected.push(sample);
        recorded_cursor.set(recorded);
    }
}

fn normalize_raw_cursor(
    raw: Option<RawCursorState>,
    rect: Option<geometry::Rect>,
    space: geometry::PositionSpace,
) -> Option<CursorSnapshot> {
    let raw = raw?;
    let rect = rect?;
    let position = geometry::normalize_to_stream(raw.position, rect, space)?;
    Some(CursorSnapshot {
        position,
        cursor_type: raw.cursor_type,
    })
}

fn cache_cursor(cursor: &MetaCursor, state: &mut CaptureState) -> Option<CursorSnapshot> {
    let history = Arc::clone(&state.cursor_history);
    // Publish the observation before an input reader can look up this time.
    let mut history = history.lock().ok();
    let observed_at = Instant::now();
    if cursor.id() == 0 {
        state.last_raw_cursor = None;
    } else {
        let cursor_type = resolve_cursor_type(cursor, state);
        let position = cursor.position();
        state.last_raw_cursor = cursor_type.map(|cursor_type| RawCursorState {
            position: (position.x, position.y),
            cursor_type,
        });
    }
    let rect = normalization_rect(state);
    let snapshot = normalize_raw_cursor(state.last_raw_cursor, rect, state.config.position_space);
    if let Some(history) = history.as_mut() {
        history.record(observed_at, snapshot);
    }
    snapshot
}

fn resolve_cursor_type(cursor: &MetaCursor, state: &mut CaptureState) -> Option<&'static str> {
    if let Some(bitmap) = cursor.bitmap() {
        if bitmap.size().width == 0 || bitmap.size().height == 0 {
            // An empty bitmap clears the sprite. Position-only updates retain that state.
            state.type_by_cursor_id.insert(cursor.id(), None);
        } else if let Some(decoded) = decode_spa_bitmap(
            bitmap,
            cursor.hotspot(),
            state.config.export_bitmap.as_deref(),
            cursor.id(),
        ) {
            let classified = cursor_shape::classify(&decoded, &state.theme).unwrap_or("arrow");
            state
                .type_by_cursor_id
                .insert(cursor.id(), Some(classified));
        }
    }
    state
        .type_by_cursor_id
        .get(&cursor.id())
        .copied()
        .unwrap_or(Some("arrow"))
}

fn decode_spa_bitmap(
    bitmap: &MetaBitmap,
    hotspot: spa::utils::Point,
    export_dir: Option<&Path>,
    id: u32,
) -> Option<cursor_shape::DecodedCursor> {
    let format = cursor_shape::PixelFormat::from_spa(bitmap.format().as_raw())?;
    let data = bitmap.bitmap_data()?;
    let decoded = cursor_shape::decode_bitmap(
        format,
        bitmap.size().width,
        bitmap.size().height,
        bitmap.stride(),
        hotspot.x,
        hotspot.y,
        data,
    )?;
    if let Some(dir) = export_dir {
        let _ = export_ppm(dir, id, &decoded);
    }
    Some(decoded)
}

fn export_ppm(dir: &Path, id: u32, cursor: &cursor_shape::DecodedCursor) -> std::io::Result<()> {
    fs::create_dir_all(dir)?;
    let path = dir.join(format!(
        "cursor-{id}-{}x{}.ppm",
        cursor.width, cursor.height
    ));
    let mut data = format!("P6\n{} {}\n255\n", cursor.width, cursor.height).into_bytes();
    data.reserve(cursor.rgba.len() / 4 * 3);
    for pixel in cursor.rgba.chunks_exact(4) {
        data.extend_from_slice(&[pixel[0], pixel[1], pixel[2]]);
    }
    fs::write(path, data)
}

fn epoch_now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |duration| {
            i64::try_from(duration.as_millis()).unwrap_or(i64::MAX)
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writes_manual_zoom_at_the_cursor_on_the_recording_timeline() {
        let start = Instant::now();
        let anchor = Anchor {
            pts_ns: 1_000_000_000,
            paused_ns: 3_000_000_000,
            epoch_ms: 1000,
            instant: start,
        };
        let cursor = CursorSnapshot {
            position: (0.25, 0.75),
            cursor_type: "arrow",
        };
        let last = Cell::new(None);
        let mut samples = Vec::new();

        for wall_ms in [3000, 3250, 3500] {
            append_zoom_marker(
                &mut samples,
                &last,
                anchor,
                cursor,
                start + Duration::from_millis(wall_ms),
                5_000_000_000,
            );
        }

        assert_eq!(samples.len(), 2);
        assert_eq!(samples[0].pts_ns, 2_000_000_000);
        assert_eq!(samples[1].pts_ns, 2_500_000_000);
        assert_eq!((samples[0].cx, samples[0].cy), cursor.position);
        assert_eq!(samples[0].interaction_type.as_deref(), Some("manual-zoom"));
        assert_eq!(samples[0].mouse_button, None);
    }

    #[test]
    fn parses_keepalive_interval_allowing_zero_and_rejecting_overflow() {
        assert_eq!(parse_keepalive_interval_ns("0"), 0);
        assert_eq!(parse_keepalive_interval_ns(" 50 "), 50_000_000);
        assert_eq!(parse_keepalive_interval_ns("-5"), FRAME_INTERVAL_NS);
        assert_eq!(
            parse_keepalive_interval_ns("9223372036855"),
            FRAME_INTERVAL_NS
        );
        assert_eq!(parse_keepalive_interval_ns("invalid"), FRAME_INTERVAL_NS);
    }

    #[test]
    fn validates_pipewire_chunk_bounds_and_wraps_offset() {
        let layout = FrameLayout {
            width: 4,
            height: 2,
            bytes_per_pixel: 4,
        };
        let mapped = vec![7u8; 32];

        // Short chunk carrying only one row (16 bytes out of 32) is rejected.
        assert!(slice_valid_frame(&mapped, 0, 16, 16, layout).is_none());

        // offset == mapped.len() wraps modulo capacity to 0 cleanly.
        let (wrapped, stride) = slice_valid_frame(&mapped, 32, 32, 16, layout).unwrap();
        assert_eq!(wrapped.len(), 32);
        assert_eq!(stride, 16);

        // Padded-stride frame fits cleanly when valid chunk covers last row's pixels.
        let padded = vec![9u8; 24 + 16];
        let (sliced, padded_stride) = slice_valid_frame(&padded, 0, 40, 24, layout).unwrap();
        assert_eq!(sliced.len(), 40);
        assert_eq!(padded_stride, 24);
    }

    #[test]
    fn computes_active_timeline_pts_across_pauses() {
        let start = Instant::now();
        let anchor = Anchor {
            pts_ns: 5_000_000_000,
            paused_ns: 3_000_000_000,
            epoch_ms: 1_700_000_000_000,
            instant: start,
        };
        // 65s wall elapsed since anchor minus 5s newly accumulated pause = 60s active PTS.
        let pts = active_timeline_pts(
            anchor,
            5_000_000_000,
            start + Duration::from_secs(65),
            8_000_000_000,
            10_000_000_000,
        );
        assert_eq!(pts, 60_000_000_000);

        // Stays strictly monotonic even if last_pts is ahead of active elapsed.
        let clamped = active_timeline_pts(
            anchor,
            5_000_000_000,
            start + Duration::from_millis(5),
            3_000_000_000,
            10_000_000,
        );
        assert_eq!(clamped, 11_000_000);
    }

    #[test]
    fn pts_clock_keeps_consistent_monotonic_origin_when_header_pts_is_missing() {
        let t0 = Instant::now();
        let mut fallback = PtsClock::default();
        let paused_raw = fallback.resolve_raw(0, t0).unwrap();
        assert_eq!(paused_raw, 1_000_000_000);

        // Even if a later buffer carries a large header PTS, origin does not jump.
        let active1 = fallback.resolve_active(
            9_000_000_000_000,
            2_000_000_000,
            None,
            t0 + Duration::from_millis(2_500),
        );
        let active2 =
            fallback.resolve_active(0, 2_000_000_000, None, t0 + Duration::from_millis(2_533));
        assert_eq!(active1, Some(1_500_000_000));
        assert_eq!(active2, Some(1_533_000_000));

        // When header PTS is present initially, missing subsequent headers interpolate from anchor.
        let mut header = PtsClock::default();
        assert_eq!(
            header.resolve_active(4_000_000_000, 0, None, t0),
            Some(4_000_000_000)
        );
        let anchor = Anchor {
            pts_ns: 4_000_000_000,
            paused_ns: 0,
            epoch_ms: 1_700_000_000_000,
            instant: t0,
        };
        assert_eq!(
            header.resolve_active(0, 0, Some(anchor), t0 + Duration::from_millis(50)),
            Some(4_050_000_000)
        );
    }

    #[test]
    fn preserves_explicit_start_epoch_and_writes_measured_when_unset() {
        let unset = AtomicI64::new(0);
        let anchor_unset = Mutex::new(None);
        report_video_started(&anchor_unset, &unset, 1_000_000_000, 0);
        assert!(unset.load(Ordering::SeqCst) > 0);

        let explicit = AtomicI64::new(1_700_000_000_555);
        let anchor_explicit = Mutex::new(None);
        report_video_started(&anchor_explicit, &explicit, 1_000_000_000, 0);
        assert_eq!(explicit.load(Ordering::SeqCst), 1_700_000_000_555);
    }

    #[test]
    fn buffered_input_uses_the_pause_state_at_its_original_time() {
        let origin = Instant::now();
        let at = |millis| origin + Duration::from_millis(millis);
        let mut pause = PauseState::default();
        pause.set_paused_at(true, at(200));
        pause.set_paused_at(false, at(500));
        pause.set_paused_at(true, at(700));
        pause.set_paused_at(false, at(900));
        pause.set_paused_at(true, at(1100));

        assert_eq!(pause.snapshot(), (true, 500_000_000));
        assert_eq!(pause.timing_at(at(199)), (false, 0));
        assert_eq!(pause.timing_at(at(200)), (true, 0));
        assert_eq!(pause.timing_at(at(400)), (true, 200_000_000));
        assert_eq!(pause.timing_at(at(500)), (false, 300_000_000));
        assert_eq!(pause.timing_at(at(750)), (true, 350_000_000));
        assert_eq!(pause.timing_at(at(1000)), (false, 500_000_000));
        assert_eq!(pause.timing_at(at(1200)), (true, 600_000_000));
    }

    #[test]
    fn pts_clock_keeps_visibility_order_when_delayed_header_pts_returns() {
        let t0 = Instant::now();
        let mut clock = PtsClock::default();
        let show1_pts = clock.resolve_active(4_000_000_000, 0, None, t0).unwrap();
        let anchor = Anchor {
            pts_ns: show1_pts,
            paused_ns: 0,
            epoch_ms: 1_700_000_000_000,
            instant: t0,
        };
        let hide_pts = clock
            .resolve_active(0, 0, Some(anchor), t0 + Duration::from_millis(100))
            .unwrap();
        assert_eq!(hide_pts, 4_100_000_000);

        let delayed_show_pts = clock
            .resolve_active(
                4_090_000_000,
                0,
                Some(anchor),
                t0 + Duration::from_millis(110),
            )
            .unwrap();
        assert_eq!(delayed_show_pts, 4_100_000_000);

        let mut recorded = RecordedCursor::default();
        let snap = CursorSnapshot {
            position: (0.5, 0.5),
            cursor_type: "arrow",
        };
        let raw = vec![
            recorded.sample(show1_pts, Some(snap)).unwrap(),
            recorded.sample(hide_pts, None).unwrap(),
            recorded.sample(delayed_show_pts, Some(snap)).unwrap(),
        ];
        let mut resolved = telemetry::resolve_samples(&raw, anchor.pts_ns, anchor.epoch_ms, 0);
        telemetry::normalize_samples(&mut resolved);
        assert_eq!(
            resolved
                .iter()
                .map(|sample| (sample.time_ms, sample.cursor_visible))
                .collect::<Vec<_>>(),
            [(0, Some(true)), (100, Some(false)), (100, Some(true)),]
        );

        clock.observe_active(4_101_000_000);
        assert_eq!(
            clock.resolve_active(
                4_095_000_000,
                0,
                Some(anchor),
                t0 + Duration::from_millis(120),
            ),
            Some(4_101_000_000)
        );
    }

    #[test]
    fn renormalizes_cached_cursor_when_stream_size_changes() {
        let raw = Some(RawCursorState {
            position: (640, 360),
            cursor_type: "arrow",
        });

        let initial = normalize_raw_cursor(
            raw,
            geometry::stream_rect(None, Some((1280, 720))),
            geometry::PositionSpace::StreamLocal,
        )
        .unwrap();
        assert!((initial.position.0 - 0.5).abs() < f64::EPSILON);
        assert!((initial.position.1 - 0.5).abs() < f64::EPSILON);

        let resized = normalize_raw_cursor(
            raw,
            geometry::stream_rect(None, Some((1920, 1080))),
            geometry::PositionSpace::StreamLocal,
        )
        .unwrap();
        assert!((resized.position.0 - (640.0 / 1920.0)).abs() < f64::EPSILON);
        assert!((resized.position.1 - (360.0 / 1080.0)).abs() < f64::EPSILON);

        assert!(
            normalize_raw_cursor(
                raw,
                geometry::stream_rect(None, Some((0, 0))),
                geometry::PositionSpace::StreamLocal,
            )
            .is_none()
        );
    }
}
