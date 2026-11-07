import { app, ipcMain } from "electron";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

type Owner = {
	id: number;
	url: string;
	destroyed: boolean;
	send: ReturnType<typeof vi.fn>;
	mainFrame: { url: string };
	getURL: () => string;
	isDestroyed: () => boolean;
	once: ReturnType<typeof vi.fn>;
};
type RelayOptions = {
	ownerAvailable: (owner: Owner) => boolean;
	hasVerifier: (key: string) => Promise<boolean>;
	deliver: (owner: Owner, url: string) => boolean;
};
const state = vi.hoisted(() => ({
	options: undefined as RelayOptions | undefined,
	flows: new Map<string, { owner: Owner; key: string }>(),
	remote: new Map<string, Promise<"forwarded" | "unavailable"> | "forwarded" | "unavailable">(),
	routed: vi.fn(),
	releaseError: undefined as Error | undefined,
	registerError: undefined as Error | undefined,
	releaseAttempts: [] as string[],
	getVerifier: vi.fn(async (_key: string): Promise<string | null> => '"verifier"'),
	windows: [] as Owner[],
}));
vi.mock("electron", () => ({
	app: {
		on: vi.fn(),
		isReady: () => false,
		whenReady: async () => undefined,
		quit: vi.fn(),
		getPath: () => "/recordly/user",
		getAppPath: () => "/recordly",
	},
	ipcMain: { handle: vi.fn() },
	safeStorage: { encryptString: vi.fn(), decryptString: vi.fn() },
	BrowserWindow: {
		getAllWindows: () =>
			state.windows.map((webContents) => ({
				webContents,
				isDestroyed: () => webContents.destroyed,
			})),
	},
}));
vi.mock("./rendererServer", () => ({
	getPackagedRendererBaseUrl: () => "http://127.0.0.1:49152/",
}));
vi.mock("./authStorage", () => ({
	encryptionAvailable: () => true,
	readNativeAuthStorageValue: state.getVerifier,
}));
vi.mock("./authFlowRelay", () => ({
	createAuthFlowRelay: (options: RelayOptions) => {
		state.options = options;
		return {
			register: vi.fn(async (flowId: string, key: string, owner: Owner) => {
				if (state.registerError) throw state.registerError;
				state.flows.set(flowId, { owner, key });
				return async () => {
					state.flows.delete(flowId);
				};
			}),
			release: vi.fn(async (flowId: string) => {
				state.releaseAttempts.push(flowId);
				if (state.releaseError) throw state.releaseError;
				state.flows.delete(flowId);
			}),
			close: vi.fn(async () => undefined),
			route: vi.fn(async (url: string) => {
				state.routed(url);
				const id = new URL(url).searchParams.get("sb_flow_id") ?? "";
				if (state.remote.has(id)) return await state.remote.get(id);
				const flow = state.flows.get(id);
				if (
					!flow ||
					!options.ownerAvailable(flow.owner) ||
					!(await options.hasVerifier(flow.key))
				)
					return "unavailable";
				return options.deliver(flow.owner, url) ? "local" : "unavailable";
			}),
		};
	},
}));

function owner(id: number): Owner {
	const result: Owner = {
		id,
		url: "file:///recordly/dist/index.html",
		destroyed: false,
		send: vi.fn(),
		mainFrame: { url: "file:///recordly/dist/index.html" },
		getURL: () => result.url,
		isDestroyed: () => result.destroyed,
		once: vi.fn(),
	};
	return result;
}
const event = (sender: Owner) =>
	({ sender, senderFrame: sender.mainFrame }) as unknown as Electron.IpcMainInvokeEvent;
function handlers() {
	return new Map(vi.mocked(ipcMain.handle).mock.calls);
}
const url = "recordly://auth/callback?code=private-owner-code&sb_flow_id=flow_alice";
const key = "sb-recordlytest-auth-token-flow-flow_alice-code-verifier";

