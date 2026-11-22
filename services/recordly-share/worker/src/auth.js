import { AVAILABLE_RECORDING_SQL, parseDatabaseTimestamp } from "./video.js";
// Adapted from Voom (MIT), Copyright (c) 2026 Aritro Paul.
// See ../../LICENSE and ../../../../THIRD_PARTY_NOTICES.md for attribution.

import { generateSalt, hashRecordingPassword, sha256Hex, timingSafeEqual } from "./crypto.js";
import { errorResponse, jsonResponse, parseCookies } from "./http.js";
import { limitedJson } from "./requestBody.js";

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
	const parts = /^v2\.(\d{1,12})\.([a-f0-9]{64})$/.exec(authToken || "");
	if (parts) {
		const deadline = Number(parts[1]);
		const seconds = Math.floor(Date.now() / 1000);
		if (
			!Number.isSafeInteger(deadline) ||
			deadline <= seconds ||
			deadline > seconds + 7 * 86400
		)
			return false;
		const expected = await generateAuthToken(
			`voom-video-v2:${shareCode}:`,
			`${video.expires_at}:${deadline}`,
			env.API_SECRET,
		);
		return timingSafeEqual(parts[2], expected);
	}
	// Old tokens rely on the recording's fixed retention deadline. They must not
	// become permanent sessions when a recording has no expiration.
	if (video.never_expires === 1 || !/^[a-f0-9]{64}$/.test(authToken || "")) return false;
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

export async function handleVerifyPassword(request, env, shareCode) {
	const video = await env.DB.prepare(
		`SELECT * FROM videos WHERE share_code = ? AND upload_completed = 1 AND ${AVAILABLE_RECORDING_SQL}`,
	)
		.bind(shareCode)
		.first();

	if (!video || !video.password_hash) return errorResponse("Not found", 404);
	if (!env.API_SECRET) return errorResponse("Password protection is not configured", 503);

	const body = await limitedJson(request, 8192);
	const password = body.password;
	if (typeof password !== "string" || password.length > 1024)
		return errorResponse("Invalid password");

	// Reserve before expensive hashing. Count successful attempts too, and keep
	// admission atomic so parallel guesses cannot all observe spare capacity.
	const clientIP = request.headers.get("CF-Connecting-IP") || "unknown";
	const admitted = await env.DB.prepare(
		`INSERT INTO password_attempts (video_id, client_ip)
		 SELECT ?, ? WHERE (SELECT COUNT(*) FROM password_attempts
		 WHERE video_id = ? AND client_ip = ? AND attempted_at > datetime('now', '-5 minutes')) < 10`,
	)
		.bind(video.id, clientIP, video.id, clientIP)
		.run();
	if (!admitted.meta.changes) return errorResponse("Too many attempts — try again later", 429);

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
		return jsonResponse({ error: "Incorrect password" }, 403);
	}

	// Issue an HMAC session token (never the stored hash).
	const sevenDays = Math.floor(Date.now() / 1000) + 7 * 86400;
	const deadline =
		video.never_expires === 1
			? sevenDays
			: Math.min(sevenDays, Math.floor(parseDatabaseTimestamp(video.expires_at) / 1000));
	const signature = await generateAuthToken(
		`voom-video-v2:${shareCode}:`,
		`${video.expires_at}:${deadline}`,
		env.API_SECRET,
	);
	const authToken = `v2.${deadline}.${signature}`;
	const expires = new Date(deadline * 1000);

	return new Response(JSON.stringify({ ok: true }), {
		status: 200,
		headers: {
			"Content-Type": "application/json",
			"Set-Cookie": `voom_auth_${shareCode}=${authToken}; Path=/; Expires=${expires.toUTCString()}; HttpOnly; SameSite=Lax; Secure`,
		},
	});
}
