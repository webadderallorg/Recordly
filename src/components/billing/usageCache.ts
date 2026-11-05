import { loadAppSetting, saveAppSetting } from "@/lib/appSettings";

/** Display-only snapshot. Never use this cache to authorize billing or uploads. */
export interface CachedCloudUsage {
	version: 1;
	updatedAt: number;
	plan: "free" | "pro";
	usage: {
		recordings: number;
		storageBytes: number;
		recordingLimit: number | null;
		storageLimitBytes: number | null;
	};
}

const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const nonnegativeInteger = (value: unknown): value is number =>
	typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

export function usageCacheKey(endpoint: string, userId: string): string {
	return `recordly:cloud-usage:v1:${encodeURIComponent(endpoint)}:${encodeURIComponent(userId)}`;
}

export function readUsageCache(endpoint: string, userId: string): CachedCloudUsage | null {
	try {
		const key = usageCacheKey(endpoint, userId);
		// Packaged renderer ports change between launches. Native settings survive
		// origin changes; browser storage also supports previews and older builds.
		const native = loadAppSetting<unknown>(key);
		const raw = native !== null ? JSON.stringify(native) : localStorage.getItem(key);
		if (!raw || raw.length > 4096) return null;
		const value = JSON.parse(raw) as CachedCloudUsage;
		if (
			!value ||
			value.version !== 1 ||
			!nonnegativeInteger(value.updatedAt) ||
			Date.now() - value.updatedAt > MAX_AGE_MS ||
			value.updatedAt > Date.now() + 60_000 ||
			(value.plan !== "free" && value.plan !== "pro") ||
			!value.usage ||
			Array.isArray(value.usage) ||
			!nonnegativeInteger(value.usage.recordings) ||
			!nonnegativeInteger(value.usage.storageBytes) ||
			(value.plan === "free" && !nonnegativeInteger(value.usage.recordingLimit)) ||
			(value.plan === "pro" &&
				(value.usage.recordingLimit !== null ||
					(value.usage.storageLimitBytes !== null &&
						(!nonnegativeInteger(value.usage.storageLimitBytes) ||
							value.usage.storageLimitBytes <= 0)))) ||
			(value.usage.storageLimitBytes !== null &&
				!nonnegativeInteger(value.usage.storageLimitBytes))
		)
			return null;
		return {
			version: 1,
			updatedAt: value.updatedAt,
			plan: value.plan,
			usage: {
				recordings: value.usage.recordings,
				storageBytes: value.usage.storageBytes,
				recordingLimit: value.usage.recordingLimit,
				storageLimitBytes: value.usage.storageLimitBytes,
			},
		};
	} catch {
		return null;
	}
}

export function writeUsageCache(
	endpoint: string,
	userId: string,
	snapshot: CachedCloudUsage,
): void {
	const key = usageCacheKey(endpoint, userId);
	saveAppSetting(key, snapshot);
	try {
		localStorage.setItem(key, JSON.stringify(snapshot));
	} catch {
		// Storage can be unavailable or full; live usage must still work.
	}
}
