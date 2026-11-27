mod audio;
mod cli;
mod clicks;
mod pipewire_capture;
mod portal;
mod video;

use anyhow::{Context, Result};
use ashpd::desktop::{ResponseError, screencast::CursorMode};
use clap::Parser;
use cli::{Cli, PositionSpaceArg};
use pipewire_capture::{CaptureConfig, Command};
use recordly_portal_cursor::{geometry, token};
use std::io::{BufRead, Write};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::AtomicI64;

enum StdinCommand {
    Stop,
    Pause,
    Resume,
    MarkZoom,
}

fn main() {
    let cli = Cli::parse();

    let runtime = match tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
    {
        Ok(runtime) => runtime,
        Err(error) => {
            eprintln!("ERROR:failed to build the tokio runtime: {error}");
            std::process::exit(1);
        }
    };

    match runtime.block_on(run(&cli)) {
        Ok(code) => std::process::exit(code),
        Err(error)
            if matches!(
                error.downcast_ref::<ashpd::Error>(),
                Some(ashpd::Error::Response(ResponseError::Cancelled))
            ) =>
        {
            std::process::exit(4);
        }
        Err(error) => {
            eprintln!("ERROR:{error:#}");
            std::process::exit(1);
        }
    }
}

async fn run(cli: &Cli) -> Result<i32> {
    let modes = portal::available_cursor_modes().await?;
    let metadata_supported = modes & (CursorMode::Metadata as u32) != 0;

    if cli.probe {
        println!(
            "CAPABILITY:cursor-modes={modes} metadata={} protocol=3",
            u8::from(metadata_supported)
        );
        let _ = std::io::stdout().flush();
        return Ok(if metadata_supported { 0 } else { 3 });
    }

    if !metadata_supported {
        println!("CAPABILITY:cursor-modes={modes} metadata=0");
        let _ = std::io::stdout().flush();
        eprintln!("ERROR:compositor does not offer the cursor Metadata mode");
        return Ok(3);
    }

    if cli.system_audio && cli.record_video.is_none() {
        eprintln!("ERROR:--system-audio requires --record-video");
        return Ok(1);
    }

    let telemetry_output = resolve_telemetry_output(cli);
    if let Err(message) = validate_output_paths(
        cli.record_video.as_deref(),
        telemetry_output.as_deref(),
        cli.system_audio,
    ) {
        eprintln!("ERROR:{message}");
        return Ok(1);
    }

    let connected = connect_portal(cli).await?;
    let stream = connected
        .streams
        .first()
        .cloned()
        .context("the portal returned no streams")?;

    if connected.streams.len() > 1 && cli.verbose {
        eprintln!(
            "[portal] {} streams returned; using node {}",
            connected.streams.len(),
            stream.node_id
        );
    }

    let stream_rect = geometry::stream_rect(stream.position, stream.size);
    let position_space = resolve_cli_position_space(cli);
    print_stream_banner(&stream, position_space);

    let start_epoch = Arc::new(AtomicI64::new(cli.start_epoch_ms.unwrap_or(0)));
    let (video_finished_tx, mut video_finished) = tokio::sync::oneshot::channel();
    let video_handle = spawn_video_recorder(cli, video_finished_tx)?;

    let config = CaptureConfig {
        node_id: stream.node_id,
        stream_rect,
        start_paused: cli.start_paused,
        position_space,
        start_epoch_ms: Arc::clone(&start_epoch),
        output: telemetry_output,
        cursor_theme: cli.cursor_theme.clone(),
        export_bitmap: cli.export_bitmap.clone(),
        video: video_handle.clone(),
        print_events: cli.print,
        verbose: cli.verbose,
    };
    let (capture_finished_tx, mut capture_finished) = tokio::sync::oneshot::channel();
    let (sender, handle) = pipewire_capture::spawn(connected.fd, config, capture_finished_tx)?;

    let stdin_commands = forward_stdin_commands(&sender);
    let interrupted = tokio::select! {
        result = tokio::signal::ctrl_c() => {
            result.context("failed to listen for Ctrl-C")?;
            false
        }
        () = stdin_commands => false,
        _ = &mut capture_finished => true,
        _ = &mut video_finished, if video_handle.is_some() => true,
    };

    if cli.verbose {
        eprintln!("[main] stopping capture");
    }

    let _ = sender.send(Command::Quit);
    let mut failed = interrupted;
    match handle.join() {
        Ok(Ok(())) => {}
        Ok(Err(error)) => {
            eprintln!("ERROR:pipewire capture failed: {error:#}");
            failed = true;
        }
        Err(_) => {
            eprintln!("ERROR:the pipewire capture thread panicked");
            failed = true;
        }
    }

    if let Some(video_handle) = video_handle
        && let Err(error) = video_handle.stop()
    {
        eprintln!("ERROR:video capture failed: {error:#}");
        failed = true;
    }

    connected.session.close().await.ok();
    Ok(i32::from(failed))
}

