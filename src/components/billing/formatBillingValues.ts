import type { CloudBillingPrice } from "@/types/cloudBilling";

export function formatCloudBytes(bytes: number, locale = "en"): string {
	const [divisor, unit] =
		bytes >= 1_000_000_000
			? ([1_000_000_000, "gigabyte"] as const)
			: bytes >= 1_000_000
				? ([1_000_000, "megabyte"] as const)
				: ([1000, "kilobyte"] as const);
	return new Intl.NumberFormat(locale, {
		style: "unit",
		unit,
		unitDisplay: "short",
		maximumFractionDigits: 1,
	}).format(bytes / divisor);
}

export function formatPrice(price: CloudBillingPrice, locale = "en"): string {
	return new Intl.NumberFormat(locale, {
		style: "currency",
		currency: price.currency.toUpperCase(),
		maximumFractionDigits: price.unitAmount % 100 === 0 ? 0 : 2,
	}).format(price.unitAmount / 100);
}
