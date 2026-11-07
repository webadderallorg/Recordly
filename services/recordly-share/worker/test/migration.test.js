// Regression tests for ensureSchema against databases that predate schema
// versioning. The v4.1.0 bug: a production DB with tables but no _meta row
// was treated as "fresh", so CREATE TABLE IF NOT EXISTS no-opped, the v2
// ALTER never ran, and every INSERT touching password_salt threw a 500.
// These tests rebuild the database into each historical shape and verify
// uploads work afterward.

import { env, SELF } from "cloudflare:test";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import worker, { __resetSchemaCacheForTests } from "../src/index.js";

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

	it("upgrades completed-library pages without sorting or changing tied-date order", async () => {
		const first = await (await upload()).json();
		const second = await (await upload()).json();
		await upload();
		await env.DB.prepare(
			"UPDATE videos SET upload_completed = 1, created_at = '2026-11-01 12:00:00' WHERE share_code IN (?, ?)",
		)
			.bind(first.shareCode, second.shareCode)
			.run();
		const pageQuery =
			"SELECT id, share_code FROM videos WHERE upload_completed = 1 ORDER BY datetime(created_at) DESC, id DESC LIMIT 51";
		// Reprepare after DDL: cached EXPLAIN statements can retain an old plan.
		const plan = async (phase) =>
			(await env.DB.prepare(`EXPLAIN QUERY PLAN ${pageQuery} /* ${phase} */`).all()).results
				.map((row) => row.detail)
				.join("\n");
		expect(await plan("fresh")).not.toContain("TEMP B-TREE");
		await env.DB.prepare("DROP INDEX idx_videos_completed_created").run();
		await env.DB.prepare("UPDATE _meta SET value = '12' WHERE key = 'schema_version'").run();
		expect(await plan("previous-schema")).toContain("TEMP B-TREE");
		__resetSchemaCacheForTests();
		const response = await SELF.fetch(`${BASE}/api/videos?page=1`, { headers: AUTH });
		expect(response.status).toBe(200);
		expect((await response.json()).videos.map((video) => video.share_code)).toEqual([
			second.shareCode,
			first.shareCode,
		]);
		expect(await plan("upgraded")).not.toContain("TEMP B-TREE");
	});

	it("adds account identity without changing existing guest comments", async () => {
		const response = await upload();
		const { shareCode } = await response.json();
		await env.DB.prepare("DROP INDEX idx_comments_account_window").run();
		await env.DB.prepare("ALTER TABLE comments DROP COLUMN author_id").run();
		await env.DB.prepare(
			"INSERT INTO comments(video_id,timestamp,author_name,text) SELECT id,2,'Old guest','Existing feedback' FROM videos WHERE share_code=?",
		)
			.bind(shareCode)
			.run();
		await env.DB.prepare("UPDATE _meta SET value=? WHERE key='schema_version'")
			.bind("11")
			.run();
		__resetSchemaCacheForTests();
		expect((await upload()).status).toBe(200);
		expect(
			await env.DB.prepare(
				"SELECT author_name,text,author_id FROM comments WHERE video_id=(SELECT id FROM videos WHERE share_code=?)",
			)
				.bind(shareCode)
				.first(),
		).toEqual({ author_name: "Old guest", text: "Existing feedback", author_id: null });
		const index = await env.DB.prepare("PRAGMA index_info(idx_comments_account_window)").all();
		expect(index.results.map((column) => column.name)).toEqual([
			"video_id",
			"author_id",
			"created_at",
		]);
	});

	it("adds feedback rate indexes when upgrading version nine", async () => {
		expect((await upload()).status).toBe(200);
		await env.DB.prepare("DROP INDEX idx_comments_rate_window").run();
		await env.DB.prepare("DROP INDEX idx_comments_video_window").run();
		await env.DB.prepare("DROP INDEX idx_reactions_rate_window").run();
		await env.DB.prepare("UPDATE _meta SET value = '9' WHERE key = 'schema_version'").run();
		__resetSchemaCacheForTests();
		expect((await upload()).status).toBe(200);
		const aggregate = await env.DB.prepare(
			"PRAGMA index_info(idx_comments_video_window)",
		).all();
		expect(aggregate.results.map((column) => column.name)).toEqual(["video_id", "created_at"]);
		for (const table of ["comments", "reactions"]) {
			const { results } = await env.DB.prepare(
				`PRAGMA index_info(idx_${table}_rate_window)`,
			).all();
			expect(results.map((column) => column.name)).toEqual([
				"video_id",
				"client_ip",
				"created_at",
			]);
		}
	});

	it("adds moderation and admission history when upgrading version ten without changing media", async () => {
		const response = await upload();
		const { shareCode } = await response.json();
		for (const table of [
			"recording_controls",
			"account_restrictions",
			"abuse_reports",
			"moderation_actions",
			"upload_admissions",
		])
			await env.DB.prepare(`DROP TABLE ${table}`).run();
		await env.DB.prepare("UPDATE _meta SET value = '10' WHERE key = 'schema_version'").run();
		__resetSchemaCacheForTests();
		expect((await upload()).status).toBe(200);
		for (const table of [
			"recording_controls",
			"account_restrictions",
			"abuse_reports",
			"moderation_actions",
			"upload_admissions",
		])
			expect(
				await env.DB.prepare(
					"SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
				)
					.bind(table)
					.first(),
			).not.toBeNull();
		expect(
			await env.DB.prepare("SELECT share_code FROM videos WHERE share_code = ?")
				.bind(shareCode)
				.first(),
		).toEqual({ share_code: shareCode });
		expect(
			(await env.DB.prepare("SELECT value FROM _meta WHERE key = 'schema_version'").first())
				.value,
		).toBe("13");
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
		expect(meta.value).toBe("13");
		expect(await videoColumns()).toContain("never_expires");
		expect(
			await env.DB.prepare(
				"SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'billing_accounts'",
			).first(),
		).toBeNull();
		expect(await videoColumns()).toContain("owner_id");
	});

	it("adds creator profiles to an existing v8 database without changing recordings", async () => {
		const ticket = await (await upload()).json();
		await env.DB.prepare("DROP TABLE creator_profiles").run();
		await env.DB.prepare("UPDATE _meta SET value = '8' WHERE key = 'schema_version'").run();
		__resetSchemaCacheForTests();
		expect((await upload()).status).toBe(200);
		expect(
			await env.DB.prepare("SELECT display_name FROM creator_profiles").all(),
		).toMatchObject({ results: [] });
		expect(
			await env.DB.prepare("SELECT title FROM videos WHERE share_code = ?")
				.bind(ticket.shareCode)
				.first(),
		).toEqual({ title: "Migration Test" });
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
