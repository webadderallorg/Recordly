import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: {}, BrowserWindow: {} }));
vi.mock("../ipc/cursor/bounds", () => ({}));
vi.mock("../ipc/utils", () => ({
	parseWindowId: (id?: string) => {
		const match = id?.match(/^window:(\d+)/);
		return match ? Number(match[1]) : null;
	},
}));
vi.mock("./agentInput", () => ({ agentInput: {} }));

import {
	type AgentPlatformDeps,
	createAgentPlatform,
	isActionableRole,
	X11_REQUIRED,
} from "./agentPlatform";

const X11 = { DISPLAY: ":0", XDG_SESSION_TYPE: "x11" };
const HELPER_WINDOW = {
	pid: 42,
	windowId: 7,
	title: "Docs",
	appName: "chrome",
	frame: { x: 200, y: 100, width: 1600, height: 1200 },
	visible: true,
	minimized: false,
};
const display = (x: number, y: number, width: number, height: number, scaleFactor: number) => ({
	bounds: { x, y, width, height },
	scaleFactor,
});
const DISPLAYS = [display(0, 0, 1280, 800, 2), display(1280, 0, 1920, 1080, 2)];
const fakeScreen = () =>
	({
		getAllDisplays: () => DISPLAYS,
		getPrimaryDisplay: () => DISPLAYS[0],
		getDisplayNearestPoint: ({ x }: { x: number }) => (x < 1280 ? DISPLAYS[0] : DISPLAYS[1]),
		dipToScreenPoint: ({ x, y }: { x: number; y: number }) => ({ x: x * 1.5, y: y * 1.5 }),
		screenToDipPoint: ({ x, y }: { x: number; y: number }) => ({ x: x / 1.5, y: y / 1.5 }),
		dipToScreenRect: (_: null, rect: { x: number }) => ({ ...rect, physical: true }),
		screenToDipRect: (_: null, rect: { x: number }) => ({ ...rect, dip: true }),
	}) as unknown as ReturnType<AgentPlatformDeps["screen"]>;

const make = (overrides: Partial<AgentPlatformDeps> = {}) =>
	createAgentPlatform({
		platform: "linux",
		env: X11,
		ozonePlatform: () => "",
		ownPid: 1,
		ownWindowIds: () => [99],
		screen: fakeScreen,
		findMacWindow: async () => null,
		windowInfo: async () => HELPER_WINDOW,
		...overrides,
	});

describe("agent platform support", () => {
	it.each([
		["darwin", {}, ""],
		["win32", {}, ""],
		["linux", X11, ""],
		["linux", { DISPLAY: ":0", WAYLAND_DISPLAY: "wayland-0", XDG_SESSION_TYPE: "x11" }, ""],
	] as const)("supports %s with %j", (platform, env, ozone) => {
		expect(make({ platform, env, ozonePlatform: () => ozone }).support()).toEqual({
			supported: true,
		});
	});

	it.each([
		[{ DISPLAY: ":0", XDG_SESSION_TYPE: "wayland" }, ""],
		[{ WAYLAND_DISPLAY: "wayland-0" }, ""],
		[{ DISPLAY: ":0", WAYLAND_DISPLAY: "wayland-0" }, ""],
		[X11, "wayland"],
		[{}, ""],
	])("refuses Linux %j (ozone %s) with the X11 reason", (env, ozone) => {
		expect(make({ env, ozonePlatform: () => ozone }).support()).toEqual({
			supported: false,
			reason: X11_REQUIRED,
		});
	});

	it("refuses other platforms", () => {
		expect(make({ platform: "freebsd" }).support()).toMatchObject({ supported: false });
	});
});

describe("agent platform windows", () => {
	it("finds a Linux window in DIP and drops a missing pid", async () => {
		const platform = make({ windowInfo: async () => ({ ...HELPER_WINDOW, pid: 0 }) });
		expect(await platform.findWindow("window:7:0")).toEqual({
			pid: undefined,
			windowId: 7,
			frame: { x: 100, y: 50, width: 800, height: 600 },
		});
	});

	it.each([
		["minimized", { minimized: true }],
		["invisible", { visible: false }],
	])("returns null for a %s window", async (_, state) => {
		const platform = make({ windowInfo: async () => ({ ...HELPER_WINDOW, ...state }) });
		expect(await platform.findWindow("window:7:0")).toBeNull();
	});

	it("returns null when the helper does not know the window or the source is a screen", async () => {
		const windowInfo = vi.fn(async () => null);
		const platform = make({ windowInfo });
		expect(await platform.findWindow("window:7:0")).toBeNull();
		expect(await platform.findWindow("screen:1:0")).toBeNull();
		expect(windowInfo).toHaveBeenCalledTimes(1);
	});

	it("keeps the macOS lookup and frame as they are", async () => {
		const frame = { x: 10, y: 20, width: 300, height: 200 };
		const windowInfo = vi.fn();
		const platform = make({
			platform: "darwin",
			findMacWindow: async () => ({ pid: 42, frame }),
			windowInfo,
		});
		expect(await platform.findWindow("window:7:0")).toEqual({ pid: 42, windowId: 7, frame });
		expect(windowInfo).not.toHaveBeenCalled();
		const offScreen = make({
			platform: "darwin",
			findMacWindow: async () => ({ pid: 42, frame: null }),
		});
		expect(await offScreen.findWindow("window:7:0")).toBeNull();
	});

	it("recognises Recordly's own windows by pid or window id", () => {
		const platform = make();
		expect(platform.isOwnWindow({ pid: 1, windowId: 7 })).toBe(true);
		expect(platform.isOwnWindow({ pid: 42, windowId: 99 })).toBe(true);
		expect(platform.isOwnWindow({ pid: 42, windowId: 7 })).toBe(false);
		expect(platform.isOwnWindow({ windowId: 7 })).toBe(false);
	});
});