beforeEach(() => {
	vi.mocked(ipcMain.handle).mockClear();
	vi.mocked(app.on).mockClear();
	vi.mocked(app.quit).mockClear();
	state.remote.clear();
	state.routed.mockClear();
	state.flows.clear();
	state.releaseError = undefined;
	state.registerError = undefined;
	state.releaseAttempts = [];
	state.windows = [];
	state.getVerifier.mockReset().mockResolvedValue('"verifier"');
});
afterEach(() => {
	vi.restoreAllMocks();
});

function openUrl(url: string) {
	const open = vi
		.mocked(app.on)
		.mock.calls.filter(([name]) => name === "open-url")
		.at(-1)![1] as (event: { preventDefault: () => void }, url: string) => void;
	open({ preventDefault: vi.fn() }, url);
}

it("awaits an early Mac callback's authenticated ACK and deduplicates its argv copy before startup completes", async () => {
	const { createAuthCallbackController } = await import("./authCallback");
	const controller = createAuthCallbackController({
		isDev: false,
		focusApp: vi.fn(),
		flowRoutingEnabled: true,
	});
	let acknowledge!: (result: "forwarded") => void;
	state.remote.set(
		"flow_alice",
		new Promise((resolve) => {
			acknowledge = resolve;
		}),
	);
	openUrl(` ${url} `);
	expect(state.routed).not.toHaveBeenCalled();
	const startup = controller.routeStartup(url);
	let settled = false;
	void startup.then(() => {
		settled = true;
	});
	await Promise.resolve();
	expect(settled).toBe(false);
	expect(state.routed).toHaveBeenCalledExactlyOnceWith(url);
	acknowledge("forwarded");
	expect(await startup).toBe("forwarded");
	expect(state.getVerifier).not.toHaveBeenCalled();
	controller.close();
});

it("drains events arriving during an ACK wait and does not quit on a partial successful batch", async () => {
	const { createAuthCallbackController } = await import("./authCallback");
	const controller = createAuthCallbackController({
		isDev: false,
		focusApp: vi.fn(),
		flowRoutingEnabled: true,
	});
	let acknowledge!: (result: "forwarded") => void;
	state.remote.set(
		"flow_alice",
		new Promise((resolve) => {
			acknowledge = resolve;
		}),
	);
	state.remote.set("flow_bob00", "unavailable");
	openUrl(url);
	const startup = controller.routeStartup(null);
	const second = "recordly://auth/callback?code=bob-private&sb_flow_id=flow_bob00";
	openUrl(second);
	acknowledge("forwarded");
	expect(await startup).toBe("unavailable");
	expect(state.routed.mock.calls.map(([candidate]) => candidate)).toEqual([url, second]);
	expect(state.getVerifier).not.toHaveBeenCalled();
	controller.close();
});

it("does not authorize startup quit after closing during a pending handoff", async () => {
	const { createAuthCallbackController } = await import("./authCallback");
	const focusApp = vi.fn();
	const controller = createAuthCallbackController({
		isDev: false,
		focusApp,
		flowRoutingEnabled: true,
	});
	let acknowledge!: (result: "unavailable") => void;
	state.remote.set(
		"flow_alice",
		new Promise((resolve) => {
			acknowledge = resolve;
		}),
	);
	openUrl(url);
	const startup = controller.routeStartup(null);
	const existing = owner(1);
	state.windows = [existing];
	vi.spyOn(app, "isReady").mockReturnValue(true);
	controller.close();
	acknowledge("unavailable");
	expect(await startup).toBe("unavailable");
	expect(state.getVerifier).not.toHaveBeenCalled();
	expect(focusApp).not.toHaveBeenCalled();
	expect(existing.send).not.toHaveBeenCalled();
});

it("bounds startup callbacks and fails safely when an additional raw callback cannot be retained", async () => {
	const { createAuthCallbackController } = await import("./authCallback");
	const controller = createAuthCallbackController({
		isDev: false,
		focusApp: vi.fn(),
		flowRoutingEnabled: true,
	});
	for (let index = 0; index < 9; index++) {
		state.remote.set(`flow_num${index}`, "forwarded");
		openUrl(`recordly://auth/callback?code=private${index}&sb_flow_id=flow_num${index}`);
	}
	expect(await controller.routeStartup(null)).toBe("unavailable");
	expect(
		state.routed.mock.calls.filter(([candidate]) =>
			new URL(candidate).searchParams.has("code"),
		),
	).toHaveLength(8);
	expect(state.routed.mock.calls.some(([candidate]) => candidate.includes("private8"))).toBe(
		false,
	);
	expect(state.getVerifier).not.toHaveBeenCalled();
	controller.close();
});

