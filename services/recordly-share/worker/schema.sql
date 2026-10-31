-- Recordly Share — consolidated D1 schema (based on Voom, through migration 0009).
-- Keep in sync with SCHEMA_STATEMENTS in src/schema.js (the runtime source of
-- truth for fresh databases). Statements are idempotent so this file is safe
-- to re-apply to an existing database; the numbered files in migrations/
-- exist for upgrading databases created from an older schema.sql.

CREATE TABLE IF NOT EXISTS videos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    share_code TEXT UNIQUE NOT NULL,
    title TEXT NOT NULL,
    duration REAL NOT NULL DEFAULT 0,
    width INTEGER NOT NULL DEFAULT 0,
    height INTEGER NOT NULL DEFAULT 0,
    has_webcam INTEGER NOT NULL DEFAULT 0,
    file_size INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL,
    upload_completed INTEGER NOT NULL DEFAULT 0,
    view_count INTEGER NOT NULL DEFAULT 0,
    password_hash TEXT,
    cta_url TEXT,
    cta_text TEXT,
    last_notified_view_count INTEGER NOT NULL DEFAULT 0,
    is_meeting INTEGER NOT NULL DEFAULT 0,
    summary TEXT,
    password_salt TEXT,
    owner_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_videos_owner ON videos(owner_id);
CREATE INDEX IF NOT EXISTS idx_videos_share_code ON videos(share_code);
CREATE INDEX IF NOT EXISTS idx_videos_expires_at ON videos(expires_at);

CREATE TABLE IF NOT EXISTS transcript_segments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    video_id INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    start_time REAL NOT NULL,
    end_time REAL NOT NULL,
    text TEXT NOT NULL,
    speaker TEXT
);
CREATE INDEX IF NOT EXISTS idx_transcript_video_id ON transcript_segments(video_id);

CREATE TABLE IF NOT EXISTS reactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    video_id INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    timestamp REAL NOT NULL,
    emoji TEXT NOT NULL,
    client_ip TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_reactions_video_id ON reactions(video_id);
CREATE INDEX IF NOT EXISTS idx_reactions_ip ON reactions(video_id, client_ip);

CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    video_id INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    timestamp REAL NOT NULL,
    author_name TEXT NOT NULL DEFAULT 'Anonymous',
    text TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    client_ip TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_comments_video_id ON comments(video_id);

CREATE TABLE IF NOT EXISTS chapters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    video_id INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    timestamp REAL NOT NULL,
    title TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chapters_video_id ON chapters(video_id);

CREATE TABLE IF NOT EXISTS password_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    video_id INTEGER NOT NULL,
    client_ip TEXT NOT NULL,
    attempted_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_password_attempts ON password_attempts(video_id, client_ip, attempted_at);

CREATE TABLE IF NOT EXISTS comment_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    display_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS comment_sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES comment_users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_comment_sessions_user ON comment_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_comment_sessions_expiry ON comment_sessions(expires_at);

CREATE TABLE IF NOT EXISTS recording_uploads (share_code TEXT PRIMARY KEY REFERENCES videos(share_code) ON DELETE CASCADE, upload_id TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS recording_locks (share_code TEXT PRIMARY KEY, token TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')));
