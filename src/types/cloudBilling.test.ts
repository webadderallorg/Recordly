import { describe, expect, it } from "vitest";
import { parseCloudBillingStatus } from "./cloudBilling";

const status = (billing: object, usage: object) => ({
	success: true,
	billing: {
		plan: "free",
		subscriptionStatus: null,
		currentPeriodEnd: null,
		cancelAtPeriodEnd: false,
		checkoutAvailable: false,
		checkoutIntervals: [],
		portalAvailable: false,
		prices: [],
		...billing,
	},
	usage: {
		recordings: 2,
		recordingLimit: 5,
		maxRecordingBytes: 1_000_000_000,
		storageBytes: 10,
		storageLimitBytes: 100,
		...usage,
	},
});

describe("parseCloudBillingStatus", () => {
	it.each([
		"incomplete",
		"past_due",
		"unpaid",
	])("treats a %s Plus subscription as not entitled instead of failing", (subscriptionStatus) => {
		const parsed = parseCloudBillingStatus(
			status(
				{ plan: "pro", subscriptionStatus, portalAvailable: true },
				{ recordingLimit: null, storageLimitBytes: null },
			),
		);
		expect(parsed.billing).toMatchObject({ plan: "free", subscriptionStatus });
		expect(parsed.usage.recordingLimit).toBe(0);
		expect(parseCloudBillingStatus({ success: true, ...parsed })).toEqual(parsed);
	});

	it("keeps a server-reported limit for a non-active Plus subscription", () => {
		const parsed = parseCloudBillingStatus(
			status({ plan: "pro", subscriptionStatus: "incomplete" }, { recordingLimit: 5 }),
		);
		expect(parsed.usage.recordingLimit).toBe(5);
	});

	it("keeps active Plus entitled", () => {
		const parsed = parseCloudBillingStatus(
			status(
				{ plan: "pro", subscriptionStatus: "active" },
				{ recordingLimit: null, storageLimitBytes: null },
			),
		);
		expect(parsed.billing.plan).toBe("pro");
		expect(parsed.usage.recordingLimit).toBeNull();
	});

	it.each([
		["unlimited recordings", { recordingLimit: null }],
		["unlimited storage", { storageLimitBytes: null }],
	])("rejects a plain free account claiming %s", (_label, usage) => {
		expect(() => parseCloudBillingStatus(status({}, usage))).toThrow();
	});

	it("rejects an active Plus plan with a recording limit", () => {
		expect(() =>
			parseCloudBillingStatus(
				status({ plan: "pro", subscriptionStatus: "active" }, { recordingLimit: 5 }),
			),
		).toThrow();
	});

	it("rejects unlimited storage for a Plus plan without a subscription status", () => {
		expect(() =>
			parseCloudBillingStatus(
				status({ plan: "pro" }, { recordingLimit: null, storageLimitBytes: null }),
			),
		).toThrow();
	});
});
