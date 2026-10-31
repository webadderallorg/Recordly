CREATE TABLE IF NOT EXISTS recording_uploads (share_code TEXT PRIMARY KEY REFERENCES videos(share_code) ON DELETE CASCADE, upload_id TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS recording_locks (share_code TEXT PRIMARY KEY, token TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')));
