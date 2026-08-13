import { describe, expect, it, vi } from "vitest";
import {
	createWillNavigateHandler,
	createWillRedirectHandler,
	createWindowOpenHandler,
	hardenWebContentsNavigation,
	isInternalRendererTarget,
	normalizeExternalHttpUrl,
	shouldHardenWebContentsType,
} from "./navigationPolicy";

describe("normalizeExternalHttpUrl", () => {
	it.each([
		["https://example.com/docs", "https://example.com/docs"],
		["http://127.0.0.1:3000/path?q=1", "http://127.0.0.1:3000/path?q=1"],
		["HTTPS://Example.COM:443/docs", "https://example.com/docs"],
	])("normalizes an external HTTP(S) URL: %s", (value, expected) => {
		expect(normalizeExternalHttpUrl(value)).toBe(expected);
	});

	it.each([
		"",
		"not a URL",
		"file:///tmp/recordly.html",
		"data:text/html,hello",
		"javascript:alert(1)",
		"mailto:security@example.com",
		"https://user:password@example.com/",
	])("rejects an unsafe external URL: %s", (value) => {
		expect(normalizeExternalHttpUrl(value)).toBeNull();
	});
});

describe("shouldHardenWebContentsType", () => {
	it("selects BrowserWindow contents only", () => {
		expect(shouldHardenWebContentsType("window")).toBe(true);
		expect(shouldHardenWebContentsType("webview")).toBe(false);
		expect(shouldHardenWebContentsType("offscreen")).toBe(false);
	});
});

describe("isInternalRendererTarget", () => {
	it.each([
		["http://localhost:5173/?windowType=editor", "http://localhost:5173/editor?reload=1"],
		["http://127.0.0.1:43123/?windowType=editor", "http://127.0.0.1:43123/assets/index.js"],
		[
			"file:///opt/Recordly/dist/index.html?windowType=editor",
			"file:///opt/Recordly/dist/index.html?windowType=hud-overlay#status",
		],
	])("identifies the current renderer origin/file", (currentUrl, targetUrl) => {
		expect(isInternalRendererTarget(currentUrl, targetUrl)).toBe(true);
	});

	it.each([
		["http://localhost:5173/?windowType=editor", "http://localhost.example.com:5173/"],
		["http://localhost:5173/", "http://localhost:5174/"],
		["https://recordly.example/", "http://recordly.example/"],
		["https://recordly.example/", "https://user:pass@recordly.example/"],
		["file:///opt/Recordly/dist/index.html", "file:///etc/passwd"],
		["file:///opt/Recordly/dist/index.html", "data:text/html,hello"],
		["not a URL", "https://example.com/"],
	])("distinguishes a target outside the current renderer", (currentUrl, targetUrl) => {
		expect(isInternalRendererTarget(currentUrl, targetUrl)).toBe(false);
	});
});

