import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ handle: vi.fn(), openExternal: vi.fn() }));
vi.mock("electron", () => ({
	app: { getAppPath: () => "/recordly" },
	ipcMain: { handle: mocks.handle },
	shell: { openExternal: mocks.openExternal },
}));

import { parseStripeBillingUrl, registerCloudBillingHandlers } from "./cloudBilling";

const endpoint = "https://videos.recordly.dev/api/upload";
const input = { endpoint, token: "signed-access-token", action: "status" };
const free = {
	billing: {
		plan: "free",
		subscriptionStatus: null,
		currentPeriodEnd: null,
		cancelAtPeriodEnd: false,
		checkoutAvailable: false,
		portalAvailable: false,
		checkoutIntervals: [],
		prices: [],
	},
	usage: {
		recordings: 5,
		recordingLimit: 5,
		maxRecordingBytes: 1_000_000_000,
		storageBytes: 40,
		storageLimitBytes: 100_000_000_000,
	},
};
type Frame = { url: string };
let sender: EventEmitter & { id: number; isDestroyed: () => boolean; mainFrame: Frame };
let handler: (
	event: { sender: typeof sender; senderFrame?: Frame },
	input: unknown,
) => Promise<unknown>;
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
	mocks.handle.mockReset();
	mocks.openExternal.mockReset().mockResolvedValue(undefined);
	sender = Object.assign(new EventEmitter(), {
		id: 42,
		isDestroyed: () => false,
		mainFrame: { url: "file:///recordly/dist/index.html?windowType=editor" },
	});
	fetchMock = vi.fn().mockResolvedValue(Response.json(free));
	vi.stubGlobal("fetch", fetchMock);
	registerCloudBillingHandlers();
	handler = mocks.handle.mock.calls.find(([channel]) => channel === "cloud-billing")![1];
});
afterEach(() => vi.unstubAllGlobals());
const call = (request: unknown = input) =>
	handler({ sender, senderFrame: sender.mainFrame }, request);

it("loads public verified pricing without sending an account token or opening a browser", async () => {
	const catalog = {
		prices: [{ interval: "monthly", unitAmount: 1500, currency: "usd" }],
		limits: {
			freeRecordingLimit: 5,
			freeMaxRecordingBytes: 1_000_000_000,
			plusMaxRecordingBytes: 10_000_000_000,
			storageLimitBytes: 100_000_000_000,
		},
	};
	fetchMock.mockResolvedValue(Response.json(catalog));
	expect(await call({ endpoint, action: "catalog" })).toEqual({ success: true, ...catalog });
	expect(String(fetchMock.mock.calls[0][0])).toBe(
		"https://videos.recordly.dev/api/billing/catalog",
	);
	expect(fetchMock.mock.calls[0][1].headers).not.toHaveProperty("authorization");
	expect(mocks.openExternal).not.toHaveBeenCalled();
});

describe("trusted Stripe links", () => {
	it("accepts Stripe checkout and portal sessions", () => {
		expect(
			parseStripeBillingUrl(
				"https://checkout.stripe.com/c/pay/cs_test_example#token",
				"checkout",
			),
		).toContain("checkout.stripe.com/c/pay/");
		expect(
			parseStripeBillingUrl("https://billing.stripe.com/p/session/example", "portal"),
		).toContain("billing.stripe.com/p/session/");
		expect(
			parseStripeBillingUrl(
				"https://billing.stripe.com/p/session?secret=test_session",
				"portal",
			),
		).toBe("https://billing.stripe.com/p/session?secret=test_session");
	});
	it.each([
		"https://billing.stripe.com/p/session",
		"https://billing.stripe.com/p/session?secret=",
		"https://billing.stripe.com/p/session-other?secret=test_session",
		"https://billing.stripe.com.evil.test/p/session?secret=test_session",
		"https://user@billing.stripe.com/p/session?secret=test_session",
	])("rejects invalid query-style portal sessions %s", (url) => {
		expect(() => parseStripeBillingUrl(url, "portal")).toThrow();
	});
	it.each([
		"http://checkout.stripe.com/c/pay/session",
		"https://checkout.stripe.com.evil.test/c/pay/session",
		"https://checkout.stripe.com@evil.test/c/pay/session",
		"https://evil:pass@checkout.stripe.com/c/pay/session",
		"https://checkout.stripe.com:444/c/pay/session",
		"https://checkout.stripe.com/redirect?url=https://evil.test",
		"https://billing.stripe.com/p/session/example",
		"javascript:alert(1)",
		"https://checkout.stripe.com/c/pay/session\n",
	])("rejects untrusted or wrong-action links %s", (url) => {
		expect(() => parseStripeBillingUrl(url, "checkout")).toThrow();
	});
});

