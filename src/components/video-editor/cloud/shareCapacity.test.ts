import { afterEach, expect, it, vi } from "vitest";
import { checkShareCapacity } from "./shareCapacity";
import { invalidateCloudBillingReads } from "./cloudBillingReads";
afterEach(() => {
	invalidateCloudBillingReads();
	vi.unstubAllGlobals();
});
function mockList(result: unknown) {
	const manage = vi.fn().mockResolvedValue(result);
	vi.stubGlobal("window", { electronAPI: { cloudShareManage: manage } });
	return manage;
}
it("blocks five recordings, including incomplete uploads", async () => {
	mockList({ success: true, videos: Array.from({ length: 5 }, (_, i) => ({ ready: i < 4 })) });
	expect(await checkShareCapacity("https://example.test/api/upload", "token")).toBe(false);
});
it("allows another share after a slot is freed", async () => {
	const manage = mockList({ success: true, videos: Array(4).fill({ ready: true }) });
	expect(await checkShareCapacity("https://example.test/api/upload", "token")).toBe(true);
	expect(manage).toHaveBeenCalledWith({
		endpoint: "https://example.test/api/upload",
		token: "token",
		action: "list",
	});
});
it("fails closed when the server cannot verify capacity", async () => {
	mockList({ success: false, error: "Offline" });
	await expect(checkShareCapacity("https://example.test/api/upload", "token")).rejects.toThrow(
		"Offline",
	);
	mockList({ success: true });
	await expect(checkShareCapacity("https://example.test/api/upload", "token")).rejects.toThrow(
		"Could not check",
	);
});

it("recovers a rejected session once and checks free capacity with the refreshed token", async () => {
	const billing = vi
		.fn()
		.mockResolvedValueOnce({ success: false, httpStatus: 401 })
		.mockResolvedValue({ success: false, httpStatus: 404 });
	const manage = mockList({ success: true, videos: [] });
	window.electronAPI.cloudBilling = billing;
	const refresh = vi.fn().mockResolvedValue("refreshed");
	expect(await checkShareCapacity("https://example.test/api/upload", "expired", refresh)).toBe(
		true,
	);
	expect(refresh).toHaveBeenCalledTimes(1);
	expect(manage).toHaveBeenCalledWith({
		endpoint: "https://example.test/api/upload",
		token: "refreshed",
		action: "list",
	});
});

it("stops after one rejected recovery without falling back around authentication", async () => {
	const manage = mockList({ success: true, videos: [] });
	window.electronAPI.cloudBilling = vi
		.fn()
		.mockResolvedValue({ success: false, httpStatus: 401 });
	const refresh = vi.fn().mockResolvedValue("rejected");
	await expect(
		checkShareCapacity("https://example.test/api/upload", "expired", refresh),
	).rejects.toThrow("Sign in again to share");
	expect(refresh).toHaveBeenCalledTimes(1);
	expect(manage).not.toHaveBeenCalled();
});

it("recognizes legacy sign-in rejection and keeps network failures separate", async () => {
	const manage = mockList({ success: false, error: "Verified sign-in required" });
	const refresh = vi.fn().mockResolvedValue(undefined);
	await expect(
		checkShareCapacity("https://example.test/api/upload", "expired", refresh),
	).rejects.toThrow("Sign in again to share");
	expect(refresh).toHaveBeenCalledTimes(1);
	manage.mockResolvedValue({ success: false, error: "Offline" });
	refresh.mockClear();
	await expect(
		checkShareCapacity("https://example.test/api/upload", "expired", refresh),
	).rejects.toThrow("Offline");
	expect(refresh).not.toHaveBeenCalled();
});

it("does not turn an offline refresh into a sign-in rejection", async () => {
	mockList({ success: true, videos: [] });
	window.electronAPI.cloudBilling = vi
		.fn()
		.mockResolvedValue({ success: false, httpStatus: 401 });
	await expect(
		checkShareCapacity("https://example.test/api/upload", "expired", async () => {
			throw new Error("Check your connection and try again.");
		}),
	).rejects.toThrow("Check your connection");
});

