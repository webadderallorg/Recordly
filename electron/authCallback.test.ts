import { app, ipcMain } from "electron";
import { expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	request: undefined as ((request: unknown, response: unknown) => void) | undefined,
	send: vi.fn(),
	foreignSend: vi.fn(),
	relayRoute: vi.fn(),
}));
vi.mock("./authFlowRelay", () => ({
	createAuthFlowRelay: () => ({ route: state.relayRoute, close: async () => undefined }),
}));
vi.mock("node:http", () => ({
	createServer: (handler: (request: unknown, response: unknown) => void) => {
		state.request = handler;
		return { on: vi.fn(), listen: vi.fn(), close: vi.fn() };
	},
}));
vi.mock("electron", () => ({
	app: {
		on: vi.fn(),
		isReady: () => false,
		getAppPath: () => "/recordly",
		getPath: () => "/recordly",
	},
	ipcMain: { handle: vi.fn() },
	BrowserWindow: {
		getAllWindows: () => [
			{
				isDestroyed: () => false,
				webContents: { send: state.foreignSend, getURL: () => "https://foreign.test/" },
			},
			{
				isDestroyed: () => false,
				webContents: { send: state.send, getURL: () => "file:///recordly/dist/index.html" },
			},
		],
	},
}));

it("forwards the SDK's PKCE flow id through the dev callback without forwarding unrelated parameters", async () => {
	const { createAuthCallbackController } = await import("./authCallback");
	const controller = createAuthCallbackController({
		isDev: true,
		focusApp: vi.fn(),
		flowRoutingEnabled: false,
	});
	controller.startDevServer();
	const response = { writeHead: vi.fn(), end: vi.fn() };
	state.request!(
		{
			method: "GET",
			headers: { host: "127.0.0.1:43821" },
			url: "/auth/callback?code=login-code&sb_flow_id=0123456789abcdef&unrelated=discard",
		},
		response,
	);
	expect(response.writeHead).toHaveBeenCalledWith(200, expect.any(Object));
	expect(state.send).toHaveBeenCalledExactlyOnceWith(
		"auth:callback",
		"recordly-dev://auth/callback?code=login-code&sb_flow_id=0123456789abcdef",
	);
	expect(state.foreignSend).not.toHaveBeenCalled();
	controller.close();
});

it("restricts callback reads and acknowledgements to the trusted main frame", async () => {
	vi.mocked(ipcMain.handle).mockClear();
	const { createAuthCallbackController } = await import("./authCallback");
	const controller = createAuthCallbackController({
		isDev: false,
		focusApp: vi.fn(),
		flowRoutingEnabled: false,
	});
	const url = "recordly://auth/callback?code=private-code";
	controller.dispatch(url);
	const handlers = new Map(vi.mocked(ipcMain.handle).mock.calls);
	const frame = { url: "file:///recordly/dist/index.html?windowType=onboarding" };
	const sender = { mainFrame: frame };
	const trusted = { sender, senderFrame: frame } as unknown as Electron.IpcMainInvokeEvent;
	for (const foreign of [false, true]) {
		const senderFrame = { url: foreign ? "https://foreign.test/" : frame.url };
		const event = {
			sender: foreign ? { mainFrame: senderFrame } : sender,
			senderFrame,
		} as unknown as Electron.IpcMainInvokeEvent;
		expect(handlers.get("auth:get-pending-callback")!(event)).toBeNull();
		handlers.get("auth:ack-callback")!(event, url);
		expect(handlers.get("auth:get-pending-callback")!(trusted)).toBe(url);
	}
	handlers.get("auth:ack-callback")!(trusted, url);
	expect(handlers.get("auth:get-pending-callback")!(trusted)).toBeNull();
});

it("shows an actionable failure page without reflecting callback secrets", async () => {
	const { createAuthCallbackController } = await import("./authCallback");
	const controller = createAuthCallbackController({
		isDev: true,
		focusApp: vi.fn(),
		flowRoutingEnabled: false,
	});
	controller.startDevServer();
	const response = { writeHead: vi.fn(), end: vi.fn() };
	state.request!(
		{
			method: "GET",
			headers: { host: "127.0.0.1:43821" },
			url: "/auth/callback?error=expired&error_description=PRIVATE_CALLBACK_VALUE",
		},
		response,
	);
	const html = response.end.mock.calls[0][0];
	expect(html).toContain("request a fresh one");
	expect(html).toContain('href="recordly-dev://app/open"');
	expect(html).not.toContain("PRIVATE_CALLBACK_VALUE");
	expect(html).not.toContain("<script");
	controller.close();
});

it("reopens the app without replacing its pending sign-in callback", async () => {
	const { createAuthCallbackController } = await import("./authCallback");
	const focusApp = vi.fn();
	const controller = createAuthCallbackController({
		isDev: false,
		focusApp,
		flowRoutingEnabled: false,
	});
	controller.dispatch("recordly://auth/callback?code=pending-private-code");
	const ready = vi.spyOn(app, "isReady").mockReturnValue(true);
	const open = vi
		.mocked(app.on)
		.mock.calls.filter(([name]) => name === "open-url")
		.at(-1)?.[1] as (event: { preventDefault: () => void }, url: string) => void;
	const event = { preventDefault: vi.fn() };
	state.send.mockClear();
	open(event, "recordly://app/open");
	expect(focusApp).toHaveBeenCalledOnce();
	expect(state.send).not.toHaveBeenCalled();
	const read = new Map(vi.mocked(ipcMain.handle).mock.calls).get("auth:get-pending-callback")!;
	const frame = { url: "file:///recordly/dist/index.html" };
	expect(
		read({
			sender: { mainFrame: frame },
			senderFrame: frame,
		} as unknown as Electron.IpcMainInvokeEvent),
	).toContain("pending-private-code");
	open(event, "recordly://app/open?redirect=https://foreign.test");
	expect(focusApp).toHaveBeenCalledOnce();
	ready.mockRestore();
});

it("finishes a rejected dev relay request with a non-reflecting error page", async () => {
	const { createAuthCallbackController } = await import("./authCallback");
	state.relayRoute.mockRejectedValueOnce(new Error("PRIVATE_RELAY_FAILURE"));
	const controller = createAuthCallbackController({
		isDev: true,
		flowRoutingEnabled: true,
		focusApp: vi.fn(),
	});
	controller.startDevServer();
	const response = { writeHead: vi.fn(), end: vi.fn() };
	state.request!(
		{
			method: "GET",
			headers: { host: "127.0.0.1:43821" },
			url: "/auth/callback?code=PRIVATE_CALLBACK_CODE",
		},
		response,
	);
	await vi.waitFor(() => expect(response.end).toHaveBeenCalledOnce());
	expect(response.writeHead).toHaveBeenCalledWith(200, expect.any(Object));
	const html = response.end.mock.calls[0][0];
	expect(html).toContain("request a fresh one");
	expect(html).not.toContain("PRIVATE_CALLBACK_CODE");
	expect(html).not.toContain("PRIVATE_RELAY_FAILURE");
	controller.close();
});
