import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	lists: { onScreen: "[]", allSpaces: "[]" },
	execFile: vi.fn(
		(
			_command: string,
			args: string[],
			_options: unknown,
			callback: (error: null, result: { stdout: string }) => void,
		) =>
			callback(null, {
				stdout: args.includes("--all-spaces")
					? mocks.lists.allSpaces
					: mocks.lists.onScreen,
			}),
	),
}));

vi.mock("node:child_process", () => ({ execFile: mocks.execFile }));
vi.mock("electron", () => ({ app: { getPath: () => "/tmp" } }));
vi.mock("../paths/binaries", () => ({ ensureNativeWindowListBinary: async () => "/bin/list" }));
vi.mock("../utils", () => ({
	parseWindowId: (id?: string) => {
		const match = id?.match(/^window:(\d+)/);
		return match ? Number(match[1]) : null;
	},
	getScreen: () => ({
		getCursorScreenPoint: () => ({ x: 1440 + 497, y: 122 + 29 }),
		getPrimaryDisplay: () => DISPLAY,
		getDisplayNearestPoint: () => DISPLAY,
		getAllDisplays: () => [DISPLAY],
	}),
}));
vi.mock("../windowsWindowControl", () => ({}));

import {
	activeCursorSamples,
	selectedWindowBounds,
	setActiveCursorSamples,
	setCachedNativeMacWindowSources,
	setCachedNativeMacWindowSourcesAtMs,
	setSelectedSource,
} from "../state";
import {
	getNativeMacWindowSources,
	isMacWindowOnScreen,
	startWindowBoundsCapture,
	stopWindowBoundsCapture,
} from "./bounds";
import { sampleCursorPoint } from "./telemetry";

const VISIBLE = { id: "window:1:0", name: "Visible", onScreen: true };
const HIDDEN = { id: "window:2:0", name: "Other desktop", onScreen: false };
const DISPLAY = { id: 1, scaleFactor: 2, bounds: { x: 1440, y: 0, width: 2560, height: 1440 } };
const platform = process.platform;

beforeAll(() => Object.defineProperty(process, "platform", { value: "darwin" }));
afterAll(() => Object.defineProperty(process, "platform", { value: platform }));
beforeEach(() => {
	setCachedNativeMacWindowSources(null);
	setCachedNativeMacWindowSourcesAtMs(0);
	mocks.execFile.mockClear();
	mocks.lists.onScreen = JSON.stringify([VISIBLE]);
	mocks.lists.allSpaces = JSON.stringify([VISIBLE, HIDDEN]);
});

describe("getNativeMacWindowSources", () => {
	it("keeps all-spaces results out of the HUD's on-screen cache and never caches them", async () => {
		await expect(getNativeMacWindowSources()).resolves.toEqual([VISIBLE]);
		await expect(getNativeMacWindowSources({ allSpaces: true })).resolves.toEqual([
			VISIBLE,
			HIDDEN,
		]);
		expect(mocks.execFile.mock.calls[1][1]).toEqual(["--all-spaces"]);
		await expect(getNativeMacWindowSources()).resolves.toEqual([VISIBLE]);
		await getNativeMacWindowSources({ allSpaces: true, maxAgeMs: 60_000 });
		expect(mocks.execFile).toHaveBeenCalledTimes(3);
	});
});

describe("isMacWindowOnScreen", () => {
	it("reads a fresh all-spaces list", async () => {
		await expect(isMacWindowOnScreen("window:1:0")).resolves.toBe(true);
		await expect(isMacWindowOnScreen("window:2:0")).resolves.toBe(false);
		await expect(isMacWindowOnScreen("window:3:0")).resolves.toBe(false);
		expect(mocks.execFile).toHaveBeenCalledTimes(3);
	});

	it("treats an empty list as unknown so a broken helper cannot block recording", async () => {
		mocks.lists.allSpaces = "[]";
		await expect(isMacWindowOnScreen("window:3:0")).resolves.toBe(true);
	});
});

describe("all-spaces failures", () => {
	it("return an empty list instead of the stale on-screen cache", async () => {
		await getNativeMacWindowSources();
		mocks.lists.allSpaces = "not json";
		await expect(getNativeMacWindowSources({ allSpaces: true })).resolves.toEqual([]);
		mocks.lists.onScreen = "not json";
		await expect(getNativeMacWindowSources({ maxAgeMs: 0 })).resolves.toEqual([VISIBLE]);
	});
});

describe("window recording cursor samples", () => {
	it("are window-relative from the first sample", async () => {
		mocks.lists.onScreen = JSON.stringify([
			{ ...VISIBLE, x: 1440, y: 122, width: 2560, height: 1318 },
		]);
		setSelectedSource({ id: VISIBLE.id, name: VISIBLE.name });
		setActiveCursorSamples([]);

		startWindowBoundsCapture();
		sampleCursorPoint();
		await vi.waitFor(() => expect(selectedWindowBounds).not.toBeNull());
		sampleCursorPoint();
		stopWindowBoundsCapture();
		setSelectedSource(null);

		expect(activeCursorSamples.map(({ cx, cy }) => ({ cx, cy }))).toEqual([
			{ cx: 497 / 2560, cy: 29 / 1318 },
		]);
	});
});
