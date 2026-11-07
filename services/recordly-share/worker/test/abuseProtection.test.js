import { beforeAll, expect, it } from "vitest";
import { env } from "cloudflare:test";
import worker from "../src/index.js";
import { ensureSchema } from "../src/schema.js";
import { cleanupExpired } from "../src/library.js";
import { sha256Hex } from "../src/crypto.js";
import { localCommentHeaders } from "./commentFixtures.js";
const sessions = new Map();
const config = { ...env };
beforeAll(() => ensureSchema(env));
const post = async (code, route, body, ip = "203.0.113.11") => {
	if (route === "comment" && !sessions.has(ip)) sessions.set(ip, localCommentHeaders());
	const account = route === "comment" ? await sessions.get(ip) : {};
	return worker.fetch(
		new Request(`https://share.test/s/${code}/${route}`, {
			method: "POST",
			headers: { ...account, "Content-Type": "application/json", "CF-Connecting-IP": ip },
			body: JSON.stringify(body),
		}),
		config,
	);
};
async function recording({ passwordHash = null, permanent = false } = {}) {
	const code = crypto.randomUUID().replaceAll("-", "");
	const owner = crypto.randomUUID();
	const inserted = await env.DB.prepare(
		`INSERT INTO videos (share_code,title,expires_at,upload_completed,password_hash,owner_id,never_expires) VALUES (?, 'Confidential acquisition plan', datetime('now','+14 days'),1,?,?,?)`,
	)
		.bind(code, passwordHash, owner, permanent ? 1 : 0)
		.run();
	return { code, id: inserted.meta.last_row_id };
}
it("atomically admits only five concurrent account comments per IP/window", async () => {
	const { code, id } = await recording();
	const responses = await Promise.all(
		Array.from({ length: 16 }, (_, i) =>
			post(code, "comment", { timestamp: i, author_name: "Guest", text: `Comment ${i}` }),
		),
	);
	expect(responses.filter((r) => r.status === 200)).toHaveLength(5);
	expect(responses.filter((r) => r.status === 429)).toHaveLength(11);
	expect(
		(
			await env.DB.prepare("SELECT COUNT(*) AS n FROM comments WHERE video_id = ?")
				.bind(id)
				.first()
		).n,
	).toBe(5);
	expect(
		(
			await post(
				code,
				"comment",
				{ timestamp: 0, author_name: "Guest", text: "Other IP" },
				"203.0.113.12",
			)
		).status,
	).toBe(200);
});
it("old comments do not consume the per-IP admission window", async () => {
	const { code, id } = await recording({ permanent: true });
	await env.DB.batch(
		Array.from({ length: 120 }, (_, i) =>
			env.DB.prepare(
				`INSERT INTO comments (video_id,timestamp,author_name,text,client_ip,created_at) VALUES (?,?,'Guest','Old comment',?,datetime('now','-1 day'))`,
			).bind(id, i, "203.0.113.11"),
		),
	);
	const responses = await Promise.all(
		Array.from({ length: 28 }, (_, i) =>
			post(code, "comment", { timestamp: i, author_name: "Guest", text: "New comment" }),
		),
	);
	expect(responses.filter((r) => r.status === 200)).toHaveLength(5);
	expect(responses.filter((r) => r.status === 429)).toHaveLength(23);
	expect(
		(await post(code, "comment", { timestamp: 0, author_name: "Guest", text: "Too fast" }))
			.status,
	).toBe(429);
	expect(
		(
			await env.DB.prepare("SELECT COUNT(*) AS n FROM comments WHERE video_id = ?")
				.bind(id)
				.first()
		).n,
	).toBe(125);
});
it("atomically throttles reactions by time window instead of lifetime", async () => {
	const { code, id } = await recording();
	await env.DB.prepare(
		`INSERT INTO reactions (video_id,timestamp,emoji,client_ip,created_at) VALUES (?,0,'👍',?,datetime('now','-1 day'))`,
	)
		.bind(id, "203.0.113.11")
		.run();
	const responses = await Promise.all(
		Array.from({ length: 65 }, () => post(code, "react", { timestamp: 0, emoji: "👍" })),
	);
	expect(responses.filter((r) => r.status === 200)).toHaveLength(50);
	expect(responses.filter((r) => r.status === 429)).toHaveLength(15);
});
it("reserves password attempts atomically before hashing and counts successful unlocks", async () => {
	const { code, id } = await recording({ passwordHash: await sha256Hex("correct password") });
	expect((await post(code, "verify-password", { password: "correct password" })).status).toBe(
		200,
	);
	const responses = await Promise.all(
		Array.from({ length: 15 }, () => post(code, "verify-password", { password: "wrong" })),
	);
	expect(responses.filter((r) => r.status === 403)).toHaveLength(9);
	expect(responses.filter((r) => r.status === 429)).toHaveLength(6);
	expect(
		(
			await env.DB.prepare("SELECT COUNT(*) AS n FROM password_attempts WHERE video_id = ?")
				.bind(id)
				.first()
		).n,
	).toBe(10);
});
it("keeps protected titles private until unlock", async () => {
	const { code } = await recording({ passwordHash: await sha256Hex("secret") });
	const response = await worker.fetch(new Request(`https://share.test/s/${code}/data`), config);
	expect(response.status).toBe(401);
	expect(await response.json()).toEqual({ password_protected: true, title: "Protected video" });
});
it("rejects oversized and malformed public feedback/password bodies", async () => {
	const { code } = await recording();
	const protectedVideo = await recording({ passwordHash: await sha256Hex("secret") });
	expect(
		(await post(code, "comment", { timestamp: 0, author_name: "Guest", text: {} })).status,
	).toBe(400);
	expect(
		(await post(code, "comment", { timestamp: "0", author_name: "Guest", text: "text" }))
			.status,
	).toBe(400);
	expect(
		(await post(code, "react", { timestamp: 0, emoji: "👍", padding: "a".repeat(2048) }))
			.status,
	).toBe(413);
	expect(
		(
			await post(code, "comment", {
				timestamp: 0,
				author_name: "Guest",
				text: "a".repeat(17000),
			})
		).status,
	).toBe(413);
	expect((await post(protectedVideo.code, "verify-password", { password: {} })).status).toBe(400);
	expect(
		(await post(protectedVideo.code, "verify-password", { password: "a".repeat(9000) })).status,
	).toBe(413);
});
it("cleans old password attempts while retaining current attempts and permanent comments", async () => {
	const { id } = await recording({ permanent: true });
	await env.DB.batch([
		env.DB.prepare(
			`INSERT INTO password_attempts (video_id,client_ip,attempted_at) VALUES (?,'old',datetime('now','-2 days'))`,
		).bind(id),
		env.DB.prepare(
			`INSERT INTO password_attempts (video_id,client_ip) VALUES (?,'current')`,
		).bind(id),
		env.DB.prepare(
			`INSERT INTO comments (video_id,timestamp,author_name,text,created_at) VALUES (?,0,'Guest','Preserve',datetime('now','-2 days'))`,
		).bind(id),
	]);
	await cleanupExpired(config);
	const attempts = await env.DB.prepare(
		"SELECT client_ip FROM password_attempts WHERE video_id = ?",
	)
		.bind(id)
		.all();
	expect(attempts.results.map((row) => row.client_ip)).toEqual(["current"]);
	expect(
		(
			await env.DB.prepare("SELECT COUNT(*) AS n FROM comments WHERE video_id = ?")
				.bind(id)
				.first()
		).n,
	).toBe(1);
});

it("caps rotating-IP comment bursts per recording with a recording-wide ceiling", async () => {
	const { code, id } = await recording({ permanent: true });
	await env.DB.batch(
		Array.from({ length: 195 }, (_, i) =>
			env.DB.prepare(
				`INSERT INTO comments (video_id,timestamp,author_name,text,client_ip) VALUES (?,0,'Guest','Existing',?)`,
			).bind(id, `old-${i}`),
		),
	);
	const responses = await Promise.all(
		Array.from({ length: 16 }, (_, i) =>
			post(
				code,
				"comment",
				{ timestamp: 0, author_name: "Guest", text: "Burst" },
				`198.51.100.${i}`,
			),
		),
	);
	expect(responses.filter((r) => r.status === 200)).toHaveLength(5);
	expect(responses.filter((r) => r.status === 429)).toHaveLength(11);
});
