CREATE INDEX IF NOT EXISTS idx_comments_rate_window ON comments(video_id, client_ip, created_at);
CREATE INDEX IF NOT EXISTS idx_reactions_rate_window ON reactions(video_id, client_ip, created_at);
CREATE INDEX IF NOT EXISTS idx_comments_video_window ON comments(video_id, created_at);
