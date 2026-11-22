import {
	type CloudBillingResult,
	parseCloudBillingCatalog,
	parseCloudBillingStatus,
} from "@/types/cloudBilling";

const STATUS_FRESH_MS = 60_000;
const CATALOG_FRESH_MS = 5 * 60_000;
const MAX_ENTRIES = 8;
type Entry = {
	promise: Promise<CloudBillingResult>;
	expiresAt: number;
	pending: boolean;
};
const reads = new Map<string, Entry>();

/** Display snapshots only. The service authorizes every mutation and reserves quota itself. */
export function readCloudBilling(
	endpoint: string,
	action: "status" | "catalog",
	token?: string,
	fresh = false,
): Promise<CloudBillingResult> {
	const key = JSON.stringify([endpoint, action, action === "status" ? token : null]);
	const existing = reads.get(key);
	if (existing && (existing.pending || (!fresh && existing.expiresAt > Date.now())))
		return existing.promise;
	const entry: Entry = {
		promise: Promise.resolve({ success: false }),
		expiresAt: 0,
		pending: true,
	};
	// Install before calling the bridge so simultaneous consumers share one request.
	reads.delete(key);
	reads.set(key, entry);
	while (reads.size > MAX_ENTRIES) reads.delete(reads.keys().next().value!);
	entry.promise = Promise.resolve().then(async () => {
		try {
			const result = await window.electronAPI.cloudBilling({
				endpoint,
				action,
				...(action === "status" ? { token } : {}),
			});
			if (!result.success) {
				if (reads.get(key) === entry) reads.delete(key);
				return result;
			}
			// A malformed response must never become a cached entitlement or price.
			if (action === "status") parseCloudBillingStatus(result);
			else parseCloudBillingCatalog(result);
			entry.expiresAt =
				Date.now() + (action === "status" ? STATUS_FRESH_MS : CATALOG_FRESH_MS);
			return result;
		} catch (error) {
			if (reads.get(key) === entry) reads.delete(key);
			throw error;
		} finally {
			entry.pending = false;
		}
	});
	return entry.promise;
}

/** Invalidating also detaches pending reads, so an old snapshot cannot refill the cache. */
export function invalidateCloudBillingReads(action?: "status"): void {
	if (!action) reads.clear();
	else {
		for (const key of reads.keys()) {
			if (JSON.parse(key)[1] === action) reads.delete(key);
		}
	}
}
