import { EventEmitter } from "node:events";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import ffmpeg from "ffmpeg-static";
import {
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import * as state from "../state";

// These regressions exercise real FFmpeg/FFprobe subprocesses, including cold starts.
vi.setConfig({ testTimeout: 20_000, hookTimeout: 20_000 });

vi.mock("electron", () => ({
	app: { getPath: () => os.tmpdir() },
	BrowserWindow: { getAllWindows: () => [] },
}));
vi.mock("../cursor/telemetry", () => ({
	persistPendingCursorTelemetry: vi.fn(),
	snapshotCursorTelemetryForPersistence: vi.fn(),
}));
vi.mock("./windows", async (original) => {
	const actual = await original<typeof import("./windows")>();
	return {
		...actual,
		waitForWindowsCaptureStop: (
			proc: Parameters<typeof actual.waitForWindowsCaptureStop>[0],
		) => actual.waitForWindowsCaptureStop(proc, 10),
	};
});
import { stopWindowsCapture } from "./handlers/stopWindowsCapture";
import {
	attachWindowsCaptureLifecycle,
	recoverNativeWindowsCaptureOutput,
} from "./windows";
import { RecordingProcessGuard } from "./processGuard";

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

describe("Windows stop failure preserves closed-output recovery", () => {
	let directory: string;
	let temporary: string;
	let destination: string;
	let video: Buffer;
	let proc: CaptureProcess;
	beforeAll(async () => {
		const fixtureDir = await fs.mkdtemp(
			path.join(os.tmpdir(), "recordly-stop-fixture-"),
		);
		try {
			const fixturePath = path.join(fixtureDir, "fixture.mp4");
			execFileSync(ffmpeg!, [
				"-v",
				"error",
				"-f",
				"lavfi",
				"-i",
				"color=c=blue:s=64x64:r=1",
				"-t",
				"1",
				"-c:v",
				"libx264",
				"-pix_fmt",
				"yuv420p",
				fixturePath,
			]);
			video = await fs.readFile(fixturePath);
		} finally {
			await fs.rm(fixtureDir, { recursive: true, force: true });
		}
	});
	beforeEach(async () => {
		directory = await fs.mkdtemp(
			path.join(os.tmpdir(), "recordly-stop-recovery-"),
		);
		temporary = path.join(directory, "temporary.mp4");
		destination = path.join(directory, "recording.mp4");
		await fs.writeFile(temporary, video);
		for (const kind of ["system", "mic"]) {
			await fs.writeFile(
				temporary.replace(".mp4", `.${kind}.wav`),
				`${kind} retained audio`,
			);
			await fs.writeFile(
				temporary.replace(".mp4", `.${kind}.wav.json`),
				'{"startDelayMs":12}',
			);
		}
		proc = new CaptureProcess();
		state.setWindowsCaptureProcess(
			proc as unknown as NonNullable<typeof state.windowsCaptureProcess>,
		);
		state.setWindowsCaptureTempPath(temporary);
		state.setWindowsCaptureTargetPath(destination);
		state.setWindowsCaptureOutputBuffer("Recording started\n");
		state.setWindowsCaptureStopRequested(false);
		state.setWindowsNativeCaptureActive(true);
		state.setNativeScreenRecordingActive(true);
		state.setWindowsPendingVideoPath(null);
		state.setWindowsSystemAudioPath(destination.replace(".mp4", ".system.wav"));
		state.setWindowsMicAudioPath(destination.replace(".mp4", ".mic.wav"));
		state.setWindowsOrphanedMicAudioPath(null);
	});
	afterEach(async () => {
		state.setWindowsCaptureProcess(null);
		state.setWindowsCaptureTempPath(null);
		state.setWindowsCaptureTargetPath(null);
		state.setWindowsNativeCaptureActive(false);
		state.setNativeScreenRecordingActive(false);
		await fs.rm(directory, { recursive: true, force: true });
	});

	it("keeps an open writer reserved, reports its real path, and recovers video/audio only after close", async () => {
		const guard = new RecordingProcessGuard();
		guard.track(proc);
		const next = guard.wrap(async () => ({ success: true }));
		let recovering:
			| ReturnType<typeof recoverNativeWindowsCaptureOutput>
			| undefined;
		attachWindowsCaptureLifecycle(
			proc as unknown as Parameters<typeof attachWindowsCaptureLifecycle>[0],
			() => {
				recovering = recoverNativeWindowsCaptureOutput();
			},
		);
		const result = await stopWindowsCapture();
		expect(result).toMatchObject({
			success: false,
			error: expect.stringContaining(temporary),
		});
		expect(state.windowsCaptureProcess).toBe(proc);
		expect(state.windowsCaptureTargetPath).toBe(destination);
		expect(state.lastNativeCaptureDiagnostics?.outputPath).toBe(temporary);
		expect(await recoverNativeWindowsCaptureOutput()).toBeNull();
		expect((await next()).success).toBe(false);
		await expect(fs.access(destination)).rejects.toThrow();
		proc.emit("close", 1);
		await expect(recovering).resolves.toMatchObject({
			success: true,
			path: destination,
		});
		expect((await fs.readFile(destination)).equals(video)).toBe(true);
		for (const kind of ["system", "mic"]) {
			expect(
				await fs.readFile(destination.replace(".mp4", `.${kind}.wav`), "utf8"),
			).toBe(`${kind} retained audio`);
			expect(
				JSON.parse(
					await fs.readFile(
						destination.replace(".mp4", `.${kind}.wav.json`),
						"utf8",
					),
				),
			).toEqual({ startDelayMs: 12 });
		}
		expect(state.windowsCaptureTempPath).toBeNull();
	});

	it("publishes a clean closed recording without a final stdout marker", async () => {
		attachWindowsCaptureLifecycle(
			proc as unknown as Parameters<typeof attachWindowsCaptureLifecycle>[0],
		);
		const stopping = stopWindowsCapture();
		proc.emit("close", 0);
		await expect(stopping).resolves.toMatchObject({
			success: true,
			path: destination,
		});
		expect((await fs.readFile(destination)).equals(video)).toBe(true);
		expect(state.windowsCaptureTempPath).toBeNull();
	});

	it("handles close during timeout termination without losing the actual helper output", async () => {
		attachWindowsCaptureLifecycle(
			proc as unknown as Parameters<typeof attachWindowsCaptureLifecycle>[0],
		);
		proc.kill.mockImplementation(() => {
			proc.killed = true;
			proc.emit("close", 1);
			return true;
		});
		await expect(stopWindowsCapture()).resolves.toMatchObject({
			success: true,
			path: destination,
		});
		expect(state.windowsCaptureProcess).toBeNull();
		expect(state.windowsPendingVideoPath).toBe(destination);
		expect((await fs.readFile(destination)).equals(video)).toBe(true);
	});

	it("keeps ownership and files if requesting termination fails", async () => {
		attachWindowsCaptureLifecycle(
			proc as unknown as Parameters<typeof attachWindowsCaptureLifecycle>[0],
		);
		proc.kill.mockImplementation(() => {
			throw new Error("termination denied");
		});
		await expect(stopWindowsCapture()).resolves.toMatchObject({
			success: false,
		});
		expect(state.windowsCaptureProcess).toBe(proc);
		expect(state.windowsCaptureTargetPath).toBe(destination);
		await expect(recoverNativeWindowsCaptureOutput()).resolves.toBeNull();
		expect((await fs.readFile(temporary)).equals(video)).toBe(true);
		proc.emit("close", 1);
		await expect(recoverNativeWindowsCaptureOutput()).resolves.toMatchObject({
			success: true,
			path: destination,
		});
	});

	it("requests termination and retains recovery when writing the stop command fails", async () => {
		attachWindowsCaptureLifecycle(
			proc as unknown as Parameters<typeof attachWindowsCaptureLifecycle>[0],
		);
		vi.spyOn(proc.stdin, "write").mockImplementation(() => { throw new Error("pipe closed"); });
		await expect(stopWindowsCapture()).resolves.toMatchObject({ success: false });
		expect(proc.kill).toHaveBeenCalledOnce();
		expect(state.windowsCaptureProcess).toBe(proc);
		await expect(recoverNativeWindowsCaptureOutput()).resolves.toBeNull();
		proc.emit("close", 1);
		await expect(recoverNativeWindowsCaptureOutput()).resolves.toMatchObject({ success: true, path: destination });
	});

	it("retains invalid closed output and destinations without claiming recovery", async () => {
		await fs.writeFile(temporary, "");
		attachWindowsCaptureLifecycle(
			proc as unknown as Parameters<typeof attachWindowsCaptureLifecycle>[0],
		);
		await expect(stopWindowsCapture()).resolves.toMatchObject({
			success: false,
		});
		proc.emit("close", 1);
		await expect(recoverNativeWindowsCaptureOutput()).resolves.toBeNull();
		expect((await fs.stat(temporary)).size).toBe(0);
		expect(state.windowsCaptureTempPath).toBe(temporary);
		expect(state.windowsCaptureTargetPath).toBe(destination);
		expect(state.windowsSystemAudioPath).toBe(
			destination.replace(".mp4", ".system.wav"),
		);
		await expect(fs.access(destination)).rejects.toThrow();
	});
});
