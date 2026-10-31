// Adapted from Voom (MIT), Copyright (c) 2026 Aritro Paul.
// See ../../LICENSE and ../../../../THIRD_PARTY_NOTICES.md for attribution.

import { errorResponse, parseCookies } from './http.js';
import { generateSalt, sha256Hex, timingSafeEqual } from './crypto.js';
import { checkLoginRateLimit, clearLoginRateLimit } from './auth.js';

const COMMENT_SESSION_COOKIE = 'recordly_comment_session';

const COMMENT_SESSION_SECONDS = 30 * 24 * 60 * 60;

async function hashCommentPassword(password, salt) {
  const material = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: new TextEncoder().encode(salt),
      iterations: 210000,
    },
    material,
    256,
  );
  return Array.from(new Uint8Array(bits), b => b.toString(16).padStart(2, '0')).join('');
}

function generateSessionToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

function commentSessionCookie(request, token, maxAge = COMMENT_SESSION_SECONDS) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${COMMENT_SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure}`;
}

export async function commentViewer(request, env) {
  const cookies = parseCookies(request.headers.get('Cookie') || '');
  const token = cookies[COMMENT_SESSION_COOKIE];
  if (!token) return null;
  const tokenHash = await sha256Hex(token);
  return env.DB.prepare(
    `SELECT u.id, u.email, u.display_name
     FROM comment_sessions s
     JOIN comment_users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND datetime(s.expires_at) > datetime('now')`
  ).bind(tokenHash).first();
}

async function createCommentSession(request, env, user) {
  const token = generateSessionToken();
  const tokenHash = await sha256Hex(token);
  const expiresAt = new Date(Date.now() + COMMENT_SESSION_SECONDS * 1000).toISOString();
  await env.DB.prepare(
    'INSERT INTO comment_sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)'
  ).bind(tokenHash, user.id, expiresAt).run();
  return new Response(JSON.stringify({
    user: { email: user.email, displayName: user.display_name },
  }), {
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': commentSessionCookie(request, token),
    },
  });
}

export async function handleCommentRegister(request, env) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (!checkLoginRateLimit(`register:${ip}`)) return errorResponse('Too many attempts', 429);
  const body = await request.json();
  const email = String(body.email || '').trim().toLowerCase();
  const displayName = String(body.displayName || '').trim();
  const password = String(body.password || '');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return errorResponse('Enter a valid email address');
  }
  if (displayName.length < 2 || displayName.length > 100) {
    return errorResponse('Display name must be between 2 and 100 characters');
  }
  if (password.length < 8 || password.length > 256) {
    return errorResponse('Password must be between 8 and 256 characters');
  }
  const salt = generateSalt();
  const passwordHash = await hashCommentPassword(password, salt);
  try {
    const result = await env.DB.prepare(
      'INSERT INTO comment_users (email, display_name, password_hash, password_salt) VALUES (?, ?, ?, ?)'
    ).bind(email, displayName, passwordHash, salt).run();
    return createCommentSession(request, env, { id: result.meta.last_row_id, email, display_name: displayName });
  } catch (error) {
    if (/unique|constraint/i.test(error.message || '')) {
      return errorResponse('An account with this email already exists', 409);
    }
    throw error;
  }
}

export async function handleCommentLogin(request, env) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (!checkLoginRateLimit(`comment:${ip}`)) return errorResponse('Too many attempts', 429);
  const body = await request.json();
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  const user = await env.DB.prepare(
    'SELECT id, email, display_name, password_hash, password_salt FROM comment_users WHERE email = ?'
  ).bind(email).first();
  if (!user) return errorResponse('Incorrect email or password', 401);
  const actualHash = await hashCommentPassword(password, user.password_salt);
  if (!timingSafeEqual(actualHash, user.password_hash)) {
    return errorResponse('Incorrect email or password', 401);
  }
  clearLoginRateLimit(`comment:${ip}`);
  return createCommentSession(request, env, user);
}

export async function handleCommentLogout(request, env) {
  const cookies = parseCookies(request.headers.get('Cookie') || '');
  const token = cookies[COMMENT_SESSION_COOKIE];
  if (token) {
    await env.DB.prepare('DELETE FROM comment_sessions WHERE token_hash = ?')
      .bind(await sha256Hex(token)).run();
  }
  return new Response(JSON.stringify({ ok: true }), {
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': commentSessionCookie(request, '', 0),
    },
  });
}
