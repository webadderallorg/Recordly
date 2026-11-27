use anyhow::{Context, Result, anyhow, bail};
use gstreamer as gst;
use gstreamer::prelude::*;
use gstreamer_app as gst_app;
use std::io::Write;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

const STOP_DRAIN_TIMEOUT: Duration = Duration::from_secs(8);

pub struct VideoConfig {
    pub output: PathBuf,
    pub encoder: String,
    pub bitrate_kbps: u32,
    pub system_audio: bool,
    pub start_paused: bool,
    pub verbose: bool,
}

pub struct VideoHandle {
    appsrc: gst_app::AppSrc,
    stop: Arc<AtomicBool>,
    audio_pause: Arc<AtomicBool>,
    errors: Arc<Mutex<Option<String>>>,
    join: Mutex<Option<JoinHandle<Result<()>>>>,
}

pub type FrameBuffer = gst::Buffer;

impl VideoHandle {
    pub fn set_video_caps(&self, format: &str, width: u32, height: u32) {
        let caps = gst::Caps::builder("video/x-raw")
            .field("format", format)
            .field("width", i32::try_from(width).unwrap_or(i32::MAX))
            .field("height", i32::try_from(height).unwrap_or(i32::MAX))
            .field("framerate", gst::Fraction::new(30, 1))
            .build();
        self.appsrc.set_caps(Some(&caps));
    }

    pub fn set_paused(&self, paused: bool) {
        self.audio_pause.store(paused, Ordering::SeqCst);
    }

    pub fn frame_buffer(frame: Vec<u8>) -> FrameBuffer {
        gst::Buffer::from_mut_slice(frame)
    }

    pub fn push_buffer(&self, pts_ns: i64, buffer: &FrameBuffer) -> Result<()> {
        let mut buffer = buffer.clone();
        buffer.make_mut().set_pts(gst::ClockTime::from_nseconds(
            u64::try_from(pts_ns.max(0)).unwrap_or(0),
        ));
        self.appsrc
            .push_buffer(buffer)
            .map_err(|error| anyhow!("failed to push a frame to GStreamer: {error:?}"))?;
        Ok(())
    }

    pub fn stop(&self) -> Result<()> {
        self.stop.store(true, Ordering::SeqCst);
        let join = self.join.lock().ok().and_then(|mut slot| slot.take());
        if let Some(join) = join {
            join.join()
                .map_err(|_| anyhow!("video capture thread panicked"))??;
        }
        if let Ok(mut slot) = self.errors.lock()
            && let Some(message) = slot.take()
        {
            bail!("video pipeline failed: {message}");
        }
        Ok(())
    }
}

pub fn spawn(
    config: VideoConfig,
    finished: tokio::sync::oneshot::Sender<()>,
) -> Result<VideoHandle> {
    let (ready_tx, ready_rx) = mpsc::channel::<Result<gst_app::AppSrc>>();
    let stop = Arc::new(AtomicBool::new(false));
    let errors = Arc::new(Mutex::new(None));
    let audio_pause = Arc::new(AtomicBool::new(config.start_paused));

    let thread_stop = Arc::clone(&stop);
    let thread_errors = Arc::clone(&errors);
    let thread_audio_pause = Arc::clone(&audio_pause);
    let join = std::thread::Builder::new()
        .name("recordly-video-capture".into())
        .spawn(move || {
            let result = run(
                &config,
                thread_stop,
                &thread_errors,
                &thread_audio_pause,
                &ready_tx,
            );
            let _ = finished.send(());
            result
        })
        .context("failed to spawn the video capture thread")?;

    let appsrc = match ready_rx.recv_timeout(Duration::from_secs(15)) {
        Ok(Ok(appsrc)) => appsrc,
        Ok(Err(error)) => {
            let _ = join.join();
            return Err(error);
        }
        Err(error) => {
            return Err(anyhow!("video pipeline did not start: {error}"));
        }
    };

    Ok(VideoHandle {
        appsrc,
        stop,
        audio_pause,
        errors,
        join: Mutex::new(Some(join)),
    })
}

