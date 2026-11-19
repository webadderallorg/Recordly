import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as state from "../../state";

const mocks = vi.hoisted(() => ({ validate: vi.fn(), size: vi.fn() }));

vi.mock("electron", () => ({ BrowserWindow: { getAllWindows: () => [] } }));
vi.mock("../../cursor/telemetry", () => ({
	persistPendingCursorTelemetry: vi.fn(),
	snapshotCursorTelemetryForPersistence: vi.fn(),
}));
vi.mock("../../utils", () => ({ moveFileWithOverwrite: vi.fn() }));
vi.mock("../diagnostics", () => ({
	validateRecordedVideo: mocks.validate,
	getFileSizeIfPresent: mocks.size,
	recordNativeCaptureDiagnostics: vi.fn(),
}));
vi.mock("../macCompanionAudio", () => ({ getFinalMacCompanionAudioPath: (file: string) => file }));
import { attachNativeCaptureLifecycle, recoverNativeMacCaptureOutput } from "../mac";
import { stopMacCapture } from "./stopMacCapture";

const platform = Object.getOwnPropertyDescriptor(process, "platform")!;

beforeEach(() => {
	Object.defineProperty(process, "platform", { value: "darwin", configurable: true });
	vi.clearAllMocks();
	vi.spyOn(console, "log").mockImplementation(() => {});
	vi.spyOn(console, "error").mockImplementation(() => {});
	mocks.validate.mockResolvedValue({ fileSizeBytes: 2048, durationSeconds: 1 });
	mocks.size.mockResolvedValue(2048);
	state.setNativeCaptureTargetPath("/recordings/retained.mp4");
	state.setNativeCaptureSystemAudioPath(null);
	state.setNativeCaptureMicrophonePath(null);
	state.setNativeCaptureOutputBuffer("");
	state.setNativeScreenRecordingActive(true);
	state.setNativeCaptureStopRequested(false);
	state.setLastNativeCaptureDiagnostics({
		backend: "mac-screencapturekit",
		phase: "start",
		timestamp: "2026-11-07T00:00:00Z",
		outputPath: "/recordings/retained.mp4",
	});
});
afterEach(() => {
	Object.defineProperty(process, "platform", platform);
	vi.restoreAllMocks();
	state.setNativeCaptureProcess(null);
	state.setNativeScreenRecordingActive(false);
	state.setNativeCaptureTargetPath(null);
	state.setNativeCaptureStopRequested(false);
	state.setLastNativeCaptureDiagnostics(null);
});
it.each([
	"throw",
	"async",
] as const)("keeps a live helper reserved after a %s stop write failure until closed recovery", async (mode) => {
	const child = Object.assign(new EventEmitter(), {
		stdin: new PassThrough(),
		stdout: new PassThrough(),
		killed: false,
		kill: vi.fn(() => true),
	});
	const native = child as unknown as ChildProcessWithoutNullStreams;
	state.setNativeCaptureProcess(native);
	attachNativeCaptureLifecycle(native);
	vi.spyOn(child.stdin, "write").mockImplementation(() => {
		if (mode === "throw") throw new Error("synthetic EPIPE");
		queueMicrotask(() => child.stdin.emit("error", new Error("synthetic EPIPE")));
		return true;
	});
	await expect(stopMacCapture()).resolves.toMatchObject({
		success: false,
		message: "The capture helper has not exited.",
	});
	expect(child.kill).toHaveBeenCalledExactlyOnceWith("SIGTERM");
	expect(state.nativeCaptureProcess).toBe(native);
	expect(state.nativeScreenRecordingActive).toBe(true);
	expect(state.nativeCaptureTargetPath).toBe("/recordings/retained.mp4");
	expect(state.nativeCaptureStopRequested).toBe(false);
	await expect(recoverNativeMacCaptureOutput()).resolves.toBeNull();
	expect(mocks.size).not.toHaveBeenCalled();
	expect(mocks.validate).not.toHaveBeenCalled();
	child.emit("close", 1);
	expect(state.nativeCaptureProcess).toBeNull();
	expect(state.nativeScreenRecordingActive).toBe(false);
	expect(() => child.stdin.emit("error", new Error("late EPIPE"))).not.toThrow();
	await expect(recoverNativeMacCaptureOutput()).resolves.toMatchObject({
		success: true,
		path: "/recordings/retained.mp4",
	});
	expect(mocks.validate).toHaveBeenCalledExactlyOnceWith("/recordings/retained.mp4");
});
