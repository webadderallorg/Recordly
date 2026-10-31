import type { Comment, Reaction } from './api';

/** Keep dense timestamp markers usable at every track width. */
function clusterMarkers<T extends { timestamp: number }>(comments: T[], duration: number, width: number, pixels = 18) {
  const gap = width > 0 ? (pixels / width) * duration : duration * 0.02;
  const clusters: { time: number; members: T[] }[] = [];
  for (const comment of [...comments].sort((a, b) => a.timestamp - b.timestamp)) {
    const last = clusters.at(-1);
    if (last && comment.timestamp - last.members.at(-1)!.timestamp < gap) {
      last.members.push(comment);
      last.time = last.members.reduce((sum, item) => sum + item.timestamp, 0) / last.members.length;
    } else clusters.push({ time: comment.timestamp, members: [comment] });
  }
  return clusters;
}

/** Parse inline timestamps without converting user text to HTML. */
export function timestampParts(text: string, duration: number) {
  const pattern = /(?<!\d)(?:(\d+):)?([0-5]?\d):([0-5]\d)(?!\d)/g;
  const parts: { text: string; time?: number }[] = [];
  let start = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index!;
    if (index > start) parts.push({ text: text.slice(start, index) });
    const time = Number(match[1] || 0) * 3600 + Number(match[2]) * 60 + Number(match[3]);
    parts.push({ text: match[0], ...(duration > 0 && time <= duration ? { time } : {}) });
    start = index + match[0].length;
  }
  if (start < text.length) parts.push({ text: text.slice(start) });
  return parts;
}

export const clusterComments = (items: Comment[], duration: number, width: number) => clusterMarkers(items, duration, width);
export const clusterReactions = (items: Reaction[], duration: number, width: number) => clusterMarkers(items, duration, width, 32);

export interface TimelineItem {
  timestamp: number;
  kind: 'comment' | 'reaction' | 'chapter';
  label: string;
  emoji?: string;
}
export const clusterTimeline = (items: TimelineItem[], duration: number, width: number) => clusterMarkers(items, duration, width, 28);
