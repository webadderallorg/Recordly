export interface VideoInfo {
  title: string;
  duration: number;
  width: number;
  height: number;
  summary: string | null;
  has_webcam: number;
  cta_url: string | null;
  cta_text: string | null;
  created_at: string;
  view_count: number;
  is_meeting: number;
}

export interface Segment {
  start_time: number;
  end_time: number;
  text: string;
  speaker: string | null;
}

export interface Chapter {
  timestamp: number;
  title: string;
}

export interface ShareData {
  creator?: { name: string; bio?: string | null; website?: string | null } | null;
  video: VideoInfo;
  segments: Segment[];
  chapters: Chapter[];
  shareCode: string;
}

export interface PasswordRequired {
  password_protected: true;
  title: string;
}

export interface Expired {
  expired: true;
}

export interface Comment {
  id: number;
  timestamp: number;
  author_name: string;
  text: string;
  created_at: string;
}

export interface CommentsResponse {
  comments: Comment[];
  total: number;
  page: number;
  limit: number;
}

export interface CommentUser {
  email: string;
  displayName: string;
}

export interface Reaction {
  timestamp: number;
  emoji: string;
  created_at: string;
}

export type ShareResponse = ShareData | PasswordRequired | Expired;

export function isShareData(r: ShareResponse): r is ShareData {
  return 'video' in r;
}

export function isPasswordRequired(r: ShareResponse): r is PasswordRequired {
  return 'password_protected' in r;
}

export function isExpired(r: ShareResponse): r is Expired {
  return 'expired' in r;
}

export async function fetchShareData(shareCode: string): Promise<ShareResponse> {
  const res = await fetch(`/s/${shareCode}/data`, { credentials: 'include' });
  return res.json();
}

export async function verifyPassword(shareCode: string, password: string): Promise<boolean> {
  const res = await fetch(`/s/${shareCode}/verify-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ password }),
  });
  return res.ok;
}

export async function fetchReactions(shareCode: string): Promise<Reaction[]> {
  const res = await fetch(`/s/${shareCode}/reactions`);
  const data = await res.json();
  return data.reactions || [];
}

export async function postReaction(shareCode: string, timestamp: number, emoji: string): Promise<boolean> {
  const res = await fetch(`/s/${shareCode}/react`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ timestamp, emoji }),
  });
  return res.ok;
}

export async function fetchComments(shareCode: string, page = 1, limit = 50): Promise<CommentsResponse> {
  const res = await fetch(`/s/${shareCode}/comments?page=${page}&limit=${limit}`);
  return res.json();
}

export async function postComment(
  shareCode: string,
  timestamp: number,
  authorName: string,
  text: string
): Promise<number> {
  const res = await fetch(`/s/${shareCode}/comment`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ timestamp, author_name: authorName, text }),
  });
  if (!res.ok) throw new Error('Could not post comment');
  return (await res.json()).id;
}

export async function fetchCommentUser(): Promise<CommentUser | null> {
  const res = await fetch('/auth/session', { credentials: 'include' });
  if (!res.ok) return null;
  return (await res.json()).user || null;
}

export async function signInForComments(email: string, password: string): Promise<CommentUser> {
  return submitCommentAuth('/auth/login', { email, password });
}

export async function createCommentAccount(
  displayName: string,
  email: string,
  password: string,
): Promise<CommentUser> {
  return submitCommentAuth('/auth/register', { displayName, email, password });
}

async function submitCommentAuth(path: string, body: Record<string, string>): Promise<CommentUser> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Unable to sign in');
  return data.user;
}

export async function signOutFromComments(): Promise<void> {
  await fetch('/auth/logout', { method: 'POST', credentials: 'include' });
}

export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function formatTimestamp(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// Turn mm:ss / h:mm:ss timestamps written inside comment text into clickable
// seek links. MUST be called on already-HTML-escaped text (output of escapeHTML):
// the regex only sees real colons (escaped entities can't be mistaken for them),
// and the href/data are built from parsed integers, never from user input — so the
// returned string is safe to assign via innerHTML. Links beyond duration stay plain.
const TIMESTAMP_RE = /(?<!\d)(?:(\d+):)?([0-5]?\d):([0-5]\d)(?!\d)/g;

export function linkifyTimestamps(escapedText: string, duration: number): string {
  return escapedText.replace(TIMESTAMP_RE, (match, hStr, mStr, sStr) => {
    const h = hStr !== undefined ? parseInt(hStr, 10) : 0;
    const m = parseInt(mStr, 10);
    const s = parseInt(sStr, 10);
    const t = h * 3600 + m * 60 + s;
    if (!duration || t > duration) return match;
    return `<a class="ts-link" data-t="${t}" role="button" tabindex="0">${match}</a>`;
  });
}

export function formatDate(isoString: string): string {
  const d = new Date(isoString + 'Z');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function escapeHTML(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
