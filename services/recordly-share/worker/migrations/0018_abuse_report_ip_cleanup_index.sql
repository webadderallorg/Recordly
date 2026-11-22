-- Keep cleared reports out of the raw-IP cleanup range scan.
CREATE INDEX IF NOT EXISTS idx_abuse_reports_ip_cleanup ON abuse_reports(created_at) WHERE client_ip <> '';
