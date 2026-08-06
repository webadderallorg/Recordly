import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
	app: {
		getAppPath: () => process.cwd(),
		getPath: () => process.env.TEMP ?? process.cwd(),
		isPackaged: false,
	},
	BrowserWindow: { fromWebContents: () => null },
	dialog: { showSaveDialog: vi.fn() },
	ipcMain: {
		handle: vi.fn(),
		on: vi.fn(),
	},
	powerSaveBlocker: {
		isStarted: () => true,
		start: () => 1,
		stop: vi.fn(),
	},
}));

vi.mock("../ffmpeg/binary", () => ({
	getFfmpegBinaryPath: () => path.join(process.cwd(), "recordly-missing-ffmpeg-binary"),
}));

import { ipcMain } from "electron";

import * as nativeVideo from "../export/native-video";
import { type NativeVideoExportSession, nativeVideoExportSessions } from "../export/native-video";
import { moveExportedTempFile, registerExportHandlers } from "./export";

const tempDirs: string[] = [];

async function makeTempDir() {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "recordly-export-move-"));
	tempDirs.push(dir);
	return dir;
}

afterEach(async () => {
	vi.restoreAllMocks();
	await Promise.allSettled(
		tempDirs.splice(0).map((dir) => fs.rm(dir, { force: true, recursive: true })),
	);
});

describe("moveExportedTempFile", () => {
	it("moves an app-managed export temp file to the selected destination", async () => {
		const dir = await makeTempDir();
		const tempPath = path.join(dir, "export-temp.mp4");
		const destinationPath = path.join(dir, "export-final.mp4");
		await fs.writeFile(tempPath, "recordly-export");

		await moveExportedTempFile(tempPath, destinationPath);

		await expect(fs.readFile(destinationPath, "utf8")).resolves.toBe("recordly-export");
		await expect(fs.access(tempPath)).rejects.toThrow();
	});

	it("falls back when Windows reports the destination already exists during initial rename", async () => {
		const dir = await makeTempDir();
		const tempPath = path.join(dir, "export-temp.mp4");
		const destinationPath = path.join(dir, "export-final.mp4");
		await fs.writeFile(tempPath, "new-export");
		await fs.writeFile(destinationPath, "previous-export");

		const originalRename = fs.rename.bind(fs);
		const renameSpy = vi.spyOn(fs, "rename");
		renameSpy.mockImplementation(async (from, to) => {
			if (from === tempPath && to === destinationPath) {
				const error = new Error("destination exists") as NodeJS.ErrnoException;
				error.code = "EEXIST";
				throw error;
			}

			return originalRename(from, to);
		});

		await moveExportedTempFile(tempPath, destinationPath);

		await expect(fs.readFile(destinationPath, "utf8")).resolves.toBe("new-export");
		await expect(fs.access(tempPath)).rejects.toThrow();
	});
});

describe("registerExportHandlers native-video-export-start observability", () => {
	function captureStartHandler() {
		const registrations = vi.mocked(ipcMain.handle).mock.calls;
		const entry = registrations.find(([channel]) => channel === "native-video-export-start");
		expect(entry).toBeDefined();
		return entry?.[1] as (event: unknown, options: Record<string, unknown>) => Promise<unknown>;
	}

	it("logs the incoming request settings before encoder resolution and on failure", async () => {
		registerExportHandlers();
		const handler = captureStartHandler();
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		const result = await handler(
			{ sender: {} },
			{
				width: 1920,
				height: 1080,
				frameRate: 30,
				bitrate: 0,
				encodingMode: "quality",
				inputMode: "rawvideo",
				videoCodec: "hevc",
				encoderPreference: "hardware",
			},
		);

		// Missing ffmpeg binary forces the native encoder resolution to fail, so the
		// handler still emits its pre-resolution request log before the failure log.
		expect(result).toMatchObject({ success: false });

		const logLines = logSpy.mock.calls.map((args) => String(args[1]));
		const startRequest = logLines.find((line) => line.includes("Start request"));
		expect(startRequest).toBeDefined();
		expect(startRequest).toMatch(/session=recordly-export-/);
		expect(startRequest).toMatch(/codec=hevc/);
		expect(startRequest).toMatch(/preference=hardware/);
		expect(startRequest).toMatch(/input=rawvideo/);
		expect(startRequest).toMatch(/mode=quality/);
		expect(startRequest).toMatch(/1920x1080/);
		expect(startRequest).toMatch(/fps=30/);

		const errorLines = errorSpy.mock.calls.map((args) => String(args[1]));
		const failure = errorLines.find((line) => line.includes("Failed to start"));
		expect(failure).toBeDefined();
		expect(failure).toMatch(/session=recordly-export-/);
		expect(failure).toMatch(/codec=hevc/);
		expect(failure).toMatch(/preference=hardware/);
		expect(failure).toMatch(/1920x1080/);
	});

	it("logs effective defaults when codec/preference/input are omitted", async () => {
		registerExportHandlers();
		const handler = captureStartHandler();
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await handler(
			{ sender: {} },
			{
				width: 640,
				height: 360,
				frameRate: 24,
				bitrate: 0,
				encodingMode: "fast",
			},
		);

		const logLines = logSpy.mock.calls.map((args) => String(args[1]));
		const startRequest = logLines.find((line) => line.includes("Start request"));
		expect(startRequest).toBeDefined();
		expect(startRequest).toMatch(/codec=h264/);
		expect(startRequest).toMatch(/preference=auto/);
		expect(startRequest).toMatch(/input=rawvideo/);
		expect(startRequest).toMatch(/640x360/);
	});
});

