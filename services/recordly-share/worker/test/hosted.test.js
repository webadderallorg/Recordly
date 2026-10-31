import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { env } from "cloudflare:test";
import worker from "../src/index.js";
import { ensureSchema } from "../src/schema.js";

const config = {
	...env,
	HOSTED_MODE: "true",
	REQUEST_RATE_LIMIT: { limit: async () => ({ success: true }) },
	ACCOUNT_RATE_LIMIT: { limit: async () => ({ success: true }) },
	SUPABASE_URL: "https://auth.example.test",
	SUPABASE_PUBLISHABLE_KEY: "public-key",
};
let owner;
beforeEach(async () => {
	await ensureSchema(env);
	owner = crypto.randomUUID();
	vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, options) => {
		const id = options.headers.Authorization.slice(7);
		return Response.json({
			id,
			email: `${id}@example.test`,
			email_confirmed_at: "2026-09-23T00:00:00Z",
			is_anonymous: false,
		});
	});
});
afterEach(() => vi.restoreAllMocks());
const call = (path, method = "GET", body, account = owner, headers = {}) =>
	worker.fetch(
		new Request(`https://share.test${path}`, {
			method,
			headers: {
				Authorization: `Bearer ${account}`,
				"Content-Type": "application/json",
				...headers,
			},
			...(body === undefined ? {} : { body: JSON.stringify(body) }),
		}),
		config,
	);
async function create(account = owner) {
	const response = await call(
		"/api/upload",
		"POST",
		{ title: "Owned recording", fileSize: 8, owner_id: "spoofed" },
		account,
	);
	expect(response.status).toBe(200);
	return (await response.json()).shareCode;
}

it("enforces fourteen-day free expiry and rejects renewal or client-claimed paid plans", async () => {
	const started = Date.now();
	const response = await call("/api/upload", "POST", {
		title: "Free expiry",
		fileSize: 8,
		plan: "paid",
		expiresAt: "2099-01-01T00:00:00Z",
	});
	expect(response.status).toBe(200);
	const ticket = await response.json();
	const expiry = Date.parse(ticket.expiresAt);
	const fortnight = 14 * 86400000;
	expect(expiry).toBeGreaterThanOrEqual(started + fortnight);
	expect(expiry).toBeLessThanOrEqual(Date.now() + fortnight);
	expect((await call(`/api/renew/${ticket.shareCode}`, "POST", {})).status).toBe(403);
	const row = await env.DB.prepare("SELECT expires_at FROM videos WHERE share_code = ?")
		.bind(ticket.shareCode)
		.first();
	expect(row.expires_at).toBe(ticket.expiresAt);

	await put(ticket.shareCode, new Uint8Array(8));
	expect((await call(`/api/metadata/${ticket.shareCode}`, "POST", {})).status).toBe(200);
	expect((await call(`/v/${ticket.shareCode}`)).status).toBe(200);
	await env.DB.prepare(
		"UPDATE videos SET expires_at = datetime('now', '-1 second') WHERE share_code = ?",
	)
		.bind(ticket.shareCode)
		.run();
	expect((await call(`/v/${ticket.shareCode}`)).status).toBe(404);
	expect((await call(`/s/${ticket.shareCode}/data`)).status).toBe(404);
	expect((await call(`/api/renew/${ticket.shareCode}`, "POST", {})).status).toBe(403);
});

it("requires a verified non-anonymous identity and never accepts a shared secret or cookie", async () => {
	for (const user of [
		{ id: owner },
		{ id: owner, email: "a@example.test", email_confirmed_at: "now", is_anonymous: true },
	]) {
		fetch.mockResolvedValueOnce(Response.json(user));
		expect((await call("/api/health")).status).toBe(401);
	}
	fetch.mockResolvedValueOnce(new Response("", { status: 401 }));
	expect((await call("/api/health", "GET", undefined, "test-secret")).status).toBe(401);
	expect(
		(
			await worker.fetch(
				new Request("https://share.test/api/videos", {
					headers: { Cookie: "voom_session=anything" },
				}),
				config,
			)
		).status,
	).toBe(401);
});

it("isolates every recording mutation before its handler can touch storage", async () => {
	const code = await create();
	const other = crypto.randomUUID();
	for (const [method, path] of [
		["PUT", `upload-data/${code}`],
		["PUT", `upload-thumbnail/${code}`],
		["POST", `upload-multipart/${code}`],
		["PUT", `upload-part/${code}/fake/1`],
		["POST", `upload-complete/${code}/fake`],
		["POST", `upload-abort/${code}/fake`],
		["POST", `metadata/${code}`],
		["POST", `renew/${code}`],
		["DELETE", `delete/${code}`],
	])
		expect((await call(`/api/${path}`, method, {}, other)).status).toBe(404);
	const row = await env.DB.prepare("SELECT owner_id FROM videos WHERE share_code = ?")
		.bind(code)
		.first();
	expect(row.owner_id).toBe(owner);
});

