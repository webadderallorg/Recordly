import { AVAILABLE_RECORDING_SQL } from "./video.js";

// Adapted from Voom (MIT), Copyright (c) 2026 Aritro Paul.
// See ../../LICENSE and ../../../../THIRD_PARTY_NOTICES.md for attribution.

import { verifyPasswordAuth } from "./auth.js";
import { commentViewer } from "./accounts.js";
import { errorResponse, jsonResponse, parseCookies } from "./http.js";
import { limitedJson } from "./requestBody.js";

// --- Reactions ---

export async function handleReact(request, env, shareCode) {
	const video = await env.DB.prepare(
		`SELECT id, password_hash, expires_at, never_expires FROM videos WHERE share_code = ? AND upload_completed = 1 AND ${AVAILABLE_RECORDING_SQL}`,
	)
		.bind(shareCode)
		.first();

	if (!video) return errorResponse("Not found", 404);

	// Password check
	if (video.password_hash) {
		const authed = await verifyPasswordAuth(request, env, shareCode, video);
		if (!authed) return errorResponse("Unauthorized", 401);
	}

	const controls = await env.DB.prepare(
		"SELECT feedback_disabled FROM recording_controls WHERE share_code = ?",
	)
		.bind(shareCode)
		.first();
	if (controls?.feedback_disabled === 1)
		return errorResponse("Feedback is disabled for this recording", 403);

	const body = await limitedJson(request, 1024);
	const { timestamp, emoji } = body;
	const allowedEmojis = ["👍", "❤️", "😂", "😮", "🔥", "👏"];
	if (!allowedEmojis.includes(emoji)) return errorResponse("Invalid emoji");
	if (!Number.isFinite(timestamp) || timestamp < 0) return errorResponse("Invalid timestamp");

	// Admit and insert in one statement so concurrent requests share the limit.
	const clientIP = request.headers.get("CF-Connecting-IP") || "unknown";
	const inserted = await env.DB.prepare(
		`INSERT INTO reactions (video_id, timestamp, emoji, client_ip)
		 SELECT ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM reactions
		 WHERE video_id = ? AND client_ip = ? AND created_at > datetime('now', '-5 minutes')) < 50
 AND NOT EXISTS (SELECT 1 FROM recording_controls WHERE share_code = ? AND feedback_disabled = 1)`,
	)
		.bind(video.id, timestamp, emoji, clientIP, video.id, clientIP, shareCode)
		.run();
	if (!inserted.meta.changes) return errorResponse("Rate limit exceeded", 429);

	return jsonResponse({ ok: true });
}

export async function handleGetReactions(request, env, shareCode) {
	const video = await env.DB.prepare(
		`SELECT id, password_hash, expires_at, never_expires FROM videos WHERE share_code = ? AND upload_completed = 1 AND ${AVAILABLE_RECORDING_SQL}`,
	)
		.bind(shareCode)
		.first();

	if (!video) return errorResponse("Not found", 404);

	// Same gate as POST /react — listing must not bypass the password.
	const authed = await verifyPasswordAuth(request, env, shareCode, video);
	if (!authed) return errorResponse("Password required", 401);

	const reactions = await env.DB.prepare(
		"SELECT timestamp, emoji, created_at FROM reactions WHERE video_id = ? ORDER BY created_at DESC LIMIT 500",
	)
		.bind(video.id)
		.all();

	return jsonResponse({ reactions: reactions.results || [] });
}

// --- Comments ---

async function commentAccount(request, env) {
	return commentViewer(request, env);
}

function hasCommentCredentials(request) {
	return "recordly_comment_session" in parseCookies(request.headers.get("Cookie") || "");
}