fn run(
    config: &VideoConfig,
    stop: Arc<AtomicBool>,
    errors: &Arc<Mutex<Option<String>>>,
    audio_pause: &Arc<AtomicBool>,
    ready_tx: &mpsc::Sender<Result<gst_app::AppSrc>>,
) -> Result<()> {
    if let Err(error) = gst::init() {
        let _ = ready_tx.send(Err(anyhow!("failed to initialize GStreamer: {error}")));
        return Err(anyhow!("failed to initialize GStreamer: {error}"));
    }

    let (pipeline, appsrc) = match build_pipeline(config) {
        Ok(pipeline) => pipeline,
        Err(error) => {
            let _ = ready_tx.send(Err(anyhow!("{error:#}")));
            return Err(error);
        }
    };

    let main_loop = gst::glib::MainLoop::new(None, false);
    let Some(bus) = pipeline.bus() else {
        let error = anyhow!("video pipeline has no bus");
        let _ = ready_tx.send(Err(anyhow!("{error:#}")));
        return Err(error);
    };

    let loop_handle = main_loop.clone();
    let watch_errors = Arc::clone(errors);
    let _watch = bus.add_watch_local(move |_, message| {
        match message.view() {
            gst::MessageView::Eos(_) => loop_handle.quit(),
            gst::MessageView::Error(error) => {
                if let Ok(mut slot) = watch_errors.lock() {
                    *slot = Some(format!("{} ({:?})", error.error(), error.debug()));
                }
                loop_handle.quit();
            }
            _ => {}
        }
        gst::glib::ControlFlow::Continue
    })?;

    if let Err(error) = pipeline.set_state(gst::State::Playing) {
        let error = anyhow!("failed to start the video pipeline: {error}");
        let _ = ready_tx.send(Err(anyhow!("{error:#}")));
        return Err(error);
    }

    if config.verbose {
        eprintln!("[video] recording to {}", config.output.display());
    }
    let _ = ready_tx.send(Ok(appsrc.clone()));

    let audio = start_system_audio(config);

    let timeout_appsrc = appsrc.clone();
    let timeout_audio = audio.clone();
    let timeout_audio_pause = Arc::clone(audio_pause);
    let timeout_loop = main_loop.clone();
    let timeout_errors = Arc::clone(errors);
    let mut eos_queued_at: Option<Instant> = None;
    let timer = gst::glib::timeout_add_local(Duration::from_millis(10), move || {
        if eos_queued_at.is_none()
            && let Some(audio) = &timeout_audio
            && let Ok(mut recorder) = audio.lock()
        {
            recorder.poll(timeout_audio_pause.load(Ordering::SeqCst));
        }
        if stop.load(Ordering::SeqCst) {
            let error = match eos_queued_at {
                Some(started) if started.elapsed() >= STOP_DRAIN_TIMEOUT => {
                    Some("timed out draining the encoder and muxer".to_owned())
                }
                Some(_) => None,
                None => match timeout_appsrc.end_of_stream() {
                    Ok(_) => {
                        eos_queued_at = Some(Instant::now());
                        None
                    }
                    Err(error) => Some(format!("failed to queue end-of-stream: {error:?}")),
                },
            };
            if let Some(error) = error {
                if let Ok(mut slot) = timeout_errors.lock() {
                    *slot = Some(error);
                }
                timeout_loop.quit();
            }
        }
        gst::glib::ControlFlow::Continue
    });

    main_loop.run();
    timer.remove();

    if let Some(audio) = &audio
        && let Ok(mut recorder) = audio.lock()
        && let Err(error) = recorder.finish()
    {
        eprintln!("ERROR:failed to finalize system audio: {error:#}");
    }

    let _ = pipeline.set_state(gst::State::Null);

    if config.verbose {
        eprintln!("[video] finished {}", config.output.display());
    }
    if errors.lock().is_ok_and(|slot| slot.is_none()) {
        println!("VIDEO_DONE:{}", config.output.display());
    }
    let _ = std::io::stdout().flush();
    Ok(())
}

