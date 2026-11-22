import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setWindowsCaptureOutputBuffer, setWindowsCaptureTargetPath } from "../state";
import { waitForWindowsCaptureStart, waitForWindowsCaptureStop } from "./windows";

const windowsCaptureSource = readFileSync(
	fileURLToPath(new URL("../../native/wgc-capture/src/wgc_session.cpp", import.meta.url)),
	"utf8",
);

vi.mock("electron", () => ({
	app: {
		getPath: () => "C:\\RecordlyTest",
	},
	BrowserWindow: {
		getAllWindows: () => [],
	},
}));

class FakeCaptureProcess extends EventEmitter {
	stdout = new PassThrough();
	stderr = new PassThrough();
	stdin = new PassThrough();
	killed = false;

	kill = vi.fn(() => {
		this.killed = true;
		return true;
	});
}

describe("waitForWindowsCaptureStart", () => {
	it("reads the encoded dimensions before the split start marker", async () => {
		const proc = new FakeCaptureProcess();
		const started = waitForWindowsCaptureStart(
			proc as unknown as Parameters<typeof waitForWindowsCaptureStart>[0],
		);
		proc.stdout.write("CAPTURE_SIZE:764x");
		proc.stdout.write("562\r\nRecording star");
		proc.stdout.write("ted\r\n");
		await expect(started).resolves.toEqual({
			captureSize: { width: 764, height: 562 },
			systemAudioCaptureUnavailable: false,
		});
	});

	it("accepts legacy start events without dimensions", async () => {
		const proc = new FakeCaptureProcess();
		const started = waitForWindowsCaptureStart(
			proc as unknown as Parameters<typeof waitForWindowsCaptureStart>[0],
		);
		proc.stdout.write("Recording started\r\n");
		await expect(started).resolves.toEqual({
			captureSize: null,
			systemAudioCaptureUnavailable: false,
		});
	});

	it("reports a split system audio marker from stdout before recording starts", async () => {
		const proc = new FakeCaptureProcess();
		const started = waitForWindowsCaptureStart(
			proc as unknown as Parameters<typeof waitForWindowsCaptureStart>[0],
		);
		proc.stdout.write("SYSTEM_AUDIO_CAPTURE_UN");
		proc.stderr.write("WASAPI did not start\r\n");
		proc.stdout.write("AVAILABLE\r\nRecording started\r\n");
		await expect(started).resolves.toEqual({
			captureSize: null,
			systemAudioCaptureUnavailable: true,
		});
	});
});

describe("waitForWindowsCaptureStop", () => {
	beforeEach(() => {
		setWindowsCaptureOutputBuffer("");
		setWindowsCaptureTargetPath(null);
	});

	it("resolves the helper output path when the process closes cleanly", async () => {
		const proc = new FakeCaptureProcess();
		setWindowsCaptureOutputBuffer("Recording stopped. Output path: C:\\Recordly\\capture.mp4");

		const stopped = waitForWindowsCaptureStop(
			proc as unknown as Parameters<typeof waitForWindowsCaptureStop>[0],
			1000,
		);
		proc.emit("close", 0);

		await expect(stopped).resolves.toBe("C:\\Recordly\\capture.mp4");
		expect(proc.kill).not.toHaveBeenCalled();
	});

	it("accepts a finalized interrupted take even though the helper exits with an error", async () => {
		const proc = new FakeCaptureProcess();
		setWindowsCaptureOutputBuffer(
			"CAPTURE_INTERRUPTED: WGC source failed\nRecording interrupted. Output path: C:\\Recordly\\capture.mp4\n",
		);
		const stopped = waitForWindowsCaptureStop(
			proc as unknown as Parameters<typeof waitForWindowsCaptureStop>[0],
			1000,
		);
		proc.emit("close", 1);
		await expect(stopped).resolves.toBe("C:\\Recordly\\capture.mp4");
	});

	it("resolves the fallback target path when the helper closes cleanly without output path", async () => {
		const proc = new FakeCaptureProcess();
		setWindowsCaptureOutputBuffer("Recording stopped without output path");
		setWindowsCaptureTargetPath("C:\\Recordly\\fallback.mp4");

		const stopped = waitForWindowsCaptureStop(
			proc as unknown as Parameters<typeof waitForWindowsCaptureStop>[0],
			1000,
		);
		proc.emit("close", 0);

		await expect(stopped).resolves.toBe("C:\\Recordly\\fallback.mp4");
		expect(proc.kill).not.toHaveBeenCalled();
	});

	it("rejects with helper output when the helper exits with a non-zero code", async () => {
		const proc = new FakeCaptureProcess();
		setWindowsCaptureOutputBuffer("Encoder error: insufficient memory");

		const stopped = waitForWindowsCaptureStop(
			proc as unknown as Parameters<typeof waitForWindowsCaptureStop>[0],
			1000,
		);
		proc.emit("close", 1);

		await expect(stopped).rejects.toThrow("Encoder error: insufficient memory");
		expect(proc.kill).not.toHaveBeenCalled();
	});

	it("rejects when the helper emits an error", async () => {
		const proc = new FakeCaptureProcess();
		const error = new Error("spawn failed");

		const stopped = waitForWindowsCaptureStop(
			proc as unknown as Parameters<typeof waitForWindowsCaptureStop>[0],
			1000,
		);
		proc.emit("error", error);

		await expect(stopped).rejects.toBe(error);
		expect(proc.kill).not.toHaveBeenCalled();
	});

	it("kills the helper and rejects when stop never completes", async () => {
		const proc = new FakeCaptureProcess();

		await expect(
			waitForWindowsCaptureStop(
				proc as unknown as Parameters<typeof waitForWindowsCaptureStop>[0],
				5,
			),
		).rejects.toThrow("Timed out waiting for native Windows capture to stop");
		expect(proc.kill).toHaveBeenCalledTimes(1);
	});
});

describe("native Windows window capture", () => {
	it("uses a capture item for the selected window", () => {
		expect(windowsCaptureSource).toContain("interop->CreateForWindow(");
		expect(windowsCaptureSource).not.toContain("MonitorFromWindow(");
	});

	it("recreates the frame pool for the captured window size", () => {
		expect(windowsCaptureSource).toContain("recreateFramePoolIfNeeded(contentSize)");
		expect(windowsCaptureSource).toContain(
			"frameCallback_(texture.Get(), contentSize.Width, contentSize.Height, frameTimeHns)",
		);
	});
});
