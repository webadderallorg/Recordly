import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BillingProvider } from "./BillingProvider";

const state = vi.hoisted(() => ({
	slots: [] as { value?: unknown; deps?: readonly unknown[]; cleanup?: () => void }[],
	index: 0,
	effects: [] as (() => void)[],
	auth: { user: { id: "alice" }, accessToken: "token-1", loading: false } as {
		user: { id: string } | null;
		accessToken: string | null;
		loading: boolean;
	},
	read: vi.fn(),
}));
const same = (a?: readonly unknown[], b?: readonly unknown[]) =>
	a !== undefined &&
	b !== undefined &&
	a.length === b.length &&
	a.every((v, i) => Object.is(v, b[i]));
vi.mock("react", async (original) => ({
	...(await original<typeof import("react")>()),
	useState: (initial: unknown) => {
		const i = state.index++;
		state.slots[i] ??= { value: typeof initial === "function" ? initial() : initial };
		return [
			state.slots[i].value,
			(next: unknown) => {
				state.slots[i].value =
					typeof next === "function" ? next(state.slots[i].value) : next;
			},
		];
	},
	useRef: (initial: unknown) => {
		const i = state.index++;
		state.slots[i] ??= { value: { current: initial } };
		return state.slots[i].value;
	},
	useMemo: (factory: () => unknown, deps: readonly unknown[]) => {
		const i = state.index++;
		if (!same(state.slots[i]?.deps, deps)) state.slots[i] = { value: factory(), deps };
		return state.slots[i].value;
	},
	useCallback: (callback: unknown, deps: readonly unknown[]) => {
		const i = state.index++;
		if (!same(state.slots[i]?.deps, deps)) state.slots[i] = { value: callback, deps };
		return state.slots[i].value;
	},
	useLayoutEffect: (effect: () => void | (() => void), deps: readonly unknown[]) => {
		const i = state.index++;
		if (same(state.slots[i]?.deps, deps)) return;
		const cleanup = state.slots[i]?.cleanup;
		state.slots[i] = { deps };
		state.effects.push(() => {
			cleanup?.();
			const next = effect();
			if (typeof next === "function") state.slots[i].cleanup = next;
		});
	},
	useEffect: (effect: () => void | (() => void), deps: readonly unknown[]) => {
		const i = state.index++;
		if (same(state.slots[i]?.deps, deps)) return;
		const cleanup = state.slots[i]?.cleanup;
		state.slots[i] = { deps };
		state.effects.push(() => {
			cleanup?.();
			const next = effect();
			if (typeof next === "function") state.slots[i].cleanup = next;
		});
	},
}));
vi.mock("@/components/auth/useRecordlyAuth", () => ({ useRecordlyAuth: () => state.auth }));
vi.mock("@/contexts/I18nContext", () => ({
	translate: (_key: string, fallback: string) => fallback,
}));
vi.mock("@/components/video-editor/cloud/endpoint", () => ({
	CLOUD_SHARE_ENDPOINT: "https://cloud.test",
}));
vi.mock("@/components/video-editor/cloud/cloudBillingReads", () => ({
	readCloudBilling: (...args: unknown[]) => state.read(...args),
	invalidateCloudBillingReads: vi.fn(),
}));
vi.mock("@/components/video-editor/cloud/shareCapacity", () => ({
	subscribeShareCapacityChanges: () => () => undefined,
}));
vi.mock("./usageCache", () => ({ readUsageCache: () => null, writeUsageCache: vi.fn() }));
vi.mock("@/lib/auth/recoverBillingSession", () => ({ recoverBillingSession: vi.fn() }));

const price = { interval: "monthly", currency: "usd", unitAmount: 900 };
const catalog = {
	success: true,
	prices: [price],
	limits: {
		freeRecordingLimit: 5,
		freeMaxRecordingBytes: 1e9,
		plusMaxRecordingBytes: 1e10,
		storageLimitBytes: null,
	},
};
const status = (plan = "pro") => ({
	success: true,
	billing: {
		plan,
		subscriptionStatus: plan === "pro" ? "active" : null,
		currentPeriodEnd: null,
		cancelAtPeriodEnd: false,
		checkoutAvailable: true,
		checkoutIntervals: ["monthly"],
		portalAvailable: false,
		prices: [price],
	},
	usage: {
		recordings: 1,
		recordingLimit: plan === "pro" ? null : 5,
		maxRecordingBytes: 1e9,
		storageBytes: 100,
		storageLimitBytes: plan === "pro" ? null : 1e11,
	},
});
function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}
const flush = async () => {
	for (let i = 0; i < 12; i++) await Promise.resolve();
};
function render() {
	state.index = 0;
	const result = BillingProvider({ children: null });
	for (const effect of state.effects.splice(0)) effect();
	return result.props.value;
}

