import type { RecordingLibraryEntry } from "@/types/recordingLibrary";

const MAX_ENTRIES = 200;
let durationQueue = Promise.resolve();

export function recordingThumbnailKey(entry: RecordingLibraryEntry): string {
	return JSON.stringify([entry.path, entry.createdAt, entry.bytes]);
}

function createRecordingCache<T>(read: (path: string) => Promise<T>) {
	const completed = new Map<string, T>();
	const pending = new Map<string, Promise<T>>();

	const peek = (key: string) => {
		const cached = completed.get(key);
		if (cached !== undefined) {
			completed.delete(key);
			completed.set(key, cached);
		}
		return cached;
	};

	const load = (key: string, path: string) => {
		const cached = peek(key);
		if (cached !== undefined) return Promise.resolve(cached);
		const existing = pending.get(key);
		if (existing) return existing;
		const task = read(path)
			.then((value) => {
				completed.set(key, value);
				if (completed.size > MAX_ENTRIES) completed.delete(completed.keys().next().value!);
				return value;
			})
			.finally(() => pending.delete(key));
		pending.set(key, task);
		return task;
	};
	return { peek, load };
}

export const { peek: peekRecordingThumbnail, load: loadRecordingThumbnail } = createRecordingCache(
	async (path) => {
		const result = await window.electronAPI.getRecordingThumbnail(path);
		if (!result.success) throw new Error(result.error);
		return result.value;
	},
);

export const { peek: peekRecordingDuration, load: loadRecordingDuration } = createRecordingCache(
	(path) => {
		// Scrolling through the gallery should only launch one FFmpeg metadata probe at a time.
		const task = durationQueue.then(async () => {
			const result = await window.electronAPI.probeNativeVideoMetadata(path);
			if (!result.success || !result.metadata) throw new Error(result.error);
			return result.metadata.duration;
		});
		durationQueue = task.then(
			() => undefined,
			() => undefined,
		);
		return task;
	},
);
