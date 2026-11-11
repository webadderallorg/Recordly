import { subscribeShareCapacityChanges } from "../cloud/shareCapacity";
import { parseSharedRecordingDate } from "../cloud/sharedRecordingDate";

export type SharedVideo = {
	code: string;
	title: string;
	url: string;
	ready: boolean;
	createdAt?: string;
};
type Snapshot = { videos?: SharedVideo[]; expiresAt: number; pending?: Promise<SharedVideo[]> };
const snapshots = new Map<string, Snapshot>();
const FRESH_MS = 60_000;

// Display data and credentials stay in this renderer's memory, scoped to the account.
export const sharedVideoCacheKey = (endpoint: string, account: string) =>
	JSON.stringify([endpoint, account]);
export function peekRecentSharedVideos(key: string) {
	// Keep the last known geometry on remount; freshness controls network reuse only.
	return snapshots.get(key)?.videos;
}

export function readRecentSharedVideos(
	key: string,
	endpoint: string,
	token: string,
	fresh = false,
): Promise<SharedVideo[]> {
	const existing = snapshots.get(key);
	if (existing?.pending && !fresh) return existing.pending;
	if (!fresh && existing?.videos && existing.expiresAt > Date.now())
		return Promise.resolve(existing.videos);
	const snapshot: Snapshot = { videos: existing?.videos, expiresAt: existing?.expiresAt ?? 0 };
	snapshots.delete(key);
	snapshots.set(key, snapshot);
	while (snapshots.size > 8) snapshots.delete(snapshots.keys().next().value!);
	snapshot.pending = Promise.resolve().then(async () => {
		try {
			const result = await window.electronAPI.cloudShareManage({
				token,
				endpoint,
				action: "list",
			});
			if (!result.success) throw new Error(result.error || "Could not load shared videos.");
			const videos = (result.videos ?? [])
				.filter((video) => video.ready)
				.sort(
					(a, b) =>
						parseSharedRecordingDate(b.createdAt) -
						parseSharedRecordingDate(a.createdAt),
				)
				.slice(0, 12);
			snapshot.videos = videos;
			snapshot.expiresAt = Date.now() + FRESH_MS;
			return videos;
		} finally {
			snapshot.pending = undefined;
			if (!snapshot.expiresAt && snapshots.get(key) === snapshot) snapshots.delete(key);
		}
	});
	return snapshot.pending;
}

// Also invalidate while Home is closed. Detached pending reads cannot repopulate it.
subscribeShareCapacityChanges(() => snapshots.clear());
