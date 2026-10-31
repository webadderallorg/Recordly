-- Migration 0006: salted share passwords, password brute-force tracking,
-- and the missing chapters lookup index.
-- Applied by CloudflareDeployService for token-based self-host deploys.
-- The hosted worker applies the same change at runtime (SCHEMA_VERSION 2).

ALTER TABLE videos ADD COLUMN password_salt TEXT;

CREATE INDEX IF NOT EXISTS idx_chapters_video_id ON chapters(video_id);

CREATE TABLE IF NOT EXISTS password_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    video_id INTEGER NOT NULL,
    client_ip TEXT NOT NULL,
    attempted_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_password_attempts ON password_attempts(video_id, client_ip, attempted_at);
