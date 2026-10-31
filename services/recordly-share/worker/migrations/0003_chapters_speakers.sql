-- Migration: Add speaker labels, chapters, and meeting flag
ALTER TABLE transcript_segments ADD COLUMN speaker TEXT;
ALTER TABLE videos ADD COLUMN is_meeting INTEGER NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS chapters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    video_id INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    timestamp REAL NOT NULL,
    title TEXT NOT NULL
);
