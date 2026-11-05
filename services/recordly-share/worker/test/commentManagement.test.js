import { beforeAll, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import worker from '../src/index.js';
import { ensureSchema } from '../src/schema.js';
import { sha256Hex } from '../src/crypto.js';
import { localCommentHeaders } from './commentFixtures.js';
const config = { ...env };
beforeAll(() => ensureSchema(env));
const account = () => localCommentHeaders('Same Name');

async function recording() {
  const code = crypto.randomUUID().replaceAll('-', '');
  const result = await env.DB.prepare("INSERT INTO videos(share_code,title,expires_at,upload_completed) VALUES (?,'Manage feedback',datetime('now','+1 day'),1)").bind(code).run();
  return { code, id: result.meta.last_row_id };
}
const call = (code, path = 'comments', method = 'GET', headers = {}, body) => worker.fetch(new Request(`https://share.test/s/${code}/${path}`, {
  method, headers: { ...headers, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
}), config);
async function add(code, headers) {
  const response = await call(code, 'comment', 'POST', headers, { timestamp: 2, text: 'Original feedback' });
  expect(response.status).toBe(200);
  return (await response.json()).id;
}
const saved = (id) => env.DB.prepare('SELECT author_id,author_name,timestamp,text FROM comments WHERE id=?').bind(id).first();

it('exposes only a private per-comment ownership boolean to the signed-in author', async () => {
  const { code, id: videoId } = await recording();
  const author = await account();
  const other = await account();
  const id = await add(code, author);
  await env.DB.prepare("INSERT INTO comments(video_id,timestamp,author_name,text) VALUES (?,1,'Same Name','Legacy guest')").bind(videoId).run();
  const read = async (headers) => {
    const response = await call(code, 'comments', 'GET', headers);
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    return (await response.json()).comments;
  };
  const mine = await read(author);
  expect(mine.map((comment) => [comment.text, comment.can_manage])).toEqual([['Legacy guest', false], ['Original feedback', true]]);
  for (const headers of [{}, other]) expect((await read(headers)).every((comment) => comment.can_manage === false)).toBe(true);
  expect(mine.every((comment) => !('author_id' in comment))).toBe(true);
  expect(mine.find((comment) => comment.id === id).author_name).toBe('Same Name');
});

it('allows only the authenticated author to edit text or delete, ignoring claimed identity and timestamp', async () => {
  const { code } = await recording();
  const author = await account();
  const other = await account();
  const id = await add(code, author);
  const original = await saved(id);
  const spoof = { text: 'Hijacked', author_id: original.author_id, author_name: original.author_name, timestamp: 9000 };
  for (const method of ['PATCH', 'DELETE']) {
    expect((await call(code, `comments/${id}`, method, {}, method === 'PATCH' ? spoof : undefined)).status).toBe(401);
    expect((await call(code, `comments/${id}`, method, other, method === 'PATCH' ? spoof : undefined)).status).toBe(404);
    expect(await saved(id)).toEqual(original);
  }
  const edit = await call(code, `comments/${id}`, 'PATCH', author, { ...spoof, text: ' Updated feedback ' });
  expect(edit.status).toBe(200);
  expect(edit.headers.get('Cache-Control')).toBe('private, no-store');
  expect(await saved(id)).toEqual({ ...original, text: 'Updated feedback' });
  expect((await call(code, `comments/${id}`, 'DELETE', author)).status).toBe(200);
  expect(await saved(id)).toBeNull();
});

it('does not manage another video, missing IDs, or legacy guest comments even with a matching name', async () => {
  const { code, id: videoId } = await recording();
  const foreign = await recording();
  const author = await account();
  const id = await add(code, author);
  const guest = await env.DB.prepare("INSERT INTO comments(video_id,timestamp,author_name,text) VALUES (?,1,'Same Name','Legacy')").bind(videoId).run();
  for (const method of ['PATCH', 'DELETE']) {
    const body = method === 'PATCH' ? { text: 'Wrong target' } : undefined;
    for (const [target, comment] of [[foreign.code, id], [code, guest.meta.last_row_id], [code, 999999999], [code, '1e3'], [code, '0'], [code, '9007199254740993']]) {
      expect((await call(target, `comments/${comment}`, method, author, body)).status).toBe(404);
    }
  }
  expect((await saved(id)).text).toBe('Original feedback');
  expect((await saved(guest.meta.last_row_id)).text).toBe('Legacy');
});

it('validates edited comment text without discarding the original, accepting the 2000-character boundary', async () => {
  const { code } = await recording();
  const author = await account();
  const id = await add(code, author);
  for (const text of ['', '  ', null, {}, 'a'.repeat(2001)]) {
    expect((await call(code, `comments/${id}`, 'PATCH', author, { text })).status).toBe(400);
    expect((await saved(id)).text).toBe('Original feedback');
  }
  expect((await call(code, `comments/${id}`, 'PATCH', author, { text: 'a'.repeat(17000) })).status).toBe(413);
  expect((await call(code, `comments/${id}`, 'PATCH', author, { text: 'a'.repeat(2000) })).status).toBe(200);
  expect((await saved(id)).text).toHaveLength(2000);
});

it('blocks editing when feedback is disabled while allowing the author to remove their comment', async () => {
  const { code } = await recording();
  const author = await account();
  const other = await account();
  const id = await add(code, author);
  await env.DB.prepare('INSERT INTO recording_controls(share_code,feedback_disabled) VALUES (?,1)').bind(code).run();
  expect((await call(code, `comments/${id}`, 'PATCH', author, { text: 'Edit' })).status).toBe(403);
  expect((await call(code, `comments/${id}`, 'DELETE', other)).status).toBe(404);
  expect((await call(code, 'comments', 'GET', author)).status).toBe(200);
  expect((await call(code, `comments/${id}`, 'DELETE', author)).status).toBe(200);
});

it('requires the recording password for author edits, deletion and ownership listing', async () => {
  const { code, id: videoId } = await recording();
  const author = await account();
  const id = await add(code, author);
  await env.DB.prepare('UPDATE videos SET password_hash=? WHERE id=?').bind(await sha256Hex('secret'),videoId).run();
  for (const method of ['PATCH', 'DELETE']) expect((await call(code, `comments/${id}`, method, author, method === 'PATCH' ? { text: 'Edit' } : undefined)).status).toBe(401);
  expect((await call(code, 'comments', 'GET', author)).status).toBe(401);
  const unlock = await call(code, 'verify-password', 'POST', {}, { password: 'secret' });
  expect(unlock.status).toBe(200);
  const headers = { ...author, Cookie: [author.Cookie,unlock.headers.get('Set-Cookie').split(';')[0]].filter(Boolean).join('; ') };
  expect((await call(code, `comments/${id}`, 'PATCH', headers, { text: 'Unlocked edit' })).status).toBe(200);
  expect((await call(code, `comments/${id}`, 'DELETE', headers)).status).toBe(200);
});

for (const condition of ['expired', 'sharing-disabled', 'operator-blocked', 'incomplete']) {
  it(`blocks comment management on ${condition} recordings`, async () => {
    const { code, id: videoId } = await recording();
    const author = await account();
    const id = await add(code, author);
    if (condition === 'expired') await env.DB.prepare("UPDATE videos SET expires_at=datetime('now','-1 day') WHERE id=?").bind(videoId).run();
    else if (condition === 'incomplete') await env.DB.prepare('UPDATE videos SET upload_completed=0 WHERE id=?').bind(videoId).run();
    else await env.DB.prepare(`INSERT INTO recording_controls(share_code,${condition === 'sharing-disabled' ? 'sharing_disabled' : 'operator_blocked'}) VALUES (?,1)`).bind(code).run();
    for (const method of ['PATCH', 'DELETE']) expect((await call(code, `comments/${id}`, method, author, method === 'PATCH' ? { text: 'Edit' } : undefined)).status).toBe(404);
    expect((await call(code, 'comments', 'GET', author)).status).toBe(404);
    expect((await saved(id)).text).toBe('Original feedback');
  });
}

it('does not treat a stale self-host session as ownership and keeps unsigned reading open', async () => {
  const { code } = await recording();
  expect((await call(code,'comments','GET',{Cookie:'recordly_comment_session=invalid'})).status).toBe(200);
  expect((await call(code)).status).toBe(200);
});
