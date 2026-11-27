import type { ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	binaryPath: "",
	recordingsDir: "",
	rememberApprovedLocalReadPath: vi.fn(),
	setCurrentProjectPath: vi.fn(),
	setCurrentVideoPath: vi.fn(),
	validateRecordedVideo: vi.fn(),
	getFileSizeIfPresent: vi.fn(),
	recordNativeCaptureDiagnostics: vi.fn(),
	discardRecordingFiles: vi.fn(),
}));

vi.mock("../paths/binaries", () => ({
	getLinuxPortalCaptureBinaryPath: () => mocks.binaryPath,
}));
vi.mock("../project/manager", () => ({
	rememberApprovedLocalReadPath: mocks.rememberApprovedLocalReadPath,
}));
vi.mock("../state", () => ({
	setCurrentProjectPath: mocks.setCurrentProjectPath,
	setCurrentVideoPath: mocks.setCurrentVideoPath,
}));
vi.mock("../utils", () => ({
	getRecordingsDir: async () => mocks.recordingsDir,
}));
vi.mock("./diagnostics", () => ({
	validateRecordedVideo: mocks.validateRecordedVideo,
	getFileSizeIfPresent: mocks.getFileSizeIfPresent,
	recordNativeCaptureDiagnostics: mocks.recordNativeCaptureDiagnostics,
}));
vi.mock("./discardFiles", () => ({
	discardRecordingFiles: mocks.discardRecordingFiles,
}));

import {
	captureLinuxPortalZoomMarker,
	isLinuxPortalCaptureActive,
	isLinuxPortalCaptureEnabled,
	killLinuxPortalCaptureProcess,
	LinuxPortalSelectionCancelled,
	parsePortalProbeOutput,
	pauseLinuxPortalCapture,
	probeLinuxPortalCapture,
	resumeLinuxPortalCapture,
	startLinuxPortalCapture,
	stopLinuxPortalCapture,
} from "./linuxPortal";

const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform")!;
const unix = it.skipIf(process.platform === "win32");
const originalSessionType = process.env.XDG_SESSION_TYPE;
const originalWaylandDisplay = process.env.WAYLAND_DISPLAY;
const originalDisableFlag = process.env.RECORDLY_LINUX_PORTAL_CURSOR;

let tempDir: string;

async function writeFakeHelper(scriptBody: string) {
	const helperPath = path.join(tempDir, "fake-portal-cursor");
	await fs.writeFile(helperPath, `#!/usr/bin/env node\n${scriptBody}\n`, { mode: 0o755 });
	mocks.binaryPath = helperPath;
	return helperPath;
}