describe("registerExportHandlers prewarm teardown hard-fail", () => {
	function captureStartHandler() {
		const registrations = vi.mocked(ipcMain.handle).mock.calls;
		const entry = registrations.find(([channel]) => channel === "native-video-export-start");
		expect(entry).toBeDefined();
		return entry?.[1] as (event: unknown, options: Record<string, unknown>) => Promise<unknown>;
	}

	it("hard-fails HEVC Hardware exports with noCpuFallback when the prewarm teardown fails", async () => {
		registerExportHandlers();
		const handler = captureStartHandler();
		vi.spyOn(console, "log").mockImplementation(() => {});
		vi.spyOn(console, "error").mockImplementation(() => {});
		vi.spyOn(console, "warn").mockImplementation(() => {});
		vi.spyOn(nativeVideo, "resolveNativeVideoEncoder").mockResolvedValue("hevc_nvenc");
		const cancelPrewarmSpy = vi
			.spyOn(nativeVideo, "cancelInFlightCapabilityOnlyPrewarms")
			.mockImplementation(() => {
				throw new Error("capability-only prewarm child failed to terminate");
			});

		const result = await handler(
			{ sender: {} },
			{
				width: 1920,
				height: 1080,
				frameRate: 30,
				bitrate: 0,
				encodingMode: "quality",
				inputMode: "rawvideo",
				videoCodec: "hevc",
				encoderPreference: "hardware",
			},
		);

		expect(result).toMatchObject({ success: false });
		const error = String((result as { error?: unknown }).error);
		expect(error).toContain("noCpuFallback:true");
		expect(error).toContain("capability-only prewarm child failed to terminate");
		expect(cancelPrewarmSpy).toHaveBeenCalledTimes(1);
		// The handler returns the strict hard-fail before the FFmpeg process spawn
		// can ever run, so the export stops instead of continuing.
		expect(error).toContain("before opening its encoder session");
	});
});

describe("registerExportHandlers native-video-export-finish finalization state", () => {
	function captureFinishHandler() {
		const registrations = vi.mocked(ipcMain.handle).mock.calls;
		const entry = registrations.find(([channel]) => channel === "native-video-export-finish");
		expect(entry).toBeDefined();
		return entry?.[1] as (
			event: unknown,
			sessionId: string,
			options?: unknown,
		) => Promise<unknown>;
	}

	function captureWriteFrameHandler() {
		const registrations = vi.mocked(ipcMain.on).mock.calls;
		const entry = registrations.find(
			([channel]) => channel === "native-video-export-write-frame-async",
		);
		expect(entry).toBeDefined();
		return entry?.[1] as unknown as (
			event: {
				sender: { send: (...args: unknown[]) => void; isDestroyed: () => boolean };
			},
			payload: { sessionId: string; requestId: number; frameData: Uint8Array },
		) => void;
	}

	it("rejects frame writes after finish has started", async () => {
		registerExportHandlers();
		const finishHandler = captureFinishHandler();
		const writeFrameHandler = captureWriteFrameHandler();

		let resolveWriteSequence!: () => void;
		const writeSequence = new Promise<void>((resolve) => {
			resolveWriteSequence = resolve;
		});

		const sender = { send: vi.fn(), isDestroyed: () => false };
		const stdin = {
			destroyed: false,
			writableEnded: false,
			writable: true,
			writableLength: 0,
			end: vi.fn(),
			write: vi.fn(),
			destroy: vi.fn(),
			on: vi.fn(),
			once: vi.fn(),
			off: vi.fn(),
		};
		const session = {
			ffmpegProcess: {
				stdin,
				stderr: { on: vi.fn() },
				on: vi.fn(),
				once: vi.fn(),
				kill: vi.fn(),
			},
			outputPath: path.join(os.tmpdir(), "recordly-finish-test.mp4"),
			inputByteSize: 1920 * 1080 * 4,
			inputMode: "rawvideo",
			maxQueuedWriteBytes: 32 * 1024 * 1024,
			stderrOutput: "",
			encoderName: "hevc_nvenc",
			processError: null,
			stdinError: null,
			terminating: false,
			writeSequence,
			completionPromise: Promise.resolve(),
			sender: null,
			pendingWriteRequestIds: new Set<number>(),
			framePort: null,
			framePortReady: false,
			nextFrameSequence: 0,
			pendingFrameRequests: new Map<number, { sequence: number }>(),
			highestAcceptedFrameRequestId: -1,
		} as unknown as NativeVideoExportSession;

		nativeVideoExportSessions.set("finish-test-session", session);

		const finishPromise = finishHandler(undefined, "finish-test-session");

		writeFrameHandler(
			{ sender },
			{
				sessionId: "finish-test-session",
				requestId: 7,
				frameData: new Uint8Array(1920 * 1080 * 4),
			},
		);

		expect(sender.send).toHaveBeenCalledWith("native-video-export-write-frame-result", {
			sessionId: "finish-test-session",
			requestId: 7,
			success: false,
			error: "Native video export session is finishing; no more frames are accepted",
		});

		resolveWriteSequence();
		const result = await finishPromise;
		expect(result).toMatchObject({ success: true });
	});
});
