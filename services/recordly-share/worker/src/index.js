// Adapted from Voom (MIT), Copyright (c) 2026 Aritro Paul.
// See ../../LICENSE and ../../../../THIRD_PARTY_NOTICES.md for attribution.

import { handleRequest } from "./router.js";
import { errorResponse } from "./http.js";
import { ensureSchema } from "./schema.js";
import { cleanupExpired } from "./library.js";

export default {
	async fetch(request, env) {
		try {
			return await handleRequest(request, env);
		} catch (e) {
			if (e.message === "BODY_TOO_LARGE")
				return errorResponse("Request body is too large", 413);
			if (e.message === "INVALID_JSON") return errorResponse("Invalid JSON body", 400);
			// D1/R2 transient failures and bugs land here instead of surfacing as
			// opaque Workers runtime errors. Keep the response app-shaped (JSON).
			console.error(
				"unhandled error",
				request.method,
				new URL(request.url).pathname,
				e.message,
				e.stack,
			);
			return errorResponse("Internal error", 500);
		}
	},

	async scheduled(event, env) {
		try {
			await ensureSchema(env);
			await cleanupExpired(env);
		} catch (e) {
			console.error("cron cleanup failed", e.message, e.stack);
			throw e; // Surface failed runs to Cloudflare monitoring instead of reporting success.
		}
	},
};

// Kept for existing consumers and the Worker integration tests.
export { __resetSchemaCacheForTests } from "./schema.js";
export { generateShareCode } from "./uploads.js";
export { escapeHTML } from "./media.js";
export { parseCookies } from "./http.js";
export { timingSafeEqual, sha256Hex, generateSalt } from "./crypto.js";
export { formatVTTTime } from "./media.js";
export { expectedSessionToken, dashboardPassword } from "./auth.js";
