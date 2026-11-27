use anyhow::{Context, Result, anyhow};
use gstreamer as gst;
use gstreamer::prelude::*;
use gstreamer_app as gst_app;
use std::fs::File;
use std::io::{Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

const MAX_AUDIO_BUFFERS: u32 = 64;
const SAMPLE_RATE: u32 = 48_000;
const CHANNELS: u16 = 2;
const BYTES_PER_SAMPLE: u16 = 2;
const HEADER_SIZE: u32 = 44;
const BLOCK_ALIGN: usize = (CHANNELS * BYTES_PER_SAMPLE) as usize;
const MAX_WAV_DATA_BYTES: u32 = {
    let limit = u32::MAX - (HEADER_SIZE - 8);
    let align = (CHANNELS * BYTES_PER_SAMPLE) as u32;
    limit - (limit % align)
};

pub struct AudioRecorder {
    pipeline: gst::Pipeline,
    appsink: gst_app::AppSink,
    file: File,
    data_bytes: u32,
    failed: Arc<AtomicBool>,
    bus_watch: Option<gst::bus::BusWatchGuard>,
    limit_reached: bool,
}

impl AudioRecorder {
    pub fn start(output: &Path, failed: Arc<AtomicBool>) -> Result<Self> {
        let source = gst::ElementFactory::make("pulsesrc")
            .name("system-audio")
            .property("device", "@DEFAULT_MONITOR@")
            .build()
            .context("failed to create pulsesrc")?;
        let convert = gst::ElementFactory::make("audioconvert")
            .build()
            .context("failed to create audioconvert")?;
        let resample = gst::ElementFactory::make("audioresample")
            .build()
            .context("failed to create audioresample")?;
        let capsfilter = gst::ElementFactory::make("capsfilter")
            .build()
            .context("failed to create audio capsfilter")?;
        capsfilter.set_property(
            "caps",
            gst::Caps::builder("audio/x-raw")
                .field("format", "S16LE")
                .field("rate", i32::try_from(SAMPLE_RATE).unwrap_or(i32::MAX))
                .field("channels", i32::from(CHANNELS))
                .build(),
        );
        let appsink = gst::ElementFactory::make("appsink")
            .name("system-audio-sink")
            .property("sync", false)
            .property("max-buffers", MAX_AUDIO_BUFFERS)
            .build()
            .context("failed to create appsink")?
            .downcast::<gst_app::AppSink>()
            .map_err(|_| anyhow!("audio sink is not an AppSink"))?;

        let pipeline = gst::Pipeline::new();
        pipeline.add_many([
            &source,
            &convert,
            &resample,
            &capsfilter,
            appsink.upcast_ref(),
        ])?;
        gst::Element::link_many([
            &source,
            &convert,
            &resample,
            &capsfilter,
            appsink.upcast_ref(),
        ])?;

        let bus = pipeline.bus().context("audio pipeline has no bus")?;
        let watch_failed = Arc::clone(&failed);
        let bus_watch = bus.add_watch(move |_, message| {
            if let gst::MessageView::Error(error) = message.view() {
                eprintln!(
                    "ERROR:system audio capture failed: {} ({:?})",
                    error.error(),
                    error.debug()
                );
                watch_failed.store(true, Ordering::SeqCst);
            }
            gst::glib::ControlFlow::Continue
        })?;

        if let Err(error) = pipeline.set_state(gst::State::Playing) {
            let _ = pipeline.set_state(gst::State::Null);
            drop(bus_watch);
            return Err(error).context("failed to start system audio capture");
        }
        let file = match create_wav(output) {
            Ok(file) => file,
            Err(error) => {
                let _ = pipeline.set_state(gst::State::Null);
                drop(bus_watch);
                return Err(error);
            }
        };
        Ok(Self {
            pipeline,
            appsink,
            file,
            data_bytes: 0,
            failed,
            bus_watch: Some(bus_watch),
            limit_reached: false,
        })
    }

    pub fn poll(&mut self, paused: bool) {
        for _ in 0..MAX_AUDIO_BUFFERS {
            let Some(sample) = self.appsink.try_pull_sample(gst::ClockTime::ZERO) else {
                break;
            };
            if paused || self.limit_reached || self.failed.load(Ordering::SeqCst) {
                continue;
            }
            if let Some(buffer) = sample.buffer()
                && let Ok(mapped) = buffer.map_readable()
            {
                let bytes = mapped.as_slice();
                let (to_write, hit_limit) = clamp_wav_chunk_len(self.data_bytes, bytes.len());
                if to_write > 0 {
                    if let Err(error) = self.file.write_all(&bytes[..to_write]) {
                        eprintln!("ERROR:system audio write failed: {error}");
                        self.failed.store(true, Ordering::SeqCst);
                        break;
                    }
                    self.data_bytes = self
                        .data_bytes
                        .saturating_add(u32::try_from(to_write).unwrap_or(u32::MAX));
                }
                if hit_limit {
                    self.limit_reached = true;
                    eprintln!(
                        "ERROR:system audio reached 4 GiB WAV size limit; stopping audio writes"
                    );
                }
            }
        }
    }

    pub fn finish(&mut self) -> Result<()> {
        let _ = self.pipeline.set_state(gst::State::Null);
        drop(self.bus_watch.take());
        finalize_wav_file(&mut self.file, self.data_bytes)
    }
}

fn clamp_wav_chunk_len(current_data_bytes: u32, incoming_len: usize) -> (usize, bool) {
    let remaining =
        usize::try_from(MAX_WAV_DATA_BYTES.saturating_sub(current_data_bytes)).unwrap_or(0);
    if incoming_len <= remaining {
        return (incoming_len, false);
    }
    let writable = remaining - (remaining % BLOCK_ALIGN);
    (writable, true)
}

fn finalize_wav_file(file: &mut File, data_bytes: u32) -> Result<()> {
    let patch_result = patch_wav_header(file, data_bytes).context("failed to update WAV header");
    let flush_result = file.flush().context("failed to flush WAV file");
    match (patch_result, flush_result) {
        (Ok(()), Ok(())) => Ok(()),
        (Err(patch_err), Ok(())) => Err(patch_err),
        (Ok(()), Err(flush_err)) => Err(flush_err),
        (Err(patch_err), Err(flush_err)) => Err(anyhow!("{patch_err:#}; {flush_err:#}")),
    }
}

pub fn wav_path_for_video(video_path: &Path) -> PathBuf {
    video_path.with_extension("system.wav")
}

fn create_wav(path: &Path) -> Result<File> {
    let mut file =
        File::create(path).with_context(|| format!("failed to create {}", path.display()))?;
    file.write_all(&wav_header(0))?;
    Ok(file)
}

fn patch_wav_header(file: &mut File, data_bytes: u32) -> std::io::Result<()> {
    file.seek(SeekFrom::Start(4))?;
    file.write_all(&(data_bytes.saturating_add(HEADER_SIZE - 8)).to_le_bytes())?;
    file.seek(SeekFrom::Start(40))?;
    file.write_all(&data_bytes.to_le_bytes())?;
    file.seek(SeekFrom::End(0))?;
    Ok(())
}

pub fn wav_header(data_bytes: u32) -> [u8; HEADER_SIZE as usize] {
    let mut header = [0u8; HEADER_SIZE as usize];
    let byte_rate = SAMPLE_RATE * u32::from(CHANNELS) * u32::from(BYTES_PER_SAMPLE);
    let block_align = CHANNELS * BYTES_PER_SAMPLE;
    header[0..4].copy_from_slice(b"RIFF");
    header[4..8].copy_from_slice(&(data_bytes.saturating_add(HEADER_SIZE - 8)).to_le_bytes());
    header[8..12].copy_from_slice(b"WAVE");
    header[12..16].copy_from_slice(b"fmt ");
    header[16..20].copy_from_slice(&16u32.to_le_bytes());
    header[20..22].copy_from_slice(&1u16.to_le_bytes());
    header[22..24].copy_from_slice(&CHANNELS.to_le_bytes());
    header[24..28].copy_from_slice(&SAMPLE_RATE.to_le_bytes());
    header[28..32].copy_from_slice(&byte_rate.to_le_bytes());
    header[32..34].copy_from_slice(&block_align.to_le_bytes());
    header[34..36].copy_from_slice(&(BYTES_PER_SAMPLE * 8).to_le_bytes());
    header[36..40].copy_from_slice(b"data");
    header[40..44].copy_from_slice(&data_bytes.to_le_bytes());
    header
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;

    #[test]
    fn wav_header_declares_pcm_48k_stereo() {
        let header = wav_header(1000);
        assert_eq!(&header[0..4], b"RIFF");
        assert_eq!(&header[8..12], b"WAVE");
        assert_eq!(&header[12..16], b"fmt ");
        assert_eq!(u32::from_le_bytes(header[16..20].try_into().unwrap()), 16);
        assert_eq!(u16::from_le_bytes(header[20..22].try_into().unwrap()), 1);
        assert_eq!(u16::from_le_bytes(header[22..24].try_into().unwrap()), 2);
        assert_eq!(
            u32::from_le_bytes(header[24..28].try_into().unwrap()),
            48_000
        );
        assert_eq!(
            u32::from_le_bytes(header[28..32].try_into().unwrap()),
            192_000
        );
        assert_eq!(u16::from_le_bytes(header[32..34].try_into().unwrap()), 4);
        assert_eq!(u16::from_le_bytes(header[34..36].try_into().unwrap()), 16);
        assert_eq!(&header[36..40], b"data");
        assert_eq!(u32::from_le_bytes(header[40..44].try_into().unwrap()), 1000);
        assert_eq!(u32::from_le_bytes(header[4..8].try_into().unwrap()), 1036);
    }

    #[test]
    fn clamp_wav_chunk_len_respects_riff_limit_and_sample_alignment() {
        assert!(MAX_WAV_DATA_BYTES.checked_add(HEADER_SIZE - 8).is_some());
        assert_eq!(MAX_WAV_DATA_BYTES % 4, 0);
        assert_eq!(clamp_wav_chunk_len(0, 1024), (1024, false));
        assert_eq!(clamp_wav_chunk_len(MAX_WAV_DATA_BYTES - 8, 16), (8, true));
        assert_eq!(clamp_wav_chunk_len(MAX_WAV_DATA_BYTES - 6, 16), (4, true));
        assert_eq!(clamp_wav_chunk_len(MAX_WAV_DATA_BYTES, 16), (0, true));
    }

    #[test]
    fn finalize_wav_file_patches_header_and_propagates_errors() {
        let temp_path = std::env::temp_dir().join(format!(
            "recordly-audio-finalize-{}.wav",
            std::process::id()
        ));
        {
            let mut file = create_wav(&temp_path).unwrap();
            file.write_all(&[1, 2, 3, 4, 5, 6, 7, 8]).unwrap();
            finalize_wav_file(&mut file, 8).unwrap();
        }

        let mut bytes = Vec::new();
        let mut readonly = File::open(&temp_path).unwrap();
        readonly.read_to_end(&mut bytes).unwrap();
        assert_eq!(bytes.len(), 52);
        assert_eq!(u32::from_le_bytes(bytes[4..8].try_into().unwrap()), 44);
        assert_eq!(u32::from_le_bytes(bytes[40..44].try_into().unwrap()), 8);

        assert!(finalize_wav_file(&mut readonly, 8).is_err());
        let _ = std::fs::remove_file(&temp_path);
    }
}
