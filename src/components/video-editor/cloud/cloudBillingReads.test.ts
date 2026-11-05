import { afterEach, expect, it, vi } from "vitest";
import { invalidateCloudBillingReads, readCloudBilling } from "./cloudBillingReads";

const endpoint = "https://example.test/api/upload";
const status = (recordings = 1) => ({
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
	},
	usage: {
		recordings,
		recordingLimit: 5,
		maxRecordingBytes: 1e9,
		storageBytes: 100,
		storageLimitBytes: 1e11,
	},
});
function bridge() {
	const billing = vi.fn().mockResolvedValue(status());
	vi.stubGlobal("window", { electronAPI: { cloudBilling: billing } });
	return billing;
}
afterEach(() => {
	invalidateCloudBillingReads();
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

it("shares pending reads and fresh status between billing and Share, expiring after one minute", async () => {
	vi.useFakeTimers();
	const billing = bridge();
	const first = readCloudBilling(endpoint, "status", "token");
	expect(readCloudBilling(endpoint, "status", "token")).toBe(first);
	await first;
	await readCloudBilling(endpoint, "status", "token");
	expect(billing).toHaveBeenCalledTimes(1);
	vi.advanceTimersByTime(60_001);
	await readCloudBilling(endpoint, "status", "token");
	expect(billing).toHaveBeenCalledTimes(2);
});

it("isolates tokens and endpoints and lets explicit refresh bypass a completed snapshot", async () => {
	const billing = bridge();
	await readCloudBilling(endpoint, "status", "alice");
	await readCloudBilling(endpoint, "status", "bob");
	await readCloudBilling("https://other.test/api/upload", "status", "alice");
	await readCloudBilling(endpoint, "status", "alice", true);
	expect(billing).toHaveBeenCalledTimes(4);
});

it("does not let an old pending snapshot overwrite a post-mutation read", async () => {
	const billing = bridge();
	let resolveOld!: (value: unknown) => void;
	billing.mockImplementationOnce(
		() =>
			new Promise((resolve) => {
				resolveOld = resolve;
			}),
	);
	const old = readCloudBilling(endpoint, "status", "alice");
	await Promise.resolve();
	invalidateCloudBillingReads();
	billing.mockResolvedValue(status(2));
	await readCloudBilling(endpoint, "status", "alice");
	resolveOld(status(1));
	await old;
	expect((await readCloudBilling(endpoint, "status", "alice")).usage?.recordings).toBe(2);
	expect(billing).toHaveBeenCalledTimes(2);
});

it("does not cache rejected, failed, or malformed status responses", async () => {
	const billing = bridge();
	billing.mockResolvedValueOnce({ success: false, httpStatus: 401 });
	expect((await readCloudBilling(endpoint, "status", "token")).httpStatus).toBe(401);
	billing.mockRejectedValueOnce(new Error("Offline"));
	await expect(readCloudBilling(endpoint, "status", "token")).rejects.toThrow("Offline");
	billing.mockResolvedValueOnce({ success: true });
	await expect(readCloudBilling(endpoint, "status", "token")).rejects.toThrow();
	await readCloudBilling(endpoint, "status", "token");
	expect(billing).toHaveBeenCalledTimes(4);
});

it("shares public catalog across accounts and caches it for five minutes", async () => {
	vi.useFakeTimers();
	const billing = bridge().mockResolvedValue({
		success: true,
		prices: [{ interval: "monthly", unitAmount: 1500, currency: "usd" }],
		limits: {
			freeRecordingLimit: 5,
			freeMaxRecordingBytes: 1e9,
			plusMaxRecordingBytes: 1e10,
			storageLimitBytes: 1e11,
		},
	});
	await readCloudBilling(endpoint, "catalog", "alice");
	vi.advanceTimersByTime(60_001);
	await readCloudBilling(endpoint, "catalog", "bob");
	expect(billing).toHaveBeenCalledTimes(1);
	expect(billing).toHaveBeenCalledWith({ endpoint, action: "catalog" });
	vi.advanceTimersByTime(5 * 60_000);
	await readCloudBilling(endpoint, "catalog");
	expect(billing).toHaveBeenCalledTimes(2);
});
