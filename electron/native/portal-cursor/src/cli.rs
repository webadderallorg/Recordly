use clap::Parser;
use std::path::PathBuf;

#[derive(clap::ValueEnum, Clone, Copy, Debug, PartialEq, Eq)]
pub enum PositionSpaceArg {
    Global,
    StreamLocal,
}

#[derive(Parser, Debug)]
#[command(
    name = "recordly-portal-cursor",
    version,
    about = "Wayland ScreenCast portal cursor-metadata helper for Recordly"
)]
#[expect(
    clippy::struct_excessive_bools,
    reason = "CLI flags mapped directly by clap::Parser"
)]
pub struct Cli {
    #[arg(long, help = "Check xdg-desktop-portal cursor mode support and exit")]
    pub probe: bool,

    #[arg(long, help = "Print cursor metadata events to stdout")]
    pub print: bool,

    #[arg(
        long,
        value_name = "PATH",
        help = "Write cursor telemetry to PATH in Recordly's .cursor.json format"
    )]
    pub output: Option<PathBuf>,

    #[arg(
        long,
        value_name = "PATH",
        help = "Record the screen cast to a WebM or MP4 file with GStreamer using the same portal session"
    )]
    pub record_video: Option<PathBuf>,

    #[arg(
        long,
        value_name = "NAME",
        default_value = "vp8enc",
        help = "GStreamer encoder element (vp8enc, vp9enc, x264enc or openh264enc)"
    )]
    pub video_encoder: String,

    #[arg(
        long,
        value_name = "KBPS",
        default_value_t = 8000,
        help = "Target video bitrate in kbit/s"
    )]
    pub video_bitrate: u32,

    #[arg(
        long,
        help = "Record system audio to <video>.system.wav using the default sink monitor"
    )]
    pub system_audio: bool,

    #[arg(
        long,
        requires = "record_video",
        help = "Wait for resume before recording"
    )]
    pub start_paused: bool,

    #[arg(
        long,
        value_name = "MS",
        help = "Epoch milliseconds of the recording start used to align sample timestamps"
    )]
    pub start_epoch_ms: Option<i64>,

    #[arg(
        long,
        value_enum,
        value_name = "SPACE",
        help = "Cursor position space: stream-local (GNOME, physical stream pixels) or global (compositor logical coordinates)"
    )]
    pub position_space: Option<PositionSpaceArg>,

    #[arg(
        long,
        value_name = "NAME",
        help = "Cursor theme used for shape classification (defaults to the desktop theme)"
    )]
    pub cursor_theme: Option<String>,

    #[arg(
        long,
        value_name = "DIR",
        help = "Write decoded cursor bitmaps as PPM files for debugging"
    )]
    pub export_bitmap: Option<PathBuf>,

    #[arg(
        long,
        value_name = "PATH",
        help = "File used to persist the single-use portal restore token"
    )]
    pub restore_token_file: Option<PathBuf>,

    #[arg(long, help = "Do not persist the portal session between runs")]
    pub no_persist: bool,

    #[arg(long, short, help = "Verbose diagnostics on stderr")]
    pub verbose: bool,
}
