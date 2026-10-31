// Regression tests for ensureSchema against databases that predate schema
// versioning. The v4.1.0 bug: a production DB with tables but no _meta row
// was treated as "fresh", so CREATE TABLE IF NOT EXISTS no-opped, the v2
// ALTER never ran, and every INSERT touching password_salt threw a 500.
// These tests rebuild the database into each historical shape and verify
// uploads work afterward.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { env, SELF } from "cloudflare:test";
import { __resetSchemaCacheForTests } from "../src/index.js";

const AUTH = { Authorization: "Bearer test-secret" };
const BASE = "https://share.test";

// The videos table exactly as production had it before migration 0006
// (base schema + migrations 0002–0005): no password_salt column.
const V1_STATEMENTS = [
	`CREATE TABLE videos (
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
    summary TEXT
  )`,
	`CREATE TABLE transcript_segments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    video_id INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    start_time REAL NOT NULL,
    end_time REAL NOT NULL,
    text TEXT NOT NULL,
    speaker TEXT
  )`,
	`CREATE TABLE reactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    video_id INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    timestamp REAL NOT NULL,
    emoji TEXT NOT NULL,
    client_ip TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
	`CREATE TABLE comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    video_id INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    timestamp REAL NOT NULL,
    author_name TEXT NOT NULL DEFAULT 'Anonymous',
    text TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    client_ip TEXT NOT NULL DEFAULT ''
  )`,
	`CREATE TABLE chapters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    video_id INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    timestamp REAL NOT NULL,
    title TEXT NOT NULL
  )`,
];

async function dropAllTables() {
	const { results } = await env.DB.prepare(
		`SELECT name FROM sqlite_master WHERE type = 'table'
     AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\' AND name NOT LIKE '\\_cf\\_%' ESCAPE '\\'`,
	).all();
	for (const { name } of results) {
		await env.DB.prepare(`DROP TABLE IF EXISTS "${name}"`).run();
	}
}

async function createV1Schema() {
	for (const sql of V1_STATEMENTS) {
		await env.DB.prepare(sql).run();
	}
}

async function videoColumns() {
	const { results } = await env.DB.prepare(`PRAGMA table_info(videos)`).all();
	return results.map((c) => c.name);
}

async function upload() {
	return SELF.fetch(`${BASE}/api/upload`, {
		method: "POST",
		headers: { ...AUTH, "Content-Type": "application/json" },
		body: JSON.stringify({ title: "Migration Test", duration: 3 }),
	});
}

describe("schema migration paths", () => {
	beforeEach(async () => {
		await dropAllTables();
		__resetSchemaCacheForTests();
	});

	// Leave a clean, fully-migrated database for any test file that runs after.
	afterAll(async () => {
		await dropAllTables();
		__resetSchemaCacheForTests();
	});

	it("migrates a pre-versioning database (tables exist, no _meta)", async () => {
		await createV1Schema();

		const res = await upload();
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.shareCode).toBeTruthy();

		expect(await videoColumns()).toContain("password_salt");
		const meta = await env.DB.prepare(
			`SELECT value FROM _meta WHERE key = 'schema_version'`,
		).first();
		expect(meta.value).toBe("5");
		expect(await videoColumns()).toContain("owner_id");
	});

	it("repairs a database mis-stamped as current without the v2 columns", async () => {
		// The exact state v4.1.0 left production in: v1 tables, _meta says 2.
		await createV1Schema();
		await env.DB.prepare(`CREATE TABLE _meta (key TEXT PRIMARY KEY, value TEXT)`).run();
		await env.DB.prepare(`INSERT INTO _meta (key, value) VALUES ('schema_version', '2')`).run();

		const res = await upload();
		expect(res.status).toBe(200);

		expect(await videoColumns()).toContain("password_salt");
	});

	it("re-running migrations on an already-migrated database is a no-op", async () => {
		await createV1Schema();
		expect((await upload()).status).toBe(200); // migrates

		__resetSchemaCacheForTests(); // simulate a new isolate cold start
		expect((await upload()).status).toBe(200); // must not throw duplicate-column
	});

	it("bootstraps a truly fresh database with the consolidated schema", async () => {
		const res = await upload();
		expect(res.status).toBe(200);

		const cols = await videoColumns();
		expect(cols).toContain("password_salt");
		const tables = await env.DB.prepare(
			`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'password_attempts'`,
		).first();
		expect(tables).toBeTruthy();
		expect(
			await env.DB.prepare(
				`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'comment_users'`,
			).first(),
		).toBeTruthy();
	});

	it("password flow works end-to-end on a migrated pre-versioning database", async () => {
		await createV1Schema();

		const hash = "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"; // sha256("hello")
		const res = await SELF.fetch(`${BASE}/api/upload`, {
			method: "POST",
			headers: { ...AUTH, "Content-Type": "application/json" },
			body: JSON.stringify({ title: "Protected", duration: 3, password_hash: hash }),
		});
		expect(res.status).toBe(200);
		const { shareCode } = await res.json();
		await env.DB.prepare(`UPDATE videos SET upload_completed = 1 WHERE share_code = ?`)
			.bind(shareCode)
			.run();

		const verify = await SELF.fetch(`${BASE}/s/${shareCode}/verify-password`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ password: "hello" }),
		});
		expect(verify.status).toBe(200);
	});
});