describe("records a screen", () => {
	const window = { id: "window:7:0", name: "Docs", sourceType: "window" as const };
	const screen = { id: "screen:1:0", name: "Entire screen", sourceType: "screen" as const };

	it.each([window, screen, null])("is always true on Linux for %j", (source) => {
		expect(make().recordsScreen(source)).toBe(true);
	});

	it.each(["darwin", "win32"] as const)("follows the selected source on %s", (platform) => {
		const platformApi = make({ platform });
		expect(platformApi.recordsScreen(screen)).toBe(true);
		expect(platformApi.recordsScreen({ name: "Entire screen", id: "screen:1:0" })).toBe(true);
		expect(platformApi.recordsScreen({ name: "Screen", sourceType: "screen" })).toBe(true);
		expect(platformApi.recordsScreen(window)).toBe(false);
		expect(platformApi.recordsScreen({ id: "window:7:0", name: "Docs" })).toBe(false);
		expect(platformApi.recordsScreen(null)).toBe(false);
	});
});

describe("agent platform conversions", () => {
	it("is the identity on macOS", () => {
		const platform = make({ platform: "darwin" });
		const rect = { x: 1.5, y: 2.5, width: 3, height: 4 };
		expect(platform.toHelperPoint({ x: 1.5, y: 2.5 })).toEqual({ x: 1.5, y: 2.5 });
		expect(platform.fromHelperPoint({ x: 1.5, y: 2.5 })).toEqual({ x: 1.5, y: 2.5 });
		expect(platform.toHelperRect(rect)).toBe(rect);
		expect(platform.fromHelperRect(rect)).toBe(rect);
	});

	it("scales by the display's scale factor on Linux", () => {
		const platform = make();
		expect(platform.toHelperPoint({ x: 1500, y: 100.5 })).toEqual({ x: 3000, y: 201 });
		expect(platform.fromHelperPoint({ x: 3000, y: 201 })).toEqual({ x: 1500, y: 100.5 });
		expect(platform.toHelperRect({ x: 10, y: 20, width: 30, height: 40 })).toEqual({
			x: 20,
			y: 40,
			width: 60,
			height: 80,
		});
		expect(platform.fromHelperRect({ x: 20, y: 40, width: 60, height: 80 })).toEqual({
			x: 10,
			y: 20,
			width: 30,
			height: 40,
		});
	});

	it("falls back to the primary display for a Linux point outside every display", () => {
		expect(make().fromHelperPoint({ x: -100, y: -100 })).toEqual({ x: -50, y: -50 });
	});

	it("uses Electron's DIP conversions on Windows, with whole-number inputs", () => {
		const platform = make({ platform: "win32" });
		expect(platform.toHelperPoint({ x: 10.4, y: 20.6 })).toEqual({ x: 15, y: 31.5 });
		expect(platform.fromHelperPoint({ x: 15, y: 30 })).toEqual({ x: 10, y: 20 });
		expect(platform.toHelperRect({ x: 1.4, y: 2, width: 3, height: 4.6 })).toEqual({
			x: 1,
			y: 2,
			width: 3,
			height: 5,
			physical: true,
		});
		expect(platform.fromHelperRect({ x: 1, y: 2, width: 3, height: 4 })).toEqual({
			x: 1,
			y: 2,
			width: 3,
			height: 4,
			dip: true,
		});
	});
});

describe("actionable roles", () => {
	it.each([
		"AXButton",
		"AXTextField",
		"AXPopUpButton",
		"AXTabButton",
		"Button",
		"SplitButton",
		"Hyperlink",
		"Edit",
		"ComboBox",
		"CheckBox",
		"RadioButton",
		"TabItem",
		"MenuItem",
	])("treats %s as actionable", (role) => {
		expect(isActionableRole(role)).toBe(true);
	});

	it.each([
		"AXStaticText",
		"AXHeading",
		"AXImage",
		"Text",
		"Heading",
		"Image",
		"Pane",
		"Document",
	])("does not treat %s as actionable", (role) => {
		expect(isActionableRole(role)).toBe(false);
	});
});
