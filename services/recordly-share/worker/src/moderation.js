import { verifyPasswordAuth } from "./auth.js";
import { limitedJson } from "./requestBody.js";
import { withRecordingLock } from "./recordingLock.js";
import { errorResponse, jsonResponse } from "./http.js";
import { AVAILABLE_RECORDING_SQL } from "./video.js";

const REPORT_REASONS = new Set([
	"spam",
	"harassment",
	"privacy",
	"copyright",
	"illegal_content",
	"other",
]);

export async function handleReport(request, env, code) {
	if (request.method !== "POST") return errorResponse("Not found", 404);
	const video = await env.DB.prepare(
		`SELECT * FROM videos WHERE share_code = ? AND upload_completed = 1 AND ${AVAILABLE_RECORDING_SQL}`,
	)
		.bind(code)
		.first();
	if (!video) return errorResponse("Not found", 404);
	if (!(await verifyPasswordAuth(request, env, code, video)))
		return errorResponse("Password required", 401);
	const body = await limitedJson(request, 16384);
	if (
		!REPORT_REASONS.has(body.reason) ||
		(body.details !== undefined &&
			(typeof body.details !== "string" || body.details.length > 2000)) ||
		Object.keys(body).some((key) => !["reason", "details"].includes(key))
	)
		return errorResponse(
			"Choose a report reason and provide at most 2000 characters of details",
		);
	const ip = request.headers.get("CF-Connecting-IP") || "unknown";
	// Admission and insertion share one statement. Reports never change visibility;
	// only an owner setting or a separate operator decision can hide a recording.
	const inserted = await env.DB.prepare(
		`INSERT INTO abuse_reports (share_code, reason, details, client_ip)
		 SELECT share_code, ?, ?, ? FROM videos
		 WHERE share_code = ? AND upload_completed = 1 AND ${AVAILABLE_RECORDING_SQL}
		 AND (SELECT COUNT(*) FROM abuse_reports WHERE client_ip = ? AND created_at > datetime('now', '-1 hour')) < 3
		 AND (SELECT COUNT(*) FROM abuse_reports WHERE share_code = ? AND created_at > datetime('now', '-1 hour')) < 20`,
	)
		.bind(body.reason, (body.details || "").trim(), ip, code, ip, code)
		.run();
	if (!inserted.meta.changes) return errorResponse("Report limit reached. Try again later.", 429);
	return jsonResponse({ ok: true });
}

async function ownedRecording(env, ownerId, code) {
	return env.DB.prepare(
		`SELECT videos.id, COALESCE(recording_controls.feedback_disabled, 0) AS feedback_disabled,
		 COALESCE(recording_controls.sharing_disabled, 0) AS sharing_disabled,
		 COALESCE(recording_controls.operator_blocked, 0) AS operator_blocked
		 FROM videos LEFT JOIN recording_controls ON recording_controls.share_code = videos.share_code
		 WHERE videos.share_code = ? AND videos.owner_id = ?`,
	)
		.bind(code, ownerId)
		.first();
}
function settings(video) {
	if (!video) return errorResponse("Video not found", 404);
	const response = jsonResponse({
		feedbackEnabled: !video.feedback_disabled,
		sharingEnabled: !video.sharing_disabled && !video.operator_blocked,
		sharingBlocked: video.operator_blocked === 1,
	});
	response.headers.set("Cache-Control", "private, no-store");
	return response;
}

export async function handleOwnerModeration(request, env, ownerId, code, commentId) {
	if (typeof ownerId !== "string" || !ownerId)
		return errorResponse("Verified sign-in required", 401);
	const commentsPath = new URL(request.url).pathname.endsWith("/comments");
	if (commentsPath && request.method !== "GET") return errorResponse("Not found", 404);
	const owned = await ownedRecording(env, ownerId, code);
	if (!owned) return errorResponse("Video not found", 404);
	if (commentId === undefined && request.method === "GET") {
		const url = new URL(request.url);
		if (!url.pathname.endsWith("/comments")) return settings(owned);
		const requestedPage = Number(url.searchParams.get("page") || "1");
		const requestedLimit = Number(url.searchParams.get("limit") || "50");
		if (
			!Number.isSafeInteger(requestedPage) ||
			requestedPage < 1 ||
			requestedPage > 1_000_000 ||
			!Number.isSafeInteger(requestedLimit) ||
			requestedLimit < 1 ||
			requestedLimit > 100
		)
			return errorResponse("Invalid comment page");
		const [total, comments] = await env.DB.batch([
			env.DB.prepare("SELECT COUNT(*) AS total FROM comments WHERE video_id = ?").bind(
				owned.id,
			),
			env.DB.prepare(`SELECT id, timestamp, author_name, text, created_at FROM comments
			 WHERE video_id = ? ORDER BY timestamp ASC, id ASC LIMIT ? OFFSET ?`).bind(
				owned.id,
				requestedLimit,
				(requestedPage - 1) * requestedLimit,
			),
		]);
		const response = jsonResponse({
			comments: comments.results || [],
			total: total.results[0].total,
			page: requestedPage,
			limit: requestedLimit,
		});
		response.headers.set("Cache-Control", "private, no-store");
		return response;
	}
	if (commentId !== undefined && request.method !== "DELETE")
		return errorResponse("Not found", 404);
	if (commentId === undefined && request.method !== "PATCH")
		return errorResponse("Not found", 404);
	let body;
	if (commentId === undefined) {
		body = await limitedJson(request, 1024);
		if (
			!Object.keys(body).length ||
			Object.keys(body).some(
				(key) =>
					!["feedbackEnabled", "sharingEnabled"].includes(key) ||
					typeof body[key] !== "boolean",
			)
		)
			return errorResponse("Provide feedbackEnabled or sharingEnabled as a boolean");
	} else if (
		!/^[1-9][0-9]*$/.test(String(commentId)) ||
		!Number.isSafeInteger(Number(commentId))
	) {
		return errorResponse("Invalid comment ID");
	}
	return withRecordingLock(env, code, async () => {
		const video = await ownedRecording(env, ownerId, code);
		if (!video) return errorResponse("Video not found", 404);
		if (commentId !== undefined) {
			const deleted = await env.DB.prepare(
				"DELETE FROM comments WHERE video_id = ? AND id = ?",
			)
				.bind(video.id, Number(commentId))
				.run();
			return deleted.meta.changes
				? jsonResponse({ ok: true })
				: errorResponse("Comment not found", 404);
		}
		// Owner-supplied JSON can only affect the two owner controls. An operator
		// block is deliberately absent from both the INSERT and UPDATE assignments.
		await env.DB.prepare(
			`INSERT INTO recording_controls (share_code, feedback_disabled, sharing_disabled)
			 VALUES (?, ?, ?) ON CONFLICT(share_code) DO UPDATE SET
			 feedback_disabled = excluded.feedback_disabled, sharing_disabled = excluded.sharing_disabled`,
		)
			.bind(
				code,
				body.feedbackEnabled === undefined
					? video.feedback_disabled
					: Number(!body.feedbackEnabled),
				body.sharingEnabled === undefined
					? video.sharing_disabled
					: Number(!body.sharingEnabled),
			)
			.run();
		return settings(await ownedRecording(env, ownerId, code));
	});
}
