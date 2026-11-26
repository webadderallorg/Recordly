use anyhow::{Context, Result, anyhow};
use gstreamer as gst;
use gstreamer::prelude::*;
use gstreamer_app as gst_app;
use std::fs::File;
use std::io::{Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

const SAMPLE_RATE: u32 = 48_000;
const CHANNELS: u16 = 2;
const BYTES_PER_SAMPLE: u16 = 2;
const HEADER_SIZE: u32 = 44;

pub struct AudioRecorder {
    pipeline: gst::Pipeline,
    appsink: gst_app::AppSink,
    file: File,
    data_bytes: u32,
    failed: Arc<AtomicBool>,
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
                .field("rate", SAMPLE_RATE as i32)
                .field("channels", CHANNELS as i32)
                .build(),
        );
        let appsink = gst::ElementFactory::make("appsink")
            .name("system-audio-sink")
            .property("sync", false)
            .property("max-buffers", 64u32)
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
        let _watch = bus.add_watch(move |_, message| {
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

        pipeline
            .set_state(gst::State::Playing)
            .context("failed to start system audio capture")?;
        let file = create_wav(output)?;
        Ok(Self {
            pipeline,
            appsink,
            file,
            data_bytes: 0,
            failed,
        })
    }

    pub fn poll(&mut self, paused: bool) {
        while let Some(sample) = self.appsink.try_pull_sample(gst::ClockTime::ZERO) {
            if paused {
                continue;
            }
            if let Some(buffer) = sample.buffer()
                && let Ok(mapped) = buffer.map_readable()
            {
                let bytes = mapped.as_slice();
                if self.file.write_all(bytes).is_err() {
                    self.failed.store(true, Ordering::SeqCst);
                    break;
                }
                self.data_bytes = self.data_bytes.saturating_add(bytes.len() as u32);
            }
        }
    }
    pub fn finish(&mut self) {
        let _ = self.pipeline.set_state(gst::State::Null);
        let _ = patch_wav_header(&mut self.file, self.data_bytes);
        let _ = self.file.flush();
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
    let byte_rate = SAMPLE_RATE * CHANNELS as u32 * BYTES_PER_SAMPLE as u32;
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
}
