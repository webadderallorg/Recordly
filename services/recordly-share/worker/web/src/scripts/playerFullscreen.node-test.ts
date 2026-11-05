import test from 'node:test';
import assert from 'node:assert/strict';
import { togglePlayerFullscreen, type FullscreenVideo } from './playerFullscreen.ts';

function fixture(doc = {}, shell = {}, video = {}) {
  return [
    { ownerDocument: doc, ...shell } as unknown as HTMLElement,
    video as FullscreenVideo,
  ] as const;
}
test('standard fullscreen request happens synchronously inside user activation', async () => {
  let called = false;
  const result = togglePlayerFullscreen(...fixture({}, { requestFullscreen() { called = true; return Promise.resolve(); } }));
  assert.equal(called, true);
  await result;
});
test('iPhone uses native video fullscreen when container fullscreen is disabled', async () => {
  let entered = false;
  await togglePlayerFullscreen(...fixture({ fullscreenEnabled: false }, { requestFullscreen() { throw new Error('must not call'); } }, { webkitEnterFullscreen() { entered = true; } }));
  assert.equal(entered, true);
});
test('a failed container request falls back to native video fullscreen', async () => {
  for (const method of ['requestFullscreen', 'webkitRequestFullscreen']) {
    let entered = false;
    await togglePlayerFullscreen(...fixture({}, { [method]: () => Promise.reject(new Error('unsupported')) }, { webkitEnterFullscreen() { entered = true; } }));
    assert.equal(entered, true);
  }
});
test('exit selects the active standard, prefixed or native fullscreen API', async () => {
  let exits = 0;
  await togglePlayerFullscreen(...fixture({ fullscreenElement: {}, exitFullscreen() { exits++; } }));
  await togglePlayerFullscreen(...fixture({ webkitFullscreenElement: {}, webkitExitFullscreen() { exits++; } }));
  await togglePlayerFullscreen(...fixture({}, {}, { webkitDisplayingFullscreen: true, webkitExitFullscreen() { exits++; } }));
  assert.equal(exits, 3);
});
test('unsupported and rejected fullscreen requests surface a failure', async () => {
  await assert.rejects(togglePlayerFullscreen(...fixture()), /unavailable/);
  await assert.rejects(togglePlayerFullscreen(...fixture({}, { requestFullscreen: () => Promise.reject(new Error('denied')) })), /denied/);
});
