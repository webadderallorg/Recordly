import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CURSOR_TELEMETRY_VERSION, MAX_CURSOR_SAMPLES } from "../constants";

vi.mock(import("../constants"), async (original) => ({
	...(await original()),
	MAX_CURSOR_SAMPLES: 4,
}));

const { writeFile, rm } = vi.hoisted(() => ({
	writeFile: vi.fn(),
	rm: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
	default: {
		writeFile,
		rm,
	},
}));

vi.mock("electron", () => ({
	app: {
		getPath: vi.fn(() => "/tmp"),
	},
}));

vi.mock("../utils", () => ({
	getTelemetryPathForVideo: vi.fn(() => "/tmp/recording.cursor.json"),
	getScreen: vi.fn(() => ({
		getCursorScreenPoint: () => ({ x: 0, y: 0 }),
		dipToScreenPoint: () => ({ x: 492, y: 346 }),
		getPrimaryDisplay: () => ({ scaleFactor: 1 }),
		getDisplayNearestPoint: () => ({ bounds: { x: 0, y: 0, width: 1, height: 1 } }),
		getAllDisplays: () => [],
	})),
}));

import {
	activeCursorSamples,
	setActiveCursorSamples,
	setCursorCaptureStartTimeMs,
	setIsCursorCaptureActive,
	setLinuxCursorScreenPoint,
	setPendingCursorSamples,
	setSelectedSource,
	setSelectedWindowBounds,
	setWindowsNativeCaptureActive,
	setWindowsWindowCaptureSize,
} from "../state";
import { getScreen } from "../utils";
import {
	captureRecordingZoomMarker,
	clearActiveCursorTelemetry,
	getCursorCaptureElapsedMs,
	getNormalizedCursorPoint,
	normalizeCursorTelemetrySamples,
	pauseCursorCapture,
	pauseCursorCaptureAtBoundary,
	persistPendingCursorTelemetry,
	pushCursorSample,
	resetCursorCaptureClock,
	resumeCursorCapture,
	sampleCursorPoint,
	snapshotCursorTelemetryForPersistence,
	writeCursorTelemetry,
} from "./telemetry";

describe("Windows window cursor coordinates", () => {
	const platform = process.platform;
	const source = { id: "window:123:0", name: "Window" };

	beforeEach(() => {
		Object.defineProperty(process, "platform", { value: "win32" });
		setSelectedSource(source);
		setSelectedWindowBounds(null);
		setWindowsNativeCaptureActive(true);
		setWindowsWindowCaptureSize({ sourceId: source.id, width: 764, height: 562 });
		setActiveCursorSamples([]);
	});

	afterEach(() => {
		Object.defineProperty(process, "platform", { value: platform });
		setSelectedSource(null);
		setSelectedWindowBounds(null);
		setWindowsNativeCaptureActive(false);
		setActiveCursorSamples([]);
	});

	it("uses the encoded frame after the source shrinks", () => {
		setSelectedWindowBounds({
			x: 112,
			y: 75,
			width: 502,
			height: 329,
			physicalOrigin: { x: 140, y: 94 },
		});
		expect(getNormalizedCursorPoint()).toEqual({ cx: 352 / 764, cy: 252 / 562 });
	});

	it("skips samples until the selected window's geometry arrives", () => {
		sampleCursorPoint();
		expect(activeCursorSamples).toEqual([]);
	});
});

it("normalizes a Linux screen cursor in the selected display's DIP coordinates", () => {
	const platform = process.platform;
	Object.defineProperty(process, "platform", { value: "linux" });
	setSelectedSource({ id: "screen:1:0", name: "Left display", display_id: "2" });
	// uiohook reports a position in the merged X screen, while Electron uses DIP.
	setLinuxCursorScreenPoint({ x: 960, y: 540, updatedAt: Date.now() });
	const left = { id: 2, bounds: { x: -1536, y: 0, width: 1536, height: 864 } };
	const cursor = vi.fn(() => ({ x: -768, y: 432 }));
	const screen = {
		getCursorScreenPoint: cursor,
		getPrimaryDisplay: () => ({ scaleFactor: 1.25 }),
		getAllDisplays: () => [left],
	} as unknown as ReturnType<typeof getScreen>;
	vi.mocked(getScreen).mockReturnValue(screen);
	try {
		expect(getNormalizedCursorPoint()).toEqual({ cx: 0.5, cy: 0.5 });
		cursor.mockReturnValue({ x: -1152, y: 216 });
		expect(getNormalizedCursorPoint()).toEqual({ cx: 0.25, cy: 0.25 });
	} finally {
		vi.mocked(getScreen).mockReset();
		Object.defineProperty(process, "platform", { value: platform });
		setSelectedSource(null);
		setLinuxCursorScreenPoint(null);
	}
});

