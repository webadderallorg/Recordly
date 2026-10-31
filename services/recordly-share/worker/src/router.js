// Adapted from Voom (MIT), Copyright (c) 2026 Aritro Paul.
// See ../../LICENSE and ../../../../THIRD_PARTY_NOTICES.md for attribution.

import { handleHostedRecording, limitedJson } from "./hostedUploads.js";
import { ensureSchema } from "./schema.js";
import {
	commentViewer,
	handleCommentLogin,
	handleCommentLogout,
	handleCommentRegister,
} from "./accounts.js";
import { errorResponse, jsonResponse } from "./http.js";
import {
	checkLoginRateLimit,
	clearLoginRateLimit,
	dashboardCookieAuthed,
	dashboardPassword,
	expectedSessionToken,
	handleVerifyPassword,
	hostedUser,
	isAuthorized,
	isDashboardAuthed,
	verifyPasswordAuth,
} from "./auth.js";
import { timingSafeEqual } from "./crypto.js";
import { handleCheckViews, handleDelete, handleListVideos, handleRenew } from "./library.js";
import {
	decodeUploadId,
	handleMetadata,
	handleMultipartAbort,
	handleMultipartComplete,
	handleMultipartPart,
	handleMultipartStart,
	handleUpload,
	handleUploadData,
	handleUploadThumbnail,
} from "./uploads.js";
import {
	handleOGImage,
	handleOGPage,
	handleShareData,
	handleVTT,
	handleVideoStream,
} from "./media.js";
import { handleComment, handleGetComments, handleGetReactions, handleReact } from "./feedback.js";

