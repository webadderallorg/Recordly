type PreviewResult = Awaited<ReturnType<Window["electronAPI"]["getProjectPreview"]>>;
type CachedPreview = { expiresAt: number; request: Promise<PreviewResult> };

const MAX_ENTRIES = 100;
const MAX_AGE_MS = 30_000;
// Capability URLs belong to this renderer's bridge session and stay in memory.
const sessions = new WeakMap<Window["electronAPI"], Map<string, CachedPreview>>();

/** Share preview reads across cards, remounts and media sorts for a listed revision. */
export function getCachedProjectPreview(path: string, revision: number): Promise<PreviewResult> {
	const api = window.electronAPI;
	let cache = sessions.get(api);
	if (!cache) {
		cache = new Map();
		sessions.set(api, cache);
	}
	const key = JSON.stringify([path, revision]);
	const cached = cache.get(key);
	if (cached && cached.expiresAt > Date.now()) {
		cache.delete(key);
		cache.set(key, cached);
		return cached.request;
	}
	if (cached) cache.delete(key);
	const sessionCache = cache;
	const entry: CachedPreview = {
		expiresAt: Number.POSITIVE_INFINITY,
		request: Promise.resolve()
			.then(() => api.getProjectPreview(path))
			.then(
				(result) => {
					if (sessionCache.get(key) === entry) {
						// Sources can be relinked or go offline without a project mtime change.
						if (result.success) entry.expiresAt = Date.now() + MAX_AGE_MS;
						else sessionCache.delete(key);
					}
					return result;
				},
				(error) => {
					if (sessionCache.get(key) === entry) sessionCache.delete(key);
					throw error;
				},
			),
	};
	cache.set(key, entry);
	if (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value!);
	return entry.request;
}