it("routes subsequent running-instance callbacks directly without quitting the existing app", async () => {
	const { createAuthCallbackController } = await import("./authCallback");
	const controller = createAuthCallbackController({
		isDev: false,
		focusApp: vi.fn(),
		flowRoutingEnabled: true,
	});
	expect(await controller.routeStartup(null)).toBe("invalid");
	state.remote.set("flow_alice", "forwarded");
	vi.spyOn(app, "isReady").mockReturnValue(true);
	openUrl(url);
	await vi.waitFor(() => expect(state.routed).toHaveBeenCalledExactlyOnceWith(url));
	expect(app.quit).not.toHaveBeenCalled();
	controller.close();
});

it("switches to running callback handling even after an unexpected startup routing error", async () => {
	const { createAuthCallbackController } = await import("./authCallback");
	const controller = createAuthCallbackController({
		isDev: false,
		focusApp: vi.fn(),
		flowRoutingEnabled: true,
	});
	state.remote.set("flow_alice", Promise.reject(new Error("Relay failure")));
	openUrl(url);
	expect(await controller.routeStartup(null)).toBe("unavailable");
	state.remote.set("flow_bob00", "forwarded");
	const next = "recordly://auth/callback?code=new-code&sb_flow_id=flow_bob00";
	openUrl(next);
	await vi.waitFor(() => expect(state.routed).toHaveBeenCalledWith(next));
	expect(app.quit).not.toHaveBeenCalled();
	controller.close();
});

it("keeps callbacks private across owner reload until its trusted document is ready", async () => {
	const { createAuthCallbackController } = await import("./authCallback");
	const controller = createAuthCallbackController({
		isDev: false,
		focusApp: vi.fn(),
		flowRoutingEnabled: true,
	});
	const alice = owner(1);
	const bob = owner(2);
	state.windows = [alice, bob];
	await controller.flowStorageHooks!.prepareSet(event(alice), key);
	alice.url = "about:blank";
	alice.mainFrame = { url: "about:blank" };
	expect(await controller.route(url)).toBe("local");
	expect(alice.send).not.toHaveBeenCalled();
	expect(bob.send).not.toHaveBeenCalled();
	const read = handlers().get("auth:get-pending-callback")!;
	const ack = handlers().get("auth:ack-callback")!;
	expect(read(event(alice))).toBeNull();
	expect(read(event(bob))).toBeNull();
	ack(event(bob), url);
	alice.url = "file:///recordly/dist/index.html?windowType=onboarding";
	alice.mainFrame = { url: alice.url };
	expect(read(event(alice))).toBe(url);
	const childFrame = {
		sender: alice,
		senderFrame: { url: alice.url },
	} as unknown as Electron.IpcMainInvokeEvent;
	ack(childFrame, url);
	expect(read(event(alice))).toBe(url);
	ack(event(alice), url);
	expect(read(event(alice))).toBeNull();
	controller.close();
});

it("sends and acknowledges only the registered window's callback, including overlapping flows", async () => {
	const { createAuthCallbackController } = await import("./authCallback");
	const controller = createAuthCallbackController({
		isDev: false,
		focusApp: vi.fn(),
		flowRoutingEnabled: true,
	});
	const alice = owner(1);
	const bob = owner(2);
	state.windows = [alice, bob];
	await controller.flowStorageHooks!.prepareSet(event(alice), key);
	await controller.flowStorageHooks!.prepareSet(
		event(bob),
		"sb-recordlytest-auth-token-flow-flow_bob00-code-verifier",
	);
	await controller.route(url);
	expect(alice.send).toHaveBeenCalledExactlyOnceWith("auth:callback", url);
	expect(bob.send).not.toHaveBeenCalled();
	const read = handlers().get("auth:get-pending-callback")!;
	const ack = handlers().get("auth:ack-callback")!;
	ack(event(bob), url);
	expect(read(event(alice))).toBe(url);
	const bobUrl = "recordly://auth/callback?code=bob-code&sb_flow_id=flow_bob00";
	await controller.route(bobUrl);
	expect(read(event(bob))).toBe(bobUrl);
	ack(event(alice), bobUrl);
	expect(read(event(bob))).toBe(bobUrl);
	ack(event(alice), url);
	expect(read(event(alice))).toBeNull();
	controller.close();
});

