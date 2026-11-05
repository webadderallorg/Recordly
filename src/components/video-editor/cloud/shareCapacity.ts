import { translate } from "@/i18n/runtime";
import { parseCloudBillingStatus } from "@/types/cloudBilling";
import { invalidateCloudBillingReads, readCloudBilling } from "./cloudBillingReads";

export const FREE_RECORDING_LIMIT = 5;
export const RECORDING_LIMIT_MESSAGE =
	"You have 5 cloud recordings. Delete one from Shared before sharing another.";

export class ShareSignInRequiredError extends Error {
	constructor() {
		super(
			translate(
				"editor.cloud.sessionRejected",
				"Your cloud session could not be verified. Sign in again to share.",
			),
		);
	}
}

export class ShareEmailVerificationRequiredError extends Error {
	constructor() {
		super(translate("ui.confirmEmailBeforeSharing"));
	}
}

function requiresSignIn(result: { error?: string; httpStatus?: number }): boolean {
	return (
		result.httpStatus === 401 ||
		/verified sign-in required|sign in again/i.test(result.error ?? "")
	);
}

export async function checkShareCapacity(
	endpoint: string,
	token: string,
	refreshToken?: () => Promise<string | undefined>,
): Promise<boolean> {
	try {
		return await readShareCapacity(endpoint, token);
	} catch (error) {
		if (!(error instanceof ShareSignInRequiredError) || !refreshToken) throw error;
		// One automatic recovery attempt; never weaken the server's sign-in or quota checks.
		const refreshed = await refreshToken();
		if (!refreshed) throw error;
		return readShareCapacity(endpoint, refreshed);
	}
}

async function readShareCapacity(endpoint: string, token: string): Promise<boolean> {
	let result;
	try {
		result = await readCloudBilling(endpoint, "status", token);
	} catch {
		// During rollout, older desktop bridges and workers still enforce the free quota.
	}
	if (!result?.success) {
		if (result && requiresSignIn(result)) throw new ShareSignInRequiredError();
		const legacy = await window.electronAPI.cloudShareManage({
			endpoint,
			token,
			action: "list",
		});
		if (!legacy.success && requiresSignIn(legacy)) throw new ShareSignInRequiredError();
		if (!legacy.success && /confirm your email/i.test(legacy.error ?? ""))
			throw new ShareEmailVerificationRequiredError();
		if (!legacy.success || !Array.isArray(legacy.videos))
			throw new Error(
				legacy.error ||
					translate(
						"editor.cloud.checkStorageFailed",
						"Could not check cloud storage. Try again.",
					),
			);
		// This fallback never grants paid capacity from an unverified claim.
		return legacy.videos.length < FREE_RECORDING_LIMIT;
	}
	const { usage } = parseCloudBillingStatus(result);
	if (usage.storageLimitBytes !== null && usage.storageBytes >= usage.storageLimitBytes)
		throw new Error(
			translate(
				"editor.cloud.storageFull",
				"Your cloud storage allowance is full. Delete a recording from Shared before sharing another.",
			),
		);
	// Pending uploads occupy slots too, matching the backend's atomic quota check.
	return usage.recordingLimit === null || usage.recordings < usage.recordingLimit;
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
	invalidateCloudBillingReads("status");
	for (const listener of capacityListeners) listener();
}
