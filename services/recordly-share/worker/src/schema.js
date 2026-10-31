// Adapted from Voom (MIT), Copyright (c) 2026 Aritro Paul.
// See ../../LICENSE and ../../../../THIRD_PARTY_NOTICES.md for attribution.

// --- Self-bootstrap: runtime schema migration ---
// When deployed via the "Deploy to Cloudflare" button, D1 is auto-provisioned
// empty, so the worker migrates its own schema at runtime on first request.
// Authentication uses the API_SECRET set during deploy (dashboard or prompt).

const SCHEMA_VERSION = 5;

// Consolidated current schema (base schema.sql + migrations 0002-0009). All
// statements are idempotent, so this is safe on both fresh (button-deployed)
// and existing (token-deployed) databases.
const SCHEMA_STATEMENTS = [
	`CREATE TABLE IF NOT EXISTS recording_uploads (share_code TEXT PRIMARY KEY REFERENCES videos(share_code) ON DELETE CASCADE, upload_id TEXT NOT NULL)`,
	`CREATE TABLE IF NOT EXISTS recording_locks (share_code TEXT PRIMARY KEY, token TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')))`,

	`CREATE TABLE IF NOT EXISTS videos (
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
  )`,
	`CREATE INDEX IF NOT EXISTS idx_videos_owner ON videos(owner_id)`,
	`CREATE INDEX IF NOT EXISTS idx_videos_share_code ON videos(share_code)`,
	`CREATE INDEX IF NOT EXISTS idx_videos_expires_at ON videos(expires_at)`,
	`CREATE TABLE IF NOT EXISTS transcript_segments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    video_id INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    start_time REAL NOT NULL,
    end_time REAL NOT NULL,
    text TEXT NOT NULL,
    speaker TEXT
  )`,
	`CREATE INDEX IF NOT EXISTS idx_transcript_video_id ON transcript_segments(video_id)`,
	`CREATE TABLE IF NOT EXISTS reactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    video_id INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    timestamp REAL NOT NULL,
    emoji TEXT NOT NULL,
    client_ip TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
	`CREATE INDEX IF NOT EXISTS idx_reactions_video_id ON reactions(video_id)`,
	`CREATE INDEX IF NOT EXISTS idx_reactions_ip ON reactions(video_id, client_ip)`,
	`CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    video_id INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    timestamp REAL NOT NULL,
    author_name TEXT NOT NULL DEFAULT 'Anonymous',
    text TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    client_ip TEXT NOT NULL DEFAULT ''
  )`,
	`CREATE INDEX IF NOT EXISTS idx_comments_video_id ON comments(video_id)`,
	`CREATE TABLE IF NOT EXISTS chapters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    video_id INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    timestamp REAL NOT NULL,
    title TEXT NOT NULL
  )`,
	`CREATE INDEX IF NOT EXISTS idx_chapters_video_id ON chapters(video_id)`,
	`CREATE TABLE IF NOT EXISTS password_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    video_id INTEGER NOT NULL,
    client_ip TEXT NOT NULL,
    attempted_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
	`CREATE INDEX IF NOT EXISTS idx_password_attempts ON password_attempts(video_id, client_ip, attempted_at)`,
	`CREATE TABLE IF NOT EXISTS comment_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    display_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
	`CREATE TABLE IF NOT EXISTS comment_sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES comment_users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
	`CREATE INDEX IF NOT EXISTS idx_comment_sessions_user ON comment_sessions(user_id)`,
	`CREATE INDEX IF NOT EXISTS idx_comment_sessions_expiry ON comment_sessions(expires_at)`,
];

