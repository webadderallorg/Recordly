export type GeneratedProjectThumbnail = { url: string; duration: number };

// Reuse completed renders across cards/remounts and limit video/GPU work while scrolling.
const completed = new Map<string, GeneratedProjectThumbnail>();
const pending = new Map<string, Promise<GeneratedProjectThumbnail>>();
let queue = Promise.resolve();
const MAX_ENTRIES = 100;

export function peekProjectThumbnail(key: string) {
	return completed.get(key);
}

export function getOrCreateProjectThumbnail(
	key: string,
	create: () => Promise<GeneratedProjectThumbnail>,
): Promise<GeneratedProjectThumbnail> {
	const cached = completed.get(key);
	if (cached) {
		completed.delete(key);
		completed.set(key, cached);
		return Promise.resolve(cached);
	}
	const existing = pending.get(key);
	if (existing) return existing;
	const task = queue
		.then(create)
		.then((result) => {
			completed.set(key, result);
			if (completed.size > MAX_ENTRIES) completed.delete(completed.keys().next().value!);
			return result;
		})
		.finally(() => pending.delete(key));
	pending.set(key, task);
	queue = task.then(
		() => undefined,
		() => undefined,
	);
	return task;
}
