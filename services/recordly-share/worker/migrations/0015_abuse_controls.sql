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