describe("navigation event handlers", () => {
	it("preserves an exact renderer reload", () => {
		const preventDefault = vi.fn();
		const openExternal = vi.fn(async () => undefined);
		const handler = createWillNavigateHandler(
			() => "http://localhost:5173/editor?windowType=editor",
			openExternal,
		);

		handler({
			url: "http://localhost:5173/editor?windowType=editor",
			preventDefault,
		});

		expect(preventDefault).not.toHaveBeenCalled();
		expect(openExternal).not.toHaveBeenCalled();
	});

	it("stops same-origin renderer navigation without externalizing it", () => {
		const preventDefault = vi.fn();
		const openExternal = vi.fn(async () => undefined);
		const handler = createWillNavigateHandler(
			() => "http://localhost:5173/editor",
			openExternal,
		);

		handler({ url: "http://localhost:5173/settings", preventDefault });

		expect(preventDefault).toHaveBeenCalledOnce();
		expect(openExternal).not.toHaveBeenCalled();
	});

	it("stops same-file query mutation without externalizing it", () => {
		const preventDefault = vi.fn();
		const openExternal = vi.fn(async () => undefined);
		const handler = createWillNavigateHandler(
			() => "file:///opt/Recordly/dist/index.html?windowType=editor",
			openExternal,
		);

		handler({
			url: "file:///opt/Recordly/dist/index.html?smokeExport=1",
			preventDefault,
		});

		expect(preventDefault).toHaveBeenCalledOnce();
		expect(openExternal).not.toHaveBeenCalled();
	});

	it("stops cross-origin navigation and opens HTTP(S) in the system browser", () => {
		const preventDefault = vi.fn();
		const openExternal = vi.fn(async () => undefined);
		const handler = createWillNavigateHandler(
			() => "http://localhost:5173/editor",
			openExternal,
		);

		handler({ url: "https://example.com/docs", preventDefault });

		expect(preventDefault).toHaveBeenCalledOnce();
		expect(openExternal).toHaveBeenCalledWith("https://example.com/docs");
	});

	it("stops unsafe schemes without opening them externally", () => {
		const preventDefault = vi.fn();
		const openExternal = vi.fn(async () => undefined);
		const handler = createWillNavigateHandler(
			() => "file:///opt/Recordly/dist/index.html",
			openExternal,
		);

		handler({ url: "file:///etc/passwd", preventDefault });

		expect(preventDefault).toHaveBeenCalledOnce();
		expect(openExternal).not.toHaveBeenCalled();
	});

	it("stops server redirects without externalizing the target", () => {
		const preventDefault = vi.fn();
		createWillRedirectHandler()({ url: "https://example.com/redirect", preventDefault });
		expect(preventDefault).toHaveBeenCalledOnce();
	});

	it("always denies Electron child windows while preserving safe external links", () => {
		const openExternal = vi.fn(async () => undefined);
		const handler = createWindowOpenHandler(() => "http://localhost:5173/editor", openExternal);

		expect(handler({ url: "https://example.com/docs" })).toEqual({ action: "deny" });
		expect(handler({ url: "http://localhost:5173/settings" })).toEqual({ action: "deny" });
		expect(handler({ url: "javascript:alert(1)" })).toEqual({ action: "deny" });
		expect(openExternal).toHaveBeenCalledOnce();
		expect(openExternal).toHaveBeenCalledWith("https://example.com/docs");
	});

	it("reports a system-browser failure without allowing the child window", async () => {
		const error = new Error("browser unavailable");
		const reportOpenError = vi.fn();
		const handler = createWindowOpenHandler(
			() => "http://localhost:5173/editor",
			vi.fn(async () => {
				throw error;
			}),
			reportOpenError,
		);

		expect(handler({ url: "https://example.com/docs" })).toEqual({ action: "deny" });
		await vi.waitFor(() => {
			expect(reportOpenError).toHaveBeenCalledWith("https://example.com/docs", error);
		});
	});

	it("reports a synchronous browser-launch failure while still denying the child", () => {
		const error = new Error("browser launch threw");
		const reportOpenError = vi.fn();
		const handler = createWindowOpenHandler(
			() => "http://localhost:5173/editor",
			vi.fn(() => {
				throw error;
			}),
			reportOpenError,
		);

		expect(handler({ url: "https://example.com/docs" })).toEqual({ action: "deny" });
		expect(reportOpenError).toHaveBeenCalledWith("https://example.com/docs", error);
	});

	it("attaches navigation, redirect, and window-open policies", () => {
		const on = vi.fn();
		const setWindowOpenHandler = vi.fn();
		const webContents = {
			getURL: () => "http://localhost:5173/",
			on,
			setWindowOpenHandler,
		};

		hardenWebContentsNavigation(
			webContents,
			vi.fn(async () => undefined),
		);

		expect(on).toHaveBeenCalledWith("will-navigate", expect.any(Function));
		expect(on).toHaveBeenCalledWith("will-redirect", expect.any(Function));
		expect(on).toHaveBeenCalledWith("did-navigate", expect.any(Function));
		expect(setWindowOpenHandler).toHaveBeenCalledWith(expect.any(Function));
	});

	it("does not trust a renderer-mutated URL as an exact reload", () => {
		let currentUrl = "file:///opt/Recordly/dist/index.html?windowType=editor";
		const on = vi.fn();
		const webContents = {
			getURL: () => currentUrl,
			on,
			setWindowOpenHandler: vi.fn(),
		};
		const openExternal = vi.fn(async () => undefined);

		hardenWebContentsNavigation(webContents, openExternal);

		// history.replaceState() changes getURL() without crossing a document-navigation boundary.
		currentUrl = "file:///opt/Recordly/dist/index.html?windowType=source-selector";
		const willNavigate = on.mock.calls.find(([eventName]) => eventName === "will-navigate")?.[1];
		if (typeof willNavigate !== "function") {
			throw new Error("will-navigate handler was not registered");
		}

		const preventDefault = vi.fn();
		willNavigate({ url: currentUrl, preventDefault });

		expect(preventDefault).toHaveBeenCalledOnce();
		expect(openExternal).not.toHaveBeenCalled();
	});

	it("trusts an exact reload after a completed document navigation", () => {
		const on = vi.fn();
		const webContents = {
			getURL: () => "",
			on,
			setWindowOpenHandler: vi.fn(),
		};

		hardenWebContentsNavigation(
			webContents,
			vi.fn(async () => undefined),
		);

		const didNavigate = on.mock.calls.find(([eventName]) => eventName === "did-navigate")?.[1];
		const willNavigate = on.mock.calls.find(([eventName]) => eventName === "will-navigate")?.[1];
		if (typeof didNavigate !== "function" || typeof willNavigate !== "function") {
			throw new Error("navigation handlers were not registered");
		}

		const loadedUrl = "file:///opt/Recordly/dist/index.html?windowType=editor";
		didNavigate({}, loadedUrl);
		const preventDefault = vi.fn();
		willNavigate({ url: loadedUrl, preventDefault });

		expect(preventDefault).not.toHaveBeenCalled();
	});
});
