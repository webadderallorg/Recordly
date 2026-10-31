import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clusterComments, clusterReactions, clusterTimeline, timestampParts } from './shareModel.ts';

const comment = (timestamp: number) => ({
  id: timestamp,
  timestamp,
  author_name: 'Viewer',
  text: 'Feedback',
  created_at: '2026-09-19 10:00:00',
});
test('dense comments cluster on a narrow track without mutating their source order', () => {
  const source = [comment(60), comment(10), comment(12), comment(13)];
  const clusters = clusterComments(source, 100, 100);
  assert.deepEqual(
    clusters.map((c) => c.members.length),
    [3, 1],
  );
  assert.equal(clusters[0].time, 35 / 3);
  assert.deepEqual(
    source.map((c) => c.timestamp),
    [60, 10, 12, 13],
  );
  assert.equal(clusterComments(source, 100, 2000).length, 4);
});
test('inline timestamps preserve text and ignore values beyond the video', () => {
  const text = '<img onerror=alert(1)> at 0:05, 1:02:03 and 9:59.';
  const parts = timestampParts(text, 100);
  assert.equal(parts.map((p) => p.text).join(''), text);
  assert.deepEqual(
    parts.filter((p) => p.time !== undefined),
    [{ text: '0:05', time: 5 }],
  );
  assert.deepEqual(timestampParts('1:02:03', 4000), [{ text: '1:02:03', time: 3723 }]);
  assert.deepEqual(timestampParts('0:05', 0), [{ text: '0:05' }]);
});

test('reaction clusters retain every emoji and timestamp, separating distant moments', () => {
  const items = [
    { timestamp: 12, emoji: '🔥', created_at: '3' },
    { timestamp: 2, emoji: '❤️', created_at: '1' },
    { timestamp: 2.1, emoji: '👍', created_at: '2' },
  ];
  const groups = clusterReactions(items, 18, 350);
  assert.deepEqual(groups.map(group => group.members.map(item => item.emoji)), [['❤️', '👍'], ['🔥']]);
  assert.equal(groups[0].members[0].timestamp, 2);
  assert.equal(items[0].timestamp, 12);
});

test('shared timeline groups overlapping comments and reactions into one numbered marker', () => {
  const groups = clusterTimeline([
    { timestamp: 2, kind: 'comment', label: 'Feedback' },
    { timestamp: 2.1, kind: 'reaction', label: 'Fire', emoji: '🔥' },
    { timestamp: 16, kind: 'reaction', label: 'Surprised', emoji: '😮' },
  ], 18, 350);
  assert.deepEqual(groups.map(group => group.members.length), [2, 1]);
  assert.deepEqual(groups[0].members.map(item => item.kind), ['comment', 'reaction']);
});
