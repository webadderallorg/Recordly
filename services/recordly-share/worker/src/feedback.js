// Adapted from Voom (MIT), Copyright (c) 2026 Aritro Paul.
// See ../../LICENSE and ../../../../THIRD_PARTY_NOTICES.md for attribution.

import { errorResponse, jsonResponse } from './http.js';
import { verifyPasswordAuth } from './auth.js';

// --- Reactions ---

export async function handleReact(request, env, shareCode) {
  const video = await env.DB.prepare(
    "SELECT id, password_hash, expires_at FROM videos WHERE share_code = ? AND upload_completed = 1 AND datetime(expires_at) > datetime('now')"
  ).bind(shareCode).first();

  if (!video) return errorResponse('Not found', 404);

  // Password check
  if (video.password_hash) {
    const authed = await verifyPasswordAuth(request, env, shareCode, video);
    if (!authed) return errorResponse('Unauthorized', 401);
  }

  const body = await request.json();
  const { timestamp, emoji } = body;
  const allowedEmojis = ['👍', '❤️', '😂', '😮', '🔥', '👏'];
  if (!allowedEmojis.includes(emoji)) return errorResponse('Invalid emoji');
  if (typeof timestamp !== 'number' || timestamp < 0) return errorResponse('Invalid timestamp');

  // Rate limit: 50 reactions per IP per video
  const clientIP = request.headers.get('CF-Connecting-IP') || 'unknown';
  const count = await env.DB.prepare(
    'SELECT COUNT(*) as cnt FROM reactions WHERE video_id = ? AND client_ip = ?'
  ).bind(video.id, clientIP).first();
  if (count && count.cnt >= 50) return errorResponse('Rate limit exceeded', 429);

  await env.DB.prepare(
    'INSERT INTO reactions (video_id, timestamp, emoji, client_ip) VALUES (?, ?, ?, ?)'
  ).bind(video.id, timestamp, emoji, clientIP).run();

  return jsonResponse({ ok: true });
}

export async function handleGetReactions(request, env, shareCode) {
  const video = await env.DB.prepare(
    "SELECT id, password_hash, expires_at FROM videos WHERE share_code = ? AND upload_completed = 1 AND datetime(expires_at) > datetime('now')"
  ).bind(shareCode).first();

  if (!video) return errorResponse('Not found', 404);

  // Same gate as POST /react — listing must not bypass the password.
  const authed = await verifyPasswordAuth(request, env, shareCode, video);
  if (!authed) return errorResponse('Password required', 401);

  const reactions = await env.DB.prepare(
    'SELECT timestamp, emoji, created_at FROM reactions WHERE video_id = ? ORDER BY created_at DESC LIMIT 500'
  ).bind(video.id).all();

  return jsonResponse({ reactions: reactions.results || [] });
}

// --- Comments ---

export async function handleComment(request, env, shareCode) {
  const video = await env.DB.prepare(
    "SELECT id, password_hash, expires_at FROM videos WHERE share_code = ? AND upload_completed = 1 AND datetime(expires_at) > datetime('now')"
  ).bind(shareCode).first();

  if (!video) return errorResponse('Not found', 404);

  // Password check
  if (video.password_hash) {
    const authed = await verifyPasswordAuth(request, env, shareCode, video);
    if (!authed) return errorResponse('Unauthorized', 401);
  }

  const body = await request.json();
  const { timestamp, text, author_name: authorName } = body;
  if (typeof timestamp !== 'number' || timestamp < 0) return errorResponse('Invalid timestamp');
  if (!authorName || typeof authorName !== 'string' || authorName.trim().length === 0) {
    return errorResponse('Display name is required');
  }
  if (authorName.length > 100) return errorResponse('Display name is too long');
  if (!text || text.trim().length === 0) return errorResponse('Text is required');
  if (text.length > 2000) return errorResponse('Text too long');

  // Rate limit: 5 comments per IP per 5 minutes
  const clientIP = request.headers.get('CF-Connecting-IP') || 'unknown';
  const recent = await env.DB.prepare(
    "SELECT COUNT(*) as cnt FROM comments WHERE video_id = ? AND client_ip = ? AND datetime(created_at) > datetime('now', '-5 minutes')"
  ).bind(video.id, clientIP).first();
  if (recent && recent.cnt >= 5) return errorResponse('Rate limit exceeded', 429);

  const inserted = await env.DB.prepare(
    'INSERT INTO comments (video_id, timestamp, author_name, text, client_ip) VALUES (?, ?, ?, ?, ?)'
  ).bind(video.id, timestamp, authorName.trim(), text.trim().substring(0, 2000), clientIP).run();

  return jsonResponse({ ok: true, id: inserted.meta.last_row_id });
}

export async function handleGetComments(request, env, shareCode) {
  const video = await env.DB.prepare(
    "SELECT id, password_hash, expires_at FROM videos WHERE share_code = ? AND upload_completed = 1 AND datetime(expires_at) > datetime('now')"
  ).bind(shareCode).first();

  if (!video) return errorResponse('Not found', 404);

  // Same gate as POST /comment — viewer comments can be sensitive.
  const authed = await verifyPasswordAuth(request, env, shareCode, video);
  if (!authed) return errorResponse('Password required', 401);

  const url = new URL(request.url);
  const requestedPage = parseInt(url.searchParams.get('page') || '1', 10);
  const requestedLimit = parseInt(url.searchParams.get('limit') || '50', 10);
  const page = Number.isSafeInteger(requestedPage) ? Math.max(1, Math.min(requestedPage, Math.floor(Number.MAX_SAFE_INTEGER / 100))) : 1;
  const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(requestedLimit, 100)) : 50;
  const offset = (page - 1) * limit;

  const total = await env.DB.prepare(
    'SELECT COUNT(*) as cnt FROM comments WHERE video_id = ?'
  ).bind(video.id).first();

  const comments = await env.DB.prepare(
    'SELECT id, timestamp, author_name, text, created_at FROM comments WHERE video_id = ? ORDER BY timestamp ASC, id ASC LIMIT ? OFFSET ?'
  ).bind(video.id, limit, offset).all();

  return jsonResponse({
    comments: comments.results || [],
    total: total ? total.cnt : 0,
    page,
    limit,
  });
}
