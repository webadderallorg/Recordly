-- Recordly Share — consolidated D1 schema (based on Voom, through migration 0017).
-- Keep in sync with SCHEMA_STATEMENTS in src/schema.js (the runtime source of
-- truth for fresh databases). Statements are idempotent so this file is safe
-- to re-apply to an existing database; the numbered files in migrations/
-- exist for upgrading databases created from an older schema.sql.

CREATE TABLE IF NOT EXISTS creator_profiles (owner_id TEXT PRIMARY KEY, display_name TEXT);

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
    never_expires INTEGER NOT NULL DEFAULT 0 CHECK (never_expires IN (0, 1)),
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
    author_id TEXT,
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

CREATE INDEX IF NOT EXISTS idx_videos_owner_created ON videos(owner_id, datetime(created_at) DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_videos_completed_created ON videos(datetime(created_at) DESC, id DESC) WHERE upload_completed = 1;

-- Bound per-recording/IP feedback rate-window queries.
CREATE INDEX IF NOT EXISTS idx_comments_rate_window ON comments(video_id, client_ip, created_at);
CREATE INDEX IF NOT EXISTS idx_reactions_rate_window ON reactions(video_id, client_ip, created_at);
CREATE INDEX IF NOT EXISTS idx_comments_video_window ON comments(video_id, created_at);

-- Moderation and upload-abuse controls (schema 11).
CREATE TABLE IF NOT EXISTS recording_controls (
 share_code TEXT PRIMARY KEY REFERENCES videos(share_code) ON DELETE CASCADE,
 feedback_disabled INTEGER NOT NULL DEFAULT 0 CHECK (feedback_disabled IN (0, 1)),
 sharing_disabled INTEGER NOT NULL DEFAULT 0 CHECK (sharing_disabled IN (0, 1)),
 operator_blocked INTEGER NOT NULL DEFAULT 0 CHECK (operator_blocked IN (0, 1)));

CREATE TABLE IF NOT EXISTS account_restrictions (
 owner_id TEXT PRIMARY KEY, suspended INTEGER NOT NULL DEFAULT 1 CHECK (suspended IN (0, 1)),
 reason TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT (datetime('now')));

CREATE TABLE IF NOT EXISTS abuse_reports (
 id INTEGER PRIMARY KEY AUTOINCREMENT, share_code TEXT NOT NULL, reason TEXT NOT NULL,
 details TEXT NOT NULL DEFAULT '', client_ip TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT (datetime('now')));

CREATE INDEX IF NOT EXISTS idx_abuse_reports_ip_window ON abuse_reports(client_ip, created_at);

CREATE INDEX IF NOT EXISTS idx_abuse_reports_video_window ON abuse_reports(share_code, created_at);

CREATE TABLE IF NOT EXISTS moderation_actions (
 id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT NOT NULL, target TEXT NOT NULL,
 reason TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')));

CREATE TRIGGER IF NOT EXISTS apply_account_moderation AFTER INSERT ON moderation_actions
 WHEN NEW.action IN ('suspend-account','restore-account') BEGIN
 INSERT INTO account_restrictions (owner_id,suspended,reason)
 VALUES (NEW.target,CASE WHEN NEW.action = 'suspend-account' THEN 1 ELSE 0 END,NEW.reason)
 ON CONFLICT(owner_id) DO UPDATE SET suspended=excluded.suspended,reason=excluded.reason,updated_at=datetime('now');
 END;

CREATE TRIGGER IF NOT EXISTS apply_recording_moderation AFTER INSERT ON moderation_actions
 WHEN NEW.action IN ('block-recording','restore-recording') BEGIN
 SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM videos WHERE share_code = NEW.target) THEN RAISE(ABORT,'Recording not found') END;
 INSERT INTO recording_controls (share_code,operator_blocked)
 SELECT share_code,CASE WHEN NEW.action = 'block-recording' THEN 1 ELSE 0 END FROM videos WHERE share_code=NEW.target
 ON CONFLICT(share_code) DO UPDATE SET operator_blocked=excluded.operator_blocked;
 END;

CREATE TABLE IF NOT EXISTS upload_admissions (
 share_code TEXT PRIMARY KEY, owner_id TEXT NOT NULL, reserved_bytes INTEGER NOT NULL,
 created_at TEXT NOT NULL DEFAULT (datetime('now')));

CREATE INDEX IF NOT EXISTS idx_upload_admissions_owner_window ON upload_admissions(owner_id, created_at);

CREATE INDEX IF NOT EXISTS idx_comments_account_window ON comments(video_id, author_id, created_at);
