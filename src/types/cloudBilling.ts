export type CloudBillingInterval = "monthly" | "yearly";

export interface CloudBillingPrice {
	interval: CloudBillingInterval;
	unitAmount: number;
	currency: string;
	regularUnitAmount?: number;
	promotion?: "early_bird";
}

export interface CloudBillingLimits {
	freeRecordingLimit: number;
	freeMaxRecordingBytes: number;
	plusMaxRecordingBytes: number;
	plusWeeklyUploadLimit?: number;
	storageLimitBytes: number | null;
}

export interface CloudBillingInput {
	endpoint: string;
	token?: string;
	action: "catalog" | "status" | "checkout" | "portal";
	interval?: CloudBillingInterval;
}

export interface CloudBillingStatus {
	plan: "free" | "pro";
	subscriptionStatus: string | null;
	currentPeriodEnd: number | null;
	cancelAtPeriodEnd: boolean;
	checkoutAvailable: boolean;
	checkoutIntervals: CloudBillingInterval[];
	portalAvailable: boolean;
	prices: CloudBillingPrice[];
}

export interface CloudBillingUsage {
	recordings: number;
	recordingLimit: number | null;
	maxRecordingBytes: number;
	storageBytes: number;
	storageLimitBytes: number | null;
}

export interface CloudBillingResult {
	success: boolean;
	httpStatus?: number;
	billing?: CloudBillingStatus;
	usage?: CloudBillingUsage;
	url?: string;
	error?: string;
	prices?: CloudBillingPrice[];
	limits?: CloudBillingLimits;
}

function parsePrices(value: unknown): CloudBillingPrice[] {
	if (!Array.isArray(value) || value.length > 2)
		throw new Error("Could not verify plan pricing.");
	const seen = new Set<CloudBillingInterval>();
	return value.map((price: unknown) => {
		if (!price || typeof price !== "object" || Array.isArray(price))
			throw new Error("Could not verify plan pricing.");
		const item = price as CloudBillingPrice;
		if (
			(item.interval !== "monthly" && item.interval !== "yearly") ||
			seen.has(item.interval) ||
			!Number.isSafeInteger(item.unitAmount) ||
			item.unitAmount <= 0 ||
			typeof item.currency !== "string" ||
			!/^[a-z]{3}$/.test(item.currency)
		)
			throw new Error("Could not verify plan pricing.");
		seen.add(item.interval);
		const regularUnitAmount = item.regularUnitAmount;
		if (
			regularUnitAmount !== undefined &&
			(!Number.isSafeInteger(regularUnitAmount) || regularUnitAmount <= item.unitAmount)
		)
			throw new Error("Could not verify plan promotion.");
		if (
			item.promotion !== undefined &&
			(item.promotion !== "early_bird" || regularUnitAmount === undefined)
		)
			throw new Error("Could not verify plan promotion.");
		return {
			interval: item.interval,
			unitAmount: item.unitAmount,
			currency: item.currency,
			...(regularUnitAmount !== undefined ? { regularUnitAmount } : {}),
			...(item.promotion ? { promotion: item.promotion } : {}),
		};
	});
}

export function parseCloudBillingCatalog(result: unknown): {
	prices: CloudBillingPrice[];
	limits: CloudBillingLimits;
} {
	if (!result || typeof result !== "object" || Array.isArray(result))
		throw new Error("Could not verify plan pricing.");
	const value = result as CloudBillingResult;
	if (value.success !== true) throw new Error(value.error || "Could not verify plan pricing.");
	const limits = value.limits;
	if (
		!limits ||
		Array.isArray(limits) ||
		![
			limits.freeRecordingLimit,
			limits.freeMaxRecordingBytes,
			limits.plusMaxRecordingBytes,
		].every((limit) => Number.isSafeInteger(limit) && limit > 0) ||
		(limits.storageLimitBytes !== null &&
			(!Number.isSafeInteger(limits.storageLimitBytes) || limits.storageLimitBytes <= 0)) ||
		(limits.plusWeeklyUploadLimit !== undefined &&
			(!Number.isSafeInteger(limits.plusWeeklyUploadLimit) ||
				limits.plusWeeklyUploadLimit <= 0)) ||
		limits.plusMaxRecordingBytes < limits.freeMaxRecordingBytes
	)
		throw new Error("Could not verify plan limits.");
	return {
		prices: parsePrices(value.prices),
		limits: {
			freeRecordingLimit: limits.freeRecordingLimit,
			freeMaxRecordingBytes: limits.freeMaxRecordingBytes,
			plusMaxRecordingBytes: limits.plusMaxRecordingBytes,
			...(limits.plusWeeklyUploadLimit === undefined
				? {}
				: { plusWeeklyUploadLimit: limits.plusWeeklyUploadLimit }),
			storageLimitBytes: limits.storageLimitBytes,
		},
	};
}

