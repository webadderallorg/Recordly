-- Migration 2: Password protection, CTA, view tracking, reactions, comments

-- Add password and CTA columns to videos
ALTER TABLE videos ADD COLUMN password_hash TEXT;
ALTER TABLE videos ADD COLUMN cta_url TEXT;
ALTER TABLE videos ADD COLUMN cta_text TEXT;
ALTER TABLE videos ADD COLUMN last_notified_view_count INTEGER NOT NULL DEFAULT 0;

-- Reactions table
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

-- Comments table
CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    video_id INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    timestamp REAL NOT NULL,
    author_name TEXT NOT NULL DEFAULT 'Anonymous',
    text TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_comments_video_id ON comments(video_id);
