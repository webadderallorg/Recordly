import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	setNativeCaptureOutputBuffer,
	setNativeCaptureStopRequested,
	setNativeScreenRecordingActive,
} from "../state";
const send = vi.hoisted(() => vi.fn());
vi.mock("electron", () => ({
	BrowserWindow: { getAllWindows: () => [{ isDestroyed: () => false, webContents: { send } }] },
}));
vi.mock("../cursor/telemetry", () => ({}));
vi.mock("../utils", () => ({}));
vi.mock("./diagnostics", () => ({}));
vi.mock("./macCompanionAudio", () => ({}));
import { attachNativeCaptureLifecycle, waitForNativeCaptureStop } from "./mac";
describe("native partial capture error propagation", () => {
	beforeEach(() => {
		send.mockClear();
		setNativeScreenRecordingActive(true);
		setNativeCaptureStopRequested(false);
		setNativeCaptureOutputBuffer("");
	});
	it("reports a finalized partial capture with the actual failure", () => {
		const child = Object.assign(new EventEmitter(), { stdin: new PassThrough() });
		attachNativeCaptureLifecycle(child as Parameters<typeof attachNativeCaptureLifecycle>[0]);
		setNativeCaptureOutputBuffer(
			"CAPTURE_INTERRUPTED: Screen sharing was revoked\nRecording interrupted. Output path: /take.mp4",
		);
		child.emit("close", 1);
		expect(send).toHaveBeenCalledWith("recording-interrupted", {
			reason: "capture-stopped",
			message: "Screen sharing was revoked",
		});
	});
	it("never treats an interrupted helper as successful even when a normal marker also appears", async () => {
		const child = Object.assign(new EventEmitter(), { stdin: new PassThrough() });
		const stopped = waitForNativeCaptureStop(
			child as Parameters<typeof waitForNativeCaptureStop>[0],
		);
		setNativeCaptureOutputBuffer(
			"CAPTURE_INTERRUPTED: Audio writer failed\nRecording stopped. Output path: /take.mp4",
		);
		child.emit("close", 0);
		await expect(stopped).rejects.toThrow("Audio writer failed");
	});
});
