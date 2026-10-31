import { describe, it, expect, beforeAll, vi } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import worker, { sha256Hex } from '../src/index.js';

const AUTH = { Authorization: 'Bearer test-secret' };
const BASE = 'https://share.test';

async function createShare(extra = {}) {
  const res = await SELF.fetch(`${BASE}/api/upload`, {
    method: 'POST',
    headers: { ...AUTH, 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Test Recording', duration: 12.5, width: 1920, height: 1080, fileSize: 1000, ...extra }),
  });
  expect(res.status).toBe(200);
  return res.json();
}

async function completeUpload(shareCode, bytes = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7])) {
  const put = await SELF.fetch(`${BASE}/api/upload-data/${shareCode}`, {
    method: 'PUT',
    headers: { ...AUTH, 'Content-Type': 'video/mp4' },
    body: bytes,
  });
  expect(put.status).toBe(200);
  const meta = await SELF.fetch(`${BASE}/api/metadata/${shareCode}`, {
    method: 'POST',
    headers: { ...AUTH, 'Content-Type': 'application/json' },
    body: JSON.stringify({ segments: [{ startTime: 0, endTime: 1, text: 'hello world' }] }),
  });
  expect(meta.status).toBe(200);
}

describe('auth', () => {
  it('rejects /api/* without a token', async () => {
    const res = await SELF.fetch(`${BASE}/api/health`);
    expect(res.status).toBe(401);
  });

  it('rejects a wrong token', async () => {
    const res = await SELF.fetch(`${BASE}/api/health`, { headers: { Authorization: 'Bearer wrong' } });
    expect(res.status).toBe(401);
  });

  it('rejects a Bearer header with no token', async () => {
    const res = await SELF.fetch(`${BASE}/api/health`, { headers: { Authorization: 'Bearer' } });
    expect(res.status).toBe(401);
  });

  it('accepts the correct token', async () => {
    const res = await SELF.fetch(`${BASE}/api/health`, { headers: AUTH });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, app: 'recordly' });
  });
});