describe("cursor telemetry pause clock", () => {
	beforeEach(() => {
		writeFile.mockReset();
		rm.mockReset();
		setCursorCaptureStartTimeMs(1_000);
		clearActiveCursorTelemetry();
		setPendingCursorSamples([]);
		resetCursorCaptureClock();
	});

	it("subtracts paused time from elapsed cursor timestamps", () => {
		expect(getCursorCaptureElapsedMs(1_120)).toBe(120);

		pauseCursorCapture(1_200);
		expect(getCursorCaptureElapsedMs(1_450)).toBe(200);

		resumeCursorCapture(1_700);
		expect(getCursorCaptureElapsedMs(1_900)).toBe(400);
	});

	it("retains zoom markers through pointer eviction, repeated snapshots and sidecar normalization", async () => {
		setIsCursorCaptureActive(false);
		expect(captureRecordingZoomMarker(1_050)).toBe(false);
		setIsCursorCaptureActive(true);
		try {
			expect(captureRecordingZoomMarker(1_100)).toBe(true);
			expect(captureRecordingZoomMarker(1_210)).toBe(true);
			pauseCursorCaptureAtBoundary(1_200);
			expect(captureRecordingZoomMarker(1_300)).toBe(false);
			resumeCursorCapture(1_500);
			for (let i = 0; i <= MAX_CURSOR_SAMPLES; i++) {
				pushCursorSample(0.5, 0.5, 210 + i);
			}
			expect(activeCursorSamples).toHaveLength(MAX_CURSOR_SAMPLES);
			snapshotCursorTelemetryForPersistence();
			// A marker may share a timestamp with the most recent pointer sample.
			expect(captureRecordingZoomMarker(1_510 + MAX_CURSOR_SAMPLES)).toBe(true);
			expect(captureRecordingZoomMarker(1_750)).toBe(true);
			snapshotCursorTelemetryForPersistence();
			clearActiveCursorTelemetry();
			snapshotCursorTelemetryForPersistence();
			await persistPendingCursorTelemetry("/tmp/recording.mp4");
			const saved = JSON.parse(writeFile.mock.calls[0][1]);
			const normalized = normalizeCursorTelemetrySamples(saved);
			expect(
				normalized.filter((sample) => sample.interactionType !== "manual-zoom"),
			).toHaveLength(MAX_CURSOR_SAMPLES);
			expect(
				normalized.filter((sample) => sample.interactionType === "manual-zoom"),
			).toMatchObject([
				{ timeMs: 100, interactionType: "manual-zoom" },
				{ timeMs: 210 + MAX_CURSOR_SAMPLES, interactionType: "manual-zoom" },
				{ timeMs: 450, interactionType: "manual-zoom" },
			]);
			expect(normalized.map((sample) => sample.timeMs)).toEqual(
				saved.samples.map((sample: { timeMs: number }) => sample.timeMs),
			);
		} finally {
			setIsCursorCaptureActive(false);
		}
	});

	it("ignores duplicate pause or resume transitions", () => {
		pauseCursorCapture(1_150);
		pauseCursorCapture(1_250);
		resumeCursorCapture(1_500);
		resumeCursorCapture(1_650);

		expect(getCursorCaptureElapsedMs(1_900)).toBe(550);
	});

	it("drops cursor samples captured after the renderer pause boundary", () => {
		pushCursorSample(0.1, 0.1, 120, "move");
		pushCursorSample(0.2, 0.2, 205, "move");
		pushCursorSample(0.3, 0.3, 260, "move");

		pauseCursorCaptureAtBoundary(1_200);

		expect(getCursorCaptureElapsedMs(1_500)).toBe(200);
		expect(activeCursorSamples.map((sample) => sample.timeMs)).toEqual([120]);

		resumeCursorCapture(1_700);
		expect(getCursorCaptureElapsedMs(1_900)).toBe(400);
	});

	it("normalizes cursor telemetry samples before persisting them", async () => {
		const samples = normalizeCursorTelemetrySamples([
			{ timeMs: 30, cx: 2, cy: -1, interactionType: "click", cursorType: "pointer" },
			{ timeMs: -10, cx: Number.NaN, cy: 0.2, interactionType: "drag", cursorType: "ibeam" },
			{ timeMs: 10, cx: 0.25, cy: 0.75, interactionType: "move", cursorType: "text" },
		]);

		expect(samples).toEqual([
			{ timeMs: 0, cx: 0.5, cy: 0.2, interactionType: undefined, cursorType: undefined },
			{ timeMs: 10, cx: 0.25, cy: 0.75, interactionType: "move", cursorType: "text" },
			{ timeMs: 30, cx: 1, cy: 0, interactionType: "click", cursorType: "pointer" },
		]);

		await writeCursorTelemetry("/tmp/recording.mp4", samples);

		expect(writeFile).toHaveBeenCalledWith(
			"/tmp/recording.cursor.json",
			JSON.stringify(
				{
					version: CURSOR_TELEMETRY_VERSION,
					samples,
				},
				null,
				2,
			),
			"utf-8",
		);
		expect(rm).not.toHaveBeenCalled();
	});

	it("removes the sidecar when saving an empty cursor telemetry payload", async () => {
		await writeCursorTelemetry("/tmp/recording.mp4", []);

		expect(rm).toHaveBeenCalledWith("/tmp/recording.cursor.json", { force: true });
		expect(writeFile).not.toHaveBeenCalled();
	});

	it("preserves button identity through persistence and rejects invalid button values", async () => {
		pushCursorSample(0.2, 0.3, 100, "right-click", "arrow", 2);
		pushCursorSample(0.8, 0.6, 2000, "mouseup", "arrow", 2);
		await writeCursorTelemetry("/tmp/recording.mp4", activeCursorSamples);
		const saved = JSON.parse(writeFile.mock.calls[0][1]);
		expect(saved.samples.map((sample: { mouseButton: number }) => sample.mouseButton)).toEqual([
			2, 2,
		]);
		expect(
			normalizeCursorTelemetrySamples([{ timeMs: 0, cx: 0, cy: 0, mouseButton: 99 }])[0]
				.mouseButton,
		).toBeUndefined();
	});

	it("releases held buttons at pause so mouseup during the pause cannot leave a stuck effect", () => {
		pushCursorSample(0.1, 0.2, 100, "click", "arrow", 1);
		pauseCursorCaptureAtBoundary(1500);
		expect(activeCursorSamples.at(-1)).toMatchObject({
			timeMs: 500,
			interactionType: "mouseup",
			mouseButton: 1,
		});
	});
});