it("scopes list and view queries and hides legacy unowned rows", async () => {
	const mine = await create();
	const theirs = await create(crypto.randomUUID());
	const legacy = await create();
	await env.DB.prepare("UPDATE videos SET upload_completed = 1 WHERE share_code IN (?, ?, ?)")
		.bind(mine, theirs, legacy)
		.run();
	await env.DB.prepare("UPDATE videos SET owner_id = NULL WHERE share_code = ?")
		.bind(legacy)
		.run();
	const list = await (await call("/api/videos")).json();
	expect(list.videos.map((v) => v.share_code)).toEqual([mine]);
	const views = await (
		await call("/api/check-views", "POST", { shareCodes: [mine, theirs, legacy] })
	).json();
	expect(Object.keys(views.views)).toEqual([mine]);
	expect((await call(`/api/delete/${legacy}`, "DELETE")).status).toBe(404);
});

it("allows exactly five concurrent reservations and releases a slot after owner deletion", async () => {
	const responses = await Promise.all(
		Array.from({ length: 9 }, () =>
			call("/api/upload", "POST", { title: "Concurrent", fileSize: 8 }),
		),
	);
	expect(responses.filter((r) => r.status === 200)).toHaveLength(5);
	expect(responses.filter((r) => r.status === 409)).toHaveLength(4);
	const row = await env.DB.prepare("SELECT share_code FROM videos WHERE owner_id = ? LIMIT 1")
		.bind(owner)
		.first();
	await env.DB.prepare(
		"UPDATE videos SET expires_at = datetime('now', '-1 day') WHERE owner_id = ?",
	)
		.bind(owner)
		.run();
	expect(
		(
			await call("/api/upload", "POST", {
				title: "Expired still occupies storage",
				fileSize: 8,
			})
		).status,
	).toBe(409);
	expect((await call(`/api/delete/${row.share_code}`, "DELETE")).status).toBe(200);
	await create();
});

it("disables the self-host shared-password dashboard and comment-account routes", async () => {
	expect((await call("/library")).status).toBe(404);
	expect((await call("/library/login", "POST", {})).status).toBe(404);
	expect((await call("/auth/register", "POST", {})).status).toBe(404);
});

const put = (code, bytes, extra = {}, path = "upload-data") =>
	worker.fetch(
		new Request(`https://share.test/api/${path}/${code}`, {
			method: "PUT",
			headers: {
				Authorization: `Bearer ${owner}`,
				"Content-Type": "video/mp4",
				"Content-Length": String(bytes.length),
				...extra,
			},
			body: bytes,
		}),
		config,
	);

it("rejects invalid reservations and refuses publication without matching bytes", async () => {
	for (const size of [0, -1, 0.5, 1_000_000_001, "8", null]) {
		expect(
			(await call("/api/upload", "POST", { title: "Invalid", fileSize: size })).status,
		).toBe(413);
	}
	const code = await create();
	expect((await call(`/api/metadata/${code}`, "POST", {})).status).toBe(409);
	expect((await put(code, new Uint8Array(9))).status).toBe(400);
	expect(await env.VIDEOS_BUCKET.head(`videos/${code}.mp4`)).toBeNull();
});

it("validates actual streamed bytes even when Content-Length lies", async () => {
	for (const size of [7, 9]) {
		const code = await create();
		expect((await put(code, new Uint8Array(size), { "Content-Length": "8" })).status).toBe(400);
		expect(await env.VIDEOS_BUCKET.head(`videos/${code}.mp4`)).toBeNull();
	}
});

it("uploads, publishes, retries metadata safely, serves playback, and deletes", async () => {
	const code = await create();
	expect((await put(code, new Uint8Array(8))).status).toBe(200);
	const metadata = { title: "Ready", segments: [{ startTime: 0, endTime: 1, text: "Hello" }] };
	expect((await call(`/api/metadata/${code}`, "POST", metadata)).status).toBe(200);
	expect((await call(`/api/metadata/${code}`, "POST", metadata)).status).toBe(200);
	const segments = await env.DB.prepare(
		"SELECT COUNT(*) AS total FROM transcript_segments WHERE video_id = (SELECT id FROM videos WHERE share_code = ?)",
	)
		.bind(code)
		.first();
	expect(segments.total).toBe(1);
	expect((await put(code, new Uint8Array(8))).status).toBe(409);
	expect((await worker.fetch(new Request(`https://share.test/v/${code}`), config)).status).toBe(
		200,
	);
	expect((await call(`/api/delete/${code}`, "DELETE")).status).toBe(200);
	expect(await env.VIDEOS_BUCKET.head(`videos/${code}.mp4`)).toBeNull();
});