async fn connect_portal(cli: &Cli) -> Result<portal::Connected> {
    let token_path = cli
        .restore_token_file
        .clone()
        .unwrap_or_else(token::default_path);
    let restore_token = if cli.no_persist {
        None
    } else {
        token::load(&token_path)
    };

    if cli.verbose {
        eprintln!(
            "[portal] restore token: {}",
            if restore_token.is_some() {
                "present"
            } else {
                "none"
            }
        );
    }

    let connected = portal::connect(CursorMode::Metadata, restore_token, !cli.no_persist).await?;

    if !cli.no_persist
        && let Some(value) = connected.restore_token.as_deref()
        && let Err(error) = token::store(&token_path, value)
    {
        eprintln!(
            "[portal] failed to write the restore token to {}: {error}",
            token_path.display()
        );
    }

    Ok(connected)
}

fn normalize_comparison_path(path: &Path) -> PathBuf {
    let absolute = if path.is_absolute() {
        path.to_path_buf()
    } else if let Ok(cwd) = std::env::current_dir() {
        cwd.join(path)
    } else {
        path.to_path_buf()
    };
    if let Ok(canonical) = std::fs::canonicalize(&absolute) {
        return canonical;
    }
    let resolved = if let (Some(parent), Some(file_name)) =
        (absolute.parent(), absolute.file_name())
        && let Ok(canonical_parent) = std::fs::canonicalize(parent)
    {
        canonical_parent.join(file_name)
    } else {
        absolute
    };
    let mut normalized = PathBuf::new();
    for component in resolved.components() {
        match component {
            std::path::Component::CurDir => {}
            std::path::Component::ParentDir => {
                if matches!(
                    normalized.components().next_back(),
                    Some(std::path::Component::Normal(_))
                ) {
                    normalized.pop();
                } else if !normalized.is_absolute() {
                    normalized.push(component);
                }
            }
            _ => normalized.push(component),
        }
    }
    normalized
}

fn paths_collide(left: &Path, right: &Path) -> bool {
    normalize_comparison_path(left) == normalize_comparison_path(right)
}

fn validate_output_paths(
    video_path: Option<&Path>,
    telemetry_path: Option<&Path>,
    system_audio: bool,
) -> std::result::Result<(), &'static str> {
    let audio_path = video_path
        .filter(|_| system_audio)
        .map(audio::wav_path_for_video);
    if let (Some(video), Some(telemetry)) = (video_path, telemetry_path)
        && paths_collide(video, telemetry)
    {
        return Err("--output cannot match --record-video");
    }
    if let (Some(audio), Some(telemetry)) = (audio_path.as_deref(), telemetry_path)
        && paths_collide(audio, telemetry)
    {
        return Err("--output cannot match --system-audio output");
    }
    if let (Some(video), Some(audio)) = (video_path, audio_path.as_deref())
        && paths_collide(video, audio)
    {
        return Err("--record-video cannot match --system-audio output");
    }
    Ok(())
}

fn resolve_cli_position_space(cli: &Cli) -> geometry::PositionSpace {
    let requested = cli.position_space.map(|space| match space {
        PositionSpaceArg::Global => geometry::PositionSpace::Global,
        PositionSpaceArg::StreamLocal => geometry::PositionSpace::StreamLocal,
    });
    geometry::resolve_space(requested)
}

