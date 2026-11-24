import { describe, expect, it } from "vitest";
import { getFreeShareUsage, isKnownFreePlan } from "./upgradePrompts";

describe("isKnownFreePlan", () => {
	it("treats signed-out users as free once billing has settled", () => {
		expect(isKnownFreePlan({ loading: false, signedIn: false, plan: undefined })).toBe(true);
	});

	it("waits while billing is still loading", () => {
		expect(isKnownFreePlan({ loading: true, signedIn: false, plan: undefined })).toBe(false);
		expect(isKnownFreePlan({ loading: true, signedIn: true, plan: "free" })).toBe(false);
	});

	it("prompts signed-in users only when their plan is known and not Pro", () => {
		expect(isKnownFreePlan({ loading: false, signedIn: true, plan: "free" })).toBe(true);
		expect(isKnownFreePlan({ loading: false, signedIn: true, plan: "pro" })).toBe(false);
	});

	it("never prompts a signed-in user whose plan could not be loaded", () => {
		expect(isKnownFreePlan({ loading: false, signedIn: true, plan: undefined })).toBe(false);
		expect(isKnownFreePlan({ loading: false, signedIn: true, plan: null })).toBe(false);
	});
});

describe("getFreeShareUsage", () => {
	const free = (recordings: number) => ({
		billing: { plan: "free" },
		usage: { recordings, recordingLimit: 5 },
	});

	it("reports shares used out of the free allowance", () => {
		expect(
			getFreeShareUsage({ status: free(0), fallbackUsage: null, usagePreview: null }),
		).toEqual({ used: 0, limit: 5 });
		expect(
			getFreeShareUsage({ status: free(5), fallbackUsage: null, usagePreview: null }),
		).toEqual({ used: 5, limit: 5 });
	});

	it("hides the count for Pro and unlimited plans", () => {
		expect(
			getFreeShareUsage({
				status: {
					billing: { plan: "pro" },
					usage: { recordings: 40, recordingLimit: null },
				},
				fallbackUsage: null,
				usagePreview: null,
			}),
		).toBeNull();
		expect(
			getFreeShareUsage({
				status: null,
				fallbackUsage: null,
				usagePreview: { plan: "pro", usage: { recordings: 3, recordingLimit: null } },
			}),
		).toBeNull();
	});

	it("uses the cached preview until the plan loads, and the legacy count as a fallback", () => {
		expect(
			getFreeShareUsage({
				status: null,
				fallbackUsage: null,
				usagePreview: { plan: "free", usage: { recordings: 2, recordingLimit: 5 } },
			}),
		).toEqual({ used: 2, limit: 5 });
		expect(
			getFreeShareUsage({
				status: null,
				fallbackUsage: { recordings: 4 },
				usagePreview: null,
			}),
		).toEqual({ used: 4, limit: 5 });
	});

	it("shows nothing while usage is unknown", () => {
		expect(
			getFreeShareUsage({ status: null, fallbackUsage: null, usagePreview: null }),
		).toBeNull();
	});
});