export async function handleComment(request, env, shareCode) {
	const video = await env.DB.prepare(
		`SELECT id, password_hash, expires_at, never_expires FROM videos WHERE share_code = ? AND upload_completed = 1 AND ${AVAILABLE_RECORDING_SQL}`,
	)
		.bind(shareCode)
		.first();

	if (!video) return errorResponse("Not found", 404);

	// Password check
	if (video.password_hash) {
		const authed = await verifyPasswordAuth(request, env, shareCode, video);
		if (!authed) return errorResponse("Password required", 401);
	}

	const controls = await env.DB.prepare(
		"SELECT feedback_disabled FROM recording_controls WHERE share_code = ?",
	)
		.bind(shareCode)
		.first();
	if (controls?.feedback_disabled === 1)
		return errorResponse("Feedback is disabled for this recording", 403);

	// A video password unlocks viewing only; it never grants account identity.
	const viewer = await commentAccount(request, env);
	if (!viewer) return errorResponse("Sign in to Recordly to comment", 401);

	const body = await limitedJson(request, 16384);
	const { timestamp, text } = body;
	const authorName = viewer.display_name;
	const authorId = String(viewer.id);
	if (!Number.isFinite(timestamp) || timestamp < 0) return errorResponse("Invalid timestamp");
	if (typeof text !== "string" || text.trim().length === 0)
		return errorResponse("Text is required");
	if (text.length > 2000) return errorResponse("Text too long");

	// Admit and insert atomically: five comments per IP/five minutes, with a
	// recording-wide ceiling to bound rotating-IP bursts.
	const clientIP = request.headers.get("CF-Connecting-IP") || "unknown";
	const inserted = await env.DB.prepare(
		`INSERT INTO comments (video_id, timestamp, author_name, author_id, text, client_ip)
		 SELECT ?, ?, ?, ?, ?, ? FROM videos WHERE id = ?
		 AND (SELECT COUNT(*) FROM comments WHERE video_id = ? AND client_ip = ?
		 AND created_at > datetime('now', '-5 minutes')) < 5
		 AND (SELECT COUNT(*) FROM comments WHERE video_id = ? AND author_id = ?
		 AND created_at > datetime('now', '-5 minutes')) < 5
		 AND (SELECT COUNT(*) FROM comments WHERE video_id = ? AND created_at > datetime('now', '-1 minute')) < 200
		 AND NOT EXISTS (SELECT 1 FROM recording_controls WHERE share_code = ? AND feedback_disabled = 1)`,
	)
		.bind(
			video.id,
			timestamp,
			authorName,
			authorId,
			text.trim(),
			clientIP,
			video.id,
			video.id,
			clientIP,
			video.id,
			authorId,
			video.id,
			shareCode,
		)
		.run();
	if (!inserted.meta.changes) return errorResponse("Rate limit exceeded", 429);

	return jsonResponse({ ok: true, id: inserted.meta.last_row_id, author_name: authorName });
}

export async function handleGetComments(request, env, shareCode) {
	const video = await env.DB.prepare(
		`SELECT id, password_hash, expires_at, never_expires FROM videos WHERE share_code = ? AND upload_completed = 1 AND ${AVAILABLE_RECORDING_SQL}`,
	)
		.bind(shareCode)
		.first();

	if (!video) return errorResponse("Not found", 404);

	// Same gate as POST /comment — viewer comments can be sensitive.
	const authed = await verifyPasswordAuth(request, env, shareCode, video);
	if (!authed) return errorResponse("Password required", 401);

	const viewer = hasCommentCredentials(request, env) ? await commentAccount(request, env) : null;
	if (viewer instanceof Response) return viewer;

	const url = new URL(request.url);
	const requestedPage = parseInt(url.searchParams.get("page") || "1", 10);
	const requestedLimit = parseInt(url.searchParams.get("limit") || "50", 10);
	const page = Number.isSafeInteger(requestedPage)
		? Math.max(1, Math.min(requestedPage, Math.floor(Number.MAX_SAFE_INTEGER / 100)))
		: 1;
	const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(requestedLimit, 100)) : 50;
	const offset = (page - 1) * limit;

	const total = await env.DB.prepare("SELECT COUNT(*) as cnt FROM comments WHERE video_id = ?")
		.bind(video.id)
		.first();

	const comments = await env.DB.prepare(
		"SELECT id, timestamp, author_name, text, created_at, CASE WHEN author_id = ? THEN 1 ELSE 0 END AS can_manage FROM comments WHERE video_id = ? ORDER BY timestamp ASC, id ASC LIMIT ? OFFSET ?",
	)
		.bind(viewer ? String(viewer.id) : null, video.id, limit, offset)
		.all();

	return jsonResponse({
		comments: (comments.results || []).map((comment) => ({
			...comment,
			can_manage: comment.can_manage === 1,
		})),
		total: total ? total.cnt : 0,
		page,
		limit,
	});
}