describe("linuxPortal capture backend", () => {
	beforeEach(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "recordly-linux-portal-"));
		mocks.recordingsDir = path.join(tempDir, "recordings");
		mocks.binaryPath = path.join(tempDir, "missing-helper");
		vi.clearAllMocks();
		mocks.validateRecordedVideo.mockResolvedValue({ fileSizeBytes: 4096, durationSeconds: 2 });
		mocks.getFileSizeIfPresent.mockResolvedValue(4096);
		mocks.discardRecordingFiles.mockResolvedValue(undefined);
		Object.defineProperty(process, "platform", { value: "linux", configurable: true });
		process.env.XDG_SESSION_TYPE = "wayland";
		delete process.env.RECORDLY_LINUX_PORTAL_CURSOR;
	});

	afterEach(async () => {
		killLinuxPortalCaptureProcess();
		Object.defineProperty(process, "platform", originalPlatform);
		if (originalSessionType === undefined) delete process.env.XDG_SESSION_TYPE;
		else process.env.XDG_SESSION_TYPE = originalSessionType;
		if (originalWaylandDisplay === undefined) delete process.env.WAYLAND_DISPLAY;
		else process.env.WAYLAND_DISPLAY = originalWaylandDisplay;
		if (originalDisableFlag === undefined) delete process.env.RECORDLY_LINUX_PORTAL_CURSOR;
		else process.env.RECORDLY_LINUX_PORTAL_CURSOR = originalDisableFlag;
		await fs.rm(tempDir, { recursive: true, force: true });
	});

	it("enables portal capture only on Linux Wayland sessions unless opted out", () => {
		expect(isLinuxPortalCaptureEnabled({ XDG_SESSION_TYPE: "wayland" }, "linux")).toBe(true);
		expect(isLinuxPortalCaptureEnabled({ WAYLAND_DISPLAY: "wayland-0" }, "linux")).toBe(true);
		expect(isLinuxPortalCaptureEnabled({ XDG_SESSION_TYPE: "x11" }, "linux")).toBe(false);
		expect(
			isLinuxPortalCaptureEnabled(
				{ XDG_SESSION_TYPE: "wayland", RECORDLY_LINUX_PORTAL_CURSOR: "0" },
				"linux",
			),
		).toBe(false);
		expect(isLinuxPortalCaptureEnabled({ XDG_SESSION_TYPE: "wayland" }, "darwin")).toBe(false);
		expect(isLinuxPortalCaptureEnabled({ XDG_SESSION_TYPE: "wayland" }, "win32")).toBe(false);
	});

	it("parses probe capability output cleanly", () => {
		expect(
			parsePortalProbeOutput("CAPABILITY:cursor-modes=7 metadata=1 protocol=3\n", 0),
		).toEqual({
			available: true,
			cursorModes: 7,
			message: undefined,
		});
		expect(
			parsePortalProbeOutput(
				"CAPABILITY:cursor-modes=3 metadata=0 protocol=3\n",
				3,
				"no meta",
			),
		).toEqual({
			available: false,
			cursorModes: 3,
			message: "no meta",
		});
		expect(
			parsePortalProbeOutput("CAPABILITY:cursor-modes=7 metadata=1 protocol=2\n", 0),
		).toMatchObject({ available: false });
		expect(parsePortalProbeOutput("unexpected", 1)).toEqual({
			available: false,
			cursorModes: undefined,
			message: undefined,
		});
	});

	unix("probes helper capability and handles missing binaries", async () => {
		await expect(probeLinuxPortalCapture()).resolves.toMatchObject({ available: false });
		await writeFakeHelper(`console.log("CAPABILITY:cursor-modes=7 metadata=1 protocol=3");`);
		await expect(probeLinuxPortalCapture()).resolves.toEqual({
			available: true,
			cursorModes: 7,
			message: undefined,
		});
	});

	unix("runs start, pause, resume, and stop lifecycle against the helper protocol", async () => {
		await writeFakeHelper(`
const fs = require("node:fs");
const readline = require("node:readline");
const args = process.argv.slice(2);
const videoIdx = args.indexOf("--record-video");
const videoPath = args[videoIdx + 1];
fs.writeFileSync(videoPath, "webm-bytes");
console.log("STREAM:node=42:id=-:source=Monitor:size=1920x1080:position=0,0:space=StreamLocal");
console.log("VIDEO_START:1700000000000");
console.log("READY");
const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
	if (line === "pause") console.log("PAUSED");
	else if (line === "resume") console.log("RESUMED");
	else if (line === "stop") {
		console.log("VIDEO_DONE:" + videoPath);
		process.exit(0);
	}
});
process.on("SIGINT", () => process.exit(0));
`);

		const outputPath = await startLinuxPortalCapture({ systemAudio: false });
		expect(outputPath).toMatch(/recording-\d+\.webm$/);
		expect(isLinuxPortalCaptureActive()).toBe(true);

		await expect(pauseLinuxPortalCapture()).resolves.toEqual({ success: true });
		await expect(resumeLinuxPortalCapture()).resolves.toEqual({ success: true });

		const stopResult = await stopLinuxPortalCapture();
		expect(stopResult).toEqual({
			success: true,
			path: outputPath,
			message: "Linux portal capture complete",
		});
		expect(isLinuxPortalCaptureActive()).toBe(false);
		expect(mocks.validateRecordedVideo).toHaveBeenCalledWith(outputPath);
		expect(mocks.rememberApprovedLocalReadPath).toHaveBeenCalledWith(outputPath);
		expect(mocks.setCurrentVideoPath).toHaveBeenCalledWith(outputPath);
		expect(mocks.setCurrentProjectPath).toHaveBeenCalledWith(null);
	});

	unix("rejects a helper that fails after portal selection but before readiness", async () => {
		await writeFakeHelper(`
console.log("STREAM:node=42");
console.error("ERROR:could not start encoder");
process.exitCode = 1;
`);
		const onUnexpectedExit = vi.fn();
		await expect(
			startLinuxPortalCapture({ systemAudio: false, onUnexpectedExit }),
		).rejects.toThrow("could not start encoder");
		expect(onUnexpectedExit).not.toHaveBeenCalled();
		expect(isLinuxPortalCaptureActive()).toBe(false);
	});

	unix.each([
		{
			label: "header only",
			dataSize: 0,
			writtenSize: 0,
			error: "without the requested system audio",
		},
		{
			label: "truncated",
			dataSize: 16,
			writtenSize: 8,
			error: "without the requested system audio",
		},
		{
			label: "valid but interrupted",
			dataSize: 8,
			writtenSize: 8,
			error: "incomplete system audio",
		},
	])(
		"reports $label system audio while keeping the video",
		async ({ dataSize, writtenSize, error }) => {
			await writeFakeHelper(`
const fs = require("node:fs");
const readline = require("node:readline");
const video = process.argv[process.argv.indexOf("--record-video") + 1];
const wav = Buffer.alloc(44 + ${writtenSize});
wav.write("RIFF");
wav.writeUInt32LE(36 + ${dataSize}, 4);
wav.write("WAVE", 8);
wav.writeUInt16LE(4, 32);
wav.write("data", 36);
wav.writeUInt32LE(${dataSize}, 40);
fs.writeFileSync(video.replace(/\\.webm$/, ".system.wav"), wav);
console.log("READY");
readline.createInterface({input: process.stdin}).on("line", line => {
	if (line === "stop") {
		console.error("ERROR:system audio capture failed");
		process.exitCode = 0;
		process.stdin.destroy();
	}
});
`);
			const video = await startLinuxPortalCapture({ systemAudio: true });
			const audio = video.replace(/\.webm$/, ".system.wav");
			await expect(stopLinuxPortalCapture()).resolves.toMatchObject({
				success: true,
				path: video,
				error: expect.stringContaining(error),
			});
			expect(mocks.recordNativeCaptureDiagnostics).toHaveBeenLastCalledWith(
				expect.objectContaining({
					processOutput: expect.stringContaining("system audio capture failed"),
				}),
			);
			if (writtenSize > 0 && writtenSize === dataSize) {
				expect(mocks.rememberApprovedLocalReadPath).toHaveBeenCalledWith(audio);
			} else {
				expect(mocks.rememberApprovedLocalReadPath).not.toHaveBeenCalledWith(audio);
				await expect(fs.access(audio)).rejects.toMatchObject({ code: "ENOENT" });
			}
		},
	);

	unix("uses a distinct status for cancellation by the portal", async () => {
		await writeFakeHelper("process.exitCode = 4;");
		await expect(startLinuxPortalCapture({ systemAudio: false })).rejects.toBeInstanceOf(
			LinuxPortalSelectionCancelled,
		);
	});

	unix("keeps the output available for recovery when the helper dies after startup", async () => {
		await writeFakeHelper(`
console.log("STREAM:node=42:id=-:source=Monitor:size=1920x1080:position=0,0:space=StreamLocal");
console.log("VIDEO_START:1700000000000");
console.log("READY");
setTimeout(() => process.exit(2), 50);
`);
		let resolveExited!: () => void;
		const exited = new Promise<void>((resolve) => {
			resolveExited = resolve;
		});

		await startLinuxPortalCapture({
			systemAudio: false,
			onUnexpectedExit: () => resolveExited(),
		});
		await exited;
		expect(isLinuxPortalCaptureActive()).toBe(true);
		await expect(stopLinuxPortalCapture()).resolves.toMatchObject({
			success: true,
			path: expect.stringMatching(/\.webm$/),
			error: expect.stringContaining("ended unexpectedly"),
		});
		expect(isLinuxPortalCaptureActive()).toBe(false);
	});

	unix("retains the recording when validation fails and recovers it on retry", async () => {
		await writeFakeHelper(`
console.log("READY");
console.log("VIDEO_START:1700000000000");
const rl = require("node:readline").createInterface({ input: process.stdin });
rl.on("line", line => {
	if (line === "stop") process.exit(0);
});
`);
		mocks.validateRecordedVideo.mockRejectedValueOnce(new Error("FFmpeg could not start"));
		const videoPath = await startLinuxPortalCapture({ systemAudio: false });

		await expect(stopLinuxPortalCapture()).rejects.toThrow("FFmpeg could not start");
		expect(isLinuxPortalCaptureActive()).toBe(true);
		await expect(stopLinuxPortalCapture()).resolves.toMatchObject({
			success: true,
			path: videoPath,
		});
		expect(mocks.validateRecordedVideo).toHaveBeenNthCalledWith(1, videoPath);
		expect(mocks.validateRecordedVideo).toHaveBeenNthCalledWith(2, videoPath);
		expect(isLinuxPortalCaptureActive()).toBe(false);
	});

	unix(
		"discards empty stub files when stopped while paused before first video frame",
		async () => {
			await writeFakeHelper(`
const readline = require("node:readline");
console.log("STREAM:node=42:id=-:source=Monitor:size=1920x1080:position=0,0:space=StreamLocal");
if (!process.argv.includes("--start-paused")) process.exit(2);
console.log("READY");
const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
	if (line === "pause") console.log("PAUSED");
	else if (line === "stop") process.exit(0);
});
`);
			mocks.getFileSizeIfPresent.mockResolvedValueOnce(0);
			const trackProcess = vi.fn();

			const outputPath = await startLinuxPortalCapture({
				systemAudio: false,
				startPaused: true,
				trackProcess,
			});
			expect(trackProcess).toHaveBeenCalledOnce();

			await expect(stopLinuxPortalCapture()).resolves.toEqual({
				success: true,
				message: "Linux portal capture cancelled before recording started",
			});
			expect(mocks.discardRecordingFiles).toHaveBeenCalledWith(outputPath);
			expect(mocks.validateRecordedVideo).not.toHaveBeenCalled();
		},
	);

	unix("waits for the first video frame when resuming after countdown", async () => {
		await writeFakeHelper(`
console.log("READY");
const rl = require("node:readline").createInterface({ input: process.stdin });
rl.on("line", line => {
	if (line === "resume") {
		console.log("RESUMED");
		setTimeout(() => console.log("VIDEO_START:1700000000000"), 30);
	} else if (line === "stop") process.exit(0);
});
`);
		let firstVideoFrame = false;
		await startLinuxPortalCapture({
			systemAudio: false,
			startPaused: true,
			trackProcess: (child) =>
				child.stdout.on("data", (chunk: Buffer) => {
					if (chunk.toString().includes("VIDEO_START:")) firstVideoFrame = true;
				}),
		});
		await expect(resumeLinuxPortalCapture()).resolves.toEqual({ success: true });
		expect(firstVideoFrame).toBe(true);
		await stopLinuxPortalCapture();
	});

	unix("forwards manual zoom only after video starts and while recording", async () => {
		await writeFakeHelper(`
console.log("READY");
const rl = require("node:readline").createInterface({ input: process.stdin });
rl.on("line", (line) => {
	if (line === "pause") console.log("PAUSED");
	else if (line === "resume") {
		console.log("VIDEO_START:1700000000000");
		console.log("RESUMED");
	} else if (line === "stop") process.exit(0);
});
`);
		let capturedChild: ChildProcessWithoutNullStreams | undefined;
		await startLinuxPortalCapture({
			systemAudio: false,
			startPaused: true,
			trackProcess: (child) => {
				capturedChild = child;
			},
		});
		const write = vi.spyOn(capturedChild!.stdin, "write");
		await captureLinuxPortalZoomMarker();
		expect(write).not.toHaveBeenCalled();

		await resumeLinuxPortalCapture();
		await captureLinuxPortalZoomMarker();
		expect(write).toHaveBeenLastCalledWith("mark-zoom\n", expect.any(Function));

		await pauseLinuxPortalCapture();
		write.mockClear();
		await captureLinuxPortalZoomMarker();
		expect(write).not.toHaveBeenCalled();
		await stopLinuxPortalCapture();
	});

	unix("does not send SIGINT when stdin.write reports backpressure on stop", async () => {
		await writeFakeHelper(`
const fs = require("node:fs");
const readline = require("node:readline");
const args = process.argv.slice(2);
const videoIdx = args.indexOf("--record-video");
const videoPath = args[videoIdx + 1];
fs.writeFileSync(videoPath, "webm-bytes");
console.log("STREAM:node=42:id=-:source=Monitor:size=1920x1080:position=0,0:space=StreamLocal");
console.log("VIDEO_START:1700000000000");
console.log("READY");
const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
	if (line === "stop") {
		console.log("VIDEO_DONE:" + videoPath);
		process.exit(0);
	}
});
process.on("SIGINT", () => process.exit(1));
`);
		let capturedChild: ChildProcessWithoutNullStreams | undefined;
		const outputPath = await startLinuxPortalCapture({
			systemAudio: false,
			trackProcess: (child) => {
				capturedChild = child as ChildProcessWithoutNullStreams;
			},
		});
		expect(capturedChild).toBeDefined();
		const child = capturedChild!;
		const originalWrite = child.stdin.write.bind(child.stdin) as (
			...args: unknown[]
		) => boolean;
		vi.spyOn(child.stdin, "write").mockImplementation(((...args: unknown[]) => {
			originalWrite(...args);
			return false;
		}) as typeof child.stdin.write);
		const killSpy = vi.spyOn(child, "kill");

		await expect(stopLinuxPortalCapture()).resolves.toEqual({
			success: true,
			path: outputPath,
			message: "Linux portal capture complete",
		});
		expect(killSpy).not.toHaveBeenCalled();
	});
});
