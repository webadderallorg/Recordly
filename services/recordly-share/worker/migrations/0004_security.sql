-- Add client_ip tracking for comment rate limiting
ALTER TABLE comments ADD COLUMN client_ip TEXT NOT NULL DEFAULT '';