/** Defensive renderer validation; entitlement and upload enforcement remain server-owned. */
export function parseCloudBillingStatus(result: unknown): {
	billing: CloudBillingStatus;
	usage: CloudBillingUsage;
} {
	if (!result || typeof result !== "object" || Array.isArray(result))
		throw new Error("Could not verify your cloud plan.");
	const value = result as CloudBillingResult;
	if (value.success !== true)
		throw new Error(value.error || "Could not verify your cloud plan. Try again.");
	const { billing, usage } = value;
	if (
		!billing ||
		Array.isArray(billing) ||
		!usage ||
		Array.isArray(usage) ||
		(billing.plan !== "free" && billing.plan !== "pro") ||
		!(billing.subscriptionStatus === null || typeof billing.subscriptionStatus === "string") ||
		!(
			billing.currentPeriodEnd === null ||
			(Number.isSafeInteger(billing.currentPeriodEnd) && billing.currentPeriodEnd > 0)
		) ||
		typeof billing.cancelAtPeriodEnd !== "boolean" ||
		typeof billing.checkoutAvailable !== "boolean" ||
		typeof billing.portalAvailable !== "boolean" ||
		!Number.isSafeInteger(usage.recordings) ||
		usage.recordings < 0 ||
		!Number.isSafeInteger(usage.maxRecordingBytes) ||
		usage.maxRecordingBytes <= 0 ||
		!Number.isSafeInteger(usage.storageBytes) ||
		usage.storageBytes < 0 ||
		!(usage.storageLimitBytes === null
			? billing.plan === "pro"
			: Number.isSafeInteger(usage.storageLimitBytes) && usage.storageLimitBytes > 0) ||
		!(
			usage.recordingLimit === null ||
			(Number.isSafeInteger(usage.recordingLimit) && usage.recordingLimit >= 0)
		) ||
		!Array.isArray(billing.checkoutIntervals) ||
		billing.checkoutIntervals.some(
			(interval) => interval !== "monthly" && interval !== "yearly",
		) ||
		new Set(billing.checkoutIntervals).size !== billing.checkoutIntervals.length ||
		billing.checkoutAvailable !== billing.checkoutIntervals.length > 0
	)
		throw new Error("Could not verify your cloud plan. Try again.");
	const entitled = billing.plan === "pro" && billing.subscriptionStatus === "active";
	if ((billing.plan === "pro" && !entitled) || (usage.recordingLimit === null) !== entitled)
		throw new Error("Could not verify your cloud plan. Try again.");
	return {
		billing: {
			plan: billing.plan,
			subscriptionStatus: billing.subscriptionStatus,
			currentPeriodEnd: billing.currentPeriodEnd,
			cancelAtPeriodEnd: billing.cancelAtPeriodEnd,
			checkoutAvailable: billing.checkoutAvailable,
			checkoutIntervals: [...billing.checkoutIntervals],
			portalAvailable: billing.portalAvailable,
			prices: parsePrices(billing.prices),
		},
		usage: {
			recordings: usage.recordings,
			recordingLimit: usage.recordingLimit,
			maxRecordingBytes: usage.maxRecordingBytes,
			storageBytes: usage.storageBytes,
			storageLimitBytes: usage.storageLimitBytes,
		},
	};
}
