import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	handlers: new Map<string, (...args: unknown[]) => unknown>(),
	trusted: vi.fn(() => true),
	pauseCursorCaptureAtBoundary: vi.fn(),
	resumeCursorCapture: vi.fn(),
	sampleCursorPoint: vi.fn(),
	writeCursorTelemetry: vi.fn(),
	normalizeCursorTelemetrySamples: vi.fn((value: unknown) => (Array.isArray(value) ? value : [])),
	getSystemCursorAssets: vi.fn(async () => ({
		default: { dataUrl: "data:image/png;base64,abc" },
	})),
	readFile: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
	default: {
		readFile: mocks.readFile,
	},
}));

vi.mock("electron", () => ({
	ipcMain: {
		handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
			mocks.handlers.set(channel, handler);
		},
	},
}));

vi.mock("../../../trustedRenderer", () => ({
	isTrustedRenderer: mocks.trusted,
}));

vi.mock("../../cursor/telemetry", () => ({
	normalizeCursorTelemetrySamples: mocks.normalizeCursorTelemetrySamples,
	pauseCursorCaptureAtBoundary: mocks.pauseCursorCaptureAtBoundary,
	resumeCursorCapture: mocks.resumeCursorCapture,
	sampleCursorPoint: mocks.sampleCursorPoint,
	writeCursorTelemetry: mocks.writeCursorTelemetry,
}));

vi.mock("./systemCursorAssets", () => ({
	getSystemCursorAssets: mocks.getSystemCursorAssets,
}));

import { setCurrentVideoPath } from "../../state";
import { registerCursorHandlers } from "./cursorHandlers";

const invoke = (channel: string, ...args: unknown[]) => mocks.handlers.get(channel)!(...args);

describe("cursorHandlers IPC security and validation", () => {
	beforeEach(() => {
		mocks.handlers.clear();
		vi.clearAllMocks();
		mocks.trusted.mockReturnValue(true);
		setCurrentVideoPath(null);
		registerCursorHandlers();
	});

	it("rejects untrusted callers across all cursor IPC handlers", async () => {
		mocks.trusted.mockReturnValue(false);
		const untrustedEvent = { sender: { id: 99 } };

		await expect(invoke("get-system-cursor-assets", untrustedEvent)).rejects.toThrow(
			/Untrusted/,
		);
		expect(() => invoke("pause-cursor-capture", untrustedEvent, 100)).toThrow(/Untrusted/);
		expect(() => invoke("resume-cursor-capture", untrustedEvent, 200)).toThrow(/Untrusted/);
		await expect(
			invoke("get-cursor-telemetry", untrustedEvent, "/tmp/demo.mp4"),
		).rejects.toThrow(/Untrusted/);
		await expect(
			invoke("set-cursor-telemetry", untrustedEvent, "/tmp/demo.mp4", []),
		).rejects.toThrow(/Untrusted/);

		expect(mocks.getSystemCursorAssets).not.toHaveBeenCalled();
		expect(mocks.pauseCursorCaptureAtBoundary).not.toHaveBeenCalled();
		expect(mocks.resumeCursorCapture).not.toHaveBeenCalled();
		expect(mocks.sampleCursorPoint).not.toHaveBeenCalled();
		expect(mocks.readFile).not.toHaveBeenCalled();
		expect(mocks.writeCursorTelemetry).not.toHaveBeenCalled();
	});

	it("rejects non-array samples and non-string videoPath in set-cursor-telemetry without erasing telemetry", async () => {
		const trustedEvent = { sender: { id: 1 } };

		for (const badSamples of [null, undefined, "invalid", { length: 1 }, 42]) {
			await expect(
				invoke("set-cursor-telemetry", trustedEvent, "/tmp/demo.mp4", badSamples),
			).resolves.toMatchObject({
				success: false,
				samples: [],
				error: "Expected an array of cursor samples",
			});
		}

		await expect(
			invoke("set-cursor-telemetry", trustedEvent, { path: "/tmp/demo.mp4" }, []),
		).resolves.toMatchObject({
			success: false,
			samples: [],
			error: "Invalid video path",
		});

		expect(mocks.writeCursorTelemetry).not.toHaveBeenCalled();
	});

	it("rejects non-string videoPath in get-cursor-telemetry while preserving valid fallback and writes", async () => {
		const trustedEvent = { sender: { id: 1 } };

		await expect(invoke("get-cursor-telemetry", trustedEvent, 12345)).resolves.toMatchObject({
			success: false,
			samples: [],
			error: "Invalid video path",
		});
		expect(mocks.readFile).not.toHaveBeenCalled();

		setCurrentVideoPath("/tmp/recording.mp4");
		mocks.readFile.mockResolvedValueOnce(JSON.stringify([{ timeMs: 10, cx: 0.5, cy: 0.5 }]));
		await expect(invoke("get-cursor-telemetry", trustedEvent)).resolves.toEqual({
			success: true,
			samples: [{ timeMs: 10, cx: 0.5, cy: 0.5 }],
		});
		expect(mocks.readFile).toHaveBeenCalledWith("/tmp/recording.mp4.cursor.json", "utf-8");

		mocks.writeCursorTelemetry.mockResolvedValueOnce([]);
		await expect(invoke("set-cursor-telemetry", trustedEvent, undefined, [])).resolves.toEqual({
			success: true,
			samples: [],
		});
		expect(mocks.writeCursorTelemetry).toHaveBeenCalledWith("/tmp/recording.mp4", []);
	});
});
