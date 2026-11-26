import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as state from "../../state";

const mocks = vi.hoisted(() => ({
	validateRecordedVideo: vi.fn(),
	waitForWindowsCaptureStop: vi.fn(),
	recoverNativeWindowsCaptureOutput: vi.fn(),
	snapshotCursorTelemetryForPersistence: vi.fn(),
	persistPendingCursorTelemetry: vi.fn(),
}));

vi.mock("electron", () => ({
	app: { getPath: () => os.tmpdir() },
	BrowserWindow: { getAllWindows: () => [] },
}));
vi.mock("../../cursor/telemetry", () => ({
	snapshotCursorTelemetryForPersistence: mocks.snapshotCursorTelemetryForPersistence,
	persistPendingCursorTelemetry: mocks.persistPendingCursorTelemetry,
}));
vi.mock("../diagnostics", async (original) => {
	const actual = await original<typeof import("../diagnostics")>();
	return {
		...actual,
		validateRecordedVideo: mocks.validateRecordedVideo,
	};
});
vi.mock("../windows", async (original) => {
	const actual = await original<typeof import("../windows")>();
	return {
		...actual,
		waitForWindowsCaptureStop: mocks.waitForWindowsCaptureStop,
		recoverNativeWindowsCaptureOutput: mocks.recoverNativeWindowsCaptureOutput,
	};
});

import { stopWindowsCapture } from "./stopWindowsCapture";

class CaptureProcess extends EventEmitter {
	stdin = new PassThrough();
	stdout = new PassThrough();
	stderr = new PassThrough();
	killed = false;
	kill = vi.fn(() => {
		this.killed = true;
		return true;
	});
}

