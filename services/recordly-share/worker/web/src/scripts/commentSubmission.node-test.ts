import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { CommentRateLimitError, CommentSignInError, commentAccessTokenForAccount, postComment, fetchComments, fetchCommentsForViewer, signOutFromComments, updateOwnComment, deleteOwnComment } from './api.ts';
import { commentDisplayName, commentProfileName, saveCommentReturn, takeCommentReturn } from './commentAuth.ts';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

test('comment throttling offers a temporary retry message without discarding the draft', async () => {
  globalThis.fetch = async () => new Response('{}', { status: 429 });
  await assert.rejects(postComment('fixture', 12, 'My draft', 'account-token'), (error) => {
    assert.ok(error instanceof CommentRateLimitError);
    assert.match(error.message, /wait a little/);
    assert.match(error.message, /draft is saved here/);
    return true;
  });
});

test('posts the account token and text, never a caller-supplied author', async () => {
  globalThis.fetch = async (_url, init) => {
    assert.deepEqual(JSON.parse(String(init?.body)), { timestamp: 12, text: 'My draft' });
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer account-token');
    return Response.json({ id: 42, author_name: 'Account name' });
  };
  assert.deepEqual(await postComment('fixture', 12, 'My draft', 'account-token'), { id: 42, author_name: 'Account name' });
});

test('expired sessions ask for sign-in while service failures allow retry', async () => {
  globalThis.fetch = async () => new Response('{}', { status: 401 });
  await assert.rejects(postComment('fixture', 12, 'Draft'), CommentSignInError);
  globalThis.fetch = async () => new Response('{}', { status: 503 });
  await assert.rejects(postComment('fixture', 12, 'Draft'), (error) => {
    assert.ok(!(error instanceof CommentSignInError));
    assert.match(String(error), /try again/); return true;
  });
});

test('comment-loading failures do not masquerade as an empty conversation', async () => {
  globalThis.fetch = async () => Response.json({ error: 'Password required' }, { status: 401 });
  await assert.rejects(fetchComments('fixture'));
});

test('public names never fall back to a private email address', () => {
  assert.equal(commentDisplayName({ email: 'private@example.test' }), 'Recordly member');
  assert.equal(commentDisplayName({ full_name: ' Alex ', name: 'Other' }), 'Alex');
  assert.equal(commentDisplayName({ name: 'A'.repeat(120) }).length, 100);
});

test('OAuth returns only to a recent local recording path', (t) => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  } });
  t.after(() => { if (previous) Object.defineProperty(globalThis, 'sessionStorage', previous); else Reflect.deleteProperty(globalThis, 'sessionStorage'); });
  saveCommentReturn('/s/abc123?t=12.5', 'flow');
  assert.equal(takeCommentReturn('flow'), '/s/abc123?t=12.5');
  assert.equal(takeCommentReturn('flow'), null);
  for (const path of ['https://evil.test', '//evil.test', '/library', '/s/abc123?redirect=https://evil.test']) {
    saveCommentReturn(path, 'flow'); assert.equal(takeCommentReturn('flow'), null);
  }
  saveCommentReturn('/s/abc123', 'old-flow');
  assert.equal(takeCommentReturn('unrelated-flow'), null);
  values.set('recordly-comment-return', JSON.stringify({ path: '/s/abc123', challenge: 'flow', at: Date.now() - 3600001 }));
  assert.equal(takeCommentReturn('flow'), null);
});

test('a failed local sign-out is not reported as success', async () => {
  globalThis.fetch = async () => new Response('{}', { status: 500 });
  await assert.rejects(signOutFromComments(), /Could not sign out/);
});

test('ownership-aware lists carry only the current access token', async () => {
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), '/s/fixture/comments?page=2&limit=50');
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer current-account');
    return Response.json({ comments: [{ id: 1, can_manage: true }], total: 1, page: 2, limit: 50 });
  };
  assert.equal((await fetchComments('fixture', 2, 50, 'current-account')).comments[0].can_manage, true);
});

test('public lists survive a failed optional token refresh without inheriting management rights', async () => {
  let requests = 0;
  globalThis.fetch = async (url, init) => {
    requests++;
    assert.equal(String(url), '/s/fixture/comments?page=2&limit=50');
    assert.equal(new Headers(init?.headers).has('Authorization'), false);
    return Response.json({ comments: [{ id: 1, text: 'Public feedback', can_manage: true }], total: 1, page: 2, limit: 50 });
  };
  const result = await fetchCommentsForViewer('fixture', 2, 50, {
    key: 'old-account', displayName: 'Member', getAccessToken: async () => { throw new Error('Refresh unavailable'); },
  });
  assert.equal(requests, 1);
  assert.equal(result.ownershipKey, undefined);
  assert.equal(result.comments[0].text, 'Public feedback');
  assert.equal(result.comments[0].can_manage, false);
});