it("fetches verified status without opening a browser or forwarding client plan claims", async () => {
	expect(await call({ ...input, plan: "pro", customer: "victim" })).toEqual({
		success: true,
		...free,
	});
	const [url, options] = fetchMock.mock.calls[0];
	expect(String(url)).toBe("https://videos.recordly.dev/api/billing");
	expect(options).toMatchObject({
		method: "GET",
		redirect: "error",
		headers: { authorization: "Bearer signed-access-token" },
	});
	expect(options.body).toBeUndefined();
	expect(mocks.openExternal).not.toHaveBeenCalled();
});

it.each([
	null,
	[],
	{ ...input, endpoint: "https://evil.test/api/upload" },
	{ ...input, token: "" },
	{ ...input, token: "token\r\nX: value" },
	{ ...input, token: "a".repeat(8193) },
	{ ...input, action: "grant-pro" },
	{ ...input, action: "checkout", interval: "price_fake" },
])("rejects invalid request before networking %j", async (request) => {
	expect(await call(request)).toMatchObject({ success: false });
	expect(fetchMock).not.toHaveBeenCalled();
});

it("opens only a validated checkout session and sends server-selected plan interval", async () => {
	fetchMock.mockResolvedValue(
		Response.json({ url: "https://checkout.stripe.com/c/pay/cs_test_example" }),
	);
	expect(
		await call({
			...input,
			action: "checkout",
			interval: "monthly",
			price: "price_client",
			return_url: "https://evil.test",
		}),
	).toEqual({ success: true });
	expect(fetchMock.mock.calls[0][1].body).toBe('{"interval":"monthly"}');
	expect(mocks.openExternal).toHaveBeenCalledWith(
		"https://checkout.stripe.com/c/pay/cs_test_example",
	);
});

it("portal requests cannot choose another customer's ID", async () => {
	fetchMock.mockResolvedValue(
		Response.json({ url: "https://billing.stripe.com/p/session/example" }),
	);
	expect(await call({ ...input, action: "portal", customer: "victim" })).toEqual({
		success: true,
	});
	expect(fetchMock.mock.calls[0][1].body).toBe("{}");
});

it("rejects a forged unlimited free plan, malformed response or unsafe payment link", async () => {
	for (const data of [
		{ ...free, usage: { ...free.usage, recordingLimit: null } },
		{ url: "https://evil.test" },
		null,
	]) {
		fetchMock.mockResolvedValueOnce(Response.json(data));
		expect(
			await call({ ...input, action: data && "url" in data ? "portal" : "status" }),
		).toMatchObject({ success: false });
	}
	expect(mocks.openExternal).not.toHaveBeenCalled();
});

it("bounds streaming responses before opening any payment page", async () => {
	let canceled = false;
	fetchMock.mockResolvedValue(
		new Response(
			new ReadableStream({
				pull(controller) {
					controller.enqueue(new Uint8Array(33000));
				},
				cancel() {
					canceled = true;
				},
			}),
		),
	);
	expect(await call()).toMatchObject({ success: false });
	expect(canceled).toBe(true);
});

