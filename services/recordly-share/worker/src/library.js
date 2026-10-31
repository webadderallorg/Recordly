// Adapted from Voom (MIT), Copyright (c) 2026 Aritro Paul.
// See ../../LICENSE and ../../../../THIRD_PARTY_NOTICES.md for attribution.

import { abortStoredMultipart, withRecordingLock } from "./hostedUploads.js";
import { EXPIRY_DAYS } from "./video.js";
import { errorResponse, jsonResponse } from "./http.js";

export async function handleRenew(env, shareCode) {
	const newExpiry = new Date(Date.now() + EXPIRY_DAYS * 24 * 60 * 60 * 1000).toISOString();

	const result = await env.DB.prepare("UPDATE videos SET expires_at = ? WHERE share_code = ?")
		.bind(newExpiry, shareCode)
		.run();

	if (result.meta.changes === 0) return errorResponse("Video not found", 404);

	return jsonResponse({ expiresAt: newExpiry });
}

export async function handleDelete(env, shareCode) {
	const video = await env.DB.prepare("SELECT id FROM videos WHERE share_code = ?")
		.bind(shareCode)
		.first();
	if (!video) return errorResponse("Video not found", 404);

	await Promise.all([
		env.VIDEOS_BUCKET.delete(`videos/${shareCode}.mp4`),
		env.VIDEOS_BUCKET.delete(`thumbnails/${shareCode}.jpg`),
	]);
	await env.DB.batch(deleteVideoStatements(env, video.id));

	return jsonResponse({ ok: true });
}

// One round-trip delete of a video and all child rows. Explicit child deletes
// rather than relying on ON DELETE CASCADE: legacy self-host databases were
// created from a base schema without cascade on every table.
function deleteVideoStatements(env, videoId) {
	return [
		env.DB.prepare("DELETE FROM chapters WHERE video_id = ?").bind(videoId),
		env.DB.prepare("DELETE FROM reactions WHERE video_id = ?").bind(videoId),
		env.DB.prepare("DELETE FROM comments WHERE video_id = ?").bind(videoId),
		env.DB.prepare("DELETE FROM transcript_segments WHERE video_id = ?").bind(videoId),
		env.DB.prepare("DELETE FROM password_attempts WHERE video_id = ?").bind(videoId),
		env.DB.prepare("DELETE FROM videos WHERE id = ?").bind(videoId),
	];
}

// --- Cron Cleanup ---

export async function cleanupExpired(env) {
	if (env.HOSTED_MODE === "true") {
		// Release only crash locks older than a full day; live requests cannot run
		// this long. Then use the same per-recording lock as interactive mutations.
		await env.DB.prepare(
			"DELETE FROM recording_locks WHERE datetime(created_at) < datetime('now', '-1 day')",
		).run();
		const stale = await env.DB.prepare(
			"SELECT share_code FROM videos WHERE owner_id IS NOT NULL AND (datetime(expires_at) < datetime('now') OR (upload_completed = 0 AND datetime(created_at) < datetime('now', '-1 day'))) LIMIT 100",
		).all();
		for (const row of stale.results || []) {
			await withRecordingLock(env, row.share_code, async () => {
				const eligible = await env.DB.prepare(
					"SELECT id FROM videos WHERE share_code = ? AND (datetime(expires_at) < datetime('now') OR (upload_completed = 0 AND datetime(created_at) < datetime('now', '-1 day')))",
				)
					.bind(row.share_code)
					.first();
				if (!eligible) return;
				await abortStoredMultipart(env, row.share_code);
				await handleDelete(env, row.share_code);
			});
		}
		return;
	}
	const expired = await env.DB.prepare(
		"SELECT id, share_code FROM videos WHERE datetime(expires_at) < datetime('now')",
	).all();

	for (const video of expired.results || []) {
		await Promise.all([
			env.VIDEOS_BUCKET.delete(`videos/${video.share_code}.mp4`),
			env.VIDEOS_BUCKET.delete(`thumbnails/${video.share_code}.jpg`),
		]);
		await env.DB.batch(deleteVideoStatements(env, video.id));
	}

	// Drop stale password rate-limit rows so the table can't grow unboundedly.
	await env.DB.prepare(
		"DELETE FROM password_attempts WHERE datetime(attempted_at) < datetime('now', '-1 day')",
	).run();
	await env.DB.prepare(
		"DELETE FROM comment_sessions WHERE datetime(expires_at) < datetime('now')",
	).run();
}

// --- Check Views (authenticated) ---

export async function handleCheckViews(request, env, ownerId = null) {
	const body = await request.json();
	const { shareCodes } = body;
	if (!Array.isArray(shareCodes) || shareCodes.length === 0)
		return errorResponse("shareCodes required");
	if (shareCodes.length > 90) return errorResponse("Too many shareCodes (max 90)");

	const placeholders = shareCodes.map(() => "?").join(",");
	const results = await env.DB.prepare(
		`SELECT share_code, view_count FROM videos WHERE share_code IN (${placeholders}) AND (? IS NULL OR owner_id = ?)`,
	)
		.bind(...shareCodes, ownerId, ownerId)
		.all();

	const views = {};
	for (const row of results.results || []) {
		views[row.share_code] = row.view_count || 0;
	}

	return jsonResponse({ views });
}

// --- Library: list all shared videos (dashboard) ---

export async function handleListVideos(env, ownerId = null) {
	const rows = await env.DB.prepare(
		`SELECT share_code, title, duration, width, height, file_size, created_at, expires_at,
            view_count, is_meeting, summary, upload_completed, (password_hash IS NOT NULL) AS is_protected
     FROM videos
     WHERE (upload_completed = 1 OR ? IS NOT NULL) AND (? IS NULL OR owner_id = ?)
     ORDER BY datetime(created_at) DESC`,
	)
		.bind(ownerId, ownerId, ownerId)
		.all();
	return jsonResponse({ videos: rows.results || [] });
}