fn print_stream_banner(stream: &portal::StreamInfo, position_space: geometry::PositionSpace) {
    let (width, height) = stream.size.unwrap_or((0, 0));
    let (x, y) = stream.position.unwrap_or((0, 0));
    println!(
        "STREAM:node={}:id={}:source={:?}:size={}x{}:position={},{}:space={:?}",
        stream.node_id,
        stream.id.as_deref().unwrap_or("-"),
        stream.source_type,
        width,
        height,
        x,
        y,
        position_space
    );
    let _ = std::io::stdout().flush();
}

fn resolve_telemetry_output(cli: &Cli) -> Option<std::path::PathBuf> {
    match (&cli.record_video, &cli.output) {
        (_, Some(output)) => Some(output.clone()),
        (Some(video_path), None) => Some(
            video_path.with_extension(
                match video_path
                    .extension()
                    .and_then(|extension| extension.to_str())
                {
                    Some(extension) => format!("{extension}.cursor.json"),
                    None => "cursor.json".to_owned(),
                },
            ),
        ),
        (None, None) => None,
    }
}

fn spawn_video_recorder(
    cli: &Cli,
    finished: tokio::sync::oneshot::Sender<()>,
) -> Result<Option<Arc<video::VideoHandle>>> {
    match &cli.record_video {
        Some(video_path) => Ok(Some(Arc::new(video::spawn(
            video::VideoConfig {
                output: video_path.clone(),
                encoder: cli.video_encoder.clone(),
                bitrate_kbps: cli.video_bitrate,
                system_audio: cli.system_audio,
                start_paused: cli.start_paused,
                verbose: cli.verbose,
            },
            finished,
        )?))),
        None => Ok(None),
    }
}

async fn forward_stdin_commands(sender: &pipewire::channel::Sender<Command>) {
    let (stdin_tx, mut stdin_rx) = tokio::sync::mpsc::unbounded_channel::<StdinCommand>();
    std::thread::Builder::new()
        .name("recordly-stdin-commands".into())
        .spawn(move || {
            let stdin = std::io::stdin();
            for line in stdin.lock().lines().map_while(Result::ok) {
                let command = match line.trim().to_ascii_lowercase().as_str() {
                    "stop" | "quit" => StdinCommand::Stop,
                    "pause" => StdinCommand::Pause,
                    "resume" => StdinCommand::Resume,
                    "mark-zoom" => StdinCommand::MarkZoom,
                    _ => continue,
                };
                let stop = matches!(command, StdinCommand::Stop);
                if stdin_tx.send(command).is_err() || stop {
                    break;
                }
            }
        })
        .ok();

    while let Some(command) = stdin_rx.recv().await {
        let forwarded = match command {
            StdinCommand::Stop => return,
            StdinCommand::Pause => Command::Pause,
            StdinCommand::Resume => Command::Resume,
            StdinCommand::MarkZoom => Command::MarkZoom,
        };
        let _ = sender.send(forwarded);
    }
    std::future::pending::<()>().await;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_colliding_video_and_telemetry_paths() {
        let dir = std::env::temp_dir().join(format!("recordly-paths-{}", std::process::id()));
        assert!(paths_collide(
            &dir.join("capture.webm"),
            &dir.join("capture.webm")
        ));
        assert!(paths_collide(
            &dir.join("./sub/../capture.webm"),
            &dir.join("capture.webm")
        ));
        assert!(!paths_collide(
            &dir.join("capture.webm"),
            &dir.join("capture.webm.cursor.json")
        ));
    }

    #[test]
    fn rejects_telemetry_paths_colliding_with_video_or_system_audio() {
        let dir = std::env::temp_dir().join(format!("recordly-outputs-{}", std::process::id()));
        let video = dir.join("capture.webm");
        let audio = dir.join("capture.system.wav");
        let telemetry = dir.join("capture.webm.cursor.json");

        assert!(validate_output_paths(Some(&video), Some(&video), false).is_err());
        assert!(validate_output_paths(Some(&video), Some(&audio), true).is_err());
        assert!(
            validate_output_paths(
                Some(&video),
                Some(&dir.join("./sub/../capture.system.wav")),
                true
            )
            .is_err()
        );
        assert!(validate_output_paths(Some(&video), Some(&audio), false).is_ok());
        assert!(validate_output_paths(Some(&video), Some(&telemetry), true).is_ok());
    }
}
