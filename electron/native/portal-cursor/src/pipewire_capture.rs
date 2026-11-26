use crate::video::VideoHandle;
use anyhow::{Context, Result};
use pipewire as pw;
use pw::properties::properties;
use pw::spa;
use pw::spa::buffer::meta::{MetaBitmap, MetaCursor, MetaHeader};
use recordly_portal_cursor::{cursor_shape, geometry, telemetry};
use std::collections::HashMap;
use std::fs;
use std::io::Write;
use std::os::fd::OwnedFd;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};
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
    fn pause(&mut self) {
        if !self.paused {
            self.paused = true;
            self.pause_started = Some(std::time::Instant::now());
        }
    }

    fn resume(&mut self) {
        if self.paused {
            if let Some(started) = self.pause_started.take() {
                self.accumulated_ns += started.elapsed().as_nanos() as i64;
            }
            self.paused = false;
        }
    }

    pub(crate) fn snapshot(&self) -> (bool, i64) {
        (self.paused, self.accumulated_ns)
    }
}

pub struct CaptureConfig {
    pub node_id: u32,
    pub stream_rect: geometry::Rect,
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

#[derive(Default)]
struct VideoTimeline {
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
    timeline: Arc<Mutex<VideoTimeline>>,
    anchor: Arc<Mutex<Option<Anchor>>>,
    pause: Arc<Mutex<PauseState>>,
    last_position: Arc<Mutex<Option<(f64, f64)>>>,
    cursor_visible: Arc<AtomicBool>,
    buffer_count: u64,
    cursor_meta_count: u64,
    last: Option<CursorKey>,
}

pub fn spawn(
    fd: OwnedFd,
    config: CaptureConfig,
) -> Result<(pw::channel::Sender<Command>, JoinHandle<Result<()>>)> {
    let (sender, receiver) = pw::channel::channel::<Command>();
    let raw_samples = Arc::new(Mutex::new(Vec::<telemetry::RawSample>::new()));
    let thread_samples = Arc::clone(&raw_samples);
    let anchor = Arc::new(Mutex::new(None::<Anchor>));
    let thread_anchor = Arc::clone(&anchor);
    let last_position = Arc::new(Mutex::new(None::<(f64, f64)>));
    let thread_position = Arc::clone(&last_position);
    let click_position = Arc::clone(&last_position);
    let cursor_visible = Arc::new(AtomicBool::new(false));
    let thread_visible = Arc::clone(&cursor_visible);
    let click_visible = Arc::clone(&cursor_visible);
    let pause = Arc::new(Mutex::new(PauseState::default()));
    let thread_pause = Arc::clone(&pause);
    let command_pause = Arc::clone(&pause);
    let timeline = Arc::new(Mutex::new(VideoTimeline::default()));
    let thread_timeline = Arc::clone(&timeline);
    let timer_timeline = Arc::clone(&timeline);
    let timer_pause = Arc::clone(&pause);
    let timer_video = config.video.clone();
    let timer_verbose = config.verbose;
    let timer_frame_interval_ns: i64 = std::env::var("RECORDLY_PORTAL_CURSOR_KEEPALIVE_MS")
        .ok()
        .and_then(|value| value.parse::<i64>().ok())
        .map(|millis| millis * 1_000_000)
        .unwrap_or(FRAME_INTERVAL_NS);
    let quit_video = config.video.clone();
    let command_video = config.video.clone();
    let start_epoch = Arc::clone(&config.start_epoch_ms);
    let output = config.output.clone();
    let verbose = config.verbose;

    crate::clicks::start(
        Arc::clone(&raw_samples),
        Arc::clone(&anchor),
        Arc::clone(&pause),
        click_position,
        click_visible,
        verbose,
    );

    let handle = std::thread::Builder::new()
        .name("recordly-pipewire-capture".into())
        .spawn(move || -> Result<()> {
            pw::init();

            let theme_name = config
                .cursor_theme
                .clone()
                .unwrap_or_else(cursor_shape::detect_theme);
            let theme = cursor_shape::load_theme(&theme_name);
            if verbose {
                eprintln!("[shape] theme {theme_name} ({} cursor files)", theme.len());
            }

            let mainloop = pw::main_loop::MainLoopRc::new(None)
                .context("failed to create PipeWire main loop")?;
            let context = pw::context::ContextRc::new(&mainloop, None)
                .context("failed to create PipeWire context")?;
            let core = context
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
                raw_samples: thread_samples,
                theme,
                type_by_cursor_id: HashMap::new(),
                current_type: None,
                video_size: None,
                video_format: None,
                timeline: thread_timeline,
                anchor: thread_anchor,
                pause: thread_pause,
                last_position: thread_position,
                cursor_visible: thread_visible,
                buffer_count: 0,
                cursor_meta_count: 0,
                last: None,
            };

            let listener = stream
                .add_local_listener_with_user_data(state)
                .state_changed(|_, state, old, new| {
                    if state.config.verbose {
                        eprintln!("[pw] state {old:?} -> {new:?}");
                    }
                })
                .param_changed(|stream, state, id, param| {
                    let Some(param) = param else {
                        return;
                    };
                    if id != spa::param::ParamType::Format.as_raw() {
                        return;
                    }
                    let Ok((media_type, media_subtype)) =
                        spa::param::format_utils::parse_format(param)
                    else {
                        return;
                    };
                    if media_type != spa::param::format::MediaType::Video
                        || media_subtype != spa::param::format::MediaSubtype::Raw
                    {
                        return;
                    }
                    let mut format = spa::param::video::VideoInfoRaw::default();
                    if format.parse(param).is_ok() {
                        state.video_size = Some((format.size().width, format.size().height));
                        state.video_format =
                            cursor_shape::PixelFormat::from_spa(format.format().as_raw());
                        if let (Some(video), Some(_pixel_format)) =
                            (&state.config.video, state.video_format)
                        {
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
                })
                .process(|stream, state| {
                    handle_process(stream, state);
                })
                .register()
                .context("failed to register the PipeWire stream listener")?;

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
            let values = spa::pod::serialize::PodSerializer::serialize(
                std::io::Cursor::new(Vec::new()),
                &spa::pod::Value::Object(format),
            )
            .context("failed to serialize the EnumFormat pod")?
            .0
            .into_inner();
            let pod = spa::pod::Pod::from_bytes(&values)
                .context("failed to parse the serialized EnumFormat pod")?;

            stream
                .connect(
                    spa::utils::Direction::Input,
                    Some(node_id),
                    pw::stream::StreamFlags::AUTOCONNECT | pw::stream::StreamFlags::MAP_BUFFERS,
                    &mut [pod],
                )
                .context("failed to connect the PipeWire stream")?;

            let quit_loop = mainloop.clone();
            let quit_timeline = Arc::clone(&timeline);
            let _receiver = receiver.attach(mainloop.loop_(), move |command| match command {
                Command::Quit => {
                    finalize_video(&quit_video, &quit_timeline, &command_pause);
                    quit_loop.quit();
                }
                Command::Pause => {
                    if let Ok(mut pause) = command_pause.lock() {
                        pause.pause();
                    }
                    if let Some(video) = &command_video {
                        video.set_paused(true);
                    }
                    println!("PAUSED");
                    let _ = std::io::stdout().flush();
                }
                Command::Resume => {
                    if let Ok(mut pause) = command_pause.lock() {
                        pause.resume();
                    }
                    if let Some(video) = &command_video {
                        video.set_paused(false);
                    }
                    println!("RESUMED");
                    let _ = std::io::stdout().flush();
                }
            });

            let keepalive_timer = mainloop.loop_().add_timer(move |_| {
                let Some(video) = timer_video.clone() else {
                    return;
                };
                let paused = timer_pause.lock().map(|pause| pause.paused).unwrap_or(true);
                let Ok(mut timeline) = timer_timeline.lock() else {
                    return;
                };
                if paused {
                    timeline.last_push = Some(Instant::now());
                    return;
                }
                let Some(last_frame) = timeline.last_frame.clone() else {
                    return;
                };
                if timer_frame_interval_ns <= 0 {
                    return;
                }
                let last_pts = timeline.last_pts.unwrap_or(0);
                let elapsed = timeline.last_push.unwrap_or_else(Instant::now).elapsed();
                if elapsed < Duration::from_nanos(timer_frame_interval_ns as u64) {
                    return;
                }
                let next_pts = last_pts + timer_frame_interval_ns;
                if video.push_buffer(next_pts, &last_frame).is_ok() {
                    if timer_verbose && next_pts % (FRAME_INTERVAL_NS * 30) < FRAME_INTERVAL_NS {
                        eprintln!("[video] keepalive active");
                    }
                    timeline.last_pts = Some(next_pts);
                    timeline.last_push = Some(Instant::now());
                }
            });
            let _ = keepalive_timer.update_timer(Some(TIMER_TICK), Some(TIMER_TICK));

            mainloop.run();

            drop(listener);

            if let Some(path) = output.as_deref() {
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
                let mut collected =
                    telemetry::resolve_samples(&raw, anchor_pts, anchor_epoch, start_epoch_ms);
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
            }

            Ok(())
        })
        .context("failed to spawn the PipeWire capture thread")?;

    Ok((sender, handle))
}

fn cursor_meta_size(width: i32, height: i32) -> i32 {
    let base = std::mem::size_of::<pw::spa::sys::spa_meta_cursor>()
        + std::mem::size_of::<pw::spa::sys::spa_meta_bitmap>();
    (base as i32).saturating_add(width.saturating_mul(height).saturating_mul(4))
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
    let header = std::mem::size_of::<pw::spa::sys::spa_meta_header>() as i32;

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

fn normalization_rect(state: &CaptureState) -> geometry::Rect {
    match state.config.position_space {
        geometry::PositionSpace::Global => state.config.stream_rect,
        geometry::PositionSpace::StreamLocal => {
            let (width, height) = state
                .video_size
                .map(|(width, height)| (width as i32, height as i32))
                .unwrap_or((
                    state.config.stream_rect.width,
                    state.config.stream_rect.height,
                ));
            geometry::Rect {
                x: 0,
                y: 0,
                width,
                height,
            }
        }
    }
}

fn ensure_anchor(state: &CaptureState, pts: i64, paused_ns: i64) -> Anchor {
    let mut anchor = state.anchor.lock().expect("anchor mutex poisoned");
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
    video: &Option<Arc<VideoHandle>>,
    timeline: &Arc<Mutex<VideoTimeline>>,
    pause: &Arc<Mutex<PauseState>>,
) {
    let Some(video) = video.clone() else {
        return;
    };
    let paused = pause.lock().map(|pause| pause.paused).unwrap_or(true);
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

fn push_video_frame(
    buffer: &mut pw::buffer::Buffer,
    pts: i64,
    paused_ns: i64,
    state: &mut CaptureState,
) {
    let Some(video) = state.config.video.clone() else {
        return;
    };
    let Some(frame) = extract_frame(buffer, state) else {
        return;
    };

    let Ok(mut timeline) = state.timeline.lock() else {
        return;
    };

    if timeline.first_pts.is_none() {
        timeline.first_pts = Some(pts);
        let anchor = ensure_anchor(state, pts, paused_ns);
        let start_epoch_ms = anchor.epoch_ms + (pts - anchor.pts_ns).div_euclid(1_000_000);
        state
            .config
            .start_epoch_ms
            .store(start_epoch_ms, Ordering::SeqCst);
        println!("VIDEO_START:{start_epoch_ms}");
        let _ = std::io::stdout().flush();
    }

    let first_pts = timeline.first_pts.unwrap_or(pts);
    let mut timeline_pts = pts - first_pts;
    if let Some(last_pts) = timeline.last_pts
        && timeline_pts <= last_pts
    {
        timeline_pts = last_pts + 1_000_000;
    }
    let frame_buffer = VideoHandle::frame_buffer(frame);
    let push_result = video.push_buffer(timeline_pts, &frame_buffer);
    timeline.last_frame = Some(frame_buffer);
    timeline.last_pts = Some(timeline_pts);
    timeline.last_push = Some(Instant::now());

    if let Err(error) = push_result
        && state.config.verbose
    {
        eprintln!("[video] frame push failed: {error:#}");
    }
}

fn extract_frame(buffer: &mut pw::buffer::Buffer, state: &CaptureState) -> Option<Vec<u8>> {
    let (width, height) = state.video_size?;
    let format = state.video_format?;
    let data = buffer.datas_mut().first_mut()?;
    let chunk = data.chunk();
    let size = chunk.size() as usize;
    if size == 0 {
        return None;
    }
    let offset = chunk.offset() as usize;
    let strided = chunk.stride();
    let mapped = data.data()?;

    let row_bytes = width as usize * format.bytes_per_pixel();
    let stride = strided.unsigned_abs() as usize;
    if stride < row_bytes {
        return None;
    }

    let source = if strided >= 0 && stride == row_bytes {
        let end = offset.checked_add(row_bytes.checked_mul(height as usize)?)?;
        mapped.get(offset..end)?.to_vec()
    } else {
        let mut frame = Vec::with_capacity(row_bytes * height as usize);
        for row in 0..height as usize {
            let source_row = if strided > 0 {
                row
            } else {
                height as usize - 1 - row
            };
            let start = offset.checked_add(source_row.checked_mul(stride)?)?;
            frame.extend_from_slice(mapped.get(start..start + row_bytes)?);
        }
        frame
    };

    format.to_i420(width, height, &source)
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

    let paused_ns = {
        let pause = state.pause.lock().expect("pause mutex poisoned");
        if pause.paused {
            return;
        }
        pause.accumulated_ns
    };

    let raw_pts = buffer
        .find_meta::<MetaHeader>()
        .map(|header| header.pts())
        .unwrap_or(0);
    let pts = if raw_pts > 0 {
        raw_pts - paused_ns
    } else if let Some(anchor) = existing_anchor(state) {
        let pause_since_anchor = paused_ns.saturating_sub(anchor.paused_ns);
        anchor.pts_ns
            + Instant::now()
                .saturating_duration_since(anchor.instant)
                .as_nanos() as i64
            - pause_since_anchor
    } else {
        return;
    };

    push_video_frame(&mut buffer, pts, paused_ns, state);

    let Some(cursor) = buffer.find_meta::<MetaCursor>() else {
        return;
    };
    state.cursor_meta_count += 1;
    if cursor.id() == 0 {
        state.cursor_visible.store(false, Ordering::SeqCst);
        return;
    }
    state.cursor_visible.store(true, Ordering::SeqCst);

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
    state.last = Some(key);

    let Some((cx, cy)) = geometry::normalize_to_stream(
        (position.x, position.y),
        normalization_rect(state),
        state.config.position_space,
    ) else {
        return;
    };

    if let Ok(mut last) = state.last_position.lock() {
        *last = Some((cx, cy));
    }

    let cursor_type = resolve_cursor_type(cursor, state);

    if state.current_type != Some(cursor_type) {
        state.current_type = Some(cursor_type);
        if state.config.print_events {
            println!("STATE:{cursor_type}");
            let _ = std::io::stdout().flush();
        }
    }

    let _ = ensure_anchor(state, pts, paused_ns);

    if let Ok(mut collected) = state.raw_samples.lock() {
        collected.push(telemetry::RawSample {
            pts_ns: pts,
            cx,
            cy,
            cursor_type: Some(cursor_type.to_owned()),
            interaction_type: None,
            mouse_button: None,
        });
    }

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
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}
