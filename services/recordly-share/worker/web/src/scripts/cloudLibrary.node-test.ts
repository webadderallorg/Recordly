import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fetchVideos, deleteVideo, renewVideo, LibrarySignInRedirectError } from './library.ts';

test('cloud library follows account-scoped cursor pages and hides unfinished uploads', async t => {
  const requests: { path: string; options?: RequestInit }[] = [];
  t.mock.method(globalThis, 'fetch', async (path: string, options?: RequestInit) => {
    requests.push({path, options});
    return Response.json(requests.length === 1
      ? { videos: [{share_code:'a',upload_completed:1}, {share_code:'pending',upload_completed:0}], nextCursor:'page+2' }
      : { videos: [{share_code:'b',upload_completed:1}] });
  });
  assert.deepEqual((await fetchVideos('owner-token')).map(v => v.share_code), ['a','b']);
  assert.deepEqual(requests.map(r => r.path), ['/api/videos','/api/videos?cursor=page%2B2']);
  for (const request of requests) assert.deepEqual(request.options?.headers, {Authorization:'Bearer owner-token'});
});

test('hosted deletion uses the current account token and propagates failed authorization', async t => {
  t.mock.method(globalThis, 'fetch', async (path: string, options?: RequestInit) => {
    assert.equal(path, '/api/delete/owned');
    assert.equal(options?.method, 'DELETE');
    assert.deepEqual(options?.headers, {Authorization:'Bearer owner-token'});
    return Response.json({error:'Unauthorized'}, {status:401});
  });
  await assert.rejects(deleteVideo('owned', 'owner-token'), /401/);
});

test('self-host library preserves cookie authentication and existing unpaginated records', async t => {
  t.mock.method(globalThis, 'fetch', async (_path: string, options?: RequestInit) => {
    assert.equal(options?.credentials,'include');
    assert.equal(options?.headers,undefined);
    return Response.json({videos:[{share_code:'legacy'}]});
  });
  assert.equal((await fetchVideos())[0].share_code,'legacy');
});


test('share dates accept SQLite and ISO timestamps without appending a second timezone', async () => {
  const { formatDate } = await import('./api.ts');
  assert.equal(formatDate('2026-10-24 00:00:00'), formatDate('2026-10-24T00:00:00Z'));
  assert.doesNotMatch(formatDate('2026-10-24T00:00:00Z'), /Invalid Date/);
  assert.equal(formatDate('invalid'), '—');
});

test('library mutations encode share codes as one path segment', async t => {
  const paths: unknown[] = [];
  t.mock.method(globalThis, 'fetch', async (path: unknown) => {
    paths.push(path);
    return Response.json({ expiresAt: '2099-01-01' });
  });
  await renewVideo('a/b?#', 'owner-token');
  await deleteVideo('a/b?#', 'owner-token');
  assert.deepEqual(paths, ['/api/renew/a%2Fb%3F%23', '/api/delete/a%2Fb%3F%23']);
});

test('expired library cookies report navigation separately from request failures', async t => {
  const window = { location: { href: '' } };
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: window });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'window', previous);
    else Reflect.deleteProperty(globalThis, 'window');
  });
  t.mock.method(globalThis, 'fetch', async () => Response.json({}, { status: 401 }));
  await assert.rejects(fetchVideos(), LibrarySignInRedirectError);
  assert.equal(window.location.href, '/library/login');
});
