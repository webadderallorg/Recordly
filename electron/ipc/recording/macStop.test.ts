import { ChildProcess } from "node:child_process";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	nativeCaptureProcess,
	nativeCaptureTargetPath,
	nativeScreenRecordingActive,
	setNativeCaptureOutputBuffer,
	setNativeCaptureProcess,
	setNativeCaptureStopRequested,
	setNativeCaptureTargetPath,
	setNativeScreenRecordingActive,
} from "../state";
import { RecordingProcessGuard } from "./processGuard";

vi.mock("electron", () => ({ BrowserWindow: { getAllWindows: () => [] } }));
vi.mock("../cursor/telemetry", () => ({}));
vi.mock("../utils", () => ({}));
vi.mock("./diagnostics", () => ({ validateRecordedVideo: vi.fn() }));
vi.mock("./macCompanionAudio", () => ({}));

import {
	attachNativeCaptureLifecycle,
	NativeCaptureStopTimeoutError,
	recoverNativeMacCaptureOutput,
	waitForNativeCaptureStop,
} from "./mac";
import { validateRecordedVideo } from "./diagnostics";

type CaptureProcess = Parameters<typeof waitForNativeCaptureStop>[0];

function createCaptureProcess() {
	const child = new ChildProcess();
	child.stdin = new PassThrough();
	const kill = vi.spyOn(child, "kill").mockReturnValue(true);
	return { child, kill, process: child as CaptureProcess };
}

const deadlines = { timeoutMs: 100, terminateGraceMs: 20, killGraceMs: 20 };

describe("macOS native stop deadline", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		setNativeCaptureOutputBuffer("");
		setNativeCaptureProcess(null);
		setNativeCaptureTargetPath("/recordings/take.mp4");
		setNativeCaptureStopRequested(true);
		setNativeScreenRecordingActive(true);
	});
	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
		setNativeCaptureProcess(null);
		setNativeCaptureTargetPath(null);
		setNativeScreenRecordingActive(false);
		setNativeCaptureStopRequested(false);
	});

	it("accepts a normal finalized recording and cancels the watchdog", async () => {
		const { child, kill, process } = createCaptureProcess();
		const stopped = waitForNativeCaptureStop(process, deadlines);
		setNativeCaptureOutputBuffer("Recording stopped. Output path: /recordings/take.mp4");
		child.emit("close", 0);
		await expect(stopped).resolves.toBe("/recordings/take.mp4");
		await vi.advanceTimersByTimeAsync(200);
		expect(kill).not.toHaveBeenCalled();
		expect(child.listenerCount("close")).toBe(0);
	});

	it("rejects a failed stop pipe without losing the lifetime error listener", async () => {
		const { child, process } = createCaptureProcess();
		const stopped = waitForNativeCaptureStop(process, deadlines);
		const failure = new Error("synthetic EPIPE");
		child.stdin!.emit("error", failure);
		await expect(stopped).rejects.toBe(failure);
		expect(() => child.stdin!.emit("error", new Error("late pipe error"))).not.toThrow();
		expect(vi.getTimerCount()).toBe(0);
	});

	it("waits for actual close after SIGTERM and never invents successful output", async () => {
		const { child, kill, process } = createCaptureProcess();
		const stopped = waitForNativeCaptureStop(process, deadlines);
		const outcome = stopped.catch((error: unknown) => error);
		await vi.advanceTimersByTimeAsync(100);
		expect(kill).toHaveBeenCalledWith("SIGTERM");
		expect(child.listenerCount("close")).toBe(1);
		setNativeCaptureOutputBuffer("Recording stopped. Output path: /recordings/take.mp4");
		child.emit("close", 0);
		expect(await outcome).toMatchObject({
			name: "NativeCaptureStopTimeoutError",
			captureStillRunning: false,
		});
		expect(vi.getTimerCount()).toBe(0);
	});

	it("escalates to SIGKILL when SIGTERM fails to close the helper", async () => {
		const { child, kill, process } = createCaptureProcess();
		const outcome = waitForNativeCaptureStop(process, deadlines).catch(
			(error: unknown) => error,
		);
		await vi.advanceTimersByTimeAsync(120);
		expect(kill.mock.calls.map(([value]) => value)).toEqual(["SIGTERM", "SIGKILL"]);
		child.emit("close", null, "SIGKILL");
		expect(await outcome).toBeInstanceOf(NativeCaptureStopTimeoutError);
		expect(await outcome).toMatchObject({ captureStillRunning: false });
		expect(vi.getTimerCount()).toBe(0);
	});

	it("keeps a nonclosing child reserved and rejects recovery until its eventual close", async () => {
		const { child, kill, process } = createCaptureProcess();
		const guard = new RecordingProcessGuard();
		guard.track(child);
		setNativeCaptureProcess(process);
		attachNativeCaptureLifecycle(process);
		const outcome = waitForNativeCaptureStop(process, deadlines).catch(
			(error: unknown) => error,
		);
		// Even an error from a failed signal must not short-circuit confirmation.
		kill.mockImplementation(() => {
			child.emit("error", new Error("signal denied"));
			return false;
		});
		await vi.advanceTimersByTimeAsync(140);
		expect(await outcome).toMatchObject({ captureStillRunning: true });
		expect(nativeCaptureProcess).toBe(process);
		expect(nativeCaptureTargetPath).toBe("/recordings/take.mp4");
		expect(nativeScreenRecordingActive).toBe(true);
		expect(await recoverNativeMacCaptureOutput()).toBeNull();
		expect(validateRecordedVideo).not.toHaveBeenCalled();
		const start = guard.wrap(async () => ({ success: true }));
		expect(await start()).toMatchObject({ success: false });
		// The IPC catch marks this as an interruption so the existing lifecycle
		// performs its normal cleanup when a late close eventually arrives.
		setNativeCaptureStopRequested(false);
		child.emit("close", null, "SIGKILL");
		expect(nativeCaptureProcess).toBeNull();
		expect(nativeScreenRecordingActive).toBe(false);
		expect(await start()).toEqual({ success: true });
		expect(vi.getTimerCount()).toBe(0);
	});
});
