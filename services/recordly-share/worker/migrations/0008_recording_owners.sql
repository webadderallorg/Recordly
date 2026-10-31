ALTER TABLE videos ADD COLUMN owner_id TEXT;
CREATE INDEX IF NOT EXISTS idx_videos_owner ON videos(owner_id);
