use anyhow::{Context, Result, bail};
use ashpd::desktop::screencast::{
    CursorMode, OpenPipeWireRemoteOptions, Screencast, SelectSourcesOptions, SourceType,
    StartCastOptions,
};
use ashpd::desktop::{CreateSessionOptions, PersistMode, Session};
use std::os::fd::OwnedFd;

#[derive(Debug, Clone)]
pub struct StreamInfo {
    pub node_id: u32,
    pub position: Option<(i32, i32)>,
    pub size: Option<(i32, i32)>,
    pub source_type: Option<SourceType>,
    pub id: Option<String>,
}

pub struct Connected {
    pub session: Session<Screencast>,
    pub streams: Vec<StreamInfo>,
    pub fd: OwnedFd,
    pub restore_token: Option<String>,
}

pub async fn available_cursor_modes() -> Result<u32> {
    let screencast = Screencast::new()
        .await
        .context("xdg-desktop-portal ScreenCast interface is unavailable")?;
    let modes = screencast
        .available_cursor_modes()
        .await
        .context("failed to read the AvailableCursorModes property")?;
    Ok(modes.bits())
}

pub async fn connect(
    cursor_mode: CursorMode,
    restore_token: Option<String>,
    persist: bool,
) -> Result<Connected> {
    let screencast = Screencast::new()
        .await
        .context("xdg-desktop-portal ScreenCast interface is unavailable")?;

    if screencast.version() < 2 {
        bail!(
            "ScreenCast portal version {} does not support cursor modes",
            screencast.version()
        );
    }

    let session = screencast
        .create_session(CreateSessionOptions::default())
        .await
        .context("CreateSession failed")?;

    let mut options = SelectSourcesOptions::default()
        .set_cursor_mode(cursor_mode)
        .set_sources(SourceType::Monitor | SourceType::Window)
        .set_multiple(false);
    if persist {
        options = options.set_persist_mode(PersistMode::ExplicitlyRevoked);
    }
    if let Some(token) = restore_token.as_deref() {
        options = options.set_restore_token(token);
    }

    screencast
        .select_sources(&session, options)
        .await
        .context("SelectSources request failed")?
        .response()
        .context("SelectSources was rejected")?;

    let response = screencast
        .start(&session, None, StartCastOptions::default())
        .await
        .context("Start request failed")?
        .response()
        .context("the ScreenCast portal did not start the selected source")?;

    let restore_token = response.restore_token().map(str::to_owned);
    let streams: Vec<StreamInfo> = response
        .streams()
        .iter()
        .map(|stream| StreamInfo {
            node_id: stream.pipe_wire_node_id(),
            position: stream.position(),
            size: stream.size(),
            source_type: stream.source_type(),
            id: stream.id().map(str::to_owned),
        })
        .collect();

    if streams.is_empty() {
        bail!("the portal returned no PipeWire streams");
    }

    let fd = screencast
        .open_pipe_wire_remote(&session, OpenPipeWireRemoteOptions::default())
        .await
        .context("OpenPipeWireRemote failed")?;

    Ok(Connected {
        session,
        streams,
        fd,
        restore_token,
    })
}
