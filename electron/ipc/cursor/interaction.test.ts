import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { loadHook, startEvdev, startPrimary } = vi.hoisted(() => ({
	loadHook: vi.fn(),
	startEvdev: vi.fn(() => vi.fn()),
	startPrimary: vi.fn(async () => ({ available: false, stop: vi.fn() })),
}));

vi.mock("./hyprlandButtons", () => ({ startHyprlandButtonCapture: startPrimary }));

vi.mock("node:module", async (importOriginal) => ({
	...(await importOriginal<typeof import("node:module")>()),
	createRequire: () => loadHook,
}));

vi.mock("./hyprland", async (importOriginal) => ({
	...(await importOriginal<typeof import("./hyprland")>()),
	startEvdevButtonCapture: startEvdev,
}));

vi.mock("electron", () => ({
	app: {
		getPath: vi.fn(() => "/tmp"),
		setPath: vi.fn(),
		isReady: vi.fn(() => true),
	},
}));

vi.mock("../utils", () => ({
	getTelemetryPathForVideo: vi.fn(() => "/tmp/recording.cursor.json"),
	getScreen: vi.fn(() => ({
		getCursorScreenPoint: () => ({ x: 480, y: 270 }),
		getPrimaryDisplay: () => ({ scaleFactor: 1 }),
		getDisplayNearestPoint: () => ({ bounds: { x: 0, y: 0, width: 1920, height: 1080 } }),
		getAllDisplays: () => [],
	})),
}));

import { buildInteractionZoomSuggestions } from "../../../src/components/video-editor/timeline/zoomSuggestionUtils";
import {
	activeCursorSamples,
	setActiveCursorSamples,
	setCursorCaptureStartTimeMs,
	setInteractionCaptureCleanup,
	setIsCursorCaptureActive,
	setLastLeftClick,
	setLinuxCursorScreenPoint,
} from "../state";

import {
	recordCursorMouseDown,
	recordCursorMouseUp,
	repairBundledUiohookBinaryForCurrentArch,
	shouldStartGlobalInteractionHook,
	startInteractionCapture,
	stopInteractionCapture,
} from "./interaction";
import { pauseCursorCapture, resetCursorCaptureClock, resumeCursorCapture } from "./telemetry";

