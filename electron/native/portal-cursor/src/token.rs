use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

#[must_use]
pub fn default_path() -> PathBuf {
    let base = std::env::var_os("XDG_STATE_HOME")
        .map(PathBuf::from)
        .filter(|path| path.is_absolute())
        .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".local/state")))
        .unwrap_or_else(|| PathBuf::from("."));
    base.join("recordly").join("portal-screencast.token")
}

#[must_use]
pub fn load(path: &Path) -> Option<String> {
    fs::read_to_string(path)
        .ok()
        .map(|token| token.trim().to_owned())
        .filter(|token| !token.is_empty())
}

/// Atomically writes a portal restore token to `path`.
///
/// # Errors
///
/// Returns an I/O error if creating parent directories, writing the temporary file, syncing it, or
/// renaming it into place fails.
pub fn store(path: &Path, token: &str) -> std::io::Result<()> {
    if let Some(parent) = path.parent()
        && !parent.as_os_str().is_empty()
    {
        fs::create_dir_all(parent)?;
    }
    let (temporary, mut file) = create_unique_temp_file(path)?;
    let write_result = (|| -> std::io::Result<()> {
        writeln!(file, "{token}")?;
        file.sync_all()?;
        Ok(())
    })();
    if let Err(error) = write_result {
        let _ = fs::remove_file(&temporary);
        return Err(error);
    }
    drop(file);
    if let Err(error) = fs::rename(&temporary, path) {
        let _ = fs::remove_file(&temporary);
        return Err(error);
    }
    Ok(())
}

fn create_unique_temp_file(destination: &Path) -> std::io::Result<(PathBuf, fs::File)> {
    let parent = destination
        .parent()
        .filter(|dir| !dir.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    let pid = std::process::id();
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |duration| duration.as_nanos());
    for attempt in 0..32u32 {
        let candidate = parent.join(format!(".portal-token.{pid}.{nanos}.{attempt}.tmp"));
        let mut options = fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        match options.open(&candidate) {
            Ok(file) => return Ok((candidate, file)),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
            Err(error) => return Err(error),
        }
    }
    Err(std::io::Error::new(
        std::io::ErrorKind::AlreadyExists,
        "failed to create a unique temporary restore-token file",
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stores_and_loads_token_privately_without_clobbering_sibling_tmp() {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |duration| duration.as_nanos());
        let dir =
            std::env::temp_dir().join(format!("recordly-token-{}-{nanos}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let sibling_tmp = dir.join("portal.token.tmp");
        fs::write(&sibling_tmp, "keep-me\n").unwrap();

        let target = dir.join("portal.token");
        store(&target, "secret-restore-token").unwrap();
        assert_eq!(load(&target).as_deref(), Some("secret-restore-token"));
        assert_eq!(fs::read_to_string(&sibling_tmp).unwrap(), "keep-me\n");

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = fs::metadata(&target).unwrap().permissions().mode() & 0o777;
            assert_eq!(mode, 0o600);
        }

        let _ = fs::remove_dir_all(&dir);
    }
}