fn start_system_audio(config: &VideoConfig) -> Option<Arc<Mutex<crate::audio::AudioRecorder>>> {
    if !config.system_audio {
        return None;
    }
    let audio_failed = Arc::new(AtomicBool::new(false));
    let audio_path = crate::audio::wav_path_for_video(&config.output);
    match crate::audio::AudioRecorder::start(&audio_path, audio_failed) {
        Ok(recorder) => {
            if config.verbose {
                eprintln!("[audio] recording to {}", audio_path.display());
            }
            Some(Arc::new(Mutex::new(recorder)))
        }
        Err(error) => {
            eprintln!("ERROR:system audio unavailable: {error:#}");
            None
        }
    }
}

fn build_pipeline(config: &VideoConfig) -> Result<(gst::Pipeline, gst_app::AppSrc)> {
    let appsrc = gst::ElementFactory::make("appsrc")
        .name("src")
        .build()
        .context("failed to create appsrc")?
        .downcast::<gst_app::AppSrc>()
        .map_err(|_| anyhow!("appsrc is not an AppSrc"))?;
    appsrc.set_format(gst::Format::Time);
    appsrc.set_is_live(false);
    appsrc.set_property("do-timestamp", false);
    appsrc.set_property("block", false);
    // Bound the upstream queue even when negotiation or a downstream sink stalls.
    if appsrc.find_property("leaky-type").is_none() {
        bail!("Wayland capture requires GStreamer 1.20 or newer");
    }
    appsrc.set_max_bytes(0);
    appsrc.set_property("max-buffers", 2u64);
    appsrc.set_property_from_str("leaky-type", "downstream");

    let queue = make("queue")?;
    queue.set_property("max-size-buffers", 4u32);
    queue.set_property("max-size-bytes", 0u32);
    queue.set_property("max-size-time", 0u64);
    queue.set_property_from_str("leaky", "downstream");
    let encoder = make(&config.encoder)
        .with_context(|| format!("unknown video encoder {}", config.encoder))?;

    let mut chain = vec![
        appsrc.clone().upcast::<gst::Element>(),
        queue,
        encoder.clone(),
    ];
    let muxer = match config.encoder.as_str() {
        "x264enc" | "openh264enc" => {
            if config.encoder == "x264enc" {
                encoder.set_property_from_str("speed-preset", "veryfast");
                encoder.set_property_from_str("tune", "zerolatency");
            }
            encoder.set_property("bitrate", config.bitrate_kbps);
            chain.push(make("h264parse")?);
            make("mp4mux")?
        }
        "vp8enc" | "vp9enc" => {
            encoder.set_property("deadline", 1i64);
            encoder.set_property("cpu-used", 8i32);
            encoder.set_property("threads", 1i32);
            encoder.set_property("lag-in-frames", 0i32);
            encoder.set_property(
                "target-bitrate",
                i32::try_from(config.bitrate_kbps.saturating_mul(1000)).unwrap_or(i32::MAX),
            );
            make("webmmux")?
        }
        other => bail!("unsupported video encoder {other}"),
    };
    let sink = make("filesink")?;
    sink.set_property("location", config.output.to_string_lossy().as_ref());
    chain.push(muxer);
    chain.push(sink);

    let pipeline = gst::Pipeline::new();
    pipeline.add_many(chain.iter())?;
    gst::Element::link_many(chain.iter())?;

    Ok((pipeline, appsrc))
}

fn make(name: &str) -> Result<gst::Element> {
    gst::ElementFactory::make(name)
        .build()
        .with_context(|| format!("failed to create GStreamer element {name}"))
}
