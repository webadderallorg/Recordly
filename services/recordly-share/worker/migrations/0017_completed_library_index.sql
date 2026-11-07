-- Keep ownerless completed-recording pages in cursor order without a full sort.
CREATE INDEX IF NOT EXISTS idx_videos_completed_created
ON videos(datetime(created_at) DESC, id DESC) WHERE upload_completed = 1;
