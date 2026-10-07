// Adapted from Voom (MIT), Copyright (c) 2026 Aritro Paul.
// See ../../LICENSE and ../../../../THIRD_PARTY_NOTICES.md for attribution.

import { generateSalt, sha256Hex, timingSafeEqual, hashRecordingPassword } from "./crypto.js";
import { errorResponse, jsonResponse, parseCookies } from "./http.js";
import { limitedJson } from "./hostedUploads.js";

/**
 * Validates a Bearer token for self-host API access.
 *
 * Accepts the static API_SECRET when ALLOW_API_SECRET_UPLOADS is enabled;
 * otherwise verifies the token against Supabase Auth and requires the
 * authenticated user to match the configured OWNER_USER_ID.
 *
 * @param {Request} request Incoming request with the Authorization header.
 * @param {object} env Worker environment bindings and secrets.
 * @returns {Promise<boolean>} True when the caller may use self-host API routes.
 */

export async function isAuthorized(request, env) {
	const auth = request.headers.get("Authorization");
	if (!auth) return false;
	const match = /^Bearer ([^\s]+)$/.exec(auth);
	if (!match) return false;
	const token = match[1];
	if (token.length > 8192) return false;
	if (
		env.ALLOW_API_SECRET_UPLOADS === "true" &&
		env.API_SECRET &&
		timingSafeEqual(token, env.API_SECRET)
	)
		return true;
	if (!env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY || !env.OWNER_USER_ID) return false;
	try {
		const authBase = new URL(env.SUPABASE_URL);
		const isLocal = authBase.hostname === "localhost" || authBase.hostname === "127.0.0.1";
		if (authBase.protocol !== "https:" && !(authBase.protocol === "http:" && isLocal))
			return false;
		const userUrl = new URL("/auth/v1/user", authBase);
		const response = await fetch(userUrl, {
			headers: {
				Authorization: `Bearer ${token}`,
				apikey: env.SUPABASE_PUBLISHABLE_KEY,
			},
		});
		if (!response.ok) return false;
		const user = await response.json();
		return typeof user.id === "string" && timingSafeEqual(user.id, env.OWNER_USER_ID);
	} catch {
		return false;
	}
}

// Hosted accounts never inherit self-host API-secret or dashboard-cookie access.
export async function hostedUser(request, env) {
	const auth = request.headers.get("Authorization") || "";
	if (!/^Bearer [^\s]+$/.test(auth) || auth.length > 8200) return null;
	if (!env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY) return null;
	try {
		const base = new URL(env.SUPABASE_URL);
		if (base.protocol !== "https:") return null;
		const response = await fetch(new URL("/auth/v1/user", base), {
			headers: { Authorization: auth, apikey: env.SUPABASE_PUBLISHABLE_KEY },
			redirect: "error",
			signal: AbortSignal.timeout(10000),
		});
		if (!response.ok) return null;
		const user = await response.json();
		if (
			typeof user.id !== "string" ||
			!user.id ||
			!user.email ||
			!user.email_confirmed_at ||
			user.is_anonymous
		)
			return null;
		if (env.STAGING_ALLOWED_USER_ID && user.id !== env.STAGING_ALLOWED_USER_ID) return null;
		return { id: user.id };
	} catch {
		return null;
	}
}