it("reuses one multipart session, enforces part sizes, and completes exactly once", async () => {
	const code = await create();
	const start = await (await call(`/api/upload-multipart/${code}`, "POST")).json();
	const retry = await (await call(`/api/upload-multipart/${code}`, "POST")).json();
	expect(retry.uploadId).toBe(start.uploadId);
	const id = encodeURIComponent(start.uploadId);
	expect((await call(`/api/upload-abort/${code}/wrong`, "POST")).status).toBe(404);
	const part = await worker.fetch(
		new Request(`https://share.test/api/upload-part/${code}/${id}/1`, {
			method: "PUT",
			headers: { Authorization: `Bearer ${owner}`, "Content-Length": "8" },
			body: new Uint8Array(8),
		}),
		config,
	);
	expect(part.status).toBe(200);
	const manifest = { parts: [await part.json()] };
	expect((await call(`/api/upload-complete/${code}/${id}`, "POST", { parts: [] })).status).toBe(
		400,
	);
	expect((await call(`/api/upload-complete/${code}/${id}`, "POST", manifest)).status).toBe(200);
	expect((await call(`/api/upload-complete/${code}/${id}`, "POST", manifest)).status).toBe(200);
	expect((await call(`/api/metadata/${code}`, "POST", {})).status).toBe(200);
	expect((await call(`/api/delete/${code}`, "DELETE")).status).toBe(200);
});

it("aborts abandoned multipart uploads and frees only stale slots", async () => {
	const { cleanupExpired } = await import("../src/library.js");
	const stale = await create();
	const active = await create();
	await call(`/api/upload-multipart/${stale}`, "POST");
	await env.DB.prepare(
		"UPDATE videos SET created_at = datetime('now', '-2 days') WHERE share_code = ?",
	)
		.bind(stale)
		.run();
	await cleanupExpired(config);
	expect(
		await env.DB.prepare("SELECT id FROM videos WHERE share_code = ?").bind(stale).first(),
	).toBeNull();
	expect(
		await env.DB.prepare("SELECT upload_id FROM recording_uploads WHERE share_code = ?")
			.bind(stale)
			.first(),
	).toBeNull();
	expect(
		await env.DB.prepare("SELECT id FROM videos WHERE share_code = ?").bind(active).first(),
	).not.toBeNull();
});

it("bounds control payloads and thumbnail bytes", async () => {
	expect(
		(await call("/api/upload", "POST", { title: "x".repeat(17000), fileSize: 8 })).status,
	).toBe(413);
	const code = await create();
	expect(
		(
			await put(
				code,
				new Uint8Array(1),
				{ "Content-Type": "image/jpeg", "Content-Length": String(3 * 1024 * 1024) },
				"upload-thumbnail",
			)
		).status,
	).toBe(413);
});

it("limits staging to its explicitly allowed account", async () => {
	const restricted = { ...config, STAGING_ALLOWED_USER_ID: owner };
	expect(
		(
			await worker.fetch(
				new Request("https://share.test/api/health", {
					headers: { Authorization: `Bearer ${owner}` },
				}),
				restricted,
			)
		).status,
	).toBe(200);
	expect(
		(
			await worker.fetch(
				new Request("https://share.test/api/health", {
					headers: { Authorization: "Bearer different-user" },
				}),
				restricted,
			)
		).status,
	).toBe(401);
});

it("leaves quota occupied when R2 cleanup fails, then succeeds on retry", async () => {
	const code = await create();
	await call(`/api/upload-multipart/${code}`, "POST");
	const failing = {
		...config,
		VIDEOS_BUCKET: {
			resumeMultipartUpload: () => ({
				abort: async () => {
					throw new Error("Storage unavailable");
				},
			}),
		},
	};
	expect(
		(
			await worker.fetch(
				new Request(`https://share.test/api/delete/${code}`, {
					method: "DELETE",
					headers: { Authorization: `Bearer ${owner}` },
				}),
				failing,
			)
		).status,
	).toBe(500);
	expect(
		await env.DB.prepare("SELECT id FROM videos WHERE share_code = ?").bind(code).first(),
	).not.toBeNull();
	expect((await call(`/api/delete/${code}`, "DELETE")).status).toBe(200);
});

it("blocks competing mutations and preserves another account’s locks", async () => {
	const code = await create();
	await env.DB.prepare("INSERT INTO recording_locks (share_code, token) VALUES (?, ?)")
		.bind(code, "held-by-upload")
		.run();
	expect((await call(`/api/delete/${code}`, "DELETE")).status).toBe(409);
	expect(
		(await call(`/api/delete/${code}`, "DELETE", undefined, crypto.randomUUID())).status,
	).toBe(404);
	expect(
		(
			await env.DB.prepare("SELECT token FROM recording_locks WHERE share_code = ?")
				.bind(code)
				.first()
		).token,
	).toBe("held-by-upload");
});

