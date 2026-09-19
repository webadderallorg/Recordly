import { describe, expect, it } from "vitest";
import { normalizeKeystrokeSamples, writeKeystrokeTelemetry } from "./keystrokes";
import { beforeEach, vi } from "vitest";

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
	getKeystrokePathForVideo: vi.fn(() => "/tmp/recording.keys.json"),
}));

vi.mock("./telemetry", () => ({
	getCursorCaptureElapsedMs: vi.fn(() => 0),
	isCursorCapturePaused: vi.fn(() => false),
}));

vi.mock("../state", () => ({
	activeKeystrokeSamples: [],
	pendingKeystrokeSamples: [],
	isCursorCaptureActive: false,
	isKeystrokeCaptureEnabled: false,
	setActiveKeystrokeSamples: vi.fn(),
	setIsKeystrokeCaptureEnabled: vi.fn(),
	setPendingKeystrokeSamples: vi.fn(),
}));

vi.mock("../../appSettingsStore", () => ({
	readAppSetting: vi.fn(() => false),
}));

describe("keystroke sidecar", () => {
	beforeEach(() => {
		writeFile.mockReset();
		rm.mockReset();
	});

	it("writes normalized samples", async () => {
		const samples = await writeKeystrokeTelemetry("/tmp/recording.mp4", [
			{ timeMs: 12, key: "Enter", ctrl: false },
		]);
		expect(samples[0]?.key).toBe("Enter");
		expect(writeFile).toHaveBeenCalled();
	});

	it("removes the sidecar when empty", async () => {
		await writeKeystrokeTelemetry("/tmp/recording.mp4", []);
		expect(rm).toHaveBeenCalledWith("/tmp/recording.keys.json", { force: true });
	});

	it("normalizes unknown payloads", () => {
		expect(normalizeKeystrokeSamples("nope")).toEqual([]);
	});
});
