import type { RecordingLibraryEntry } from "@/types/recordingLibrary";

const completed = new Map<string, string>();
const pending = new Map<string, Promise<string>>();
const MAX_ENTRIES = 200;

export function recordingThumbnailKey(entry: RecordingLibraryEntry): string {
	return JSON.stringify([entry.path, entry.createdAt, entry.bytes]);
}

export function peekRecordingThumbnail(key: string): string | undefined {
	const cached = completed.get(key);
	if (cached) {
		completed.delete(key);
		completed.set(key, cached);
	}
	return cached;
}

export function loadRecordingThumbnail(key: string, path: string): Promise<string> {
	const cached = peekRecordingThumbnail(key);
	if (cached) return Promise.resolve(cached);
	const existing = pending.get(key);
	if (existing) return existing;
	const task = window.electronAPI
		.getRecordingThumbnail(path)
		.then((result) => {
			if (!result.success) throw new Error(result.error);
			completed.set(key, result.value);
			if (completed.size > MAX_ENTRIES) completed.delete(completed.keys().next().value!);
			return result.value;
		})
		.finally(() => pending.delete(key));
	pending.set(key, task);
	return task;
}