// Comment ownership is the authenticated account ID, never a submitted name.
export async function handleManageComment(request, env, shareCode, commentId) {
	if (!/^[1-9][0-9]*$/.test(commentId) || !Number.isSafeInteger(Number(commentId)))
		return errorResponse("Not found", 404);
	const video = await env.DB.prepare(
		`SELECT id, password_hash, expires_at, never_expires FROM videos WHERE share_code = ? AND upload_completed = 1 AND ${AVAILABLE_RECORDING_SQL}`,
	)
		.bind(shareCode)
		.first();
	if (!video) return errorResponse("Not found", 404);
	if (!(await verifyPasswordAuth(request, env, shareCode, video)))
		return errorResponse("Password required", 401);
	const viewer = await commentAccount(request, env);
	if (viewer instanceof Response) return viewer;
	if (!viewer) return errorResponse("Sign in to Recordly to manage your comments", 401);
	const authorId = String(viewer.id);
	const owned = await env.DB.prepare(
		"SELECT id FROM comments WHERE id = ? AND video_id = ? AND author_id = ?",
	)
		.bind(Number(commentId), video.id, authorId)
		.first();
	if (!owned) return errorResponse("Not found", 404);

	if (request.method === "DELETE") {
		// Removing one's own comment remains available when new feedback is disabled.
		const result =
			await env.DB.prepare(`DELETE FROM comments WHERE id = ? AND video_id = ? AND author_id = ?
		 AND EXISTS (SELECT 1 FROM videos WHERE id = ? AND upload_completed = 1 AND ${AVAILABLE_RECORDING_SQL})`)
				.bind(Number(commentId), video.id, authorId, video.id)
				.run();
		return result.meta.changes ? jsonResponse({ ok: true }) : errorResponse("Not found", 404);
	}

	const controls = await env.DB.prepare(
		"SELECT feedback_disabled FROM recording_controls WHERE share_code = ?",
	)
		.bind(shareCode)
		.first();
	if (controls?.feedback_disabled === 1)
		return errorResponse("Feedback is disabled for this recording", 403);
	const body = await limitedJson(request, 16384);
	if (typeof body.text !== "string" || !body.text.trim())
		return errorResponse("Text is required");
	if (body.text.length > 2000) return errorResponse("Text too long");
	const result =
		await env.DB.prepare(`UPDATE comments SET text = ? WHERE id = ? AND video_id = ? AND author_id = ?
	 AND EXISTS (SELECT 1 FROM videos WHERE id = ? AND upload_completed = 1 AND ${AVAILABLE_RECORDING_SQL})
	 AND NOT EXISTS (SELECT 1 FROM recording_controls WHERE share_code = ? AND feedback_disabled = 1)`)
			.bind(body.text.trim(), Number(commentId), video.id, authorId, video.id, shareCode)
			.run();
	if (!result.meta.changes) {
		const current = await env.DB.prepare(
			"SELECT feedback_disabled FROM recording_controls WHERE share_code = ?",
		)
			.bind(shareCode)
			.first();
		return current?.feedback_disabled === 1
			? errorResponse("Feedback is disabled for this recording", 403)
			: errorResponse("Not found", 404);
	}
	return jsonResponse({ ok: true });
}
