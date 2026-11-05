// Adapted from Voom (MIT), Copyright (c) 2026 Aritro Paul.
// See ../../LICENSE and ../../../../THIRD_PARTY_NOTICES.md for attribution.

import { generateSalt, hashRecordingPassword } from "./crypto.js";
import { limitedJson } from "./requestBody.js";
import { errorResponse, jsonResponse } from "./http.js";
import { EXPIRY_DAYS, finiteNonnegative } from "./video.js";

export function generateShareCode() {
	const bytes = new Uint8Array(32);
	crypto.getRandomValues(bytes);
	return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function handleUpload(request, env) {
	const body = await limitedJson(request, 16384);
	const { title, duration, width, height, hasWebcam, fileSize, password_hash, cta_url, cta_text } = body;
	if (typeof title !== "string" || !title.trim() || title.length > 200)
		return errorResponse("Title must be between 1 and 200 characters");
	if (password_hash && !env.API_SECRET)
		return errorResponse("Password protection is not configured", 503);
	if (cta_url && !/^https?:\/\//i.test(cta_url))
		return errorResponse("cta_url must be an http(s) URL");
	const shareCode = generateShareCode();
	const expiresAt = new Date(Date.now() + EXPIRY_DAYS * 86400000).toISOString();
	const salt = password_hash ? generateSalt() : null;
	const storedHash = password_hash ? await hashRecordingPassword(password_hash, salt) : null;
	await env.DB.prepare(
		`INSERT INTO videos (share_code, title, duration, width, height, has_webcam,
		 file_size, expires_at, password_hash, password_salt, cta_url, cta_text)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
	).bind(shareCode, title, finiteNonnegative(duration), finiteNonnegative(width),
		finiteNonnegative(height), hasWebcam ? 1 : 0, finiteNonnegative(fileSize),
		expiresAt, storedHash, salt, cta_url || null, cta_text || null).run();
	const baseUrl = new URL(request.url).origin;
	return jsonResponse({
		shareCode, progressiveUpload: false, parallelUploads: true, reservationBytes: fileSize,
		uploadURL: `${baseUrl}/api/upload-data/${shareCode}`,
		shareURL: `${baseUrl}/s/${shareCode}`, expiresAt,
	});
}

export async function handleUploadData(request, env, shareCode) {
	const video = await env.DB.prepare("SELECT id FROM videos WHERE share_code = ?")
		.bind(shareCode)
		.first();
	if (!video) return errorResponse("Video not found", 404);

	const contentType = request.headers.get("Content-Type") || "video/mp4";

	await env.VIDEOS_BUCKET.put(`videos/${shareCode}.mp4`, request.body, {
		httpMetadata: { contentType },
	});

	return jsonResponse({ ok: true });
}

export async function handleUploadThumbnail(request, env, shareCode) {
	const video = await env.DB.prepare("SELECT id FROM videos WHERE share_code = ?")
		.bind(shareCode)
		.first();
	if (!video) return errorResponse("Video not found", 404);

	const contentType = request.headers.get("Content-Type") || "image/jpeg";

	await env.VIDEOS_BUCKET.put(`thumbnails/${shareCode}.jpg`, request.body, {
		httpMetadata: { contentType },
	});

	return jsonResponse({ ok: true });
}

export async function handleMultipartStart(request, env, shareCode) {
	const video = await env.DB.prepare("SELECT id FROM videos WHERE share_code = ?")
		.bind(shareCode)
		.first();
	if (!video) return errorResponse("Video not found", 404);

	const key = `videos/${shareCode}.mp4`;
	const multipartUpload = await env.VIDEOS_BUCKET.createMultipartUpload(key, {
		httpMetadata: { contentType: "video/mp4" },
	});

	return jsonResponse({ uploadId: multipartUpload.uploadId });
}

export function decodeUploadId(value) {
	try {
		const decoded = decodeURIComponent(value);
		return decoded && decoded.length <= 2048 ? decoded : null;
	} catch {
		return null;
	}
}

export async function handleMultipartPart(request, env, shareCode, uploadId, partNumber) {
	const video = await env.DB.prepare("SELECT id FROM videos WHERE share_code = ?")
		.bind(shareCode)
		.first();
	if (!video) return errorResponse("Video not found", 404);
	if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > 10000) {
		return errorResponse("Invalid multipart part number");
	}

	const key = `videos/${shareCode}.mp4`;
	const multipartUpload = env.VIDEOS_BUCKET.resumeMultipartUpload(key, uploadId);

	const part = await multipartUpload.uploadPart(partNumber, request.body);

	return jsonResponse({ partNumber: part.partNumber, etag: part.etag });
}

export async function handleMultipartAbort(request, env, shareCode, uploadId) {
	const key = `videos/${shareCode}.mp4`;
	try {
		const multipartUpload = env.VIDEOS_BUCKET.resumeMultipartUpload(key, uploadId);
		await multipartUpload.abort();
	} catch (_e) {
		// Ignore errors — upload may already be completed or expired
	}
	return jsonResponse({ ok: true });
}

export async function handleMultipartComplete(request, env, shareCode, uploadId) {
	const video = await env.DB.prepare("SELECT id FROM videos WHERE share_code = ?")
		.bind(shareCode)
		.first();
	if (!video) return errorResponse("Video not found", 404);

	const key = `videos/${shareCode}.mp4`;
	const multipartUpload = env.VIDEOS_BUCKET.resumeMultipartUpload(key, uploadId);

	const body = await request.json();
	const parts = body.parts; // [{ partNumber, etag }, ...]
	if (!Array.isArray(parts) || parts.length === 0 || parts.length > 10000) {
		return errorResponse("Invalid multipart parts");
	}
	if (
		parts.some(
			(part) =>
				!part ||
				!Number.isInteger(part.partNumber) ||
				part.partNumber < 1 ||
				part.partNumber > 10000 ||
				typeof part.etag !== "string" ||
				!part.etag,
		)
	) {
		return errorResponse("Invalid multipart parts");
	}

	await multipartUpload.complete(parts);

	return jsonResponse({ ok: true });
}

export async function handleMetadata(request, env, shareCode) {
	const video = await env.DB.prepare("SELECT id FROM videos WHERE share_code = ?")
		.bind(shareCode)
		.first();
	if (!video) return errorResponse("Video not found", 404);

	const body = await request.json();
	const { segments, title, summary, chapters, isMeeting } = body;

	// Chunk inserts so a multi-hour transcript can't exceed D1 batch limits.
	const BATCH_CHUNK = 100;
	if (segments && segments.length > 0) {
		const stmt = env.DB.prepare(
			"INSERT INTO transcript_segments (video_id, start_time, end_time, text, speaker) VALUES (?, ?, ?, ?, ?)",
		);
		const batch = segments.map((seg) =>
			stmt.bind(video.id, seg.startTime, seg.endTime, seg.text, seg.speaker || null),
		);
		for (let i = 0; i < batch.length; i += BATCH_CHUNK) {
			await env.DB.batch(batch.slice(i, i + BATCH_CHUNK));
		}
	}

	if (chapters && chapters.length > 0) {
		const stmt = env.DB.prepare(
			"INSERT INTO chapters (video_id, timestamp, title) VALUES (?, ?, ?)",
		);
		const batch = chapters.map((ch) => stmt.bind(video.id, ch.timestamp, ch.title));
		for (let i = 0; i < batch.length; i += BATCH_CHUNK) {
			await env.DB.batch(batch.slice(i, i + BATCH_CHUNK));
		}
	}

	// Update title, summary, is_meeting, and mark upload complete
	const updateFields = ["upload_completed = 1"];
	const updateBinds = [];
	if (title) {
		updateFields.push("title = ?");
		updateBinds.push(title);
	}
	if (summary !== undefined) {
		updateFields.push("summary = ?");
		updateBinds.push(summary || null);
	}
	if (isMeeting !== undefined) {
		updateFields.push("is_meeting = ?");
		updateBinds.push(isMeeting ? 1 : 0);
	}
	updateBinds.push(shareCode);
	await env.DB.prepare(`UPDATE videos SET ${updateFields.join(", ")} WHERE share_code = ?`)
		.bind(...updateBinds)
		.run();

	return jsonResponse({ ok: true });
}
