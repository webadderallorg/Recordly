import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
	class HelperUnavailableError extends Error {}
	return {
		HelperUnavailableError,
		request: vi.fn(),
		onScreen: [] as Array<Record<string, unknown>>,
		allSpaces: [] as Array<Record<string, unknown>>,
		listCalls: [] as unknown[],
		execFile: vi.fn(
			(
				_command: string,
				_args: string[],
				_options: unknown,
				callback: (error: null, result: { stdout: string }) => void,
			) => callback(null, { stdout: "" }),
		),
	};
});

vi.mock("node:child_process", () => ({ execFile: mocks.execFile }));
vi.mock("electron", () => ({
	app: {},
	BrowserWindow: {},
	desktopCapturer: {},
	ipcMain: {},
	systemPreferences: {},
}));
vi.mock("../../recordingEditorNavigation", () => ({}));
vi.mock("../../windows", () => ({}));
vi.mock("../constants", () => ({}));
vi.mock("../../mcp/agentInput", () => ({
	agentInput: { request: mocks.request },
	HelperUnavailableError: mocks.HelperUnavailableError,
}));
vi.mock("../cursor/bounds", () => ({
	getNativeMacWindowSources: async (options?: { allSpaces?: boolean }) => {
		mocks.listCalls.push(options);
		return options?.allSpaces ? mocks.allSpaces : mocks.onScreen;
	},
	getWindowBoundsFromNativeSource: (source?: Record<string, number> | null) =>
		source && typeof source.width === "number"
			? { x: source.x, y: source.y, width: source.width, height: source.height }
			: null,
}));
vi.mock("../recording/ffmpeg", () => ({}));
vi.mock("../state", () => ({}));
vi.mock("../utils", () => ({
	parseWindowId: (id?: string) => {
		const match = id?.match(/^window:(\d+)/);
		return match ? Number(match[1]) : null;
	},
}));
vi.mock("../windowsWindowControl", () => ({}));
vi.mock("./sourceMapping", () => ({}));

import { bringSelectedWindowForward } from "./sources";

const FRAME = { x: 10, y: 20, width: 800, height: 600 };
const CHROME = { id: "window:7:0", name: "Docs", pid: 42, bundleId: "com.google.Chrome", ...FRAME };
const OTHER_CHROME = { ...CHROME, id: "window:8:0", pid: 43 };
const SOURCE = {
	id: "window:7:0",
	name: "Docs",
	appName: "Google Chrome",
	bundleId: "com.google.Chrome",
	pid: 42,
};
const platform = process.platform;

async function raise(source: Record<string, unknown> = SOURCE) {
	const result = bringSelectedWindowForward(source as never);
	await vi.advanceTimersByTimeAsync(1000);
	return result;
}

const byNameCalls = () => mocks.execFile.mock.calls.filter(([command]) => command === "open");

beforeAll(() => Object.defineProperty(process, "platform", { value: "darwin" }));
afterAll(() => Object.defineProperty(process, "platform", { value: platform }));
beforeEach(() => {
	vi.useFakeTimers();
	mocks.request.mockReset();
	mocks.execFile.mockClear();
	mocks.listCalls = [];
	mocks.onScreen = [CHROME, OTHER_CHROME];
	mocks.allSpaces = [CHROME, OTHER_CHROME];
});

describe("bringSelectedWindowForward on macOS", () => {
	it("keeps the old by-name raise for a single running instance, without the helper", async () => {
		mocks.onScreen = [CHROME, { ...CHROME, id: "window:9:0" }];
		await raise();
		expect(mocks.request).not.toHaveBeenCalled();
		expect(mocks.listCalls).toEqual([undefined]);
		expect(byNameCalls()[0]?.[1]).toEqual(["-a", "Google Chrome"]);
	});

	it("uses the by-name path when the source has no pid", async () => {
		await raise({ ...SOURCE, pid: undefined });
		expect(mocks.request).not.toHaveBeenCalled();
		expect(byNameCalls()).toHaveLength(1);
	});

	it("raises by pid through the helper when two instances run", async () => {
		mocks.request.mockResolvedValue({ raised: true });
		await expect(raise()).resolves.toEqual(FRAME);
		expect(mocks.request).toHaveBeenCalledWith(
			{ cmd: "raise", pid: 42, windowId: 7, frame: FRAME },
			{ timeoutMs: 3000 },
		);
		expect(byNameCalls()).toHaveLength(0);
	});

	it("counts an instance whose window is on another desktop", async () => {
		mocks.onScreen = [OTHER_CHROME];
		mocks.request.mockResolvedValue({ raised: true });
		await expect(raise()).resolves.toEqual(FRAME);
		expect(byNameCalls()).toHaveLength(0);
	});

	it.each([
		["times out", () => mocks.request.mockRejectedValue(new Error("did not answer in time"))],
		["reports raised:false", () => mocks.request.mockResolvedValue({ raised: false })],
	])("never falls back by name when the helper %s with two instances", async (_, arrange) => {
		arrange();
		await expect(raise()).resolves.toBeNull();
		expect(byNameCalls()).toHaveLength(0);
	});

	it("falls back by name when the helper cannot start", async () => {
		mocks.request.mockRejectedValue(new mocks.HelperUnavailableError("missing"));
		await raise();
		expect(byNameCalls()).toHaveLength(1);
	});

	it("falls back by name on a helper error once the fresh list shows one instance", async () => {
		mocks.allSpaces = [CHROME];
		mocks.request.mockRejectedValue(new Error("did not answer in time"));
		await raise();
		expect(byNameCalls()).toHaveLength(1);
	});
});
