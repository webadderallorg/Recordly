import { AVAILABLE_RECORDING_SQL } from "./video.js";

// Adapted from Voom (MIT), Copyright (c) 2026 Aritro Paul.
// See ../../LICENSE and ../../../../THIRD_PARTY_NOTICES.md for attribution.

import {
	commentViewer,
	handleCommentLogin,
	handleCommentLogout,
	handleCommentRegister,
} from "./accounts.js";
import {
	checkLoginRateLimit,
	clearLoginRateLimit,
	dashboardCookieAuthed,
	dashboardPassword,
	expectedSessionToken,
	handleVerifyPassword,
	isAuthorized,
	isDashboardAuthed,
	verifyPasswordAuth,
} from "./auth.js";
import { timingSafeEqual } from "./crypto.js";
import {
	handleComment,
	handleGetComments,
	handleGetReactions,
	handleManageComment,
	handleReact,
} from "./feedback.js";
import { errorResponse, jsonResponse } from "./http.js";
import { handleCheckViews, handleDelete, handleListVideos, handleRenew } from "./library.js";
import {
	handleOGImage,
	handleOGPage,
	handleShareData,
	handleVideoStream,
	handleVTT,
} from "./media.js";
import { ensureSchema } from "./schema.js";
import { handleReport } from "./moderation.js";
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

export async function handleRequest(request, env) {
	const url = new URL(request.url);
	const path = url.pathname;
	// Never let a stale hosted configuration fall back to single-owner access.
	if (env.HOSTED_MODE === "true")
		return errorResponse("Hosted deployments require the separate private service", 503);
	if (
		path === "/api/billing" ||
		path.startsWith("/api/billing/") ||
		(path.startsWith("/billing/") && path !== "/billing/")
	)
		return errorResponse("Not found", 404);

	// Public policies must remain reachable during database outages.
	if (
		["/privacy", "/terms", "/billing", "/contact"].includes(path.replace(/\/$/, "")) &&
		["GET", "HEAD"].includes(request.method) &&
		env.ASSETS
	)
		return env.ASSETS.fetch(request);

	await ensureSchema(env);

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

		const ownerId = null;
		if (!(await isAuthorized(request, env)) && !(await dashboardCookieAuthed(request, env)))
			return errorResponse("Unauthorized", 401);

		// Connection check used by the desktop app to validate a worker URL + secret.
		if (path === "/api/health" && request.method === "GET") {
			return jsonResponse({ ok: true, app: "recordly" });
		}

		if (path === "/api/videos" && request.method === "GET") {
			return handleListVideos(env, ownerId, request);
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
			return handleCheckViews(request, env, ownerId);
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

	// Password verification (public)
	const reportMatch = path.match(/^\/s\/([a-z0-9]+)\/report$/);
	if (reportMatch && request.method === "POST") return handleReport(request, env, reportMatch[1]);

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
	const commentManageMatch = path.match(/^\/s\/([a-z0-9]+)\/comments\/([^/]+)$/);
	if (commentManageMatch) {
		if (!["PATCH", "DELETE"].includes(request.method)) return errorResponse("Not found", 404);
		return handleManageComment(request, env, commentManageMatch[1], commentManageMatch[2]);
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
		const appRequest = new Request(new URL("/share", url), request);
		// The static shell's validators do not describe per-recording metadata.
		appRequest.headers.delete("If-None-Match");
		appRequest.headers.delete("If-Modified-Since");
		const appResponse = await env.ASSETS.fetch(appRequest);
		return handleOGPage(request, env, shareCode, appResponse);
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
			`SELECT password_hash, expires_at, never_expires FROM videos WHERE share_code = ? AND upload_completed = 1 AND ${AVAILABLE_RECORDING_SQL}`,
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
					"Cache-Control": "private, no-store",
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
		return Response.redirect(new URL("/library", url), 302);
	}

	// Fall through to static assets
	return env.ASSETS.fetch(request);
}