test('successful cloud and local-cookie viewers retain only their resolved ownership scope', async () => {
  for (const token of ['current-token', undefined]) {
    globalThis.fetch = async (_url, init) => {
      assert.equal(new Headers(init?.headers).get('Authorization'), token ? `Bearer ${token}` : null);
      assert.equal(init?.credentials, 'include');
      return Response.json({ comments: [{ id: 1, can_manage: true }], total: 1 });
    };
    const result = await fetchCommentsForViewer('fixture', 1, 50, {
      key: token ? 'cloud-account' : 'local:fixture@example.test', displayName: 'Member', getAccessToken: async () => token,
    });
    assert.equal(result.ownershipKey, token ? 'cloud-account' : 'local:fixture@example.test');
    assert.equal(result.comments[0].can_manage, true);
  }
});

test('anonymous fallback still reports actual public-read failures', async () => {
  globalThis.fetch = async () => new Response('{}', { status: 503 });
  await assert.rejects(fetchCommentsForViewer('fixture', 1, 50, {
    key: 'old-account', displayName: 'Member', getAccessToken: async () => { throw new Error('Refresh unavailable'); },
  }), /Could not load comments/);
});

test('a captured comment account never returns another account token after a session switch', () => {
  const session = (id: string, token: string) => ({ user: { id }, access_token: token });
  assert.equal(commentAccessTokenForAccount('account-a', { data: { session: session('account-a', 'token-a') } }), 'token-a');
  assert.equal(commentAccessTokenForAccount('account-a', { data: { session: session('account-a', 'refreshed-token-a') } }), 'refreshed-token-a');
  for (const result of [
    { data: { session: session('account-b', 'token-b') } },
    { data: { session: null } },
    { error: new Error('Refresh failed'), data: { session: session('account-a', 'token-a') } },
    { data: { session: session('account-a', '') } },
  ]) assert.throws(() => commentAccessTokenForAccount('account-a', result), /Sign in again.*draft is saved/);
});


test('own-comment changes send text only and require server authorization', async () => {
  const calls: { method?: string; body: unknown }[] = [];
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), '/s/fixture/comments/42');
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer current-account');
    calls.push({ method: init?.method, body: init?.body });
    return Response.json({ ok: true });
  };
  await updateOwnComment('fixture', 42, 'Corrected feedback', 'current-account');
  await deleteOwnComment('fixture', 42, 'current-account');
  assert.deepEqual(calls, [
    { method: 'PATCH', body: JSON.stringify({ text: 'Corrected feedback' }) },
    { method: 'DELETE', body: undefined },
  ]);
  globalThis.fetch = async () => Response.json({}, { status: 401 });
  await assert.rejects(updateOwnComment('fixture', 42, 'Draft', 'expired'), CommentSignInError);
  globalThis.fetch = async () => Response.json({}, { status: 404 });
  await assert.rejects(deleteOwnComment('fixture', 42, 'another-account'), /no longer available/);
});

test('comment ownership outages preserve the edit draft and password expiry asks for unlock', async () => {
  globalThis.fetch = async () => Response.json({}, { status: 503 });
  await assert.rejects(updateOwnComment('fixture', 42, 'Draft', 'valid'), /draft is still here/);
  globalThis.fetch = async () => Response.json({ error: 'Password required' }, { status: 401 });
  await assert.rejects(deleteOwnComment('fixture', 42, 'valid'), (error) => {
    assert.ok(!(error instanceof CommentSignInError));
    assert.match(String(error), /password again/); return true;
  });
});

test('missing profile names require name entry without using the email', () => {
  assert.equal(commentProfileName({}), undefined);
  assert.equal(commentProfileName({ full_name: '  ', email: 'private@example.test' }), undefined);
  assert.equal(commentProfileName({ full_name: ' Reviewer ' }), 'Reviewer');
});

test('expired recording passwords do not trigger account sign-in when posting', async () => {
  globalThis.fetch = async () => Response.json({ error: 'Password required' }, { status: 401 });
  await assert.rejects(postComment('fixture', 12, 'My draft', 'current-account'), (error) => {
    assert.ok(!(error instanceof CommentSignInError));
    assert.match(String(error), /password again.*draft is saved here/);
    return true;
  });
});
