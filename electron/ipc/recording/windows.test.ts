import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setWindowsCaptureOutputBuffer, setWindowsCaptureTargetPath } from "../state";
import { muxNativeWindowsVideoWithAudio, waitForWindowsCaptureStop } from "./windows";

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
	it("crops monitor frames to the selected window bounds", () => {
		expect(windowsCaptureSource).not.toContain("CreateForWindow(");
		expect(windowsCaptureSource).toContain("DwmGetWindowAttribute(");
		expect(windowsCaptureSource).toContain("CopySubresourceRegion(cropTexture_");
	});

	it("maps desktop bounds into WGC texture coordinates and keeps the encoder size fixed", () => {
		expect(windowsCaptureSource).toContain("normalized * framePoolWidth_");
		expect(windowsCaptureSource).toContain(
			"d3dDevice_->CreateTexture2D(&desc, nullptr, &resizedTexture)",
		);
		expect(windowsCaptureSource).not.toContain("nextWidth != captureWidth_");
	});

	it("does not expose desktop pixels when the selected window shrinks", () => {
		expect(windowsCaptureSource).toContain("(std::min)(mappedWidth");
		expect(windowsCaptureSource).toContain("ClearRenderTargetView");
	});
});

describe("muxNativeWindowsVideoWithAudio", () => {
	function createTestWavBuffer(sampleRate = 48000, channels = 2, dataFrames = 100): Buffer {
		const blockAlign = channels * 2;
		const dataBytes = dataFrames * blockAlign;
		const buf = Buffer.alloc(44 + dataBytes);
		buf.write("RIFF", 0);
		buf.writeUInt32LE(36 + dataBytes, 4);
		buf.write("WAVE", 8);
		buf.write("fmt ", 12);
		buf.writeUInt32LE(16, 16);
		buf.writeUInt16LE(1, 20); // PCM
		buf.writeUInt16LE(channels, 22);
		buf.writeUInt32LE(sampleRate, 24);
		buf.writeUInt32LE(sampleRate * blockAlign, 28);
		buf.writeUInt16LE(blockAlign, 32);
		buf.writeUInt16LE(16, 34);
		buf.write("data", 36);
		buf.writeUInt32LE(dataBytes, 40);
		return buf;
	}

	it("pre-pads silence to WAV companion files matching startDelayMs and resets startDelayMs to 0", async () => {
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "recordly-test-mux-"));
		try {
			const videoPath = path.join(tempDir, "rec.mp4");
			const systemPath = path.join(tempDir, "rec.system.wav");
			const jsonPath = path.join(tempDir, "rec.system.wav.json");

			await fs.writeFile(videoPath, Buffer.alloc(100));
			await fs.writeFile(systemPath, createTestWavBuffer(48000, 2, 480)); // 10ms of audio (480 frames = 1920 bytes)
			await fs.writeFile(
				jsonPath,
				JSON.stringify({
					startDelayMs: 1000, // 1 second delay = 48000 frames = 192000 bytes
					capturedDurationMs: 10,
					dataBytes: 1920,
					sampleRate: 48000,
					channels: 2,
				}),
			);

			const result = await muxNativeWindowsVideoWithAudio(videoPath, systemPath, null);
			expect(result.audio.system).toBeDefined();
			expect(result.audio.system?.startDelayMs).toBe(0);

			const updatedJson = JSON.parse(await fs.readFile(jsonPath, "utf8"));
			expect(updatedJson.startDelayMs).toBe(0);
			expect(updatedJson.capturedDurationMs).toBe(1010);
			expect(updatedJson.dataBytes).toBe(1920 + 192000);

			const updatedWav = await fs.readFile(systemPath);
			expect(updatedWav.length).toBe(44 + 1920 + 192000);
		} finally {
			await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
		}
	});
});
