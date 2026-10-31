import { errorResponse, jsonResponse } from "./http.js";
import { handleDelete } from "./library.js";
import { handleMetadata, decodeUploadId } from "./uploads.js";

// Match the desktop uploader's chunks. Values are bytes, not client assertions.
export const MAX_RECORDING_BYTES = 1_000_000_000;
export const PART_BYTES = 25 * 1024 * 1024;
const THUMBNAIL_BYTES = 2 * 1024 * 1024;
const TYPES = new Set(["video/mp4", "video/webm", "video/quicktime", "image/gif"]);

export async function limitedJson(request, max = 1024 * 1024) {
	const reader = request.body?.getReader();
	if (!reader) throw new Error("INVALID_JSON");
	let size = 0;
	const chunks = [];
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			size += value.byteLength;
			if (size > max) {
				await reader.cancel();
				throw new Error("BODY_TOO_LARGE");
			}
			chunks.push(value);
		}
	} finally {
		reader.releaseLock();
	}
	const bytes = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	try {
		const value = JSON.parse(new TextDecoder().decode(bytes));
		if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
		return value;
	} catch {
		throw new Error("INVALID_JSON");
	}
}

// Serialize upload/delete/finalize for a recording across Worker isolates. A crash
// leaves a lock for maintenance instead of allowing a competing writer through.
export async function withRecordingLock(env, code, action) {
	const token = crypto.randomUUID();
	const result = await env.DB.prepare(
		"INSERT OR IGNORE INTO recording_locks (share_code, token) VALUES (?, ?)",
	)
		.bind(code, token)
		.run();
	if (!result.meta.changes) return errorResponse("Recording is busy. Try again shortly.", 409);
	try {
		return await action();
	} finally {
		await env.DB.prepare("DELETE FROM recording_locks WHERE share_code = ? AND token = ?")
			.bind(code, token)
			.run();
	}
}

async function exactUpload(request, length, consume) {
	if (!request.body || request.headers.get("Content-Length") !== String(length)) {
		return errorResponse("Upload length does not match the reserved size", 400);
	}
	// Cloudflare enforces too many AND too few bytes while streaming to R2;
	// never buffer a recording or trust Content-Length alone.
	// biome-ignore lint/correctness/noUndeclaredVariables: FixedLengthStream is a Cloudflare Workers runtime global.
	const stream = new FixedLengthStream(length);
	const results = await Promise.allSettled([
		request.body.pipeTo(stream.writable, { signal: AbortSignal.timeout(5 * 60 * 1000) }),
		consume(stream.readable),
	]);
	if (results[0].status === "rejected")
		return errorResponse("Upload body does not match the reserved size", 400);
	if (results[1].status === "rejected") {
		if (/FixedLengthStream|fixed.length|expected bytes/i.test(String(results[1].reason)))
			return errorResponse("Upload body does not match the reserved size", 400);
		throw results[1].reason;
	}
	return jsonResponse({ ok: true, ...(results[1].value?.partNumber ? results[1].value : {}) });
}

export async function abortStoredMultipart(env, code) {
	const session = await env.DB.prepare(
		"SELECT upload_id FROM recording_uploads WHERE share_code = ?",
	)
		.bind(code)
		.first();
	if (session) {
		// R2 abort is idempotent. Do not swallow service failures and release quota
		// while parts might still occupy storage.
		await env.VIDEOS_BUCKET.resumeMultipartUpload(
			`videos/${code}.mp4`,
			session.upload_id,
		).abort();
		await env.DB.prepare("DELETE FROM recording_uploads WHERE share_code = ?").bind(code).run();
	}
}