it.each([
	"destroyed",
	"foreign",
	"missing verifier",
])("never falls through to another verifier when the owner is %s", async (reason) => {
	const { createAuthCallbackController } = await import("./authCallback");
	const controller = createAuthCallbackController({
		isDev: false,
		focusApp: vi.fn(),
		flowRoutingEnabled: true,
	});
	const alice = owner(1);
	const bob = owner(2);
	state.windows = [alice, bob];
	await controller.flowStorageHooks!.prepareSet(event(alice), key);
	if (reason === "destroyed") alice.destroyed = true;
	if (reason === "foreign") {
		alice.url = "https://foreign.test/";
		alice.mainFrame = { url: alice.url };
	}
	if (reason === "missing verifier") state.getVerifier.mockResolvedValue(null);
	expect(await controller.route(url)).toBe("unavailable");
	for (const candidate of [alice, bob])
		for (const args of candidate.send.mock.calls)
			expect(args[1]).not.toContain("private-owner-code");
	expect(handlers().get("auth:get-pending-callback")!(event(bob))).toBe(
		"recordly://auth/callback?error=flow_unavailable",
	);
	controller.close();
});

it("retains disabled broadcast compatibility and installs no flow hooks", async () => {
	const { createAuthCallbackController } = await import("./authCallback");
	const controller = createAuthCallbackController({
		isDev: false,
		focusApp: vi.fn(),
		flowRoutingEnabled: false,
	});
	const alice = owner(1);
	const bob = owner(2);
	state.windows = [alice, bob];
	expect(controller.flowStorageHooks).toBeUndefined();
	expect(await controller.route("recordly://auth/callback?code=legacy-code")).toBe("local");
	expect(alice.send).toHaveBeenCalledWith(
		"auth:callback",
		"recordly://auth/callback?code=legacy-code",
	);
	expect(bob.send).toHaveBeenCalledWith(
		"auth:callback",
		"recordly://auth/callback?code=legacy-code",
	);
	controller.close();
});

it("cleans a destroyed registered owner's routing without transferring its pending code", async () => {
	const { createAuthCallbackController } = await import("./authCallback");
	const controller = createAuthCallbackController({
		isDev: false,
		focusApp: vi.fn(),
		flowRoutingEnabled: true,
	});
	const alice = owner(1);
	await controller.flowStorageHooks!.prepareSet(event(alice), key);
	await controller.route(url);
	alice.destroyed = true;
	const destroyed = alice.once.mock.calls.find(
		([name]) => name === "destroyed",
	)![1] as () => void;
	destroyed();
	expect(state.flows.has("flow_alice")).toBe(false);
	controller.close();
});

it("preserves active unindexed registrations and prunes only exact verifiers missing after a peer deletion", async () => {
	const { createAuthCallbackController } = await import("./authCallback");
	const controller = createAuthCallbackController({
		isDev: false,
		focusApp: vi.fn(),
		flowRoutingEnabled: true,
	});
	const alice = owner(1),
		bob = owner(2);
	state.windows = [alice, bob];
	const aliceKey = "sb-recordlytest-auth-token-flow-flow_alice-code-verifier";
	const bobKey = "sb-recordlytest-auth-token-flow-flow_bob00-code-verifier";
	await controller.flowStorageHooks!.prepareSet(event(alice), aliceKey, []);
	// No SDK index is present in this snapshot. The exact active slot suffices.
	await controller.flowStorageHooks!.prepareSet(event(bob), bobKey, [aliceKey]);
	expect(state.flows.has("flow_alice")).toBe(true);
	expect(await controller.route(url)).toBe("local");
	expect(alice.send).toHaveBeenCalledWith("auth:callback", url);
	const nextKey = "sb-recordlytest-auth-token-flow-flow_next0-code-verifier";
	await controller.flowStorageHooks!.prepareSet(event(bob), nextKey, [bobKey]);
	expect(state.flows.has("flow_alice")).toBe(false);
	expect(state.flows.has("flow_bob00")).toBe(true);
	expect(state.flows.has("flow_next0")).toBe(true);
	controller.close();
});

