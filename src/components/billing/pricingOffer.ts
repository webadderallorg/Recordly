import type { CloudBillingInterval, CloudBillingPrice } from "@/types/cloudBilling";

/** Display and checkout use the same server-verified catalog entry. */
export function getPlusPrice(
	catalog: { prices?: CloudBillingPrice[] } | null,
	interval: CloudBillingInterval = "monthly",
): CloudBillingPrice | null {
	return (
		catalog?.prices?.find(
			(price) =>
				price.interval === interval &&
				price.currency === "usd" &&
				Number.isSafeInteger(price.unitAmount) &&
				price.unitAmount > 0,
		) ?? null
	);
}

export function getDiscountPercent(price: CloudBillingPrice | null): number | null {
	if (
		!price?.regularUnitAmount ||
		!Number.isSafeInteger(price.regularUnitAmount) ||
		price.regularUnitAmount <= price.unitAmount
	)
		return null;
	// Round down so the advertised saving never exceeds the actual saving.
	const percent = Math.floor((1 - price.unitAmount / price.regularUnitAmount) * 100 + 1e-9);
	return percent > 0 ? percent : null;
}

/** Do not offer checkout when public pricing and the account's verified price disagree. */
export function hasVerifiedCheckoutPrice(
	catalog: { prices?: CloudBillingPrice[] } | null,
	billing: { prices?: CloudBillingPrice[] } | undefined,
	interval: CloudBillingInterval = "monthly",
): boolean {
	const displayed = getPlusPrice(catalog, interval);
	const verified = getPlusPrice(billing ?? null, interval);
	return Boolean(displayed && verified && displayed.unitAmount === verified.unitAmount);
}