async function generateAuthToken(shareCode, expiresAt, apiSecret) {
	const encoder = new TextEncoder();
	const key = await crypto.subtle.importKey(
		"raw",
		encoder.encode(apiSecret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(shareCode + expiresAt));
	return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function verifyPasswordAuth(request, env, shareCode, video) {
	if (!video.password_hash) return true;
	if (!env.API_SECRET) return false;
	const cookies = parseCookies(request.headers.get("Cookie") || "");
	const authToken = cookies[`voom_auth_${shareCode}`];
	if (!authToken) return false;
	const expected = await generateAuthToken(shareCode, video.expires_at, env.API_SECRET);
	return timingSafeEqual(authToken, expected);
}

// --- Dashboard session helpers ---

export function dashboardPassword(env) {
	return env.DASHBOARD_PASSWORD || env.API_SECRET;
}

export async function expectedSessionToken(
	env,
	expiresAt = Math.floor(Date.now() / 1000) + 604800,
) {
	const password = dashboardPassword(env);
	if (!password) throw new Error("Dashboard sign-in is not configured");
	const encoder = new TextEncoder();
	const key = await crypto.subtle.importKey(
		"raw",
		encoder.encode(password),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const sig = await crypto.subtle.sign(
		"HMAC",
		key,
		encoder.encode(`voom-dashboard-v2:${expiresAt}`),
	);
	return (
		`${expiresAt}.` +
		Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("")
	);
}

export async function isDashboardAuthed(request, env) {
	if (env.HOSTED_MODE === "true") return false;
	return (await isAuthorized(request, env)) || dashboardCookieAuthed(request, env);
}

export async function dashboardCookieAuthed(request, env) {
	if (!dashboardPassword(env)) return false;
	const cookies = parseCookies(request.headers.get("Cookie") || "");
	const sessionToken = cookies["voom_session"];
	if (!sessionToken || !/^\d+\.[0-9a-f]{64}$/.test(sessionToken)) return false;
	const expiresAt = Number(sessionToken.split(".")[0]);
	if (!Number.isSafeInteger(expiresAt) || expiresAt <= Math.floor(Date.now() / 1000))
		return false;
	return timingSafeEqual(sessionToken, await expectedSessionToken(env, expiresAt));
}

// best-effort, per-isolate login rate limiter (real protection is the password's entropy)
const _loginAttempts = new Map();

export function checkLoginRateLimit(ip) {
	const now = Date.now();
	const entry = _loginAttempts.get(ip);
	if (entry && now < entry.resetAt) {
		if (entry.count >= 10) return false;
		entry.count++;
	} else {
		_loginAttempts.set(ip, { count: 1, resetAt: now + 5 * 60 * 1000 });
	}
	return true;
}

export function clearLoginRateLimit(ip) {
	_loginAttempts.delete(ip);
}

// --- Password Verification ---

/**
 * Handles password verification for a shared recording.
 *
 * Rate-limits attempts per IP and video, compares the submitted password
 * against the stored hash (upgrading legacy SHA-256 hashes to the slow
 * PBKDF2 variant on success), and issues an HMAC session cookie on match.
 * The request body is read via limitedJson because this endpoint is
 * reachable without authentication.
 *
 * @param {Request} request Incoming request with the password payload.
 * @param {object} env Worker environment bindings and secrets.
 * @param {string} shareCode Share code of the target recording.
 * @returns {Promise<Response>} JSON response with the auth cookie or an error.
 */

export async function handleVerifyPassword(request, env, shareCode) {
	const video = await env.DB.prepare(
		"SELECT * FROM videos WHERE share_code = ? AND upload_completed = 1 AND datetime(expires_at) > datetime('now')",
	)
		.bind(shareCode)
		.first();

	if (!video || !video.password_hash) return errorResponse("Not found", 404);
	if (!env.API_SECRET) return errorResponse("Password protection is not configured", 503);

	// Brute-force protection: 10 attempts per IP per video per 5 minutes.
	const clientIP = request.headers.get("CF-Connecting-IP") || "unknown";
	const recent = await env.DB.prepare(
		"SELECT COUNT(*) as cnt FROM password_attempts WHERE video_id = ? AND client_ip = ? AND datetime(attempted_at) > datetime('now', '-5 minutes')",
	)
		.bind(video.id, clientIP)
		.first();
	if (recent && recent.cnt >= 10)
		return errorResponse("Too many attempts — try again later", 429);

	const body = await limitedJson(request, 16384);
	const password = body.password || "";

	const clientHash = await sha256Hex(password);
	const slowHash = video.password_hash.startsWith("pbkdf2-sha256:210000:");
	const actual = slowHash
		? await hashRecordingPassword(clientHash, video.password_salt)
		: video.password_salt
			? await sha256Hex(video.password_salt + clientHash)
			: clientHash;
	const matches = timingSafeEqual(actual, video.password_hash);
	if (matches && !slowHash) {
		const salt = generateSalt();
		const upgraded = await hashRecordingPassword(clientHash, salt);
		await env.DB.prepare("UPDATE videos SET password_hash = ?, password_salt = ? WHERE id = ?")
			.bind(upgraded, salt, video.id)
			.run();
	}

	if (!matches) {
		await env.DB.prepare("INSERT INTO password_attempts (video_id, client_ip) VALUES (?, ?)")
			.bind(video.id, clientIP)
			.run();
		return jsonResponse({ error: "Incorrect password" }, 403);
	}

	// Issue an HMAC session token (never the stored hash).
	const authToken = await generateAuthToken(shareCode, video.expires_at, env.API_SECRET);
	const expires = new Date(video.expires_at + "Z");

	return new Response(JSON.stringify({ ok: true }), {
		status: 200,
		headers: {
			"Content-Type": "application/json",
			"Set-Cookie": `voom_auth_${shareCode}=${authToken}; Path=/; Expires=${expires.toUTCString()}; HttpOnly; SameSite=Lax; Secure`,
		},
	});
}