it("fails closed without rate limits and throttles before expensive auth/storage work", async () => {
	const request = () =>
		new Request("https://share.test/api/health", {
			headers: { Authorization: `Bearer ${owner}` },
		});
	expect(
		(await worker.fetch(request(), { ...config, REQUEST_RATE_LIMIT: undefined })).status,
	).toBe(503);
	const denied = { limit: async () => ({ success: false }) };
	fetch.mockClear();
	expect((await worker.fetch(request(), { ...config, REQUEST_RATE_LIMIT: denied })).status).toBe(
		429,
	);
	expect(fetch).not.toHaveBeenCalled();
	expect((await worker.fetch(request(), { ...config, ACCOUNT_RATE_LIMIT: denied })).status).toBe(
		429,
	);
});

it("accepts the full 1 GB allowance while rejecting the next byte", async () => {
	const accepted = await call("/api/upload", "POST", {
		title: "Full allowance",
		fileSize: 1_000_000_000,
	});
	expect(accepted.status).toBe(200);
	const rejected = await call("/api/upload", "POST", {
		title: "Over allowance",
		fileSize: 1_000_000_001,
	});
	expect(rejected.status).toBe(413);
});

it("scheduled cleanup removes expired completed objects and preserves active recordings", async () => {
	const expired = await create();
	const active = await create();
	for (const code of [expired, active]) {
		await put(code, new Uint8Array(8));
		await call(`/api/metadata/${code}`, "POST", {});
	}
	await env.DB.prepare(
		"UPDATE videos SET expires_at = datetime('now', '-1 second') WHERE share_code = ?",
	)
		.bind(expired)
		.run();
	await worker.scheduled({}, config);
	expect(await env.VIDEOS_BUCKET.head(`videos/${expired}.mp4`)).toBeNull();
	expect(
		await env.DB.prepare("SELECT id FROM videos WHERE share_code = ?").bind(expired).first(),
	).toBeNull();
	expect(await env.VIDEOS_BUCKET.head(`videos/${active}.mp4`)).not.toBeNull();
	expect(
		await env.DB.prepare("SELECT id FROM videos WHERE share_code = ?").bind(active).first(),
	).not.toBeNull();
});

it("accepts the owner poster after publication without allowing media replacement", async () => {
	const code = await create();
	expect((await put(code, new Uint8Array(8))).status).toBe(200);
	expect((await call(`/api/metadata/${code}`, "POST", {})).status).toBe(200);
	const thumbnail = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
	expect(
		(await put(code, thumbnail, { "Content-Type": "image/jpeg" }, "upload-thumbnail")).status,
	).toBe(200);
	const poster = await env.VIDEOS_BUCKET.get(`thumbnails/${code}.jpg`);
	expect(new Uint8Array(await poster.arrayBuffer())).toEqual(thumbnail);
	expect((await put(code, new Uint8Array(8))).status).toBe(409);
	expect(
		(await call(`/api/upload-thumbnail/${code}`, "PUT", {}, crypto.randomUUID())).status,
	).toBe(404);
});

it("clears a completed size-mismatch session so a fresh multipart upload can start", async () => {
	const code = await create();
	const start = await (await call(`/api/upload-multipart/${code}`, "POST")).json();
	const brokenStorage = {
		...config,
		VIDEOS_BUCKET: {
			head: (...args) => env.VIDEOS_BUCKET.head(...args),
			delete: (...args) => env.VIDEOS_BUCKET.delete(...args),
			resumeMultipartUpload: () => ({ complete: async () => ({ size: 7 }) }),
		},
	};
	const response = await worker.fetch(
		new Request(
			`https://share.test/api/upload-complete/${code}/${encodeURIComponent(start.uploadId)}`,
			{
				method: "POST",
				headers: { Authorization: `Bearer ${owner}`, "Content-Type": "application/json" },
				body: JSON.stringify({ parts: [{ partNumber: 1, etag: "fixture" }] }),
			},
		),
		brokenStorage,
	);
	expect(response.status).toBe(400);
	expect(
		await env.DB.prepare("SELECT upload_id FROM recording_uploads WHERE share_code = ?")
			.bind(code)
			.first(),
	).toBeNull();
	const retry = await (await call(`/api/upload-multipart/${code}`, "POST")).json();
	expect(retry.uploadId).not.toBe(start.uploadId);
	// The fake storage above cannot actually complete the original R2 session.
	await env.VIDEOS_BUCKET.resumeMultipartUpload(`videos/${code}.mp4`, start.uploadId).abort();
});
