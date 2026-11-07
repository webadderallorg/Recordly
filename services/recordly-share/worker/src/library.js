// Adapted from Voom (MIT), Copyright (c) 2026 Aritro Paul.
// See ../../LICENSE and ../../../../THIRD_PARTY_NOTICES.md for attribution.

import { errorResponse, jsonResponse } from "./http.js";
import { EXPIRY_DAYS } from "./video.js";

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
		env.DB.prepare(
			"DELETE FROM recording_controls WHERE share_code = (SELECT share_code FROM videos WHERE id = ?)",
		).bind(videoId),
		env.DB.prepare("DELETE FROM videos WHERE id = ?").bind(videoId),
	];
}

// --- Cron Cleanup ---

export async function cleanupExpired(env) {
	// Admission history outlives deletion/cancellation; only old days are pruned.
	await env.DB.prepare(
		"DELETE FROM upload_admissions WHERE created_at < datetime('now', '-30 days')",
	).run();

	// Drop stale password rate-limit rows so the table can't grow unboundedly.
	await env.DB.prepare(
		"DELETE FROM password_attempts WHERE datetime(attempted_at) < datetime('now', '-1 day')",
	).run();
	await env.DB.prepare(
		"DELETE FROM comment_sessions WHERE datetime(expires_at) < datetime('now')",
	).run();

	const expired = await env.DB.prepare(
		"SELECT id, share_code FROM videos WHERE never_expires = 0 AND datetime(expires_at) <= datetime('now')",
	).all();

	for (const video of expired.results || []) {
		await Promise.all([
			env.VIDEOS_BUCKET.delete(`videos/${video.share_code}.mp4`),
			env.VIDEOS_BUCKET.delete(`thumbnails/${video.share_code}.jpg`),
		]);
		await env.DB.batch(deleteVideoStatements(env, video.id));
	}
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

const LIBRARY_PAGE_SIZE = 50;

function decodeLibraryCursor(value) {
	if (!/^[A-Za-z0-9_-]{1,512}$/.test(value)) throw new Error("Invalid library cursor");
	const decoded = JSON.parse(atob(value.replace(/-/g, "+").replace(/_/g, "/")));
	if (
		!decoded ||
		decoded.v !== 1 ||
		typeof decoded.createdAt !== "string" ||
		!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(decoded.createdAt) ||
		!Number.isSafeInteger(decoded.id) ||
		decoded.id < 1
	)
		throw new Error("Invalid library cursor");
	const timestamp = new Date(`${decoded.createdAt.replace(" ", "T")}Z`);
	if (
		!Number.isFinite(timestamp.getTime()) ||
		timestamp.toISOString().slice(0, 19).replace("T", " ") !== decoded.createdAt
	)
		throw new Error("Invalid library cursor");
	return decoded;
}

function encodeLibraryCursor(row) {
	return btoa(JSON.stringify({ v: 1, createdAt: row.cursor_created_at, id: row.id }))
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");
}

export async function handleListVideos(env, ownerId = null, request) {
	const url = request ? new URL(request.url) : null;
	const cursorValue = url?.searchParams.get("cursor");
	const paginated =
		url?.searchParams.get("page") === "1" ||
		(cursorValue !== null && cursorValue !== undefined);
	if (paginated) {
		let cursor;
		try {
			if (cursorValue !== null && cursorValue !== undefined)
				cursor = decodeLibraryCursor(cursorValue);
		} catch {
			return errorResponse("Invalid library cursor", 400);
		}
		// Omit large transcripts/summaries from pages. The desktop only needs card
		// metadata; a fixed row count and bounded titles keep every page small.
		// Fixed SQL branches let SQLite seek the owner/date index instead of
		// scanning all accounts or sorting a whole recording library for each page.
		const ownerFilter = ownerId !== null ? "owner_id = ?" : "upload_completed = 1";
		const cursorFilter = cursor
			? "AND datetime(created_at) <= ? AND (datetime(created_at), id) < (?, ?)"
			: "";
		const bindings = ownerId !== null ? [ownerId] : [];
		if (cursor) bindings.push(cursor.createdAt, cursor.createdAt, cursor.id);
		bindings.push(LIBRARY_PAGE_SIZE + 1);
		const rows = await env.DB.prepare(
			`SELECT id, share_code, substr(title, 1, 512) AS title, duration, width, height,
			 file_size, created_at, CASE WHEN never_expires = 1 THEN NULL ELSE expires_at END AS expires_at, view_count, is_meeting, upload_completed,
			 (password_hash IS NOT NULL) AS is_protected, datetime(created_at) AS cursor_created_at
			 FROM videos
			 WHERE ${ownerFilter} ${cursorFilter}
			 ORDER BY datetime(created_at) DESC, id DESC LIMIT ?`,
		)
			.bind(...bindings)
			.all();
		const page = (rows.results || []).slice(0, LIBRARY_PAGE_SIZE);
		const nextCursor =
			rows.results?.length > LIBRARY_PAGE_SIZE
				? encodeLibraryCursor(page[page.length - 1])
				: undefined;
		return jsonResponse({
			videos: page.map(({ id, cursor_created_at, ...video }) => video),
			nextCursor,
		});
	}
	// Preserve the self-host web dashboard's existing unpaginated contract.
	const rows = await env.DB.prepare(
		`SELECT share_code, title, duration, width, height, file_size, created_at,
            CASE WHEN never_expires = 1 THEN NULL ELSE expires_at END AS expires_at,
            view_count, is_meeting, summary, upload_completed, (password_hash IS NOT NULL) AS is_protected
     FROM videos
     WHERE (upload_completed = 1 OR ? IS NOT NULL) AND (? IS NULL OR owner_id = ?)
     ORDER BY datetime(created_at) DESC`,
	)
		.bind(ownerId, ownerId, ownerId)
		.all();
	return jsonResponse({ videos: rows.results || [] });
}
