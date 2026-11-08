ALTER TABLE comments ADD COLUMN author_id TEXT;
CREATE INDEX IF NOT EXISTS idx_comments_account_window ON comments(video_id, author_id, created_at);
