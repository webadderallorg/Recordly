use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

pub fn default_path() -> PathBuf {
    let base = std::env::var_os("XDG_STATE_HOME")
        .map(PathBuf::from)
        .filter(|path| path.is_absolute())
        .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".local/state")))
        .unwrap_or_else(|| PathBuf::from("."));
    base.join("recordly").join("portal-screencast.token")
}

pub fn load(path: &Path) -> Option<String> {
    fs::read_to_string(path)
        .ok()
        .map(|token| token.trim().to_owned())
        .filter(|token| !token.is_empty())
}

pub fn store(path: &Path, token: &str) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let temporary = path.with_extension("token.tmp");
    let mut file = fs::File::create(&temporary)?;
    writeln!(file, "{token}")?;
    file.sync_all()?;
    fs::rename(temporary, path)
}