beforeEach(() => {
	state.slots = [];
	state.index = 0;
	state.effects = [];
	state.auth = { user: { id: "alice" }, accessToken: "token-1", loading: false };
	state.read
		.mockReset()
		.mockImplementation(async (_endpoint, action) =>
			action === "catalog" ? catalog : status(),
		);
	vi.useFakeTimers();
	vi.stubGlobal("window", {
		addEventListener: vi.fn(),
		removeEventListener: vi.fn(),
		electronAPI: { cloudBilling: vi.fn(), cloudBillingCancel: vi.fn(async () => undefined) },
	});
	vi.stubGlobal("document", {
		visibilityState: "visible",
		addEventListener: vi.fn(),
		removeEventListener: vi.fn(),
	});
});
afterEach(() => {
	for (const slot of state.slots) slot.cleanup?.();
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

it("retains a verified plan immediately and during a same-account token refresh", async () => {
	render();
	await flush();
	expect(render().status.billing.plan).toBe("pro");
	const newer = deferred<ReturnType<typeof status>>();
	state.read.mockImplementation((_endpoint, action) =>
		action === "catalog" ? Promise.resolve(catalog) : newer.promise,
	);
	state.auth = { ...state.auth, accessToken: "token-2" };
	expect(render().status.billing.plan).toBe("pro");
	expect(render().status.billing.plan).toBe("pro");
	newer.resolve(status());
	await flush();
	expect(render().status.billing.plan).toBe("pro");
});

it("tracks an opened checkout after token rotation without reusing the expired token", async () => {
	state.read.mockImplementation(async (_endpoint, action) =>
		action === "catalog" ? catalog : status("free"),
	);
	render();
	await flush();
	const billing = render();
	const checkout = deferred<{ success: boolean }>();
	vi.mocked(window.electronAPI.cloudBilling).mockReturnValue(checkout.promise);
	const pending = billing.startBilling("checkout");
	state.auth = { ...state.auth, accessToken: "token-2" };
	render();
	await flush();
	render();
	const oldReads = state.read.mock.calls.filter(
		(args) => args[1] === "status" && args[2] === "token-1",
	).length;
	checkout.resolve({ success: true });
	await pending;
	expect(render().awaitingCheckout).toBe(true);
	await vi.advanceTimersByTimeAsync(2000);
	await flush();
	expect(
		state.read.mock.calls.filter((args) => args[1] === "status" && args[2] === "token-1"),
	).toHaveLength(oldReads);
	expect(
		state.read.mock.calls.some(
			(args) => args[1] === "status" && args[2] === "token-2" && args[3] === true,
		),
	).toBe(true);
});

it("hides the prior account immediately and rejects a stale status response", async () => {
	const old = deferred<ReturnType<typeof status>>();
	state.read.mockImplementation((_endpoint, action, token) =>
		action === "catalog"
			? Promise.resolve(catalog)
			: token === "token-1"
				? old.promise
				: Promise.resolve(status("free")),
	);
	render();
	state.auth = { user: { id: "bob" }, accessToken: "bob-token", loading: false };
	expect(render().status).toBeNull();
	await flush();
	expect(render().status.billing.plan).toBe("free");
	old.resolve(status());
	await flush();
	expect(render().status.billing.plan).toBe("free");
});

it("does not apply checkout completion after leaving and returning to the same account", async () => {
	state.read.mockImplementation(async (_endpoint, action) =>
		action === "catalog" ? catalog : status("free"),
	);
	render();
	await flush();
	const checkout = deferred<{ success: boolean }>();
	vi.mocked(window.electronAPI.cloudBilling).mockReturnValue(checkout.promise);
	const pending = render().startBilling("checkout");
	state.auth = { user: { id: "bob" }, accessToken: "bob-token", loading: false };
	render();
	await flush();
	render();
	state.auth = { user: { id: "alice" }, accessToken: "token-1", loading: false };
	render();
	await flush();
	render();
	checkout.resolve({ success: true });
	await pending;
	expect(render().awaitingCheckout).toBe(false);
});

it("isolates busy checkout operations and does not let an old account clear the new account's operation", async () => {
	state.read.mockImplementation(async (_endpoint, action) =>
		action === "catalog" ? catalog : status("free"),
	);
	render();
	await flush();
	const first = deferred<{ success: boolean }>();
	const second = deferred<{ success: boolean }>();
	vi.mocked(window.electronAPI.cloudBilling)
		.mockReturnValueOnce(first.promise)
		.mockReturnValueOnce(second.promise);
	const old = render().startBilling("checkout");
	state.auth = { user: { id: "bob" }, accessToken: "bob-token", loading: false };
	expect(render().busy).toBeNull();
	await flush();
	const current = render().startBilling("checkout");
	expect(render().busy).toBe("checkout");
	first.resolve({ success: true });
	await old;
	expect(render().busy).toBe("checkout");
	second.resolve({ success: true });
	await current;
	expect(render().busy).toBeNull();
	expect(render().awaitingCheckout).toBe(true);
});
