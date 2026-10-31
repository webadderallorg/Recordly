export interface LibraryVideo {
  share_code: string;
  title: string;
  duration: number;
  width: number;
  height: number;
  file_size: number;
  created_at: string;
  expires_at: string;
  view_count: number;
  is_meeting: number;
  summary: string | null;
  is_protected: number;
}

export async function fetchVideos(): Promise<LibraryVideo[]> {
  const res = await fetch('/api/videos', { credentials: 'include' });
  if (res.status === 401) {
    window.location.href = '/library/login';
    return [];
  }
  if (!res.ok) throw new Error(`Failed to load videos (${res.status})`);
  const data = await res.json();
  return data.videos || [];
}

export async function renewVideo(shareCode: string): Promise<string | null> {
  const res = await fetch(`/api/renew/${shareCode}`, {
    method: 'POST',
    credentials: 'include',
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.expiresAt || null;
}

export async function deleteVideo(shareCode: string): Promise<boolean> {
  const res = await fetch(`/api/delete/${shareCode}`, {
    method: 'DELETE',
    credentials: 'include',
  });
  return res.ok;
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
