use crate::video::VideoHandle;
use anyhow::{Context, Result};
use pipewire as pw;
use pw::properties::properties;
use pw::spa;
use pw::spa::buffer::meta::{MetaBitmap, MetaCursor, MetaHeader};
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
}

#[derive(Clone, Copy)]
pub(crate) struct Anchor {
    pub pts_ns: i64,
    pub paused_ns: i64,
    pub epoch_ms: i64,
    pub instant: Instant,
}

#[derive(Default)]
pub(crate) struct PauseState {
    paused: bool,
    accumulated_ns: i64,
    pause_started: Option<std::time::Instant>,
}

impl PauseState {
    pub(crate) fn pause(&mut self) {
        if !self.paused {
            self.paused = true;
            self.pause_started = Some(Instant::now());
        }
    }

    fn resume(&mut self) {
        if self.paused {
            if let Some(started) = self.pause_started.take() {
                self.accumulated_ns += duration_to_ns(started.elapsed());
            }
            self.paused = false;
        }
    }

    pub(crate) fn snapshot(&self) -> (bool, i64) {
        (self.paused, self.accumulated_ns)
    }

    pub(crate) fn timing_at(&self, event_time: Instant) -> (bool, i64) {
        let current_pause_ns = self.pause_started.map_or(0, |start| {
            duration_to_ns(event_time.saturating_duration_since(start))
        });
        (
            self.paused,
            self.accumulated_ns.saturating_add(current_pause_ns),
        )
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

#[derive(Clone, Copy)]
pub(crate) struct CursorSnapshot {
    pub position: (f64, f64),
    pub cursor_type: &'static str,
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
    timeline: Arc<Mutex<VideoTimeline>>,
    anchor: Arc<Mutex<Option<Anchor>>>,
    pause: Arc<Mutex<PauseState>>,
    last_cursor: Arc<Mutex<Option<CursorSnapshot>>>,
    buffer_count: u64,
    cursor_meta_count: u64,
    last: Option<CursorKey>,
}

pub fn spawn(
    fd: OwnedFd,
    config: CaptureConfig,
    finished: tokio::sync::oneshot::Sender<()>,
) -> Result<(pw::channel::Sender<Command>, JoinHandle<Result<()>>)> {
    let (sender, receiver) = pw::channel::channel::<Command>();
    let raw_samples = Arc::new(Mutex::new(Vec::<telemetry::RawSample>::new()));
    let anchor = Arc::new(Mutex::new(None::<Anchor>));
    let last_cursor = Arc::new(Mutex::new(None::<CursorSnapshot>));
    let mut pause_state = PauseState::default();
    if config.start_paused {
        pause_state.pause();
    }
    let pause = Arc::new(Mutex::new(pause_state));
    let timeline = Arc::new(Mutex::new(VideoTimeline::default()));
    let timer_frame_interval_ns = configure_keepalive_interval_ns();

    crate::clicks::start(&raw_samples, &anchor, &pause, &last_cursor, config.verbose);

    let thread_context = CaptureThreadContext {
        config,
        raw_samples,
        anchor,
        pause,
        last_cursor,
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
    last_cursor: Arc<Mutex<Option<CursorSnapshot>>>,
    timeline: Arc<Mutex<VideoTimeline>>,
    timer_frame_interval_ns: i64,
}

fn configure_keepalive_interval_ns() -> i64 {
    std::env::var("RECORDLY_PORTAL_CURSOR_KEEPALIVE_MS")
        .ok()
        .and_then(|value| value.parse::<i64>().ok())
        .filter(|millis| *millis > 0)
        .and_then(|millis| millis.checked_mul(1_000_000))
        .unwrap_or(FRAME_INTERVAL_NS)
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
        last_cursor,
        timeline,
        timer_frame_interval_ns,
    } = context;

    let verbose = config.verbose;
    let output = config.output.clone();
    let start_epoch = Arc::clone(&config.start_epoch_ms);
    let command_video = config.video.clone();
    let timer_video = config.video.clone();

    let theme_name = config
        .cursor_theme
        .clone()
        .unwrap_or_else(cursor_shape::detect_theme);
    let theme = cursor_shape::load_theme(&theme_name);
    if verbose {
        eprintln!("[shape] theme {theme_name} ({} cursor files)", theme.len());
    }

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
    let state = CaptureState {
        config,
        raw_samples: Arc::clone(&raw_samples),
        theme,
        type_by_cursor_id: HashMap::new(),
        current_type: None,
        video_size: None,
        video_format: None,
        ready: false,
        timeline: Arc::clone(&timeline),
        anchor: Arc::clone(&anchor),
        pause: Arc::clone(&pause),
        last_cursor: Arc::clone(&last_cursor),
        buffer_count: 0,
        cursor_meta_count: 0,
        last: None,
    };

    let capture_error = Rc::new(Cell::new(None));
    let listener = register_stream_listener(&stream, state, &mainloop, Rc::clone(&capture_error))?;
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
        .context("failed to connect the PipeWire stream")?;

    let resume_anchor = Arc::clone(&anchor);
    let resume_epoch = Arc::clone(&start_epoch);
    let resume_samples = Arc::clone(&raw_samples);
    let _receiver = attach_command_receiver(
        receiver,
        &mainloop,
        command_video,
        Arc::clone(&timeline),
        Arc::clone(&pause),
        move |pts, paused_ns| {
            if let Some(cursor) = last_cursor.lock().ok().and_then(|cursor| *cursor) {
                append_cursor_sample(&resume_samples, pts, cursor);
            }
            report_video_started(&resume_anchor, &resume_epoch, pts, paused_ns);
        },
    );
    let _keepalive_timer = attach_keepalive_timer(
        &mainloop,
        timer_video,
        timeline,
        pause,
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
        if (size != state.video_size || pixel_format != state.video_format)
            && let Ok(mut timeline) = state.timeline.lock()
        {
            timeline.last_frame = None;
            timeline.startup_frame = None;
        }
        state.video_size = size;
        state.video_format = pixel_format;
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

fn attach_command_receiver(
    receiver: pw::channel::Receiver<Command>,
    mainloop: &pw::main_loop::MainLoopRc,
    video: Option<Arc<VideoHandle>>,
    timeline: Arc<Mutex<VideoTimeline>>,
    pause: Arc<Mutex<PauseState>>,
    on_start: impl Fn(i64, i64) + 'static,
) -> pw::channel::AttachedReceiver<'_, Command> {
    let quit_loop = mainloop.clone();
    receiver.attach(mainloop.loop_(), move |command| match command {
        Command::Quit => {
            finalize_video(video.as_deref(), &timeline, &pause);
            quit_loop.quit();
        }
        Command::Pause => {
            if let Ok(mut state) = pause.lock() {
                state.pause();
            }
            if let Some(video) = &video {
                video.set_paused(true);
            }
            println!("PAUSED");
            let _ = std::io::stdout().flush();
        }
        Command::Resume => {
            if let Ok(mut state) = pause.lock() {
                state.resume();
                if let Some(video) = &video {
                    if let Ok(mut timeline) = timeline.lock()
                        && let Some(frame) = timeline.startup_frame.take()
                    {
                        let pts = frame
                            .raw_pts_ns
                            .saturating_add(duration_to_ns(frame.received_at.elapsed()))
                            .saturating_sub(state.accumulated_ns);
                        // Submit the latest available pixels at the resume time. A static
                        // compositor may not send another frame until something changes.
                        if let Ok(true) = queue_video_frame(video, &mut timeline, frame.buffer, pts)
                        {
                            on_start(pts, state.accumulated_ns);
                        }
                    }
                    video.set_paused(false);
                }
            }
            println!("RESUMED");
            let _ = std::io::stdout().flush();
        }
    })
}

fn attach_keepalive_timer(
    mainloop: &pw::main_loop::MainLoopRc,
    video: Option<Arc<VideoHandle>>,
    timeline: Arc<Mutex<VideoTimeline>>,
    pause: Arc<Mutex<PauseState>>,
    frame_interval_ns: i64,
    verbose: bool,
) -> pw::loop_::TimerSource<'_> {
    let timer = mainloop.loop_().add_timer(move |_| {
        let Some(video) = video.as_deref() else {
            return;
        };
        let paused = pause.lock().map_or(true, |state| state.paused);
        let Ok(mut timeline) = timeline.lock() else {
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
        let elapsed = timeline.last_push.unwrap_or_else(Instant::now).elapsed();
        if elapsed < Duration::from_nanos(interval_u64) {
            return;
        }
        let next_pts = last_pts + frame_interval_ns;
        if video.push_buffer(next_pts, &last_frame).is_ok() {
            if verbose && next_pts % (FRAME_INTERVAL_NS * 30) < FRAME_INTERVAL_NS {
                eprintln!("[video] keepalive active");
            }
            timeline.last_pts = Some(next_pts);
            timeline.last_push = Some(Instant::now());
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

fn finalize_video(
    video: Option<&VideoHandle>,
    timeline: &Arc<Mutex<VideoTimeline>>,
    pause: &Arc<Mutex<PauseState>>,
) {
    let Some(video) = video else {
        return;
    };
    let paused = pause.lock().map_or(true, |pause| pause.paused);
    if paused {
        return;
    }
    let Ok(mut timeline) = timeline.lock() else {
        return;
    };
    let Some(last_frame) = timeline.last_frame.clone() else {
        return;
    };
    let last_pts = timeline.last_pts.unwrap_or(0);
    let next_pts = last_pts + FRAME_INTERVAL_NS;
    if video.push_buffer(next_pts, &last_frame).is_ok() {
        timeline.last_pts = Some(next_pts);
        timeline.last_push = Some(Instant::now());
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

fn push_video_frame(
    buffer: &mut pw::buffer::Buffer<'_>,
    pts: i64,
    paused_ns: i64,
    state: &mut CaptureState,
) {
    let Some(video) = &state.config.video else {
        return;
    };
    let Some(frame) = get_video_frame(buffer, state) else {
        return;
    };
    let Ok(mut timeline) = state.timeline.lock() else {
        return;
    };
    match queue_video_frame(video, &mut timeline, frame, pts) {
        Ok(true) => {
            report_video_started(&state.anchor, &state.config.start_epoch_ms, pts, paused_ns)
        }
        Ok(false) => {}
        Err(error) => {
            if state.config.verbose {
                eprintln!("[video] frame push failed: {error:#}");
            }
            return;
        }
    }
    drop(timeline);
    report_ready(state);
}

fn queue_video_frame(
    video: &VideoHandle,
    timeline: &mut VideoTimeline,
    frame: crate::video::FrameBuffer,
    pts: i64,
) -> Result<bool> {
    let first = timeline.first_pts.is_none();
    let mut timeline_pts = pts - timeline.first_pts.unwrap_or(pts);
    if let Some(last_pts) = timeline.last_pts
        && timeline_pts <= last_pts
    {
        timeline_pts = last_pts + 1_000_000;
    }
    video.push_buffer(timeline_pts, &frame)?;
    if first {
        timeline.first_pts = Some(pts);
    }
    timeline.last_frame = Some(frame);
    timeline.last_pts = Some(timeline_pts);
    timeline.last_push = Some(Instant::now());
    Ok(first)
}

fn report_video_started(
    anchor: &Mutex<Option<Anchor>>,
    start_epoch: &AtomicI64,
    pts: i64,
    paused_ns: i64,
) {
    let anchor = ensure_anchor(anchor, pts, paused_ns);
    let start_epoch_ms = anchor.epoch_ms + (pts - anchor.pts_ns).div_euclid(1_000_000);
    start_epoch.store(start_epoch_ms, Ordering::SeqCst);
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

fn frame_data<'a>(
    buffer: &'a mut pw::buffer::Buffer<'_>,
    width: u32,
    height: u32,
    bytes_per_pixel: usize,
) -> Option<(&'a [u8], i32)> {
    let data = buffer.datas_mut().first_mut()?;
    let chunk = data.chunk();
    let size = chunk.size() as usize;
    let offset = chunk.offset() as usize;
    let stride = chunk.stride();
    let mapped = data.data()?;
    let row_bytes = (width as usize).checked_mul(bytes_per_pixel)?;
    let last_row = (height as usize).checked_sub(1)?;
    let row_stride = stride.unsigned_abs() as usize;
    if row_bytes == 0 || row_stride < row_bytes {
        return None;
    }
    let required = last_row.checked_mul(row_stride)?.checked_add(row_bytes)?;
    if size < required {
        return None;
    }
    Some((mapped.get(offset..offset.checked_add(required)?)?, stride))
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
        let raw_pts_ns = buffer.find_meta::<MetaHeader>().map_or(0, MetaHeader::pts);
        let received_at = Instant::now();
        if state.config.start_paused
            && raw_pts_ns > 0
            && let Ok(mut timeline) = state.timeline.lock()
            && timeline.first_pts.is_none()
            && let Some(buffer) = get_video_frame(&mut buffer, state)
        {
            // Keep only the latest countdown frame in memory. Do not encode pre-roll.
            timeline.startup_frame = Some(StartupFrame {
                buffer,
                raw_pts_ns,
                received_at,
            });
            drop(timeline);
            report_ready(state);
        }
        return;
    }

    let Some(pts) = resolve_buffer_pts(&mut buffer, state, paused_ns) else {
        return;
    };
    push_video_frame(&mut buffer, pts, paused_ns, state);
    record_cursor_metadata(&mut buffer, pts, paused_ns, state);
}

fn resolve_buffer_pts(
    buffer: &mut pw::buffer::Buffer,
    state: &CaptureState,
    paused_ns: i64,
) -> Option<i64> {
    let raw_pts = buffer.find_meta::<MetaHeader>().map_or(0, MetaHeader::pts);
    if raw_pts > 0 {
        return Some(raw_pts - paused_ns);
    }
    let anchor = existing_anchor(state)?;
    let pause_since_anchor = paused_ns.saturating_sub(anchor.paused_ns);
    Some(
        anchor.pts_ns + duration_to_ns(Instant::now().saturating_duration_since(anchor.instant))
            - pause_since_anchor,
    )
}

fn record_cursor_metadata(
    buffer: &mut pw::buffer::Buffer,
    pts: i64,
    paused_ns: i64,
    state: &mut CaptureState,
) {
    let Some(cursor) = buffer.find_meta::<MetaCursor>() else {
        return;
    };
    state.cursor_meta_count += 1;
    if cursor.id() == 0 {
        let _ = cache_cursor(cursor, state);
        state.last = None;
        return;
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
    if state.last == Some(key) {
        return;
    }
    let Some(snapshot) = cache_cursor(cursor, state) else {
        return;
    };
    state.last = Some(key);

    let cursor_type = snapshot.cursor_type;

    if state.current_type != Some(cursor_type) {
        state.current_type = Some(cursor_type);
        if state.config.print_events {
            println!("STATE:{cursor_type}");
            let _ = std::io::stdout().flush();
        }
    }

    let _ = ensure_anchor(&state.anchor, pts, paused_ns);

    append_cursor_sample(&state.raw_samples, pts, snapshot);

    if state.config.print_events {
        let bitmap_text = match bitmap {
            None => "-".to_owned(),
            Some((format, width, height, stride)) => {
                format!("{width}x{height}@{format:#010x}+{stride}")
            }
        };
        println!(
            "CURSOR:{pts}:{}:{}:{}:{}:{}:{}",
            position.x,
            position.y,
            cursor.id(),
            hotspot.x,
            hotspot.y,
            bitmap_text
        );
        let _ = std::io::stdout().flush();
    }
}

fn append_cursor_sample(
    samples: &Mutex<Vec<telemetry::RawSample>>,
    pts_ns: i64,
    cursor: CursorSnapshot,
) {
    if let Ok(mut collected) = samples.lock() {
        collected.push(telemetry::RawSample {
            pts_ns,
            cx: cursor.position.0,
            cy: cursor.position.1,
            cursor_type: Some(cursor.cursor_type.to_owned()),
            interaction_type: None,
            mouse_button: None,
        });
    }
}

fn cache_cursor(cursor: &MetaCursor, state: &mut CaptureState) -> Option<CursorSnapshot> {
    let snapshot = if cursor.id() == 0 {
        None
    } else {
        let cursor_type = resolve_cursor_type(cursor, state);
        let position = cursor.position();
        normalization_rect(state)
            .and_then(|rect| {
                geometry::normalize_to_stream(
                    (position.x, position.y),
                    rect,
                    state.config.position_space,
                )
            })
            .map(|position| CursorSnapshot {
                position,
                cursor_type,
            })
    };
    if let Ok(mut last) = state.last_cursor.lock() {
        *last = snapshot;
    }
    snapshot
}

fn resolve_cursor_type(cursor: &MetaCursor, state: &mut CaptureState) -> &'static str {
    if let Some(bitmap) = cursor.bitmap()
        && let Some(decoded) = decode_spa_bitmap(
            bitmap,
            cursor.hotspot(),
            state.config.export_bitmap.as_deref(),
            cursor.id(),
        )
    {
        let classified = cursor_shape::classify(&decoded, &state.theme);
        state.type_by_cursor_id.insert(cursor.id(), classified);
    }
    state
        .type_by_cursor_id
        .get(&cursor.id())
        .copied()
        .flatten()
        .unwrap_or("arrow")
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