// Incremental migrations for databases that are already at an older version.
// SCHEMA_STATEMENTS only covers fresh databases (CREATE TABLE IF NOT EXISTS
// cannot add columns to existing tables), so any change that ALTERs an
// existing table MUST appear here under a bumped SCHEMA_VERSION.
const SCHEMA_MIGRATIONS = {
	5: [
		`CREATE TABLE IF NOT EXISTS recording_uploads (share_code TEXT PRIMARY KEY REFERENCES videos(share_code) ON DELETE CASCADE, upload_id TEXT NOT NULL)`,
		`CREATE TABLE IF NOT EXISTS recording_locks (share_code TEXT PRIMARY KEY, token TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
	],
	4: [
		`ALTER TABLE videos ADD COLUMN owner_id TEXT`,
		`CREATE INDEX IF NOT EXISTS idx_videos_owner ON videos(owner_id)`,
	],
	2: [
		`CREATE INDEX IF NOT EXISTS idx_chapters_video_id ON chapters(video_id)`,
		`ALTER TABLE videos ADD COLUMN password_salt TEXT`,
		`CREATE TABLE IF NOT EXISTS password_attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      video_id INTEGER NOT NULL,
      client_ip TEXT NOT NULL,
      attempted_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
		`CREATE INDEX IF NOT EXISTS idx_password_attempts ON password_attempts(video_id, client_ip, attempted_at)`,
	],
	3: [
		`CREATE TABLE IF NOT EXISTS comment_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
		`CREATE TABLE IF NOT EXISTS comment_sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES comment_users(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
		`CREATE INDEX IF NOT EXISTS idx_comment_sessions_user ON comment_sessions(user_id)`,
		`CREATE INDEX IF NOT EXISTS idx_comment_sessions_expiry ON comment_sessions(expires_at)`,
	],
};

let schemaReady = false;

// Test-only: lets the vitest suite force ensureSchema to re-run after it
// rebuilds the database into an older shape. Never called in production.
export function __resetSchemaCacheForTests() {
	schemaReady = false;
}

export async function ensureSchema(env) {
	if (schemaReady) return;
	await env.DB.prepare(
		`CREATE TABLE IF NOT EXISTS _meta (key TEXT PRIMARY KEY, value TEXT)`,
	).run();
	const row = await env.DB.prepare(
		`SELECT value FROM _meta WHERE key = 'schema_version'`,
	).first();
	let current = row ? parseInt(row.value, 10) : 0;

	if (current === 0) {
		// No version stamp ≠ fresh: databases created before versioning existed
		// have tables but no _meta row. Treating one as fresh would skip the
		// ALTERs (CREATE TABLE IF NOT EXISTS no-ops on existing tables).
		const videos = await env.DB.prepare(
			`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'videos'`,
		).first();
		if (videos) current = 1;
	}

	if (current >= 2) {
		// Repair pass: v4.1.0 stamped pre-versioning databases as current without
		// running the v2 ALTERs. If anything v2 introduced is missing, rewind so
		// the migration loop below re-runs (its statements tolerate re-application).
		const cols = await env.DB.prepare(`PRAGMA table_info(videos)`).all();
		const attempts = await env.DB.prepare(
			`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'password_attempts'`,
		).first();
		if (!(cols.results || []).some((c) => c.name === "password_salt") || !attempts) current = 1;
	}

	if (current >= 3) {
		const commentUsers = await env.DB.prepare(
			`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'comment_users'`,
		).first();
		const commentSessions = await env.DB.prepare(
			`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'comment_sessions'`,
		).first();
		if (!commentUsers || !commentSessions) current = 2;
	}

	if (current < SCHEMA_VERSION) {
		if (current === 0) {
			// Fresh database: the consolidated schema already reflects every migration.
			await env.DB.batch(SCHEMA_STATEMENTS.map((sql) => env.DB.prepare(sql)));
		} else {
			// Existing database: apply each migration step in order. ALTER TABLE
			// is not idempotent, so tolerate duplicate-column errors from re-runs.
			for (let v = current + 1; v <= SCHEMA_VERSION; v++) {
				for (const sql of SCHEMA_MIGRATIONS[v] || []) {
					try {
						await env.DB.prepare(sql).run();
					} catch (e) {
						if (!/duplicate column|already exists/i.test(e.message || "")) throw e;
					}
				}
			}
		}
		await env.DB.prepare(
			`INSERT INTO _meta (key, value) VALUES ('schema_version', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
		)
			.bind(String(SCHEMA_VERSION))
			.run();
	}
	schemaReady = true;
}
