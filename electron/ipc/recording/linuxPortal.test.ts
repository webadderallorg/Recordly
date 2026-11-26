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
	isLinuxPortalCaptureActive,
	isLinuxPortalCaptureEnabled,
	killLinuxPortalCaptureProcess,
	parsePortalProbeOutput,
	pauseLinuxPortalCapture,
	probeLinuxPortalCapture,
	resumeLinuxPortalCapture,
	startLinuxPortalCapture,
	stopLinuxPortalCapture,
} from "./linuxPortal";

const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform")!;
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
		expect(parsePortalProbeOutput("CAPABILITY:cursor-modes=7 metadata=1\n", 0)).toEqual({
			available: true,
			cursorModes: 7,
			message: undefined,
		});
		expect(
			parsePortalProbeOutput("CAPABILITY:cursor-modes=3 metadata=0\n", 3, "no meta"),
		).toEqual({
			available: false,
			cursorModes: 3,
			message: "no meta",
		});
		expect(parsePortalProbeOutput("unexpected", 1)).toEqual({
			available: false,
			cursorModes: undefined,
			message: undefined,
		});
	});

	it("probes helper capability and handles missing binaries", async () => {
		await expect(probeLinuxPortalCapture()).resolves.toMatchObject({ available: false });
		await writeFakeHelper(`console.log("CAPABILITY:cursor-modes=7 metadata=1");`);
		await expect(probeLinuxPortalCapture()).resolves.toEqual({
			available: true,
			cursorModes: 7,
			message: undefined,
		});
	});

	it("runs start, pause, resume, and stop lifecycle against the helper protocol", async () => {
		await writeFakeHelper(`
const fs = require("node:fs");
const readline = require("node:readline");
const args = process.argv.slice(2);
const videoIdx = args.indexOf("--record-video");
const videoPath = args[videoIdx + 1];
fs.writeFileSync(videoPath, "webm-bytes");
console.log("STREAM:node=42:id=-:source=Monitor:size=1920x1080:position=0,0:space=StreamLocal");
console.log("VIDEO_START:1700000000000");
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

	it("notifies onUnexpectedExit and clears state if the helper dies after startup", async () => {
		await writeFakeHelper(`
console.log("STREAM:node=42:id=-:source=Monitor:size=1920x1080:position=0,0:space=StreamLocal");
console.log("VIDEO_START:1700000000000");
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
		expect(isLinuxPortalCaptureActive()).toBe(false);
	});

	it("discards empty stub files when stopped while paused before first video frame", async () => {
		await writeFakeHelper(`
const readline = require("node:readline");
console.log("STREAM:node=42:id=-:source=Monitor:size=1920x1080:position=0,0:space=StreamLocal");
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
			trackProcess,
		});
		expect(trackProcess).toHaveBeenCalledOnce();
		await expect(pauseLinuxPortalCapture()).resolves.toEqual({ success: true });

		await expect(stopLinuxPortalCapture()).resolves.toEqual({
			success: true,
			message: "Linux portal capture cancelled before recording started",
		});
		expect(mocks.discardRecordingFiles).toHaveBeenCalledWith(outputPath);
		expect(mocks.validateRecordedVideo).not.toHaveBeenCalled();
	});

	it("does not send SIGINT when stdin.write reports backpressure on stop", async () => {
		await writeFakeHelper(`
const fs = require("node:fs");
const readline = require("node:readline");
const args = process.argv.slice(2);
const videoIdx = args.indexOf("--record-video");
const videoPath = args[videoIdx + 1];
fs.writeFileSync(videoPath, "webm-bytes");
console.log("STREAM:node=42:id=-:source=Monitor:size=1920x1080:position=0,0:space=StreamLocal");
console.log("VIDEO_START:1700000000000");
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
		const originalWrite = child.stdin.write.bind(child.stdin) as (...args: unknown[]) => boolean;
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
