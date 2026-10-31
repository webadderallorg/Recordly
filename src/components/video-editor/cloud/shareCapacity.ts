export const FREE_RECORDING_LIMIT = 5;
export const RECORDING_LIMIT_MESSAGE =
	"You have 5 cloud recordings. Delete one from Shared before sharing another.";

export async function checkShareCapacity(endpoint: string, token: string): Promise<boolean> {
	const result = await window.electronAPI.cloudShareManage({ endpoint, token, action: "list" });
	if (!result.success || !Array.isArray(result.videos)) {
		throw new Error(result.error || "Could not check cloud storage. Try again.");
	}
	// Pending uploads occupy slots too, matching the backend's atomic quota check.
	return result.videos.length < FREE_RECORDING_LIMIT;
}

const capacityListeners = new Set<() => void>();

/** Refresh active quota checks after a successful library mutation in this renderer. */
export function subscribeShareCapacityChanges(listener: () => void): () => void {
	capacityListeners.add(listener);
	return () => {
		capacityListeners.delete(listener);
	};
}

export function notifyShareCapacityChanged(): void {
	for (const listener of capacityListeners) listener();
}