export async function handleHostedRecording(request, env, ownerId, route, code, rawId, rawPart) {
	const owned = await env.DB.prepare(
		"SELECT id FROM videos WHERE share_code = ? AND owner_id = ?",
	)
		.bind(code, ownerId)
		.first();
	if (!owned) return errorResponse("Video not found", 404);
	return withRecordingLock(env, code, async () => {
		const video = await env.DB.prepare(
			"SELECT * FROM videos WHERE share_code = ? AND owner_id = ?",
		)
			.bind(code, ownerId)
			.first();
		if (!video) return errorResponse("Video not found", 404);
		const key = `videos/${code}.mp4`;
		if (route === "delete") {
			await abortStoredMultipart(env, code);
			return handleDelete(env, code);
		}
		// A renewal endpoint must not let free accounts bypass their fixed expiry.
		if (route === "renew")
			return errorResponse(
				"Free recordings expire after 14 days and cannot be renewed.",
				403,
			);
		if (
			!video.upload_completed &&
			Date.parse(`${video.created_at.replace(" ", "T")}Z`) < Date.now() - 86400000
		) {
			return errorResponse("Upload expired. Delete it and start again.", 410);
		}
		if (route === "metadata") {
			const body = await limitedJson(request);
			const object = await env.VIDEOS_BUCKET.head(key);
			if (!object || object.size !== video.file_size)
				return errorResponse("Upload the complete recording before publishing", 409);
			if (video.upload_completed) return jsonResponse({ ok: true });
			if (
				(body.title !== undefined &&
					(typeof body.title !== "string" ||
						!body.title.trim() ||
						body.title.length > 200)) ||
				(body.summary !== undefined &&
					(typeof body.summary !== "string" || body.summary.length > 10000)) ||
				(body.isMeeting !== undefined && typeof body.isMeeting !== "boolean")
			)
				return errorResponse("Invalid recording metadata");
			for (const [name, max] of [
				["segments", 5000],
				["chapters", 200],
			]) {
				if (
					body[name] !== undefined &&
					(!Array.isArray(body[name]) || body[name].length > max)
				)
					return errorResponse("Too much recording metadata");
			}
			if (
				(body.segments || []).some(
					(s) =>
						!s ||
						!Number.isFinite(s.startTime) ||
						!Number.isFinite(s.endTime) ||
						s.startTime < 0 ||
						s.endTime < s.startTime ||
						typeof s.text !== "string" ||
						s.text.length > 2000 ||
						(s.speaker != null &&
							(typeof s.speaker !== "string" || s.speaker.length > 100)),
				)
			)
				return errorResponse("Invalid transcript");
			if (
				(body.chapters || []).some(
					(c) =>
						!c ||
						!Number.isFinite(c.timestamp) ||
						c.timestamp < 0 ||
						typeof c.title !== "string" ||
						c.title.length > 200,
				)
			)
				return errorResponse("Invalid chapters");
			// A failed metadata attempt may have inserted some chunks. Retry replaces
			// those chunks rather than accumulating duplicates.
			await env.DB.batch([
				env.DB.prepare("DELETE FROM transcript_segments WHERE video_id = ?").bind(video.id),
				env.DB.prepare("DELETE FROM chapters WHERE video_id = ?").bind(video.id),
			]);
			return handleMetadata(
				new Request(request.url, { method: "POST", body: JSON.stringify(body) }),
				env,
				code,
			);
		}
		if (route === "upload-thumbnail") {
			const length = Number(request.headers.get("Content-Length"));
			if (!Number.isSafeInteger(length) || length <= 0 || length > THUMBNAIL_BYTES)
				return errorResponse("Thumbnail must be at most 2 MB", 413);
			if (request.headers.get("Content-Type") !== "image/jpeg")
				return errorResponse("Thumbnail must be JPEG");
			return exactUpload(request, length, (stream) =>
				env.VIDEOS_BUCKET.put(`thumbnails/${code}.jpg`, stream, {
					httpMetadata: { contentType: "image/jpeg" },
				}),
			);
		}
		// Posters may arrive after metadata publishes the recording. Media remains immutable.
		if (video.upload_completed)
			return errorResponse("Published recordings cannot be overwritten", 409);
		const session = await env.DB.prepare(
			"SELECT upload_id FROM recording_uploads WHERE share_code = ?",
		)
			.bind(code)
			.first();
		const object = await env.VIDEOS_BUCKET.head(key);
		if (route === "upload-data") {
			if (session) return errorResponse("A multipart upload is already in progress", 409);
			if (video.file_size > 50 * 1024 * 1024)
				return errorResponse("Use multipart upload for recordings over 50 MB", 413);
			if (!TYPES.has(request.headers.get("Content-Type")))
				return errorResponse("Unsupported recording type");
			if (object)
				return object.size === video.file_size
					? jsonResponse({ ok: true })
					: errorResponse("Stored recording size mismatch", 409);
			return exactUpload(request, video.file_size, (stream) =>
				env.VIDEOS_BUCKET.put(key, stream, {
					httpMetadata: { contentType: request.headers.get("Content-Type") },
				}),
			);
		}
		if (route === "upload-multipart") {
			if (object) return errorResponse("Recording bytes have already been uploaded", 409);
			if (session) return jsonResponse({ uploadId: session.upload_id });
			const upload = await env.VIDEOS_BUCKET.createMultipartUpload(key, {
				httpMetadata: { contentType: "video/mp4" },
			});
			try {
				await env.DB.prepare(
					"INSERT INTO recording_uploads (share_code, upload_id) VALUES (?, ?)",
				)
					.bind(code, upload.uploadId)
					.run();
			} catch (error) {
				await upload.abort();
				throw error;
			}
			return jsonResponse({ uploadId: upload.uploadId });
		}
		const uploadId = decodeUploadId(rawId || "");
		if (!uploadId || !session || session.upload_id !== uploadId)
			return errorResponse("Upload session not found", 404);
		if (route === "upload-abort") {
			await abortStoredMultipart(env, code);
			return jsonResponse({ ok: true });
		}
		if (object)
			return route === "upload-complete" && object.size === video.file_size
				? jsonResponse({ ok: true })
				: errorResponse("Recording bytes have already been uploaded", 409);
		const upload = env.VIDEOS_BUCKET.resumeMultipartUpload(key, uploadId);
		const count = Math.ceil(video.file_size / PART_BYTES);
		if (route === "upload-part") {
			const number = Number(rawPart);
			if (!Number.isInteger(number) || number < 1 || number > count)
				return errorResponse("Invalid part number");
			const length = Math.min(PART_BYTES, video.file_size - (number - 1) * PART_BYTES);
			return exactUpload(request, length, (stream) => upload.uploadPart(number, stream));
		}
		if (route === "upload-complete") {
			const body = await limitedJson(request, 65536);
			if (
				!Array.isArray(body.parts) ||
				body.parts.length !== count ||
				body.parts.some(
					(part, i) =>
						!part ||
						part.partNumber !== i + 1 ||
						typeof part.etag !== "string" ||
						!part.etag ||
						part.etag.length > 200,
				)
			)
				return errorResponse("Invalid multipart manifest");
			const result = await upload.complete(body.parts);
			if (result.size !== video.file_size) {
				await env.VIDEOS_BUCKET.delete(key);
				await env.DB.prepare("DELETE FROM recording_uploads WHERE share_code = ?")
					.bind(code)
					.run();
				return errorResponse("Completed recording size mismatch", 400);
			}
			// Keep the ID until deletion for retry idempotence and crash recovery.
			return jsonResponse({ ok: true });
		}
		return errorResponse("Not found", 404);
	});
}