describe("stopWindowsCapture", () => {
	let directory: string;
	let proc: CaptureProcess;

	beforeEach(async () => {
		directory = await fs.mkdtemp(path.join(os.tmpdir(), "recordly-stop-win-"));
		proc = new CaptureProcess();
		vi.clearAllMocks();

		state.setWindowsCaptureProcess(
			proc as unknown as NonNullable<typeof state.windowsCaptureProcess>,
		);
		state.setWindowsNativeCaptureActive(true);
		state.setNativeScreenRecordingActive(true);
		state.setWindowsCaptureStopRequested(false);
		state.setWindowsCapturePaused(true);
		state.setWindowsCaptureOutputBuffer("Recording started\n");
		state.setWindowsPendingVideoPath(null);
		state.setWindowsOrphanedMicAudioPath(null);
		state.setWindowsSystemAudioPath(null);
		state.setWindowsMicAudioPath(null);
		state.setWindowsCaptureTempPath(null);
		state.setWindowsCaptureTargetPath(null);
	});

	afterEach(async () => {
		state.setWindowsCaptureProcess(null);
		state.setWindowsNativeCaptureActive(false);
		state.setNativeScreenRecordingActive(false);
		state.setWindowsCaptureStopRequested(false);
		state.setWindowsCapturePaused(false);
		state.setWindowsPendingVideoPath(null);
		state.setWindowsOrphanedMicAudioPath(null);
		state.setWindowsSystemAudioPath(null);
		state.setWindowsMicAudioPath(null);
		state.setWindowsCaptureTempPath(null);
		state.setWindowsCaptureTargetPath(null);
		await fs.rm(directory, { recursive: true, force: true });
	});

	it("moves companion audio files when ancestor directories contain .mp4 or extension is uppercase .MP4", async () => {
		const tempDir = path.join(directory, "session.mp4", "staging");
		const finalDir = path.join(directory, "exports.mp4", "final");
		await fs.mkdir(tempDir, { recursive: true });
		await fs.mkdir(finalDir, { recursive: true });

		const tempVideo = path.join(tempDir, "temp.MP4");
		const finalVideo = path.join(finalDir, "recording.mp4");
		const finalSystemAudio = path.join(finalDir, "recording.system.wav");
		const finalMicAudio = path.join(finalDir, "recording.mic.wav");

		await fs.writeFile(tempVideo, "video-bytes");
		await fs.writeFile(path.join(tempDir, "temp.system.wav"), "system-wav");
		await fs.writeFile(path.join(tempDir, "temp.system.wav.json"), '{"startDelayMs":5}');
		await fs.writeFile(path.join(tempDir, "temp.mic.wav"), "mic-wav");
		await fs.writeFile(path.join(tempDir, "temp.mic.wav.json"), '{"startDelayMs":8}');

		state.setWindowsCaptureTempPath(tempVideo);
		state.setWindowsCaptureTargetPath(finalVideo);
		state.setWindowsSystemAudioPath(finalSystemAudio);
		state.setWindowsMicAudioPath(finalMicAudio);

		mocks.waitForWindowsCaptureStop.mockResolvedValue(tempVideo);
		mocks.validateRecordedVideo.mockResolvedValue({
			fileSizeBytes: 11,
			durationSeconds: 1.5,
		});

		const result = await stopWindowsCapture();

		expect(result).toEqual({ success: true, path: finalVideo });
		expect(await fs.readFile(finalVideo, "utf8")).toBe("video-bytes");
		expect(await fs.readFile(finalSystemAudio, "utf8")).toBe("system-wav");
		expect(await fs.readFile(`${finalSystemAudio}.json`, "utf8")).toBe('{"startDelayMs":5}');
		expect(await fs.readFile(finalMicAudio, "utf8")).toBe("mic-wav");
		expect(await fs.readFile(`${finalMicAudio}.json`, "utf8")).toBe('{"startDelayMs":8}');
		await expect(fs.access(path.join(directory, "session.system.wav"))).rejects.toThrow();
		await expect(fs.access(path.join(directory, "session.mic.wav"))).rejects.toThrow();
	});

	it("clears process and active capture flags after waitForWindowsCaptureStop even if post-exit validation fails", async () => {
		const tempVideo = path.join(directory, "temp.mp4");
		const finalVideo = path.join(directory, "recording.mp4");
		const orphanedMic = path.join(directory, "orphaned.mic.wav");
		await fs.writeFile(tempVideo, "video-bytes");
		await fs.writeFile(orphanedMic, "orphaned-audio");

		state.setWindowsCaptureTempPath(tempVideo);
		state.setWindowsCaptureTargetPath(finalVideo);
		state.setWindowsSystemAudioPath(path.join(directory, "recording.system.wav"));
		state.setWindowsMicAudioPath(path.join(directory, "recording.mic.wav"));
		state.setWindowsOrphanedMicAudioPath(orphanedMic);

		mocks.waitForWindowsCaptureStop.mockResolvedValue(tempVideo);
		mocks.recoverNativeWindowsCaptureOutput.mockResolvedValue(null);
		mocks.validateRecordedVideo.mockRejectedValue(new Error("Invalid video duration"));

		const result = await stopWindowsCapture();

		expect(result).toMatchObject({
			success: false,
			message: "Failed to stop native Windows capture",
		});
		expect(proc.kill).not.toHaveBeenCalled();
		expect(state.windowsCaptureProcess).toBeNull();
		expect(state.windowsNativeCaptureActive).toBe(false);
		expect(state.nativeScreenRecordingActive).toBe(false);
		expect(state.windowsCaptureStopRequested).toBe(false);
		expect(state.windowsCapturePaused).toBe(false);
		expect(state.windowsOrphanedMicAudioPath).toBeNull();
		expect(state.windowsPendingVideoPath).toBeNull();
		expect(state.windowsCaptureTargetPath).toBe(finalVideo);
		expect(state.windowsCaptureTempPath).toBe(tempVideo);
		expect(state.windowsSystemAudioPath).toBe(path.join(directory, "recording.system.wav"));
		await expect(fs.access(orphanedMic)).rejects.toThrow();
	});

	it("clears live capture flags without killing an exited process if moving the output fails", async () => {
		const missingTempVideo = path.join(directory, "missing-temp.mp4");
		const finalVideo = path.join(directory, "recording.mp4");

		state.setWindowsCaptureTempPath(missingTempVideo);
		state.setWindowsCaptureTargetPath(finalVideo);

		mocks.waitForWindowsCaptureStop.mockResolvedValue(missingTempVideo);
		mocks.recoverNativeWindowsCaptureOutput.mockResolvedValue(null);

		const result = await stopWindowsCapture();

		expect(result).toMatchObject({
			success: false,
			message: "Failed to stop native Windows capture",
		});
		expect(proc.kill).not.toHaveBeenCalled();
		expect(state.windowsCaptureProcess).toBeNull();
		expect(state.windowsNativeCaptureActive).toBe(false);
		expect(state.nativeScreenRecordingActive).toBe(false);
		expect(state.windowsCaptureStopRequested).toBe(false);
		expect(state.windowsCapturePaused).toBe(false);
	});
});