export async function handleRequest(request, env) {
	const url = new URL(request.url);
	const path = url.pathname;

	const hosted = env.HOSTED_MODE === "true";
	if (hosted) {
		if (!env.REQUEST_RATE_LIMIT || !env.ACCOUNT_RATE_LIMIT)
			return errorResponse("Hosted rate limits are not configured", 503);
		const { success } = await env.REQUEST_RATE_LIMIT.limit({
			key: request.headers.get("CF-Connecting-IP") || "local",
		});
		if (!success) return errorResponse("Too many requests. Try again in a minute.", 429);
	}
	await ensureSchema(env);
	// The shared-password dashboard and legacy comment accounts are self-host only.
	if (hosted && (path.startsWith("/library") || path.startsWith("/auth/"))) {
		return errorResponse("Not found", 404);
	}

	if (path === "/auth/session" && request.method === "GET") {
		const viewer = await commentViewer(request, env);
		return jsonResponse({
			user: viewer ? { email: viewer.email, displayName: viewer.display_name } : null,
		});
	}
	if (path === "/auth/register" && request.method === "POST") {
		return handleCommentRegister(request, env);
	}
	if (path === "/auth/login" && request.method === "POST") {
		return handleCommentLogin(request, env);
	}
	if (path === "/auth/logout" && request.method === "POST") {
		return handleCommentLogout(request, env);
	}

	// Library login (public — no bearer required; form POST)
	if (path === "/library/login" && request.method === "POST") {
		const ip = request.headers.get("CF-Connecting-IP") || "unknown";
		if (!checkLoginRateLimit(ip)) {
			return new Response("Too many attempts — try again later", { status: 429 });
		}
		const form = await request.formData();
		const password = form.get("password") || "";
		if (timingSafeEqual(password, dashboardPassword(env))) {
			clearLoginRateLimit(ip);
			const token = await expectedSessionToken(env);
			return new Response(null, {
				status: 302,
				headers: {
					Location: "/library",
					"Set-Cookie": `voom_session=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=604800`,
				},
			});
		}
		return new Response(null, { status: 302, headers: { Location: "/library/login?error=1" } });
	}

	// Library logout
	if (path === "/library/logout" && request.method === "GET") {
		return new Response(null, {
			status: 302,
			headers: {
				Location: "/library/login",
				"Set-Cookie": "voom_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0",
			},
		});
	}

	// Library dashboard (auth-gated)
	// Internal asset is /lib.html (not /library.html) so the ASSETS binding
	// does not auto-serve it before the worker runs (no run_worker_first needed).
	if (path === "/library" && request.method === "GET") {
		if (!(await isDashboardAuthed(request, env))) {
			return new Response(null, { status: 302, headers: { Location: "/library/login" } });
		}
		return env.ASSETS.fetch(new Request(new URL("/lib", url), request));
	}

	// Library login page (public)
	if (path === "/library/login" && request.method === "GET") {
		return env.ASSETS.fetch(new Request(new URL("/lib-login", url), request));
	}

	// API routes (authenticated)
	if (path.startsWith("/api/")) {
		if (request.method === "OPTIONS") {
			return new Response(null, {
				headers: {
					"Access-Control-Allow-Origin": "*",
					"Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
					"Access-Control-Allow-Headers": "Authorization, Content-Type",
				},
			});
		}

		let ownerId = null;
		if (hosted) {
			const user = await hostedUser(request, env);
			if (!user) return errorResponse("Verified sign-in required", 401);
			ownerId = user.id;
			if (!(await env.ACCOUNT_RATE_LIMIT.limit({ key: ownerId })).success)
				return errorResponse("Too many account requests. Try again in a minute.", 429);
			if (!["/api/health", "/api/videos", "/api/upload", "/api/check-views"].includes(path)) {
				const route = path.match(
					/^\/api\/(upload-data|upload-thumbnail|upload-multipart|upload-part|upload-complete|upload-abort|metadata|renew|delete)\/([a-z0-9]+)(?:\/([^/]+)(?:\/(\d+))?)?$/,
				);
				if (!route) return errorResponse("Not found", 404);
				const expected =
					{
						"upload-data": "PUT",
						"upload-thumbnail": "PUT",
						"upload-part": "PUT",
						delete: "DELETE",
					}[route[1]] || "POST";
				if (
					request.method !== expected ||
					(route[1] === "upload-part" ? !route[4] : route[4] !== undefined) ||
					(["upload-part", "upload-complete", "upload-abort"].includes(route[1])
						? !route[3]
						: route[3] !== undefined)
				)
					return errorResponse("Not found", 404);
				return handleHostedRecording(request, env, ownerId, ...route.slice(1));
			}
		} else if (
			!(await isAuthorized(request, env)) &&
			!(await dashboardCookieAuthed(request, env))
		) {
			return errorResponse("Unauthorized", 401);
		}

		// Connection check used by the desktop app to validate a worker URL + secret.
		if (path === "/api/health" && request.method === "GET") {
			return jsonResponse({ ok: true, app: "recordly" });
		}

		if (path === "/api/videos" && request.method === "GET") {
			return handleListVideos(env, ownerId);
		}

		if (path === "/api/upload" && request.method === "POST") {
			return handleUpload(request, env, ownerId);
		}

		const uploadDataMatch = path.match(/^\/api\/upload-data\/([a-z0-9]+)$/);
		if (uploadDataMatch && request.method === "PUT") {
			return handleUploadData(request, env, uploadDataMatch[1]);
		}

		const thumbnailMatch = path.match(/^\/api\/upload-thumbnail\/([a-z0-9]+)$/);
		if (thumbnailMatch && request.method === "PUT") {
			return handleUploadThumbnail(request, env, thumbnailMatch[1]);
		}

		const multipartStartMatch = path.match(/^\/api\/upload-multipart\/([a-z0-9]+)$/);
		if (multipartStartMatch && request.method === "POST") {
			return handleMultipartStart(request, env, multipartStartMatch[1]);
		}

		const multipartPartMatch = path.match(/^\/api\/upload-part\/([a-z0-9]+)\/(.+?)\/(\d+)$/);
		if (multipartPartMatch && request.method === "PUT") {
			const multipartUploadId = decodeUploadId(multipartPartMatch[2]);
			if (!multipartUploadId) return errorResponse("Invalid multipart upload ID");
			return handleMultipartPart(
				request,
				env,
				multipartPartMatch[1],
				multipartUploadId,
				parseInt(multipartPartMatch[3], 10),
			);
		}

		const multipartCompleteMatch = path.match(/^\/api\/upload-complete\/([a-z0-9]+)\/(.+)$/);
		if (multipartCompleteMatch && request.method === "POST") {
			const multipartUploadId = decodeUploadId(multipartCompleteMatch[2]);
			if (!multipartUploadId) return errorResponse("Invalid multipart upload ID");
			return handleMultipartComplete(
				request,
				env,
				multipartCompleteMatch[1],
				multipartUploadId,
			);
		}

		const multipartAbortMatch = path.match(/^\/api\/upload-abort\/([a-z0-9]+)\/(.+)$/);
		if (multipartAbortMatch && request.method === "POST") {
			const multipartUploadId = decodeUploadId(multipartAbortMatch[2]);
			if (!multipartUploadId) return errorResponse("Invalid multipart upload ID");
			return handleMultipartAbort(request, env, multipartAbortMatch[1], multipartUploadId);
		}

		const metadataMatch = path.match(/^\/api\/metadata\/([a-z0-9]+)$/);
		if (metadataMatch && request.method === "POST") {
			return handleMetadata(request, env, metadataMatch[1]);
		}

		const renewMatch = path.match(/^\/api\/renew\/([a-z0-9]+)$/);
		if (renewMatch && request.method === "POST") {
			return handleRenew(env, renewMatch[1]);
		}

		const deleteMatch = path.match(/^\/api\/delete\/([a-z0-9]+)$/);
		if (deleteMatch && request.method === "DELETE") {
			return handleDelete(env, deleteMatch[1]);
		}

		if (path === "/api/check-views" && request.method === "POST") {
			return handleCheckViews(
				hosted
					? new Request(request.url, {
							method: "POST",
							body: JSON.stringify(await limitedJson(request, 16384)),
						})
					: request,
				env,
				ownerId,
			);
		}

		return errorResponse("Not found", 404);
	}

	// CORS preflight for public endpoints
	if (request.method === "OPTIONS") {
		return new Response(null, {
			headers: {
				"Access-Control-Allow-Origin": "*",
				"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
				"Access-Control-Allow-Headers": "Content-Type",
			},
		});
	}

	if (hosted && request.method === "POST") {
		request = new Request(request, { body: JSON.stringify(await limitedJson(request, 16384)) });
	}

	// Password verification (public)
	const verifyMatch = path.match(/^\/s\/([a-z0-9]+)\/verify-password$/);
	if (verifyMatch && request.method === "POST") {
		return handleVerifyPassword(request, env, verifyMatch[1]);
	}

	// Share data endpoint (public, for SPA)
	const dataMatch = path.match(/^\/s\/([a-z0-9]+)\/data$/);
	if (dataMatch && request.method === "GET") {
		return handleShareData(request, env, dataMatch[1]);
	}

	// Reactions (public)
	const reactMatch = path.match(/^\/s\/([a-z0-9]+)\/react$/);
	if (reactMatch && request.method === "POST") {
		return handleReact(request, env, reactMatch[1]);
	}
	const reactGetMatch = path.match(/^\/s\/([a-z0-9]+)\/reactions$/);
	if (reactGetMatch && request.method === "GET") {
		return handleGetReactions(request, env, reactGetMatch[1]);
	}

	// Comments (public)
	const commentMatch = path.match(/^\/s\/([a-z0-9]+)\/comment$/);
	if (commentMatch && request.method === "POST") {
		return handleComment(request, env, commentMatch[1]);
	}
	const commentGetMatch = path.match(/^\/s\/([a-z0-9]+)\/comments$/);
	if (commentGetMatch && request.method === "GET") {
		return handleGetComments(request, env, commentGetMatch[1]);
	}

	// VTT captions
	const vttMatch = path.match(/^\/vtt\/([a-z0-9]+)$/);
	if (vttMatch && request.method === "GET") {
		return handleVTT(request, env, vttMatch[1]);
	}

	// Share page — serve Astro SPA or OG for bots
	const shareMatch = path.match(/^\/s\/([a-z0-9]+)$/);
	if (shareMatch && request.method === "GET") {
		const shareCode = shareMatch[1];
		const ua = request.headers.get("User-Agent") || "";
		if (
			/bot|crawl|spider|facebook|twitter|slack|discord|telegram|whatsapp|linkedin/i.test(ua)
		) {
			return handleOGPage(request, env, shareCode);
		}
		return env.ASSETS.fetch(new Request(new URL("/share", url), request));
	}

	// Video streaming
	const videoMatch = path.match(/^\/v\/([a-z0-9]+)$/);
	if (videoMatch && request.method === "GET") {
		return handleVideoStream(request, env, videoMatch[1]);
	}

	// OG image
	const ogMatch = path.match(/^\/og\/([a-z0-9]+)$/);
	if (ogMatch && request.method === "GET") {
		return handleOGImage(env, ogMatch[1]);
	}

	// Embed player — serve Astro embed page
	const embedMatch = path.match(/^\/embed\/([a-z0-9]+)$/);
	if (embedMatch && request.method === "GET") {
		return env.ASSETS.fetch(new Request(new URL("/embed", url), request));
	}

	// Thumbnail (high-res poster) — gated like the OG image: the poster frame
	// of a password-protected or expired video may itself be sensitive.
	const thumbMatch = path.match(/^\/thumb\/([a-z0-9]+)$/);
	if (thumbMatch && request.method === "GET") {
		const video = await env.DB.prepare(
			"SELECT password_hash, expires_at FROM videos WHERE share_code = ? AND datetime(expires_at) > datetime('now')",
		)
			.bind(thumbMatch[1])
			.first();
		if (!video) return new Response("Not found", { status: 404 });
		if (!(await verifyPasswordAuth(request, env, thumbMatch[1], video))) {
			return new Response("Not found", { status: 404 });
		}
		const thumb = await env.VIDEOS_BUCKET.get(`thumbnails/${thumbMatch[1]}.jpg`);
		if (thumb) {
			return new Response(thumb.body, {
				// Recheck the unlock cookie on every protected poster request.
				headers: {
					"Content-Type": "image/jpeg",
					"Cache-Control": video.password_hash
						? "private, no-store"
						: "public, max-age=86400",
				},
			});
		}
		return new Response("Not found", { status: 404 });
	}

	// Static assets from R2
	if (path === "/icon-64.png" && request.method === "GET") {
		const obj = await env.VIDEOS_BUCKET.get("static/icon-64.png");
		if (obj) {
			return new Response(obj.body, {
				headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=604800" },
			});
		}
	}

	if (path === "/") {
		return new Response("Recordly Share", { status: 200 });
	}

	// Fall through to static assets
	return env.ASSETS.fetch(request);
}
