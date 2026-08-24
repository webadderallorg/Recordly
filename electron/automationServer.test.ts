import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
	app: { getName: () => "Recordly" },
	BrowserWindow: class {
		static getAllWindows() {
			return [];
		}
	},
	desktopCapturer: { getSources: vi.fn() },
}));

describe("pickSource", () => {
	const screen = { id: "screen:0:0", name: "Entire screen", sourceType: "screen" as const };
	const chromeWindow = {
		id: "window:1:0",
		name: "Chrome - New Tab",
		sourceType: "window" as const,
	};
	const codeWindow = { id: "window:2:0", name: "VS Code", sourceType: "window" as const };
	const sources = [screen, chromeWindow, codeWindow];

	it("matches an exact sourceId first", async () => {
		const { pickSource } = await import("./automationServer");
		expect(pickSource(sources, { sourceId: "window:2:0" })).toBe(codeWindow);
	});

	it("matches sourceName as a case-insensitive substring", async () => {
		const { pickSource } = await import("./automationServer");
		expect(pickSource(sources, { sourceName: "chrome" })).toBe(chromeWindow);
	});

	it("falls back to the first screen source when nothing matches", async () => {
		const { pickSource } = await import("./automationServer");
		expect(pickSource(sources, { sourceName: "does-not-exist" })).toBe(screen);
	});

	it("returns undefined when there is no screen fallback either", async () => {
		const { pickSource } = await import("./automationServer");
		expect(pickSource([chromeWindow, codeWindow], {})).toBeUndefined();
	});
});