it("asks for email confirmation without trying to refresh a valid session", async () => {
	mockList({
		success: false,
		error: "Confirm your email using a new Recordly sign-in link, then try sharing again.",
	});
	window.electronAPI.cloudBilling = vi.fn().mockResolvedValue({
		success: false,
		httpStatus: 403,
		error: "Confirm your email before sharing.",
	});
	const refresh = vi.fn();
	await expect(
		checkShareCapacity("https://example.test/api/upload", "valid", refresh),
	).rejects.toThrow("Confirm your email");
	expect(refresh).not.toHaveBeenCalled();
});

it.each([
	404, 405, 501,
])("uses legacy quota only when billing route is unsupported (%s)", async (httpStatus) => {
	const manage = mockList({ success: true, videos: Array(5).fill({ ready: true }) });
	window.electronAPI.cloudBilling = vi.fn().mockResolvedValue({ success: false, httpStatus });
	expect(await checkShareCapacity("https://example.test/api/upload", "token")).toBe(false);
	expect(manage).toHaveBeenCalledTimes(1);
});

it("supports an old bridge with an explicitly missing billing IPC handler", async () => {
	const manage = mockList({ success: true, videos: [] });
	window.electronAPI.cloudBilling = vi
		.fn()
		.mockRejectedValue(
			new Error(
				"Error invoking remote method 'cloud-billing': Error: No handler registered for 'cloud-billing'",
			),
		);
	expect(await checkShareCapacity("https://example.test/api/upload", "token")).toBe(true);
	expect(manage).toHaveBeenCalledTimes(1);
});

it.each([
	403,
	429,
	500,
	503,
	undefined,
])("keeps billing failures separate from a free recording limit (%s)", async (httpStatus) => {
	const manage = mockList({ success: true, videos: Array(6).fill({ ready: true }) });
	window.electronAPI.cloudBilling = vi.fn().mockResolvedValue({
		success: false,
		httpStatus,
		error: "Billing temporarily unavailable",
	});
	const refresh = vi.fn();
	await expect(
		checkShareCapacity("https://example.test/api/upload", "paid-token", refresh),
	).rejects.toThrow("Billing temporarily unavailable");
	expect(manage).not.toHaveBeenCalled();
	expect(refresh).not.toHaveBeenCalled();
});

it.each([
	"transport",
	"malformed",
])("does not substitute legacy Free capacity for %s billing failures", async (kind) => {
	const manage = mockList({ success: true, videos: Array(6).fill({ ready: true }) });
	window.electronAPI.cloudBilling =
		kind === "transport"
			? vi.fn().mockRejectedValue(new Error("Network unavailable"))
			: vi.fn().mockResolvedValue({ success: true });
	await expect(
		checkShareCapacity("https://example.test/api/upload", "paid-token"),
	).rejects.toThrow();
	expect(manage).not.toHaveBeenCalled();
});

it.each(["pro", "free"])("only verified Plus can have unlimited storage (%s)", async (plan) => {
	mockList({ success: true, videos: Array(5).fill({ ready: true }) });
	window.electronAPI.cloudBilling = vi.fn().mockResolvedValue({
		success: true,
		billing: {
			plan,
			subscriptionStatus: plan === "pro" ? "active" : null,
			currentPeriodEnd: null,
			cancelAtPeriodEnd: false,
			checkoutAvailable: false,
			checkoutIntervals: [],
			portalAvailable: false,
			prices: [],
		},
		usage: {
			recordings: 200,
			recordingLimit: plan === "pro" ? null : 5,
			maxRecordingBytes: 1e10,
			storageBytes: 500_000_000_000,
			storageLimitBytes: null,
		},
	});
	if (plan === "pro")
		expect(await checkShareCapacity("https://example.test/api/upload", "token")).toBe(true);
	else
		await expect(
			checkShareCapacity("https://example.test/api/upload", "token"),
		).rejects.toThrow("Could not verify your cloud plan");
});
