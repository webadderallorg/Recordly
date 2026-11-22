import type { useOptionalBilling } from "./BillingProvider";

/** Use the current verified account, including when saving a previously rendered export. */
export function canExportCaptionFiles(billing: ReturnType<typeof useOptionalBilling>): boolean {
	return Boolean(
		billing?.user &&
			!billing.loading &&
			!billing.needsSignIn &&
			billing.status?.billing.plan === "pro" &&
			billing.status.billing.subscriptionStatus === "active",
	);
}