describe('comment accounts', () => {
  it('allows comments without signing in and uses the supplied display name', async () => {
    const { shareCode } = await createShare();
    await completeUpload(shareCode);

    const anonymous = await SELF.fetch(`${BASE}/s/${shareCode}/comment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        timestamp: 2,
        author_name: 'Link Reviewer',
        text: 'No account required',
      }),
    });
    expect(anonymous.status).toBe(200);

    const comments = await SELF.fetch(`${BASE}/s/${shareCode}/comments`);
    const data = await comments.json();
    expect(data.comments).toEqual(expect.arrayContaining([
      expect.objectContaining({
        author_name: 'Link Reviewer',
        text: 'No account required',
      }),
    ]));
  });

  it('supports signing back in and invalidates a logged-out session', async () => {
    const register = await SELF.fetch(`${BASE}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.80' },
      body: JSON.stringify({
        displayName: 'Signed-in Reviewer',
        email: 'reviewer@example.com',
        password: 'correct-horse-battery-staple',
      }),
    });
    expect(register.status).toBe(200);

    const login = await SELF.fetch(`${BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.81' },
      body: JSON.stringify({
        email: 'reviewer@example.com',
        password: 'correct-horse-battery-staple',
      }),
    });
    expect(login.status).toBe(200);
    const cookie = login.headers.get('Set-Cookie').split(';')[0];

    const logout = await SELF.fetch(`${BASE}/auth/logout`, {
      method: 'POST',
      headers: { Cookie: cookie },
    });
    expect(logout.status).toBe(200);

    const session = await SELF.fetch(`${BASE}/auth/session`, { headers: { Cookie: cookie } });
    expect(await session.json()).toEqual({ user: null });
  });
});

describe('upload validation', () => {
  it('requires a title', async () => {
    const res = await SELF.fetch(`${BASE}/api/upload`, {
      method: 'POST',
      headers: { ...AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('rejects javascript: CTA URLs', async () => {
    const res = await SELF.fetch(`${BASE}/api/upload`, {
      method: 'POST',
      headers: { ...AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'x', cta_url: 'javascript:alert(1)' }),
    });
    expect(res.status).toBe(400);
  });

  it('accepts https CTA URLs and returns a well-formed share code', async () => {
    const data = await createShare({ cta_url: 'https://example.com', cta_text: 'Visit' });
    expect(data.shareCode).toMatch(/^[0-9a-f]{64}$/);
    expect(data.shareURL).toContain(`/s/${data.shareCode}`);
  });

  it('uploads and completes a video through the multipart API', async () => {
    const { shareCode } = await createShare({ fileSize: 6 });
    const start = await SELF.fetch(`${BASE}/api/upload-multipart/${shareCode}`, {
      method: 'POST',
      headers: AUTH,
    });
    expect(start.status).toBe(200);
    const { uploadId } = await start.json();

    const part = await SELF.fetch(
      `${BASE}/api/upload-part/${shareCode}/${encodeURIComponent(uploadId)}/1`,
      {
        method: 'PUT',
        headers: { ...AUTH, 'Content-Type': 'video/mp4' },
        body: new Uint8Array([10, 20, 30, 40, 50, 60]),
      },
    );
    expect(part.status).toBe(200);
    const uploadedPart = await part.json();

    const complete = await SELF.fetch(
      `${BASE}/api/upload-complete/${shareCode}/${encodeURIComponent(uploadId)}`,
      {
        method: 'POST',
        headers: { ...AUTH, 'Content-Type': 'application/json' },
        body: JSON.stringify({ parts: [uploadedPart] }),
      },
    );
    expect(complete.status).toBe(200);

    const meta = await SELF.fetch(`${BASE}/api/metadata/${shareCode}`, {
      method: 'POST',
      headers: { ...AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(meta.status).toBe(200);

    const video = await SELF.fetch(`${BASE}/v/${shareCode}`);
    expect(video.status).toBe(200);
    expect(Array.from(new Uint8Array(await video.arrayBuffer()))).toEqual([10, 20, 30, 40, 50, 60]);
  });
});

describe('share data + view counts', () => {
  it('serves data for a completed upload and increments views', async () => {
    const { shareCode } = await createShare();
    await completeUpload(shareCode);

    const res1 = await SELF.fetch(`${BASE}/s/${shareCode}/data`);
    expect(res1.status).toBe(200);
    const d1 = await res1.json();
    expect(d1.video.title).toBe('Test Recording');
    expect(d1.video.view_count).toBe(1);
    expect(d1.segments).toHaveLength(1);

    const res2 = await SELF.fetch(`${BASE}/s/${shareCode}/data`);
    const d2 = await res2.json();
    expect(d2.video.view_count).toBe(2);
  });

  it('404s for incomplete uploads', async () => {
    const { shareCode } = await createShare();
    const res = await SELF.fetch(`${BASE}/s/${shareCode}/data`);
    expect(res.status).toBe(404);
  });
});

describe('video streaming + ranges', () => {
  let shareCode;
  const bytes = new Uint8Array(100).map((_, i) => i);

  beforeAll(async () => {
    ({ shareCode } = await createShare());
    await completeUpload(shareCode, bytes);
  });

  it('serves the full object without a Range header', async () => {
    const res = await SELF.fetch(`${BASE}/v/${shareCode}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Length')).toBe('100');
    expect(res.headers.get('Accept-Ranges')).toBe('bytes');
  });

  it('serves a bounded range with the full size in Content-Range', async () => {
    const res = await SELF.fetch(`${BASE}/v/${shareCode}`, { headers: { Range: 'bytes=10-19' } });
    expect(res.status).toBe(206);
    expect(res.headers.get('Content-Range')).toBe('bytes 10-19/100');
    expect(res.headers.get('Content-Length')).toBe('10');
    const body = new Uint8Array(await res.arrayBuffer());
    expect(Array.from(body)).toEqual([10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
  });

  it('serves an open-ended range', async () => {
    const res = await SELF.fetch(`${BASE}/v/${shareCode}`, { headers: { Range: 'bytes=90-' } });
    expect(res.status).toBe(206);
    expect(res.headers.get('Content-Range')).toBe('bytes 90-99/100');
    expect(res.headers.get('Content-Length')).toBe('10');
  });

  it('serves a suffix range (bytes=-N)', async () => {
    const res = await SELF.fetch(`${BASE}/v/${shareCode}`, { headers: { Range: 'bytes=-5' } });
    expect(res.status).toBe(206);
    expect(res.headers.get('Content-Range')).toBe('bytes 95-99/100');
    const body = new Uint8Array(await res.arrayBuffer());
    expect(Array.from(body)).toEqual([95, 96, 97, 98, 99]);
  });

  it('returns 416 for an unsatisfiable range', async () => {
    const res = await SELF.fetch(`${BASE}/v/${shareCode}`, { headers: { Range: 'bytes=5000-' } });
    expect(res.status).toBe(416);
  });
});

describe('password protection', () => {
  const password = 'hunter2';
  let clientHash;

  beforeAll(async () => {
    clientHash = await sha256Hex(password); // what the desktop app sends at share time
  });

  async function protectedShare() {
    const share = await createShare({ password_hash: clientHash });
    await completeUpload(share.shareCode);
    return share.shareCode;
  }

  it('gates /data behind the password', async () => {
    const shareCode = await protectedShare();
    const res = await SELF.fetch(`${BASE}/s/${shareCode}/data`);
    expect(res.status).toBe(401);
    expect((await res.json()).password_protected).toBe(true);
  });

  it('gates reactions, comments, and the thumbnail behind the password', async () => {
    const shareCode = await protectedShare();

    expect((await SELF.fetch(`${BASE}/s/${shareCode}/reactions`)).status).toBe(401);
    expect((await SELF.fetch(`${BASE}/s/${shareCode}/comments`)).status).toBe(401);
    expect((await SELF.fetch(`${BASE}/thumb/${shareCode}`)).status).toBe(404);

    // …and unlocks them all with the auth cookie.
    const good = await SELF.fetch(`${BASE}/s/${shareCode}/verify-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    expect(good.status).toBe(200);
    const cookie = good.headers.get('Set-Cookie').split(';')[0];

    expect((await SELF.fetch(`${BASE}/s/${shareCode}/reactions`, { headers: { Cookie: cookie } })).status).toBe(200);
    expect((await SELF.fetch(`${BASE}/s/${shareCode}/comments`, { headers: { Cookie: cookie } })).status).toBe(200);
  });

  it('rejects password attempts on expired videos', async () => {
    const shareCode = await protectedShare();
    await env.DB.prepare(
      "UPDATE videos SET expires_at = datetime('now', '-1 day') WHERE share_code = ?"
    ).bind(shareCode).run();

    const res = await SELF.fetch(`${BASE}/s/${shareCode}/verify-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    expect(res.status).toBe(404);
  });

  it('rejects a wrong password, accepts the right one, sets an HttpOnly cookie', async () => {
    const shareCode = await protectedShare();

    const bad = await SELF.fetch(`${BASE}/s/${shareCode}/verify-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'wrong' }),
    });
    expect(bad.status).toBe(403);

    const good = await SELF.fetch(`${BASE}/s/${shareCode}/verify-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    expect(good.status).toBe(200);
    const cookie = good.headers.get('Set-Cookie');
    expect(cookie).toContain(`voom_auth_${shareCode}=`);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');

    const authed = await SELF.fetch(`${BASE}/s/${shareCode}/data`, {
      headers: { Cookie: cookie.split(';')[0] },
    });
    expect(authed.status).toBe(200);
  });

  it('stores passwords salted — never the bare client hash', async () => {
    const shareCode = await protectedShare();
    const row = await env.DB.prepare('SELECT password_hash, password_salt FROM videos WHERE share_code = ?')
      .bind(shareCode).first();
    expect(row.password_salt).toMatch(/^[0-9a-f]{32}$/);
    expect(row.password_hash).toMatch(/^pbkdf2-sha256:210000:[0-9a-f]{64}$/);
  });

  it('lazily upgrades legacy unsalted rows on successful verify', async () => {
    const shareCode = await protectedShare();
    // Regress the row to the legacy (pre-salt) format.
    await env.DB.prepare('UPDATE videos SET password_hash = ?, password_salt = NULL WHERE share_code = ?')
      .bind(clientHash, shareCode).run();

    const res = await SELF.fetch(`${BASE}/s/${shareCode}/verify-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    expect(res.status).toBe(200);

    const row = await env.DB.prepare('SELECT password_hash, password_salt FROM videos WHERE share_code = ?')
      .bind(shareCode).first();
    expect(row.password_salt).toMatch(/^[0-9a-f]{32}$/);
    expect(row.password_hash).toMatch(/^pbkdf2-sha256:210000:[0-9a-f]{64}$/); // re-stored salted
  });

  it('rate-limits brute-force attempts (429 after 10 failures)', async () => {
    const shareCode = await protectedShare();
    for (let i = 0; i < 10; i++) {
      const res = await SELF.fetch(`${BASE}/s/${shareCode}/verify-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.7' },
        body: JSON.stringify({ password: `wrong-${i}` }),
      });
      expect(res.status).toBe(403);
    }
    const blocked = await SELF.fetch(`${BASE}/s/${shareCode}/verify-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.7' },
      body: JSON.stringify({ password }),
    });
    expect(blocked.status).toBe(429);
  });

  it('hides title and thumbnail from the OG page and image', async () => {
    const shareCode = await protectedShare();
    const og = await SELF.fetch(`${BASE}/s/${shareCode}`, { headers: { 'User-Agent': 'Twitterbot/1.0' } });
    expect(og.status).toBe(200);
    const html = await og.text();
    expect(html).toContain('Protected video');
    expect(html).not.toContain('Test Recording');

    const img = await SELF.fetch(`${BASE}/og/${shareCode}`);
    expect(img.status).toBe(200);
    expect(img.headers.get('Content-Type')).toContain('svg');
    const svg = await img.text();
    expect(svg).toContain('Protected video');
    expect(svg).not.toContain('Test Recording');
  });
});

describe('OG page (public video)', () => {
  it('escapes the title in meta tags', async () => {
    const { shareCode } = await createShare({ title: '<script>alert("x")</script>' });
    await completeUpload(shareCode);
    const res = await SELF.fetch(`${BASE}/s/${shareCode}`, { headers: { 'User-Agent': 'Slackbot 1.0' } });
    const html = await res.text();
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('delete', () => {
  it('removes the video row, children, and R2 objects', async () => {
    const { shareCode } = await createShare();
    await completeUpload(shareCode);

    const del = await SELF.fetch(`${BASE}/api/delete/${shareCode}`, { method: 'DELETE', headers: AUTH });
    expect(del.status).toBe(200);

    expect((await SELF.fetch(`${BASE}/s/${shareCode}/data`)).status).toBe(404);
    expect((await SELF.fetch(`${BASE}/v/${shareCode}`)).status).toBe(404);
    const segs = await env.DB.prepare(
      'SELECT COUNT(*) AS cnt FROM transcript_segments ts WHERE NOT EXISTS (SELECT 1 FROM videos v WHERE v.id = ts.video_id)'
    ).first();
    expect(segs.cnt).toBe(0); // no orphaned children
    expect(await env.VIDEOS_BUCKET.get(`videos/${shareCode}.mp4`)).toBeNull();
  });
});

describe('check-views', () => {
  it('caps the shareCodes array', async () => {
    const res = await SELF.fetch(`${BASE}/api/check-views`, {
      method: 'POST',
      headers: { ...AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ shareCodes: Array.from({ length: 91 }, (_, i) => `code${i}`) }),
    });
    expect(res.status).toBe(400);
  });
});

describe('error middleware', () => {
  it('returns JSON 500 instead of an opaque error on handler crashes', async () => {
    // Malformed JSON body → request.json() throws inside handleUpload.
    const res = await SELF.fetch(`${BASE}/api/upload`, {
      method: 'POST',
      headers: { ...AUTH, 'Content-Type': 'application/json' },
      body: '{not json',
    });
    expect(res.status).toBe(500);
    expect(res.headers.get('Content-Type')).toContain('application/json');
    expect((await res.json()).error).toBe('Internal error');
  });
});


describe('review security fixes', () => {
  it('allows only the configured Supabase owner and performs one auth lookup', async () => {
    const config = { ...env, ALLOW_API_SECRET_UPLOADS: 'false', SUPABASE_URL: 'https://auth.example.test', SUPABASE_PUBLISHABLE_KEY: 'public-test', OWNER_USER_ID: 'owner' };
    const request = () => new Request(`${BASE}/api/health`, { headers: { Authorization: 'Bearer user-token' } });
    const lookup = vi.spyOn(globalThis, 'fetch');
    try {
      lookup.mockResolvedValue(new Response(JSON.stringify({ id: 'other-user' })));
      expect((await worker.fetch(request(), config, {})).status).toBe(401);
      lookup.mockClear().mockResolvedValue(new Response(JSON.stringify({ id: 'owner' })));
      expect((await worker.fetch(request(), config, {})).status).toBe(200);
      expect(lookup).toHaveBeenCalledTimes(1);
      lookup.mockClear();
      expect((await worker.fetch(request(), { ...config, OWNER_USER_ID: '' }, {})).status).toBe(401);
      expect(lookup).not.toHaveBeenCalled();
    } finally { lookup.mockRestore(); }
  });

  it('never caches protected video, transcripts, or thumbnails', async () => {
    const password = 'cache-test';
    const { shareCode } = await createShare({ password_hash: await sha256Hex(password) });
    await completeUpload(shareCode);
    await env.VIDEOS_BUCKET.put(`thumbnails/${shareCode}.jpg`, new Uint8Array([0xff, 0xd8, 0xff, 0xd9]));
    const unlocked = await SELF.fetch(`${BASE}/s/${shareCode}/verify-password`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
    const Cookie = unlocked.headers.get('Set-Cookie').split(';')[0];
    for (const [url, extra] of [[`/v/${shareCode}`, {}], [`/v/${shareCode}`, { Range: 'bytes=0-3' }], [`/vtt/${shareCode}`, {}], [`/thumb/${shareCode}`, {}]]) {
      const response = await SELF.fetch(`${BASE}${url}`, { headers: { Cookie, ...extra } });
      expect([200, 206]).toContain(response.status);
      expect(response.headers.get('Cache-Control')).toBe('private, no-store');
      await response.arrayBuffer();
    }
  });

  it('coerces untrusted dimensions at upload and when rendering older rows', async () => {
    const payload = '\"><script>alert(1)</script>';
    const { shareCode } = await createShare({ width: payload, height: payload, duration: 'invalid', fileSize: -1 });
    const row = await env.DB.prepare('SELECT width, height, duration, file_size FROM videos WHERE share_code = ?').bind(shareCode).first();
    expect(row).toMatchObject({ width: 0, height: 0, duration: 0, file_size: 0 });
    await completeUpload(shareCode);
    await env.DB.prepare('UPDATE videos SET width = ?, height = ? WHERE share_code = ?').bind(payload, payload, shareCode).run();
    const response = await SELF.fetch(`${BASE}/s/${shareCode}`, { headers: { 'User-Agent': 'Twitterbot/1.0' } });
    expect(await response.text()).not.toContain('<script>alert(1)</script>');
  });
});


it('normalizes invalid comment pagination and clamps zero limits', async () => {
  const { shareCode } = await createShare();
  await completeUpload(shareCode);
  for (const query of ['page=invalid&limit=invalid', 'page=-5&limit=0', 'page=1&limit=-1']) {
    const response = await SELF.fetch(`${BASE}/s/${shareCode}/comments?${query}`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.comments).toEqual([]);
  }
});

it('fails password verification gracefully when its signing secret is absent', async () => {
  const { shareCode } = await createShare({ password_hash: await sha256Hex('secret') });
  await completeUpload(shareCode);
  const response = await worker.fetch(new Request(`${BASE}/s/${shareCode}/verify-password`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'secret' }),
  }), { ...env, API_SECRET: '' }, {});
  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({ error: 'Password protection is not configured' });
});

it('returns stable comment IDs and orders equal timestamps by ID', async () => {
  const { shareCode } = await createShare();
  await completeUpload(shareCode);
  const ids = [];
  for (const text of ['first', 'second']) {
    const response = await SELF.fetch(`${BASE}/s/${shareCode}/comment`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ timestamp: 1, author_name: 'Viewer', text }),
    });
    expect(response.status).toBe(200);
    ids.push((await response.json()).id);
  }
  const response = await SELF.fetch(`${BASE}/s/${shareCode}/comments`);
  expect((await response.json()).comments.map((comment) => comment.id)).toEqual(ids);
  expect(ids[1]).toBeGreaterThan(ids[0]);
});

it('rejects creating protected shares without a signing secret', async () => {
  const lookup = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ id: 'owner' })));
  try {
    const response = await worker.fetch(new Request(`${BASE}/api/upload`, {
      method: 'POST', headers: { Authorization: 'Bearer owner-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Protected', password_hash: 'hash' }),
    }), { ...env, API_SECRET: '', ALLOW_API_SECRET_UPLOADS: 'false', SUPABASE_URL: 'https://auth.example.test', SUPABASE_PUBLISHABLE_KEY: 'key', OWNER_USER_ID: 'owner' }, {});
    expect(response.status).toBe(503);
    await response.arrayBuffer();
  } finally { lookup.mockRestore(); }
});

it('rejects dashboard cookies without configured secrets instead of crashing', async () => {
  const config = { ...env, API_SECRET: undefined, DASHBOARD_PASSWORD: undefined };
  const response = await worker.fetch(new Request(`${BASE}/api/videos`, {
    headers: { Cookie: 'voom_session=untrusted' },
  }), config, {});
  expect(response.status).toBe(401);
  await response.arrayBuffer();
});
it('clamps a bounded video range to the actual object size', async () => {
  const { shareCode } = await createShare();
  await completeUpload(shareCode);
  const response = await SELF.fetch(`${BASE}/v/${shareCode}`, { headers: { Range: 'bytes=6-200' } });
  expect(response.status).toBe(206);
  expect(response.headers.get('Content-Range')).toBe('bytes 6-7/8');
  expect(response.headers.get('Content-Length')).toBe('2');
  expect(Array.from(new Uint8Array(await response.arrayBuffer()))).toEqual([6, 7]);
});

it('counts successful registrations without allowing login to reset their quota', async () => {
  const headers = { 'Content-Type': 'application/json', 'CF-Connecting-IP': '192.0.2.201' };
  for (let i = 0; i < 10; i++) {
    const response = await SELF.fetch(`${BASE}/auth/register`, {
      method: 'POST', headers,
      body: JSON.stringify({ email: `quota-${i}@example.com`, displayName: 'Quota Test', password: 'test-password' }),
    });
    expect(response.status).toBe(200);
  }
  const login = await SELF.fetch(`${BASE}/auth/login`, {
    method: 'POST', headers,
    body: JSON.stringify({ email: 'quota-0@example.com', password: 'test-password' }),
  });
  expect(login.status).toBe(200);
  const blocked = await SELF.fetch(`${BASE}/auth/register`, {
    method: 'POST', headers,
    body: JSON.stringify({ email: 'quota-extra@example.com', displayName: 'Quota Test', password: 'test-password' }),
  });
  expect(blocked.status).toBe(429);
});

it('upgrades salted legacy recording passwords only after correct verification', async () => {
  const password = 'legacy-recording-password';
  const { shareCode } = await createShare();
  await completeUpload(shareCode);
  const salt = 'legacy-salt';
  const hash = await sha256Hex(salt + await sha256Hex(password));
  await env.DB.prepare('UPDATE videos SET password_hash = ?, password_salt = ? WHERE share_code = ?').bind(hash, salt, shareCode).run();
  const verify = (value) => SELF.fetch(`${BASE}/s/${shareCode}/verify-password`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: value }),
  });
  expect((await verify('wrong')).status).toBe(403);
  expect((await env.DB.prepare('SELECT password_hash FROM videos WHERE share_code = ?').bind(shareCode).first()).password_hash).toBe(hash);
  expect((await verify(password)).status).toBe(200);
  const row = await env.DB.prepare('SELECT password_hash FROM videos WHERE share_code = ?').bind(shareCode).first();
  expect(row.password_hash).toMatch(/^pbkdf2-sha256:210000:[0-9a-f]{64}$/);
  expect((await verify(password)).status).toBe(200);
});
