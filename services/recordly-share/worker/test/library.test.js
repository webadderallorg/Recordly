import { describe, it, expect, beforeAll } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { expectedSessionToken } from '../src/index.js';

const AUTH = { Authorization: 'Bearer test-secret' };
const BASE = 'https://share.test';

async function createAndCompleteShare(extra = {}) {
  const res = await SELF.fetch(`${BASE}/api/upload`, {
    method: 'POST',
    headers: { ...AUTH, 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Library Test', duration: 30, width: 1920, height: 1080, fileSize: 5000, ...extra }),
  });
  expect(res.status).toBe(200);
  const { shareCode } = await res.json();

  await SELF.fetch(`${BASE}/api/upload-data/${shareCode}`, {
    method: 'PUT',
    headers: { ...AUTH, 'Content-Type': 'video/mp4' },
    body: new Uint8Array([0, 1, 2, 3, 4]),
  });
  await SELF.fetch(`${BASE}/api/metadata/${shareCode}`, {
    method: 'POST',
    headers: { ...AUTH, 'Content-Type': 'application/json' },
    body: JSON.stringify({ segments: [] }),
  });
  return shareCode;
}

describe('GET /api/videos', () => {
  it('rejects with no auth -> 401', async () => {
    const res = await SELF.fetch(`${BASE}/api/videos`);
    expect(res.status).toBe(401);
  });

  it('returns 200 and a videos array with valid bearer token', async () => {
    const res = await SELF.fetch(`${BASE}/api/videos`, { headers: AUTH });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.videos)).toBe(true);
  });

  it('returns completed videos newest-first and omits sensitive fields', async () => {
    const code1 = await createAndCompleteShare({ title: 'Older Video' });
    const code2 = await createAndCompleteShare({ title: 'Newer Video' });

    // Force distinct timestamps so ordering is deterministic in the test env
    // (SQLite datetime('now') has second precision; both rows may land the same second)
    await env.DB.prepare("UPDATE videos SET created_at = datetime('now', '-10 seconds') WHERE share_code = ?")
      .bind(code1).run();

    const res = await SELF.fetch(`${BASE}/api/videos`, { headers: AUTH });
    expect(res.status).toBe(200);
    const { videos } = await res.json();

    // Both videos should appear
    const codes = videos.map(v => v.share_code);
    expect(codes).toContain(code1);
    expect(codes).toContain(code2);

    // Newer should be first
    const idx1 = codes.indexOf(code1);
    const idx2 = codes.indexOf(code2);
    expect(idx2).toBeLessThan(idx1);

    // Sensitive fields must not be present on any row
    for (const v of videos) {
      expect(v).not.toHaveProperty('password_hash');
      expect(v).not.toHaveProperty('password_salt');
      expect(v).not.toHaveProperty('id');
    }

    // Required fields present
    const video = videos.find(v => v.share_code === code2);
    expect(video).toBeDefined();
    expect(typeof video.title).toBe('string');
    expect(typeof video.duration).toBe('number');
    expect(typeof video.view_count).toBe('number');
    expect(typeof video.is_protected).toBe('number');
  });

  it('marks password-protected videos with is_protected=1', async () => {
    const { sha256Hex } = await import('../src/index.js');
    const clientHash = await sha256Hex('secret123');
    const code = await createAndCompleteShare({ password_hash: clientHash });

    const res = await SELF.fetch(`${BASE}/api/videos`, { headers: AUTH });
    const { videos } = await res.json();
    const video = videos.find(v => v.share_code === code);
    expect(video).toBeDefined();
    expect(video.is_protected).toBe(1);
    expect(video).not.toHaveProperty('password_hash');
  });
});

describe('Dashboard login/logout', () => {
  it('POST /library/login with wrong password -> 302 to /library/login?error=1 (no session cookie)', async () => {
    const form = new FormData();
    form.set('password', 'wrong-password');
    const res = await SELF.fetch(`${BASE}/library/login`, {
      method: 'POST',
      body: form,
      redirect: 'manual',
    });
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/library/login?error=1');
    const setCookie = res.headers.get('Set-Cookie') || '';
    expect(setCookie).not.toContain('voom_session=');
  });

  it('POST /library/login with correct password (API_SECRET) -> 302 to /library with HttpOnly session cookie', async () => {
    const form = new FormData();
    form.set('password', 'test-secret'); // matches API_SECRET in test env
    const res = await SELF.fetch(`${BASE}/library/login`, {
      method: 'POST',
      body: form,
      redirect: 'manual',
    });
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/library');
    const setCookie = res.headers.get('Set-Cookie') || '';
    expect(setCookie).toContain('voom_session=');
    expect(setCookie).toContain('HttpOnly');
  });

  it('GET /api/videos with session cookie (no bearer) -> 200', async () => {
    // Get a valid session token
    const token = await expectedSessionToken(env);
    const res = await SELF.fetch(`${BASE}/api/videos`, {
      headers: { Cookie: `voom_session=${token}` },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.videos)).toBe(true);
  });
});

describe('GET /library (dashboard gate)', () => {
  it('redirects to /library/login with no cookie', async () => {
    const res = await SELF.fetch(`${BASE}/library`, { redirect: 'manual' });
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/library/login');
  });

  it('serves the dashboard page with a valid session cookie', async () => {
    const token = await expectedSessionToken(env);
    // ASSETS serve library.html for /library — this exercises the auth gate passing
    const res = await SELF.fetch(`${BASE}/library`, {
      headers: { Cookie: `voom_session=${token}` },
      redirect: 'manual',
    });
    // In the test environment ASSETS returns the static HTML; status 200
    expect([200, 304]).toContain(res.status);
  });
});

it('rejects expired and tampered dashboard sessions', async () => {
  const expired = await expectedSessionToken(env, Math.floor(Date.now() / 1000) - 1);
  const valid = await expectedSessionToken(env);
  const tampered = `${Number(valid.split('.')[0]) + 604800}.${valid.split('.')[1]}`;
  for (const token of [expired, tampered, valid.split('.')[1]]) {
    const res = await SELF.fetch(`${BASE}/api/videos`, { headers: { Cookie: `voom_session=${token}` } });
    expect(res.status).toBe(401);
  }
});
