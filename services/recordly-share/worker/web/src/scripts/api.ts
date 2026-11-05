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
  feedback_enabled?: boolean;
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
  can_manage?: boolean;
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

export async function fetchComments(shareCode: string, page = 1, limit = 50, accessToken?: string): Promise<CommentsResponse> {
  const res = await fetch(`/s/${shareCode}/comments?page=${page}&limit=${limit}`, {
    credentials: 'include',
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
  });
  if (!res.ok) throw new Error('Could not load comments');
  return res.json();
}

export class CommentRateLimitError extends Error {
  constructor() {
    super('You’re commenting too quickly. Please wait a little and try again. Your draft is saved here.');
  }
}

export interface CommentAccountState {
  key: string;
  needsDisplayName?: boolean;
  displayName: string;
  getAccessToken: () => Promise<string | undefined>;
}

export class CommentSignInError extends Error {
  constructor() {
    super('Your session expired. Sign in again to continue. Your draft is saved here.');
  }
}

export async function postComment(
  shareCode: string,
  timestamp: number,
  text: string,
  accessToken?: string,
): Promise<{ id: number; author_name: string }> {
  const res = await fetch(`/s/${shareCode}/comment`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
    credentials: 'include',
    body: JSON.stringify({ timestamp, text }),
  });
  if (res.status === 429) throw new CommentRateLimitError();
  if (res.status === 401) throw new CommentSignInError();
  if (res.status === 422) throw new Error('Choose a display name before commenting.');
  if (res.status === 403) throw new Error('New comments are unavailable. The creator may have disabled feedback or your account may need verification. Your draft is saved here.');
  if (!res.ok) throw new Error('Could not post your comment. Your draft is saved here—please try again.');
  return res.json();
}

export async function updateOwnComment(shareCode: string, id: number, text: string, accessToken?: string): Promise<void> {
  await changeOwnComment(shareCode, id, 'PATCH', accessToken, { text });
}

export async function deleteOwnComment(shareCode: string, id: number, accessToken?: string): Promise<void> {
  await changeOwnComment(shareCode, id, 'DELETE', accessToken);
}

async function changeOwnComment(shareCode: string, id: number, method: 'PATCH' | 'DELETE', accessToken?: string, body?: { text: string }) {
  const response = await fetch(`/s/${shareCode}/comments/${id}`, {
    method,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (response.status === 401) {
    const data = await response.json().catch(() => null);
    if (data?.error === 'Password required') throw new Error('This recording needs its password again. Reload the page to unlock it.');
    throw new CommentSignInError();
  }
  if (response.status === 403) {
    const data = await response.json().catch(() => null);
    throw new Error(data?.error === 'Feedback is disabled for this recording'
      ? 'The creator has turned off comment editing. You can still delete your own comments.'
      : 'Your account could not be verified for this change. Please sign in again.');
  }
  if (response.status === 404) throw new Error('This comment is no longer available or belongs to another account.');
  if (response.status === 429) throw new Error('Please wait a little before changing this comment again.');
  if (!response.ok) throw new Error(method === 'PATCH' ? 'Could not save your changes. Your draft is still here—please try again.' : 'Could not delete your comment. Please try again.');
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
  const response = await fetch('/auth/logout', { method: 'POST', credentials: 'include' });
  if (!response.ok) throw new Error('Could not sign out. Please try again.');
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

// Share pages and the library use the same Safari-safe UTC timestamp parser.
export { formatDate } from './library.ts';

export function escapeHTML(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}


export type ReportReason = 'spam' | 'harassment' | 'illegal_content' | 'privacy' | 'copyright' | 'other';
export interface ModerationSettings { feedbackEnabled: boolean; sharingEnabled: boolean; sharingBlocked?: boolean; }

export async function reportRecording(shareCode: string, reason: ReportReason, details: string): Promise<void> {
  const res = await fetch(`/s/${encodeURIComponent(shareCode)}/report`, {
    method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason, details: details.trim() }),
  });
  if (res.status === 429) throw new Error('Too many reports. Please wait before trying again. Your draft is saved here.');
  if (!res.ok) throw new Error('Could not send your report. Your draft is saved here. Please try again.');
}

async function moderationRequest<T>(shareCode: string, accessToken: string, suffix = '', init: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api/moderation/${encodeURIComponent(shareCode)}${suffix}`, {
    ...init, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(res.status === 401 ? 'Your session expired. Sign in again to manage this recording.' : 'Could not update sharing controls. Please try again.');
  return res.status === 204 ? undefined as T : res.json();
}
export function fetchModeration(shareCode: string, accessToken: string): Promise<ModerationSettings> {
  return moderationRequest(shareCode, accessToken);
}
export function updateModeration(shareCode: string, accessToken: string, settings: Partial<ModerationSettings>): Promise<ModerationSettings> {
  return moderationRequest(shareCode, accessToken, '', { method: 'PATCH', body: JSON.stringify(settings) });
}
export function fetchModerationComments(shareCode: string, accessToken: string, page = 1): Promise<CommentsResponse> {
  return moderationRequest(shareCode, accessToken, `/comments?page=${page}&limit=50`);
}
export function deleteModerationComment(shareCode: string, accessToken: string, commentId: number): Promise<void> {
  return moderationRequest(shareCode, accessToken, `/comments/${commentId}`, { method: 'DELETE' });
}