it("does not release an owned flow when another project removes the same textual flow ID", async () => {
	const { createAuthCallbackController } = await import("./authCallback");
	const controller = createAuthCallbackController({
		isDev: false,
		focusApp: vi.fn(),
		flowRoutingEnabled: true,
	});
	const alice = owner(1);
	state.windows = [alice];
	await controller.flowStorageHooks!.prepareSet(event(alice), key, []);
	await controller.flowStorageHooks!.didRemove(
		event(alice),
		"sb-other-auth-token-flow-flow_alice-code-verifier",
	);
	expect(state.flows.has("flow_alice")).toBe(true);
	expect(await controller.route(url)).toBe("local");
	controller.close();
});

it.each([
	"AuthStorageBusyError",
	"EPERM",
])("retries failed stale-route cleanup without blocking a new verifier (%s)", async (failure) => {
	const { createAuthCallbackController } = await import("./authCallback");
	const controller = createAuthCallbackController({
		isDev: false,
		focusApp: vi.fn(),
		flowRoutingEnabled: true,
	});
	const alice = owner(1),
		bob = owner(2);
	state.windows = [alice, bob];
	const bobKey = "sb-recordlytest-auth-token-flow-flow_bob00-code-verifier";
	const nextKey = "sb-recordlytest-auth-token-flow-flow_next0-code-verifier";
	await controller.flowStorageHooks!.prepareSet(event(alice), key, []);
	state.getVerifier.mockImplementation(async (candidate) =>
		candidate === key ? null : '"verifier"',
	);
	state.releaseError = Object.assign(new Error(failure), { code: failure });
	await expect(controller.flowStorageHooks!.prepareSet(event(bob), bobKey, [])).resolves.toEqual(
		expect.any(Function),
	);
	expect(state.flows.has("flow_alice")).toBe(true);
	expect(await controller.route(url)).toBe("unavailable");
	expect(alice.send).not.toHaveBeenCalledWith("auth:callback", url);
	const bobUrl = url.replace("flow_alice", "flow_bob00");
	expect(await controller.route(bobUrl)).toBe("local");
	expect(bob.send).toHaveBeenCalledWith("auth:callback", bobUrl);
	state.releaseError = undefined;
	await controller.flowStorageHooks!.prepareSet(event(bob), nextKey, [bobKey]);
	expect(state.releaseAttempts).toEqual(["flow_alice", "flow_alice"]);
	expect(state.flows.has("flow_alice")).toBe(false);
	expect(state.flows.has("flow_bob00")).toBe(true);
	await controller.flowStorageHooks!.prepareSet(event(bob), nextKey, [bobKey, nextKey]);
	expect(state.releaseAttempts).toEqual(["flow_alice", "flow_alice"]);
	controller.close();
});

it.each([
	"Too many pending sign-in flows.",
	"This sign-in flow already belongs to another window.",
])("preserves strict registration rejection after cleanup failure: %s", async (message) => {
	const { createAuthCallbackController } = await import("./authCallback");
	const controller = createAuthCallbackController({
		isDev: false,
		focusApp: vi.fn(),
		flowRoutingEnabled: true,
	});
	const alice = owner(1);
	await controller.flowStorageHooks!.prepareSet(event(alice), key, []);
	state.releaseError = new Error("Cleanup unavailable");
	state.registerError = new Error(message);
	const nextKey = "sb-recordlytest-auth-token-flow-flow_next0-code-verifier";
	await expect(controller.flowStorageHooks!.prepareSet(event(alice), nextKey, [])).rejects.toBe(
		state.registerError,
	);
	expect(state.flows.has("flow_alice")).toBe(true);
	expect(state.flows.has("flow_next0")).toBe(false);
	controller.close();
});