it("prevents concurrent mutation clicks while allowing status refresh and subsequent retry", async () => {
	let release!: (response: Response) => void;
	fetchMock.mockImplementationOnce(
		() =>
			new Promise<Response>((resolve) => {
				release = resolve;
			}),
	);
	const mutation = { ...input, action: "checkout", interval: "monthly" };
	const pending = call(mutation);
	expect(await call(mutation)).toMatchObject({
		success: false,
		error: expect.stringContaining("in progress"),
	});
	expect(await call()).toMatchObject({ success: true });
	release(Response.json({ url: "https://checkout.stripe.com/c/pay/cs_test_example" }));
	expect(await pending).toEqual({ success: true });
	fetchMock.mockResolvedValue(
		Response.json({ url: "https://checkout.stripe.com/c/pay/cs_test_example" }),
	);
	expect(await call(mutation)).toEqual({ success: true });
	expect(sender.listenerCount("destroyed")).toBe(0);
});

it("does not open checkout after the requesting window is destroyed", async () => {
	let release!: (response: Response) => void;
	fetchMock.mockImplementationOnce(
		() =>
			new Promise<Response>((resolve) => {
				release = resolve;
			}),
	);
	const pending = call({ ...input, action: "checkout", interval: "monthly" });
	sender.emit("destroyed");
	release(Response.json({ url: "https://checkout.stripe.com/c/pay/cs_test_example" }));
	expect(await pending).toMatchObject({ success: false });
	expect(mocks.openExternal).not.toHaveBeenCalled();
});

it("does not expose upstream secrets or raw network errors", async () => {
	fetchMock.mockResolvedValueOnce(
		Response.json({ error: "secret-key-diagnostic" }, { status: 503 }),
	);
	expect(JSON.stringify(await call())).not.toContain("secret-key");
	fetchMock.mockRejectedValueOnce(new Error("signed-access-token internal details"));
	expect(JSON.stringify(await call())).not.toContain("signed-access-token");
});

it("cancels only the requesting window and never opens its pending checkout", async () => {
	let release!: (response: Response) => void;
	fetchMock.mockImplementationOnce(
		() =>
			new Promise<Response>((resolve) => {
				release = resolve;
			}),
	);
	const pending = call({ ...input, action: "checkout", interval: "monthly" });
	const cancel = mocks.handle.mock.calls.find(
		([channel]) => channel === "cloud-billing-cancel",
	)![1];
	expect(
		cancel({ sender: { id: 999, mainFrame: sender.mainFrame }, senderFrame: sender.mainFrame }),
	).toEqual({ success: true });
	expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(false);
	expect(cancel({ sender, senderFrame: sender.mainFrame })).toEqual({ success: true });
	expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
	release(Response.json({ url: "https://checkout.stripe.com/c/pay/cs_test_example" }));
	expect(await pending).toMatchObject({ success: false });
	expect(mocks.openExternal).not.toHaveBeenCalled();
});

it("does not open a previous account's checkout after a new token checks its plan", async () => {
	let release!: (response: Response) => void;
	fetchMock.mockImplementationOnce(
		() =>
			new Promise<Response>((resolve) => {
				release = resolve;
			}),
	);
	const pending = call({ ...input, action: "checkout", interval: "monthly" });
	expect(await call({ ...input, token: "new-account-token" })).toMatchObject({ success: true });
	release(Response.json({ url: "https://checkout.stripe.com/c/pay/cs_test_example" }));
	expect(await pending).toMatchObject({ success: false });
	expect(mocks.openExternal).not.toHaveBeenCalled();
});

it("rejects foreign main frames and embedded frames before billing networking", async () => {
	const valid = sender.mainFrame;
	for (const frame of [undefined, { ...valid }, { url: "https://foreign.test/" }]) {
		if (frame?.url === "https://foreign.test/") sender.mainFrame = frame;
		expect(await handler({ sender, senderFrame: frame }, input)).toMatchObject({
			success: false,
		});
	}
	expect(fetchMock).not.toHaveBeenCalled();
	expect(mocks.openExternal).not.toHaveBeenCalled();
});
