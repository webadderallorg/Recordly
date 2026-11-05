// Isolated UI regression smoke: local Astro server, fixture APIs, no cloud writes.
// Run from any directory: node services/recordly-share/worker/web/scripts/moderation.browser-test.mjs
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium, expect as baseExpect } from '@playwright/test';
const expect = baseExpect.configure({ timeout: 15_000 });
const webRoot = fileURLToPath(new URL('../', import.meta.url));
const port = Number(process.env.MODERATION_TEST_PORT || 5196);
const base = `http://127.0.0.1:${port}`;
let serverOutput = '';
const server = spawn(process.execPath, [fileURLToPath(new URL('../node_modules/astro/bin/astro.mjs', import.meta.url)), 'dev', '--ignore-lock', '--host', '127.0.0.1', '--port', String(port)], { cwd: webRoot, stdio: ['ignore', 'pipe', 'pipe'] });
server.stdout.on('data', (data) => { serverOutput += data; });
server.stderr.on('data', (data) => { serverOutput += data; });
let browser;
try {
  const deadline = Date.now() + 60_000;
  while (true) {
    if (server.exitCode !== null) throw new Error(serverOutput);
    try { if ((await fetch(`${base}/share`)).ok) break; } catch { /* Retry until the development server starts or the deadline expires. */ }
    if (Date.now() > deadline) throw new Error(`Astro startup timed out: ${serverOutput}`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.setDefaultTimeout(15_000);
  page.setDefaultNavigationTimeout(30_000);
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  const video = { title: 'Moderation fixture', duration: 60, width: 1280, height: 720, summary: null, has_webcam: 0, cta_url: null, cta_text: null, created_at: '2026-10-21 00:00:00', view_count: 1, is_meeting: 0, feedback_enabled: false };
  await page.route('**/s/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/data')) return route.fulfill({ json: { video, segments: [], chapters: [], shareCode: 'share' } });
    if (path.endsWith('/comments')) return route.fulfill({ json: { comments: [{ id: 1, timestamp: 1, author_name: 'Guest', text: 'Existing visible comment', created_at: video.created_at }], total: 1, page: 1, limit: 50 } });
    if (path.endsWith('/reactions')) return route.fulfill({ json: { reactions: [] } });
    return route.fulfill({ status: 404, body: '' });
  });
  await page.goto(`${base}/share`, { waitUntil: 'domcontentloaded' });
  console.log('Viewer loaded');
  await expect(page.getByRole('heading', { name: video.title, exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Report recording', exact: true })).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: 'Report recording', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Comments', exact: true }).click();
  await expect(page.getByText('Existing visible comment')).toBeVisible();
  await expect(page.getByText('The creator has turned off new comments and reactions.')).toBeVisible();
  await expect(page.getByLabel('Comment', { exact: true })).toBeHidden();
  await page.getByRole('button', { name: 'Back to video' }).click();
  await expect(page.getByRole('button', { name: 'Like', exact: true })).toBeDisabled();
  console.log('PASS viewer has no report control on desktop/mobile and preserves disabled feedback');
  await page.setViewportSize({ width: 1280, height: 900 });

  const token = `${Buffer.from(JSON.stringify({ alg: 'HS256' })).toString('base64url')}.${Buffer.from(JSON.stringify({ sub: 'fixture-owner', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.fixture`;
  await page.addInitScript(({ token }) => localStorage.setItem('recordly-cloud-auth', JSON.stringify({ access_token: token, refresh_token: 'fixture-refresh', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: 'fixture-owner', email: 'fixture@example.invalid', aud: 'authenticated', app_metadata: {}, user_metadata: {} } })), { token });
  let settings = { feedbackEnabled: true, sharingEnabled: true, sharingBlocked: false };
  let comments = Array.from({ length: 51 }, (_, i) => ({ id: i + 1, timestamp: i, author_name: `Guest ${i + 1}`, text: `Comment ${i + 1}`, created_at: video.created_at }));
  const patches = [];
  await page.route('**/cloud/config', (route) => route.fulfill({ json: { url: 'https://moderation-fixture.supabase.co', publishableKey: 'fixture-public-key' } }));
  await page.route('https://moderation-fixture.supabase.co/**', (route) => route.fulfill({ json: { id: 'fixture-owner', aud: 'authenticated', email: 'fixture@example.invalid' } }));
  await page.route('**/api/videos*', (route) => route.fulfill({ json: { videos: [{ ...video, share_code: 'fixture', file_size: 100, expires_at: '2099-01-01T00:00:00Z', upload_completed: 1, is_protected: 0 }] } }));
  await page.route('**/api/moderation/**', async (route) => {
    expect(route.request().headers().authorization).toBe(`Bearer ${token}`);
    const url = new URL(route.request().url());
    if (/\/comments\/\d+$/.test(url.pathname)) {
      const id = Number(url.pathname.split('/').pop()); comments = comments.filter((comment) => comment.id !== id);
      return route.fulfill({ json: { ok: true } });
    }
    if (url.pathname.endsWith('/comments')) {
      const current = Number(url.searchParams.get('page') || 1);
      return route.fulfill({ json: { comments: comments.slice((current - 1) * 50, current * 50), total: comments.length, page: current, limit: 50 } });
    }
    if (route.request().method() === 'PATCH') {
      const patch = route.request().postDataJSON(); patches.push(patch); settings = { ...settings, ...patch };
    }
    return route.fulfill({ json: settings });
  });
  await page.goto(`${base}/cloud-home`, { waitUntil: 'domcontentloaded' });
  async function openControls() {
    await page.getByRole('button', { name: 'Options for Moderation fixture' }).click();
    await page.getByRole('menuitem', { name: 'Manage sharing' }).click();
    await expect(page.getByRole('heading', { name: 'Manage sharing' })).toBeVisible();
  }
  await openControls();
  await page.getByRole('button', { name: 'Pause sharing' }).click();
  await expect(page.getByRole('button', { name: 'Resume sharing' })).toBeEnabled();
  await page.getByRole('button', { name: 'Disable feedback' }).click();
  await expect(page.getByRole('button', { name: 'Enable feedback' })).toBeEnabled();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByText('Comment 51', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Delete comment by Guest 51', exact: true }).click();
  await expect(page.getByText('Page 1', { exact: true })).toBeVisible();
  await expect(page.getByText('Comment 1', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeDisabled();
  expect(patches).toEqual([{ sharingEnabled: false }, { feedbackEnabled: false }]);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  settings = { ...settings, sharingBlocked: true };
  await openControls();
  await expect(page.getByText('Sharing is unavailable while this recording is under review.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Resume sharing' })).toBeDisabled();
  await page.getByRole('dialog', { name: 'Manage sharing' }).screenshot({ path: '/tmp/recordly-sharing-controls-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('dialog', { name: 'Manage sharing' }).screenshot({ path: '/tmp/recordly-sharing-controls-mobile.png' });
  expect(pageErrors).toEqual([]);
  console.log('PASS owner bearer controls, comment pagination/delete, and operator block');
} finally {
  await browser?.close();
  server.kill('SIGTERM');
}