describe("captured cursor interactions", () => {
	const platformDescriptor = Object.getOwnPropertyDescriptor(
		process,
		"platform",
	) as PropertyDescriptor;

	beforeEach(() => {
		Object.defineProperty(process, "platform", { ...platformDescriptor, value: "linux" });
		startPrimary.mockReset();
		startPrimary.mockResolvedValue({ available: false, stop: vi.fn() });
		startEvdev.mockClear();
		loadHook.mockReset();
		vi.useFakeTimers();
		vi.setSystemTime(10_000);
		setIsCursorCaptureActive(true);
		setCursorCaptureStartTimeMs(10_000);
		setActiveCursorSamples([]);
		setLastLeftClick(null);
		setLinuxCursorScreenPoint(null);
		resetCursorCaptureClock();
	});

	afterEach(() => {
		stopInteractionCapture();
		setIsCursorCaptureActive(false);
		resetCursorCaptureClock();
		vi.useRealTimers();
		Object.defineProperty(process, "platform", platformDescriptor);
	});

	it("records buttons and releases against the media clock and creates zooms", () => {
		vi.setSystemTime(11_000);
		recordCursorMouseDown(1);
		vi.setSystemTime(11_100);
		recordCursorMouseUp();
		vi.setSystemTime(11_200);
		recordCursorMouseDown(1);
		vi.setSystemTime(14_000);
		recordCursorMouseDown(2);
		vi.setSystemTime(17_000);
		recordCursorMouseDown(3);

		expect(
			activeCursorSamples.map(({ timeMs, interactionType }) => ({ timeMs, interactionType })),
		).toEqual([
			{ timeMs: 1000, interactionType: "click" },
			{ timeMs: 1100, interactionType: "mouseup" },
			{ timeMs: 1200, interactionType: "double-click" },
			{ timeMs: 4000, interactionType: "right-click" },
			{ timeMs: 7000, interactionType: "middle-click" },
		]);
		const zooms = buildInteractionZoomSuggestions({
			cursorTelemetry: activeCursorSamples,
			totalMs: 10_000,
			defaultDurationMs: 3000,
		});
		expect(zooms.status).toBe("ok");
		expect(zooms.suggestions).toEqual([
			{ start: 500, end: 1700, focus: { cx: 0.25, cy: 0.25 } },
			{ start: 3500, end: 4500, focus: { cx: 0.25, cy: 0.25 } },
			{ start: 6500, end: 7500, focus: { cx: 0.25, cy: 0.25 } },
		]);
	});

	it("ignores paused and stopped clicks and excludes pause duration after resuming", () => {
		pauseCursorCapture(11_000);
		vi.setSystemTime(13_000);
		recordCursorMouseDown(1);
		recordCursorMouseUp();
		expect(activeCursorSamples).toEqual([]);
		resumeCursorCapture(14_000);
		vi.setSystemTime(14_100);
		recordCursorMouseDown(1);
		expect(activeCursorSamples).toMatchObject([
			{ timeMs: 1100, interactionType: "click", cx: 0.25, cy: 0.25 },
		]);
		setIsCursorCaptureActive(false);
		recordCursorMouseDown(2);
		recordCursorMouseUp();
		expect(activeCursorSamples).toHaveLength(1);
	});

	it("does not reenter cleanup when its provider stops capture", () => {
		const cleanup = vi.fn(() => stopInteractionCapture());
		setInteractionCaptureCleanup(cleanup);
		stopInteractionCapture();
		expect(cleanup).toHaveBeenCalledOnce();
	});

	it("ignores callbacks from a stopped provider after restarting capture", async () => {
		const on = vi.fn();
		const off = vi.fn();
		loadHook.mockReturnValue({ uIOhook: { on, off, start: vi.fn(), stop: vi.fn() } });
		await startInteractionCapture();
		const staleMouseDown = on.mock.calls.find(([event]) => event === "mousedown")?.[1];
		expect(staleMouseDown).toBeTypeOf("function");
		await startInteractionCapture();
		vi.setSystemTime(11_000);
		staleMouseDown({ button: 1 });
		expect(activeCursorSamples).toEqual([]);
		const currentMouseDown = on.mock.calls
			.filter(([event]) => event === "mousedown")
			.at(-1)?.[1];
		currentMouseDown({ button: 1 });
		expect(activeCursorSamples).toHaveLength(1);
		expect(off).toHaveBeenCalledWith("mousedown", staleMouseDown);
	});

	it("uses compositor clicks exclusively while the primary capture is available", async () => {
		startPrimary.mockResolvedValue({ available: true, stop: vi.fn() });
		await startInteractionCapture();
		expect(startEvdev).not.toHaveBeenCalled();
		expect(loadHook).not.toHaveBeenCalled();
		const handlers = startPrimary.mock.calls[0][0];
		vi.setSystemTime(11_000);
		handlers.onMouseDown(1);
		handlers.onMouseUp();
		expect(activeCursorSamples.map(({ interactionType }) => interactionType)).toEqual([
			"click",
			"mouseup",
		]);
	});

	it("aborts a pending primary startup and disposes its late result without starting fallback", async () => {
		let resolveStartup!: (result: { available: boolean; stop: () => void }) => void;
		startPrimary.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					resolveStartup = resolve;
				}),
		);
		const startup = startInteractionCapture();
		const signal = startPrimary.mock.calls[0][1].signal;
		stopInteractionCapture();
		expect(signal.aborted).toBe(true);
		const stop = vi.fn();
		resolveStartup({ available: true, stop });
		await startup;
		expect(stop).toHaveBeenCalledOnce();
		expect(startEvdev).not.toHaveBeenCalled();
	});

	it("preserves new capture when a previous pending startup resolves", async () => {
		let resolveStartup!: (result: { available: boolean; stop: () => void }) => void;
		startPrimary.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					resolveStartup = resolve;
				}),
		);
		const previousStartup = startInteractionCapture();
		const previousHandlers = startPrimary.mock.calls[0][0];
		const currentStop = vi.fn();
		startPrimary.mockResolvedValueOnce({ available: true, stop: currentStop });
		await startInteractionCapture();
		const previousStop = vi.fn();
		resolveStartup({ available: true, stop: previousStop });
		await previousStartup;
		previousHandlers.onMouseDown(1);
		expect(previousStop).toHaveBeenCalledOnce();
		expect(currentStop).not.toHaveBeenCalled();
		expect(activeCursorSamples).toEqual([]);
		stopInteractionCapture();
		expect(currentStop).toHaveBeenCalledOnce();
	});

	it("switches to fallback once after failure and ignores late primary events", async () => {
		const stop = vi.fn();
		startPrimary.mockResolvedValue({ available: true, stop });
		loadHook.mockReturnValue({ uIOhook: { on: vi.fn(), start: vi.fn(), stop: vi.fn() } });
		await startInteractionCapture();
		const [handlers, options] = startPrimary.mock.calls[0];
		options.onUnavailable();
		options.onUnavailable();
		handlers.onMouseDown(1);
		handlers.onMouseUp();
		expect(startEvdev).toHaveBeenCalledOnce();
		expect(loadHook).toHaveBeenCalledOnce();
		expect(activeCursorSamples).toEqual([]);
	});

	it("suppresses hook click duplicates once an evdev device opens", async () => {
		const on = vi.fn();
		loadHook.mockReturnValue({ uIOhook: { on, start: vi.fn(), stop: vi.fn() } });
		await startInteractionCapture();
		const [handlers, options] = startEvdev.mock.calls[0];
		options.onDeviceOpened();
		vi.setSystemTime(11_000);
		handlers.onMouseDown(1);
		on.mock.calls.find(([event]) => event === "mousedown")?.[1]({ button: 1 });
		handlers.onMouseUp();
		on.mock.calls.find(([event]) => event === "mouseup")?.[1]();
		expect(activeCursorSamples.map(({ interactionType }) => interactionType)).toEqual([
			"click",
			"mouseup",
		]);
	});

	it("does not start fallback when a cancelled primary request rejects", async () => {
		let rejectStartup!: (error: Error) => void;
		startPrimary.mockImplementationOnce(
			() =>
				new Promise((_, reject) => {
					rejectStartup = reject;
				}),
		);
		const startup = startInteractionCapture();
		stopInteractionCapture();
		rejectStartup(new Error("socket closed"));
		await startup;
		expect(startEvdev).not.toHaveBeenCalled();
		expect(loadHook).not.toHaveBeenCalled();
	});
});

