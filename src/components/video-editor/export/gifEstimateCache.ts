import type { GifSizeEstimate } from "@/lib/exporter/gifExporter";

const cache = new Map<string, { estimate: GifSizeEstimate; expires: number }>();
const identities = new WeakMap<object, number>();
let nextIdentity = 1;
let tail = Promise.resolve();
const jobs = new Set<AbortController>();

export function gifEstimateTelemetryKey(value: object | undefined): number {
	if (!value) return 0;
	let id = identities.get(value);
	if (!id) {
		id = nextIdentity++;
		identities.set(value, id);
	}
	return id;
}

export function getCachedGifSizeEstimate(key: string): GifSizeEstimate | undefined {
	const entry = cache.get(key);
	if (!entry) return;
	cache.delete(key);
	if (entry.expires <= Date.now()) return;
	cache.set(key, entry);
	return entry.estimate;
}

export function cacheGifSizeEstimate(key: string, estimate: GifSizeEstimate): void {
	cache.delete(key);
	cache.set(key, { estimate, expires: Date.now() + 5 * 60_000 });
	while (cache.size > 8) cache.delete(cache.keys().next().value!);
}

/** Keep GPU rendering and encoding samples serial, including asynchronous cleanup. */
export async function runGifSizeEstimate<T>(
	signal: AbortSignal,
	job: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
	const controller = new AbortController();
	const abort = () => controller.abort();
	signal.addEventListener("abort", abort, { once: true });
	if (signal.aborted) abort();
	jobs.add(controller);
	const result = tail.then(() => {
		if (controller.signal.aborted)
			throw new DOMException("GIF estimate cancelled", "AbortError");
		return job(controller.signal);
	});
	tail = result.then(
		() => undefined,
		() => undefined,
	);
	try {
		return await result;
	} finally {
		jobs.delete(controller);
		signal.removeEventListener("abort", abort);
	}
}

/** A real export gets priority and waits until sample resources have been released. */
export async function stopGifSizeEstimates(): Promise<void> {
	for (const controller of jobs) controller.abort();
	await tail;
}
