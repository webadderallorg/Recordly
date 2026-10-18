import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	lastNativeCaptureDiagnostics,
	setLastNativeCaptureDiagnostics,
	setNativeCaptureMicrophonePath,
	setNativeCaptureSystemAudioPath,
	setNativeCaptureTargetPath,
} from "../state";
import { discardNativeMacCaptureOutput, recoverNativeMacCaptureOutput } from "./mac";

vi.mock("electron", () => ({
	app: {
		getPath: () => os.tmpdir(),
	},
	BrowserWindow: {
		getAllWindows: () => [],
	},
}));

async function exists(filePath: string) {
	return fs
		.access(filePath)
		.then(() => true)
		.catch(() => false);
}

describe("discardNativeMacCaptureOutput", () => {
	let root: string;

	beforeEach(async () => {
		root = await fs.mkdtemp(path.join(os.tmpdir(), "recordly-mac-discard-"));
		setNativeCaptureTargetPath(null);
		setNativeCaptureSystemAudioPath(null);
		setNativeCaptureMicrophonePath(null);
		setLastNativeCaptureDiagnostics(null);
	});

	afterEach(async () => {
		await fs.rm(root, { recursive: true, force: true });
	});

	it("deletes the interrupted video, its audio sidecars and cursor telemetry", async () => {
		const videoPath = path.join(root, "recording-1.mp4");
		const systemAudioPath = path.join(root, "recording-1.system.m4a");
		const microphonePath = path.join(root, "recording-1.mic.m4a");
		const telemetryPath = `${videoPath}.cursor.json`;
		for (const filePath of [videoPath, systemAudioPath, microphonePath, telemetryPath]) {
			await fs.writeFile(filePath, "data");
		}
		setLastNativeCaptureDiagnostics({
			backend: "mac-screencapturekit",
			phase: "start",
			timestamp: new Date().toISOString(),
			outputPath: videoPath,
			systemAudioPath,
			microphonePath,
		});

		await expect(discardNativeMacCaptureOutput()).resolves.toBe(true);

		for (const filePath of [videoPath, systemAudioPath, microphonePath, telemetryPath]) {
			expect(await exists(filePath)).toBe(false);
		}
	});

	it("forgets the discarded capture so it cannot be recovered afterwards", async () => {
		const videoPath = path.join(root, "recording-1.mp4");
		await fs.writeFile(videoPath, "data");
		setLastNativeCaptureDiagnostics({
			backend: "mac-screencapturekit",
			phase: "start",
			timestamp: new Date().toISOString(),
			outputPath: videoPath,
		});

		await expect(discardNativeMacCaptureOutput()).resolves.toBe(true);

		expect(lastNativeCaptureDiagnostics).toBeNull();
		await expect(recoverNativeMacCaptureOutput()).resolves.toBeNull();
	});

	it("prefers the active capture paths over older diagnostics", async () => {
		const videoPath = path.join(root, "recording-2.mp4");
		const olderVideoPath = path.join(root, "recording-1.mp4");
		await fs.writeFile(videoPath, "data");
		await fs.writeFile(olderVideoPath, "data");
		setNativeCaptureTargetPath(videoPath);
		setLastNativeCaptureDiagnostics({
			backend: "mac-screencapturekit",
			phase: "start",
			timestamp: new Date().toISOString(),
			outputPath: olderVideoPath,
		});

		await expect(discardNativeMacCaptureOutput()).resolves.toBe(true);

		expect(await exists(videoPath)).toBe(false);
		expect(await exists(olderVideoPath)).toBe(true);
	});

	it("ignores diagnostics from another capture backend", async () => {
		const videoPath = path.join(root, "recording-1.mp4");
		await fs.writeFile(videoPath, "data");
		setLastNativeCaptureDiagnostics({
			backend: "windows-wgc",
			phase: "start",
			timestamp: new Date().toISOString(),
			outputPath: videoPath,
		});

		await expect(discardNativeMacCaptureOutput()).resolves.toBe(false);
		expect(await exists(videoPath)).toBe(true);
	});

	it("succeeds when sidecars were never written", async () => {
		const videoPath = path.join(root, "recording-1.mp4");
		await fs.writeFile(videoPath, "data");
		setLastNativeCaptureDiagnostics({
			backend: "mac-screencapturekit",
			phase: "start",
			timestamp: new Date().toISOString(),
			outputPath: videoPath,
			systemAudioPath: path.join(root, "recording-1.system.m4a"),
		});

		await expect(discardNativeMacCaptureOutput()).resolves.toBe(true);
		expect(await exists(videoPath)).toBe(false);
	});
});
