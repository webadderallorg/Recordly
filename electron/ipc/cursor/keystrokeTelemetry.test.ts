import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { KEYSTROKE_TELEMETRY_VERSION, MAX_KEYSTROKE_SAMPLES } from "../constants";

const { writeFile, rm, readAppSetting } = vi.hoisted(() => ({
	writeFile: vi.fn(),
	rm: vi.fn(),
	readAppSetting: vi.fn(),
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

vi.mock("../../appSettingsStore", () => ({
	readAppSetting,
}));

vi.mock("../utils", () => ({
	getKeystrokePathForVideo: vi.fn(() => "/tmp/recording.keystrokes.json"),
	getTelemetryPathForVideo: vi.fn(() => "/tmp/recording.cursor.json"),
	normalizeVideoSourcePath: (videoPath?: string | null) => {
		if (typeof videoPath !== "string") {
			return null;
		}
		const trimmed = videoPath.trim();
		return trimmed ? trimmed : null;
	},
	getScreen: vi.fn(() => ({
		getCursorScreenPoint: () => ({ x: 0, y: 0 }),
		getPrimaryDisplay: () => ({ scaleFactor: 1 }),
		getDisplayNearestPoint: () => ({ bounds: { x: 0, y: 0, width: 1, height: 1 } }),
		getAllDisplays: () => [],
	})),
}));

import {
	pendingKeystrokeSamples,
	setActiveKeystrokeSamples,
	setPendingKeystrokeSamples,
} from "../state";
import {
	isExplicitKeystrokeTelemetryPathDenied,
	isKeystrokeCaptureEnabledFromPrefs,
	normalizeKeystrokeTelemetrySamples,
	persistPendingKeystrokeTelemetry,
	resetKeystrokeRepeatState,
	snapshotKeystrokeTelemetryForPersistence,
	writeKeystrokeTelemetry,
} from "./keystrokeTelemetry";

const recordingRegisterSource = readFileSync(
	fileURLToPath(new URL("../register/recording.ts", import.meta.url)),
	"utf8",
);
const macRecordingSource = readFileSync(
	fileURLToPath(new URL("../recording/mac.ts", import.meta.url)),
	"utf8",
);

describe("keystroke telemetry", () => {
	beforeEach(() => {
		writeFile.mockReset();
		rm.mockReset();
		readAppSetting.mockReset();
		readAppSetting.mockReturnValue(null);
		setActiveKeystrokeSamples([]);
		setPendingKeystrokeSamples([]);
		resetKeystrokeRepeatState();
	});

	it("drops junk samples and clamps negative time", () => {
		expect(
			normalizeKeystrokeTelemetrySamples([
				null,
				"c",
				{ timeMs: -10, key: "c", modifiers: ["meta"] },
				{ timeMs: 20, key: "", modifiers: ["meta"] },
				{ timeMs: 30, key: "  ", modifiers: ["meta"] },
			]),
		).toEqual([{ timeMs: 0, key: "c", modifiers: ["meta"] }]);
	});

	it("filters modifiers to the allow-list in stable order", () => {
		expect(
			normalizeKeystrokeTelemetrySamples([
				{
					timeMs: 10,
					key: "C",
					modifiers: ["shift", "super", "ctrl", "ctrl", "meta", "alt"],
				},
			]),
		).toEqual([{ timeMs: 10, key: "c", modifiers: ["meta", "ctrl", "alt", "shift"] }]);
	});

	it("sorts samples by timeMs", () => {
		expect(
			normalizeKeystrokeTelemetrySamples([
				{ timeMs: 30, key: "v", modifiers: ["meta"] },
				{ timeMs: 10, key: "c", modifiers: ["meta"] },
			]).map((sample) => sample.timeMs),
		).toEqual([10, 30]);
	});

	it("caps samples and drops bare modifier keys", () => {
		const samples = [
			{ timeMs: 1, key: "shift", modifiers: [] },
			{ timeMs: 2, key: "meta", modifiers: [] },
			{ timeMs: 3, key: "cmd", modifiers: [] },
			...Array.from({ length: MAX_KEYSTROKE_SAMPLES + 5 }, (_, index) => ({
				timeMs: index + 10,
				key: "a",
				modifiers: [],
			})),
		];
		const normalized = normalizeKeystrokeTelemetrySamples(samples);
		expect(normalized).toHaveLength(MAX_KEYSTROKE_SAMPLES);
		expect(normalized[0]?.timeMs).toBe(10);
		expect(normalized.some((sample) => sample.key === "shift")).toBe(false);
	});

	it("drops right-hand uiohook modifier names as bare keys", () => {
		expect(
			normalizeKeystrokeTelemetrySamples([
				{ timeMs: 1, key: "ctrlright", modifiers: ["ctrl"] },
				{ timeMs: 2, key: "altright", modifiers: ["alt"] },
				{ timeMs: 3, key: "metaright", modifiers: ["meta"] },
				{ timeMs: 4, key: "c", modifiers: ["ctrl"] },
			]),
		).toEqual([{ timeMs: 4, key: "c", modifiers: ["ctrl"] }]);
	});

	it("removes the sidecar when writing an empty payload", async () => {
		await writeKeystrokeTelemetry("/tmp/recording.mp4", []);
		expect(rm).toHaveBeenCalledWith("/tmp/recording.keystrokes.json", { force: true });
		expect(writeFile).not.toHaveBeenCalled();
	});

	it("writes a versioned sidecar for nonempty samples", async () => {
		const samples = [{ timeMs: 10, key: "c", modifiers: ["meta"] }];
		await writeKeystrokeTelemetry("/tmp/recording.mp4", samples);
		expect(writeFile).toHaveBeenCalledWith(
			"/tmp/recording.keystrokes.json",
			JSON.stringify({ version: KEYSTROKE_TELEMETRY_VERSION, samples }, null, 2),
			"utf-8",
		);
		expect(rm).not.toHaveBeenCalled();
	});

	it("does not delete a sidecar when persistPending is empty", async () => {
		setPendingKeystrokeSamples([{ timeMs: 10, key: "c", modifiers: ["meta"] }]);
		await persistPendingKeystrokeTelemetry("/tmp/recording.mp4");
		expect(writeFile).toHaveBeenCalledTimes(1);

		writeFile.mockClear();
		rm.mockClear();
		await persistPendingKeystrokeTelemetry("/tmp/recording.mp4");
		expect(rm).not.toHaveBeenCalled();
		expect(writeFile).not.toHaveBeenCalled();
	});

	it("writes then clears pending when persistPending is nonempty", async () => {
		setPendingKeystrokeSamples([{ timeMs: 10, key: "c", modifiers: ["meta"] }]);
		await persistPendingKeystrokeTelemetry("/tmp/recording.mp4");
		expect(writeFile).toHaveBeenCalledTimes(1);
		expect(pendingKeystrokeSamples).toEqual([]);
	});

	it("merges active samples into pending on snapshot", () => {
		snapshotKeystrokeTelemetryForPersistence();
		expect(pendingKeystrokeSamples).toEqual([]);

		setActiveKeystrokeSamples([{ timeMs: 10, key: "c", modifiers: ["meta"] }]);
		snapshotKeystrokeTelemetryForPersistence();
		expect(pendingKeystrokeSamples).toEqual([{ timeMs: 10, key: "c", modifiers: ["meta"] }]);

		setActiveKeystrokeSamples([
			{ timeMs: 10, key: "c", modifiers: ["meta"] },
			{ timeMs: 20, key: "v", modifiers: ["meta"] },
		]);
		snapshotKeystrokeTelemetryForPersistence();
		expect(pendingKeystrokeSamples).toEqual([
			{ timeMs: 10, key: "c", modifiers: ["meta"] },
			{ timeMs: 20, key: "v", modifiers: ["meta"] },
		]);
	});

	it("persists keystrokes from finalizeStoredVideo and recording stop", () => {
		expect(macRecordingSource).toContain("persistPendingKeystrokeTelemetry");
		expect(recordingRegisterSource).toContain("snapshotKeystrokeTelemetryForPersistence");
		expect(recordingRegisterSource).toContain("persistPendingKeystrokeTelemetry");
		expect(recordingRegisterSource).not.toContain("set-keystroke-telemetry");
	});

	it("does not deny omitted keystroke telemetry paths", () => {
		expect(isExplicitKeystrokeTelemetryPathDenied(undefined, () => false)).toBe(false);
	});

	it("denies explicit paths that fail the allowlist", () => {
		expect(isExplicitKeystrokeTelemetryPathDenied("/tmp/secret.mp4", () => false)).toBe(true);
	});

	it("allows explicit paths that pass the allowlist", () => {
		expect(isExplicitKeystrokeTelemetryPathDenied("/tmp/recording.mp4", () => true)).toBe(
			false,
		);
	});

	it("treats blank explicit keystroke telemetry paths as omitted", () => {
		expect(isExplicitKeystrokeTelemetryPathDenied("", () => false)).toBe(false);
		expect(isExplicitKeystrokeTelemetryPathDenied("   ", () => false)).toBe(false);
	});

	it("authorizes get-keystroke-telemetry senders without wrapping cursor telemetry", () => {
		expect(recordingRegisterSource).toContain("get-keystroke-telemetry");
		expect(recordingRegisterSource).not.toContain("set-keystroke-telemetry");
		expect(recordingRegisterSource).toContain(
			'ipcMain.handle("get-keystroke-telemetry", async (event, videoPath?: string)',
		);
		expect(recordingRegisterSource).toContain("BrowserWindow.fromWebContents");
		expect(recordingRegisterSource).toContain(
			'ipcMain.handle("get-cursor-telemetry", async (_, videoPath?: string)',
		);
	});

	it("treats missing prefs as capture off", () => {
		readAppSetting.mockReturnValue(null);
		expect(isKeystrokeCaptureEnabledFromPrefs()).toBe(false);
	});

	it("treats a non-boolean enabled flag as capture off", () => {
		readAppSetting.mockReturnValue({ keystrokeOverlay: { enabled: "yes" } });
		expect(isKeystrokeCaptureEnabledFromPrefs()).toBe(false);
	});

	it("enables capture only when overlay.enabled is true", () => {
		readAppSetting.mockReturnValue({ keystrokeOverlay: { enabled: true } });
		expect(isKeystrokeCaptureEnabledFromPrefs()).toBe(true);
	});
});
