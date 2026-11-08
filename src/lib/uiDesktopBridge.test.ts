import { createContext, runInContext } from "node:vm";
import type { Page } from "@playwright/test";
import { expect, it, vi } from "vitest";
import { installDesktopBridge, installDesktopBridgeOverrides } from "../../tests/ui/bridge";

vi.mock("../../tests/ui/auth", () => ({ installSupabaseAuth: async () => undefined }));

function harness() {
	const browserWindow: Record<string, unknown> = {};
	const context = createContext({ window: browserWindow });
	const scripts: string[] = [];
	const page = {
		exposeBinding: async (name: string, callback: (...args: unknown[]) => unknown) => {
			browserWindow[name] = (...args: unknown[]) => callback(undefined, ...args);
		},
		addInitScript: async (
			script: ((arg: unknown) => void) | { content: string },
			arg?: unknown,
		) => {
			scripts.push(
				typeof script === "function"
					? `(${script.toString()})(${JSON.stringify(arg)});`
					: script.content,
			);
		},
	} as unknown as Page;
	return {
		page,
		scripts,
		run: (script: string) => runInContext(script, context),
		api: () => browserWindow.electronAPI as Window["electronAPI"],
		trace: () => browserWindow.bridgeTrace,
	};
}

it.each([
	"defaults first",
	"override first",
])("lets an override wrap the native auth default when init scripts run %s", async (order) => {
	const browser = harness();
	await installDesktopBridge(browser.page);
	await installDesktopBridgeOverrides(browser.page, () => {
		const getItem = window.electronAPI.authStorageGetItem;
		const state = window as unknown as { bridgeTrace: string[] };
		state.bridgeTrace = [];
		window.electronAPI.authStorageGetItem = async (key) => {
			state.bridgeTrace.push(key);
			return getItem(key);
		};
	});
	const [defaults, override] = browser.scripts;
	for (const script of order === "defaults first" ? [defaults, override] : [override, defaults])
		browser.run(script);

	await browser.api().authStorageSetItem("session", "saved session");
	expect(await browser.api().authStorageGetItem("session")).toBe("saved session");
	expect(browser.trace()).toEqual(["session"]);
	expect(await browser.api().getPlatform()).toBe("darwin");
});

it("applies multiple early overrides once and preserves their wrapper chain and arguments", async () => {
	const browser = harness();
	await installDesktopBridge(browser.page);
	for (const label of ["first", "second"]) {
		await installDesktopBridgeOverrides(
			browser.page,
			(label) => {
				const getItem = window.electronAPI.authStorageGetItem;
				const state = window as unknown as { bridgeTrace?: string[] };
				state.bridgeTrace ??= [];
				state.bridgeTrace.push(`installed ${label}`);
				window.electronAPI.authStorageGetItem = async (key) => {
					state.bridgeTrace?.push(label);
					return getItem(key);
				};
			},
			label,
		);
	}
	for (const script of [...browser.scripts.slice(1), browser.scripts[0]]) browser.run(script);

	expect(await browser.api().authStorageGetItem("missing")).toBeNull();
	expect(browser.trace()).toEqual(["installed first", "installed second", "second", "first"]);
});

it("keeps partial overrides installed directly before the bridge defaults", async () => {
	const browser = harness();
	await installDesktopBridge(browser.page);
	browser.run('window.electronAPI = { getPlatform: async () => "win32" };');
	browser.run(browser.scripts[0]);

	expect(await browser.api().getPlatform()).toBe("win32");
	expect(await browser.api().authStorageGetItem("missing")).toBeNull();
});