describe("shouldStartGlobalInteractionHook", () => {
	it("does not start the synchronous uiohook event tap on macOS", () => {
		expect(shouldStartGlobalInteractionHook("darwin")).toBe(false);
	});

	it("keeps global interaction capture enabled on Windows and Linux", () => {
		expect(shouldStartGlobalInteractionHook("win32")).toBe(true);
		expect(shouldStartGlobalInteractionHook("linux")).toBe(true);
	});
});

describe("repairBundledUiohookBinaryForCurrentArch", () => {
	const tempRoots: string[] = [];

	afterEach(async () => {
		await Promise.all(
			tempRoots
				.splice(0)
				.map((tempRoot) => fs.rm(tempRoot, { recursive: true, force: true })),
		);
	});

	it("promotes the bundled darwin-arm64 prebuild over a stale incompatible build", async () => {
		const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "recordly-uiohook-"));
		tempRoots.push(tempRoot);

		const packageRoot = path.join(tempRoot, "uiohook-napi");
		const prebuildPath = path.join(packageRoot, "prebuilds", "darwin-arm64", "node.napi.node");
		const buildPath = path.join(packageRoot, "build", "Release", "uiohook_napi.node");
		await fs.mkdir(path.dirname(prebuildPath), { recursive: true });
		await fs.mkdir(path.dirname(buildPath), { recursive: true });
		await fs.writeFile(prebuildPath, "arm64-prebuild");
		await fs.writeFile(buildPath, "x64-build");

		const log = vi.fn();
		const repaired = repairBundledUiohookBinaryForCurrentArch(
			Object.assign(
				new Error(
					"mach-o file, but is an incompatible architecture (have 'x86_64', need 'arm64')",
				),
				{
					code: "ERR_DLOPEN_FAILED",
				},
			),
			{ packageRoot, platform: "darwin", arch: "arm64", log },
		);

		expect(repaired).toBe(true);
		expect(await fs.readFile(buildPath, "utf8")).toBe("arm64-prebuild");
		expect(log).toHaveBeenCalledWith(
			"[CursorTelemetry] Repaired stale uiohook-napi binary using bundled darwin-arm64 prebuild.",
		);
	});

	it("does not rewrite binaries for unrelated load failures", async () => {
		const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "recordly-uiohook-"));
		tempRoots.push(tempRoot);

		const packageRoot = path.join(tempRoot, "uiohook-napi");
		const buildPath = path.join(packageRoot, "build", "Release", "uiohook_napi.node");
		await fs.mkdir(path.dirname(buildPath), { recursive: true });
		await fs.writeFile(buildPath, "existing-build");

		const repaired = repairBundledUiohookBinaryForCurrentArch(
			Object.assign(new Error("some other dlopen failure"), {
				code: "ERR_DLOPEN_FAILED",
			}),
			{ packageRoot, platform: "darwin", arch: "arm64" },
		);

		expect(repaired).toBe(false);
		expect(await fs.readFile(buildPath, "utf8")).toBe("existing-build");
	});
});
