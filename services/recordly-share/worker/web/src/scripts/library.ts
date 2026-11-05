export interface LibraryVideo {
  share_code: string;
  title: string;
  duration: number;
  width: number;
  height: number;
  file_size: number;
  created_at: string;
  expires_at: string | null;
  view_count: number;
  is_meeting: number;
  summary: string | null;
  upload_completed?: number;
  is_protected: number;
}

async function libraryRequest(path: string, accessToken?: string, method = 'GET') {
  const response = await fetch(path, {
    method, credentials: 'include',
    ...(accessToken ? { headers: { Authorization: `Bearer ${accessToken}` } } : {}),
  });
  if (response.status === 401 && !accessToken) window.location.href = '/library/login';
  if (!response.ok) throw new Error(`Cloud request failed (${response.status})`);
  return response.json();
}

export async function fetchVideos(accessToken?: string): Promise<LibraryVideo[]> {
  const videos: LibraryVideo[] = [];
  let cursor: string | undefined;
  do {
    const data = await libraryRequest(`/api/videos${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`, accessToken);
    videos.push(...(data.videos || []));
    cursor = data.nextCursor;
  } while (cursor);
  return videos.filter(video => video.upload_completed !== 0);
}

export async function renewVideo(shareCode: string, accessToken?: string): Promise<string | null> {
  const data = await libraryRequest(`/api/renew/${shareCode}`, accessToken, 'POST');
  return data.expiresAt || null;
}

export async function deleteVideo(shareCode: string, accessToken?: string): Promise<boolean> {
  await libraryRequest(`/api/delete/${shareCode}`, accessToken, 'DELETE');
  return true;
}

export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// The two timestamp columns are NOT the same shape: created_at comes from
// SQLite CURRENT_TIMESTAMP ("2026-07-08 17:57:28", UTC but unmarked), while
// expires_at is written as a JS ISO string ("2026-08-07T17:57:28.487Z").
// Blindly appending "Z" produced "...487ZZ" → Invalid Date → "Expires in NaN
// days" on every card. Only stamp the zone when the string lacks one.
export function parseUTC(value: string): Date {
  const hasZone = /[Zz]$|[+-]\d{2}:?\d{2}$/.test(value);
  return new Date(hasZone ? value : value.replace(' ', 'T') + 'Z');
}

export function formatDate(isoString: string): string {
  const d = parseUTC(isoString);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/** NaN when the timestamp can't be parsed — callers render "Expiry unknown". */
export function daysUntilExpiry(expiresAt: string): number {
  const exp = parseUTC(expiresAt).getTime();
  if (Number.isNaN(exp)) return NaN;
  return Math.max(0, Math.round((exp - Date.now()) / (24 * 60 * 60 * 1000)));
}

export function escapeHTML(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
