import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	setNativeScreenRecordingActive,
	nativeScreenRecordingActive,
	windowsCaptureTargetPath,
	setWindowsPendingVideoPath,
	setWindowsCaptureOutputBuffer,
	setWindowsCaptureProcess,
	setWindowsCaptureStopRequested,
	setWindowsCaptureTargetPath,
	setWindowsMicAudioPath,
	setWindowsNativeCaptureActive,
	setWindowsSystemAudioPath,
	windowsPendingVideoPath,
} from "../state";

const { send, validate } = vi.hoisted(() => ({ send: vi.fn(), validate: vi.fn() }));
vi.mock("electron", () => ({
	app: { getPath: () => os.tmpdir() },
	BrowserWindow: { getAllWindows: () => [{ isDestroyed: () => false, webContents: { send } }] },
}));
vi.mock("./diagnostics", () => ({ validateRecordedVideo: validate }));
import { attachWindowsCaptureLifecycle, recoverNativeWindowsCaptureOutput } from "./windows";
import { WindowsRecordingFinalizer } from "./windowsFinalizer";
import { RecordingOwnerRecovery } from "./ownerRecovery";

describe("Windows interrupted recording recovery", () => {
	let directory: string;
	let capturedPath: string;
	let finalPath: string;
	beforeEach(async () => {
		directory = await fs.mkdtemp(path.join(os.tmpdir(), "recordly-win-recovery-"));
		capturedPath = path.join(directory, "temporary.mp4");
		finalPath = path.join(directory, "recording.mp4");
		await fs.writeFile(capturedPath, "finalized video fixture");
		validate.mockReset().mockResolvedValue({ fileSizeBytes: 4000, durationSeconds: 2 });
		send.mockClear();
		setWindowsPendingVideoPath(null);
		setWindowsNativeCaptureActive(false);
		setWindowsCaptureProcess(null);
		setWindowsCaptureStopRequested(false);
		setWindowsCaptureTargetPath(finalPath);
		setWindowsSystemAudioPath(null);
		setWindowsMicAudioPath(null);
		setWindowsCaptureOutputBuffer(
			`CAPTURE_INTERRUPTED: WGC capture session failed during recording\nRecording interrupted. Output path: ${capturedPath}\n`,
		);
	});
	afterEach(async () => {
		await fs.rm(directory, { recursive: true, force: true });
	});

	it("publishes finalized partial video and both WAV tracks with timing metadata", async () => {
		for (const kind of ["system", "mic"]) {
			await fs.writeFile(path.join(directory, `temporary.${kind}.wav`), `${kind} audio`);
			await fs.writeFile(
				path.join(directory, `temporary.${kind}.wav.json`),
				'{"startDelayMs":12}',
			);
		}
		setWindowsSystemAudioPath(path.join(directory, "recording.system.wav"));
		setWindowsMicAudioPath(path.join(directory, "recording.mic.wav"));
		await expect(recoverNativeWindowsCaptureOutput()).resolves.toEqual({
			success: true,
			path: finalPath,
			error: "Recording interrupted: WGC capture session failed during recording. A partial recording was saved.",
		});
		expect(validate).toHaveBeenCalledWith(capturedPath);
		expect(windowsPendingVideoPath).toBe(finalPath);
		expect(await fs.readFile(finalPath, "utf8")).toBe("finalized video fixture");
		for (const kind of ["system", "mic"]) {
			expect(await fs.readFile(path.join(directory, `recording.${kind}.wav`), "utf8")).toBe(
				`${kind} audio`,
			);
			expect(
				JSON.parse(
					await fs.readFile(path.join(directory, `recording.${kind}.wav.json`), "utf8"),
				),
			).toEqual({ startDelayMs: 12 });
		}
	});

	it("keeps invalid output on disk without reporting successful recovery", async () => {
		validate.mockRejectedValueOnce(new Error("no decodable video stream"));
		await expect(recoverNativeWindowsCaptureOutput()).resolves.toBeNull();
		expect(await fs.readFile(capturedPath, "utf8")).toBe("finalized video fixture");
		await expect(fs.access(finalPath)).rejects.toThrow();
	});

	it("does not read active or unfinalized encoder output", async () => {
		setWindowsNativeCaptureActive(true);
		await expect(recoverNativeWindowsCaptureOutput()).resolves.toBeNull();
		setWindowsNativeCaptureActive(false);
		setWindowsCaptureOutputBuffer(
			"CAPTURE_INTERRUPTED: writer failed\nERROR: Failed to finalize Media Foundation encoder",
		);
		await expect(recoverNativeWindowsCaptureOutput()).resolves.toBeNull();
		expect(validate).not.toHaveBeenCalled();
	});

	it("does not move audio or clear state if another session replaced a deferred recovery", async () => {
		let release!: () => void;
		validate.mockImplementationOnce(
			() =>
				new Promise<void>((resolve) => {
					release = resolve;
				}),
		);
		const oldAudio = path.join(directory, "temporary.system.wav");
		await fs.writeFile(oldAudio, "old audio");
		setWindowsSystemAudioPath(path.join(directory, "recording.system.wav"));
		const recovering = recoverNativeWindowsCaptureOutput();
		const newVideo = path.join(directory, "new.mp4");
		const newAudio = path.join(directory, "new.system.wav");
		await fs.writeFile(newAudio, "new audio");
		setWindowsCaptureTargetPath(newVideo);
		setWindowsSystemAudioPath(newAudio);
		setWindowsNativeCaptureActive(true);
		setNativeScreenRecordingActive(true);
		release();
		await expect(recovering).resolves.toBeNull();
		expect(await fs.readFile(newAudio, "utf8")).toBe("new audio");
		expect(await fs.readFile(oldAudio, "utf8")).toBe("old audio");
		expect(windowsCaptureTargetPath).toBe(newVideo);
		expect(nativeScreenRecordingActive).toBe(true);
	});

	it("reserves on unexpected close, joins recovery through mux, and then admits the next capture", async () => {
		let releaseValidation!: () => void;
		validate.mockImplementationOnce(
			() =>
				new Promise<void>((resolve) => {
					releaseValidation = resolve;
				}),
		);
		let releaseMux!: () => void;
		const muxGate = new Promise<void>((resolve) => {
			releaseMux = resolve;
		});
		const performMux = vi.fn(async () => {
			const video = windowsPendingVideoPath;
			setWindowsPendingVideoPath(null);
			await muxGate;
			return { success: true, path: video ?? undefined };
		});
		const finalizer = new WindowsRecordingFinalizer(
			() => Boolean(windowsPendingVideoPath),
			performMux,
		);
		const owner = Object.assign(new EventEmitter(), { id: 1 }) as unknown as Pick<
			Electron.WebContents,
			"id" | "on" | "removeListener"
		>;
		const ownership = new RecordingOwnerRecovery({
			stop: async () => ({ success: false }),
			needsFinish: () => finalizer.needsFinish,
			finish: () => finalizer.run(),
			discard: async () => {},
			reset: () => {},
			report: async () => {},
		});
		await ownership.start(owner, async () => ({ success: true }));
		const child = new EventEmitter();
		let recovery!: ReturnType<typeof finalizer.recover>;
		setWindowsNativeCaptureActive(true);
		attachWindowsCaptureLifecycle(
			child as Parameters<typeof attachWindowsCaptureLifecycle>[0],
			() => {
				recovery = finalizer.recover(recoverNativeWindowsCaptureOutput);
			},
		);
		child.once("close", () => {
			expect(finalizer.needsFinish).toBe(true);
			ownership.captureExited();
		});
		child.emit("close", 1);
		const newStart = vi.fn(async () => ({ success: true }));
		expect((await ownership.start(owner, newStart)).success).toBe(false);
		expect(finalizer.recover(recoverNativeWindowsCaptureOutput)).toBe(recovery);
		releaseValidation();
		for (let i = 0; i < 100 && performMux.mock.calls.length === 0; i++)
			await new Promise((resolve) => setTimeout(resolve, 1));
		expect(performMux).toHaveBeenCalledOnce();
		expect(windowsPendingVideoPath).toBeNull();
		expect((await ownership.start(owner, newStart)).success).toBe(false);
		releaseMux();
		await expect(recovery).resolves.toMatchObject({
			success: true,
			path: finalPath,
			error: expect.stringContaining("partial recording was saved"),
		});
		expect(finalizer.needsFinish).toBe(false);
		expect((await ownership.start(owner, newStart)).success).toBe(true);
		expect(newStart).toHaveBeenCalledOnce();
	});

	it("does not clear or recover a replacement session when an older child closes", () => {
		const previous = new EventEmitter();
		const replacement = new EventEmitter();
		const interrupted = vi.fn();
		setNativeScreenRecordingActive(true);
		setWindowsNativeCaptureActive(true);
		setWindowsCaptureProcess(replacement as unknown as Parameters<typeof setWindowsCaptureProcess>[0]);
		attachWindowsCaptureLifecycle(previous as unknown as Parameters<typeof attachWindowsCaptureLifecycle>[0], interrupted);
		previous.emit("close", 1);
		expect(interrupted).not.toHaveBeenCalled();
		expect(nativeScreenRecordingActive).toBe(true);
		expect(windowsCaptureTargetPath).toBe(finalPath);
	});

	it("surfaces the actual interruption to the renderer when capture exits", () => {
		const child = new EventEmitter();
		setWindowsNativeCaptureActive(true);
		attachWindowsCaptureLifecycle(child as Parameters<typeof attachWindowsCaptureLifecycle>[0]);
		child.emit("close", 1);
		expect(send).toHaveBeenCalledWith("recording-interrupted", {
			reason: "capture-stopped",
			message: "WGC capture session failed during recording",
		});
	});
});
