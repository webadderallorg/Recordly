import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type ExecFileCallback = (error: Error | null, stdout?: string, stderr?: string) => void;

describe("getCompanionAudioFallbackPaths", () => {
	let tempRoot: string;
	let appDataPath: string;
	let userDataPath: string;
	let tempPath: string;
	let appPath: string;
	let execFileMock: ReturnType<typeof vi.fn>;

	beforeEach(async () => {
		tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "recordly-companion-audio-"));
		appDataPath = path.join(tempRoot, "AppData");
		userDataPath = path.join(tempRoot, "UserData");
		tempPath = path.join(tempRoot, "Temp");
		appPath = path.join(tempRoot, "App");
		await Promise.all(
			[appDataPath, userDataPath, tempPath, appPath].map((dirPath) =>
				fs.mkdir(dirPath, { recursive: true }),
			),
		);
		execFileMock = vi.fn(
			(
				_file: string,
				_args: string[],
				_options: Record<string, unknown>,
				callback: ExecFileCallback,
			) => {
				callback(null, "", "");
			},
		);

		vi.resetModules();
		vi.doMock("electron", () => ({
			app: {
				isPackaged: false,
				getAppPath: () => appPath,
				getPath: (name: string) => {
					if (name === "appData") return appDataPath;
					if (name === "userData") return userDataPath;
					if (name === "temp") return tempPath;
					return tempRoot;
				},
				setPath: () => undefined,
			},
		}));
		vi.doMock("node:child_process", () => ({
			execFile: execFileMock,
		}));
		vi.doMock("../ffmpeg/binary", () => ({
			getFfmpegBinaryPath: () => "ffmpeg",
			getFfprobeBinaryPath: () => "ffprobe",
		}));
	});

	afterEach(async () => {
		vi.resetModules();
		vi.doUnmock("electron");
		vi.doUnmock("node:child_process");
		vi.doUnmock("../ffmpeg/binary");
		if (tempRoot) {
			await fs.rm(tempRoot, { recursive: true, force: true });
		}
	});

	it("returns companion audio files directly when the video has no embedded audio", async () => {
		const videoPath = path.join(tempRoot, "recording.mp4");
		const systemPath = path.join(tempRoot, "recording.system.wav");
		const micPath = path.join(tempRoot, "recording.mic.wav");

		await Promise.all([
			fs.writeFile(videoPath, "video"),
			fs.writeFile(systemPath, "system"),
			fs.writeFile(micPath, "mic"),
		]);

		execFileMock.mockImplementation(
			(
				_file: string,
				_args: string[],
				_options: Record<string, unknown>,
				callback: ExecFileCallback,
			) => {
				const error = new Error("ffmpeg probe failed") as Error & { stderr?: string };
				error.stderr = "Stream #0:0: Video: h264";
				callback(error, "", error.stderr);
			},
		);

		const { getCompanionAudioFallbackPaths } = await import("./diagnostics");

		await expect(getCompanionAudioFallbackPaths(videoPath)).resolves.toEqual([
			systemPath,
			micPath,
		]);
	});

	it("keeps the embedded source audio and adds the mic companion when both are present", async () => {
		const videoPath = path.join(tempRoot, "recording.mp4");
		const systemPath = path.join(tempRoot, "recording.system.wav");
		const micPath = path.join(tempRoot, "recording.mic.wav");

		await Promise.all([
			fs.writeFile(videoPath, "video"),
			fs.writeFile(systemPath, "system"),
			fs.writeFile(micPath, "mic"),
		]);

		execFileMock.mockImplementation(
			(
				_file: string,
				_args: string[],
				_options: Record<string, unknown>,
				callback: ExecFileCallback,
			) => {
				const error = new Error("ffmpeg probe found embedded audio") as Error & {
					stderr?: string;
				};
				error.stderr = "Stream #0:1: Audio: aac";
				callback(error, "", error.stderr);
			},
		);

		const { getCompanionAudioFallbackPaths } = await import("./diagnostics");

		await expect(getCompanionAudioFallbackPaths(videoPath)).resolves.toEqual([
			videoPath,
			micPath,
		]);
	});

	it("prefers the mac mic companion alone when embedded audio already exists and no system sidecar is present", async () => {
		const videoPath = path.join(tempRoot, "recording.mp4");
		const micPath = path.join(tempRoot, "recording.mic.m4a");

		await Promise.all([fs.writeFile(videoPath, "video"), fs.writeFile(micPath, "mic")]);

		execFileMock.mockImplementation(
			(
				_file: string,
				_args: string[],
				_options: Record<string, unknown>,
				callback: ExecFileCallback,
			) => {
				const error = new Error("ffmpeg probe found embedded audio") as Error & {
					stderr?: string;
				};
				error.stderr = "Stream #0:1: Audio: aac";
				callback(error, "", error.stderr);
			},
		);

		const { getCompanionAudioFallbackPaths } = await import("./diagnostics");

		await expect(getCompanionAudioFallbackPaths(videoPath)).resolves.toEqual([micPath]);
	});

	it("loads saved sidecar timing metadata alongside companion audio paths", async () => {
		const videoPath = path.join(tempRoot, "recording.mp4");
		const micPath = path.join(tempRoot, "recording.mic.webm");

		await Promise.all([
			fs.writeFile(videoPath, "video"),
			fs.writeFile(micPath, "mic"),
			fs.writeFile(`${micPath}.json`, `\ufeff${JSON.stringify({ startDelayMs: 2750 })}`),
		]);

		execFileMock.mockImplementation(
			(
				_file: string,
				_args: string[],
				_options: Record<string, unknown>,
				callback: ExecFileCallback,
			) => {
				const error = new Error("ffmpeg probe failed") as Error & { stderr?: string };
				error.stderr = "Stream #0:0: Video: h264";
				callback(error, "", error.stderr);
			},
		);

		const { getCompanionAudioFallbackInfo } = await import("./diagnostics");

		await expect(getCompanionAudioFallbackInfo(videoPath)).resolves.toEqual({
			paths: [micPath],
			startDelayMsByPath: {
				[micPath]: 2750,
			},
		});
	});

	it("scales audio mux timeout for long recordings", async () => {
		const { getRecordingAudioMuxTimeoutMs } = await import("./diagnostics");

		expect(getRecordingAudioMuxTimeoutMs(0)).toBe(5 * 60 * 1000);
		expect(getRecordingAudioMuxTimeoutMs(29 * 60 + 29.41)).toBeGreaterThan(120000);
		expect(getRecordingAudioMuxTimeoutMs(29 * 60 + 29.41)).toBeCloseTo(
			(29 * 60 + 29.41) * 1000 + 60 * 1000,
			0,
		);
	});

	it("uses video stream frames when container duration is misleading", async () => {
		const { parseFfprobeVideoStreamDuration } = await import("./diagnostics");

		expect(
			parseFfprobeVideoStreamDuration(
				JSON.stringify({
					streams: [
						{
							duration: "18.000000",
							nb_read_frames: "540",
							avg_frame_rate: "30/1",
						},
					],
				}),
			),
		).toEqual({
			durationSeconds: 18,
			frameCount: 540,
			frameRate: 30,
		});
	});

	it("derives video stream duration from frame count when stream duration is absent", async () => {
		const { parseFfprobeVideoStreamDuration } = await import("./diagnostics");

		expect(
			parseFfprobeVideoStreamDuration(
				JSON.stringify({
					streams: [
						{
							nb_read_frames: "540",
							avg_frame_rate: "30/1",
						},
					],
				}),
			),
		).toEqual({
			durationSeconds: 18,
			frameCount: 540,
			frameRate: 30,
		});
	});

	it("writes a recording diagnostics sidecar with stream and audio probes", async () => {
		const videoPath = path.join(tempRoot, "recording-123.mp4");
		const micPath = path.join(tempRoot, "recording-123.mic.wav");
		await Promise.all([
			fs.writeFile(videoPath, "video"),
			fs.writeFile(micPath, "mic"),
			fs.writeFile(`${micPath}.json`, JSON.stringify({ startDelayMs: 125 })),
		]);

		execFileMock.mockImplementation(
			(
				file: string,
				args: string[],
				_options: Record<string, unknown>,
				callback: ExecFileCallback,
			) => {
				if (file === "ffprobe" || args.includes("-of")) {
					callback(
						null,
						JSON.stringify({
							streams: [
								{
									duration: "18.000000",
									nb_read_frames: "540",
									avg_frame_rate: "30/1",
								},
							],
						}),
						"",
					);
					return;
				}

				const error = new Error("ffmpeg probe") as Error & { stderr?: string };
				error.stderr = "Duration: 00:00:18.00, start: 0.000000";
				callback(error, "", error.stderr);
			},
		);

		const { getRecordingDiagnosticsPath, writeRecordingDiagnosticsSnapshot } = await import(
			"./diagnostics"
		);

		const diagnosticsPath = await writeRecordingDiagnosticsSnapshot(videoPath, {
			backend: "windows-wgc",
			phase: "mux-start",
			expectedDurationMs: 60_000,
			outputPath: videoPath,
			microphonePath: micPath,
			details: {
				hasMicrophone: true,
			},
		});
		const diagnostics = JSON.parse(await fs.readFile(diagnosticsPath, "utf8"));

		expect(diagnosticsPath).toBe(getRecordingDiagnosticsPath(videoPath));
		expect(diagnostics.events).toHaveLength(1);
		expect(diagnostics.latest.expectedDurationMs).toBe(60_000);
		expect(diagnostics.latest.media.video.stream).toEqual({
			durationSeconds: 18,
			frameCount: 540,
			frameRate: 30,
		});
		expect(diagnostics.latest.media.microphone).toMatchObject({
			path: micPath,
			exists: true,
			containerDurationSeconds: 18,
			startDelayMs: 125,
		});
	});

	it("ignores invalid sidecar timing metadata values", async () => {
		const micPath = path.join(tempRoot, "recording.mic.wav");
		await Promise.all([
			fs.writeFile(micPath, "mic"),
			fs.writeFile(`${micPath}.json`, JSON.stringify({ startDelayMs: -250 })),
		]);

		const { getCompanionAudioStartDelayMs } = await import("./diagnostics");

		await expect(getCompanionAudioStartDelayMs(micPath)).resolves.toBeNull();
	});

	it("classifies wall-clock mic chunk gaps covered by pause intervals", async () => {
		const { summarizeMicrophoneChunkTiming } = await import("./diagnostics");

		expect(
			summarizeMicrophoneChunkTiming(
				[
					{
						index: 0,
						size: 1024,
						elapsedMs: 250,
						deltaMs: null,
						recordedElapsedMs: 250,
						recordedDeltaMs: null,
					},
					{
						index: 1,
						size: 1024,
						elapsedMs: 8250,
						deltaMs: 8000,
						recordedElapsedMs: 500,
						recordedDeltaMs: 250,
					},
				],
				[{ startElapsedMs: 250, endElapsedMs: 8250, durationMs: 7750 }],
				250,
			),
		).toMatchObject({
			status: "pause-accounted",
			wallClockGapCount: 1,
			recordedGapCount: 0,
			pausedDurationMs: 7750,
		});
	});

	it("flags recorded mic chunk gaps that remain after pause accounting", async () => {
		const { summarizeMicrophoneChunkTiming } = await import("./diagnostics");

		expect(
			summarizeMicrophoneChunkTiming(
				[
					{
						index: 0,
						size: 1024,
						elapsedMs: 250,
						deltaMs: null,
						recordedElapsedMs: 250,
						recordedDeltaMs: null,
					},
					{
						index: 1,
						size: 1024,
						elapsedMs: 2500,
						deltaMs: 2250,
						recordedElapsedMs: 2500,
						recordedDeltaMs: 2250,
					},
				],
				[],
				250,
			),
		).toMatchObject({
			status: "needs-review",
			wallClockGapCount: 1,
			recordedGapCount: 1,
		});
	});

	it("rejects tiny MP4 container-only outputs before they reach the editor", async () => {
		const videoPath = path.join(tempRoot, "recording-123.mp4");
		await fs.writeFile(videoPath, Buffer.alloc(261));

		const { validateRecordedVideo } = await import("./diagnostics");

		await expect(validateRecordedVideo(videoPath)).rejects.toThrow(
			"Recorded output is too small to contain playable video",
		);
	});

	it("caches probe results so repeated probes of an unchanged file spawn once", async () => {
		const videoPath = path.join(tempRoot, "recording-cache.mp4");
		await fs.writeFile(videoPath, "video-content");

		execFileMock.mockImplementation(
			(
				_file: string,
				_args: string[],
				_options: Record<string, unknown>,
				callback: ExecFileCallback,
			) => {
				const error = new Error("ffmpeg probe") as Error & { stderr?: string };
				error.stderr = "Duration: 00:00:18.00, start: 0.000000";
				callback(error, "", error.stderr);
			},
		);

		const { probeMediaDurationSeconds } = await import("./diagnostics");

		await expect(probeMediaDurationSeconds(videoPath)).resolves.toBe(18);
		await expect(probeMediaDurationSeconds(videoPath)).resolves.toBe(18);

		const ffmpegCalls = execFileMock.mock.calls.filter(([file]) => file === "ffmpeg");
		expect(ffmpegCalls).toHaveLength(1);
	});

	it("invalidates the cache when the file changes", async () => {
		const videoPath = path.join(tempRoot, "recording-invalidate.mp4");
		await fs.writeFile(videoPath, "video-content");

		execFileMock.mockImplementation(
			(
				_file: string,
				_args: string[],
				_options: Record<string, unknown>,
				callback: ExecFileCallback,
			) => {
				const error = new Error("ffmpeg probe") as Error & { stderr?: string };
				error.stderr = "Duration: 00:00:18.00, start: 0.000000";
				callback(error, "", error.stderr);
			},
		);

		const { probeMediaDurationSeconds } = await import("./diagnostics");

		await expect(probeMediaDurationSeconds(videoPath)).resolves.toBe(18);
		expect(execFileMock.mock.calls.filter(([file]) => file === "ffmpeg")).toHaveLength(1);

		// Rewriting the file changes size and mtime, forcing a fresh probe.
		await fs.writeFile(videoPath, "longer-video-content-here-for-a-different-file");
		await expect(probeMediaDurationSeconds(videoPath)).resolves.toBe(18);

		expect(execFileMock.mock.calls.filter(([file]) => file === "ffmpeg")).toHaveLength(2);
	});

	it("never caches missing files or failed probes", async () => {
		const missingPath = path.join(tempRoot, "missing.mp4");

		execFileMock.mockImplementation(
			(
				_file: string,
				_args: string[],
				_options: Record<string, unknown>,
				callback: ExecFileCallback,
			) => {
				callback(new Error("file not found"), "", "");
			},
		);

		const { probeMediaDurationSeconds, probeVideoStreamDuration } = await import(
			"./diagnostics"
		);

		await expect(probeMediaDurationSeconds(missingPath)).resolves.toBe(0);
		await expect(probeMediaDurationSeconds(missingPath)).resolves.toBe(0);
		await expect(probeVideoStreamDuration(missingPath)).resolves.toBeNull();
		await expect(probeVideoStreamDuration(missingPath)).resolves.toBeNull();

		// Missing files are never cached, so each call still spawns a binary.
		expect(execFileMock.mock.calls.filter(([file]) => file === "ffmpeg")).toHaveLength(2);
		expect(execFileMock.mock.calls.filter(([file]) => file === "ffprobe")).toHaveLength(2);
	});

	it("does not leak cached metadata across different files", async () => {
		const firstPath = path.join(tempRoot, "recording-first.mp4");
		const secondPath = path.join(tempRoot, "recording-second.mp4");
		await Promise.all([
			fs.writeFile(firstPath, "first-content"),
			fs.writeFile(secondPath, "second-content"),
		]);

		execFileMock.mockImplementation(
			(
				_file: string,
				args: string[],
				_options: Record<string, unknown>,
				callback: ExecFileCallback,
			) => {
				const error = new Error("ffmpeg probe") as Error & { stderr?: string };
				error.stderr = args.includes(firstPath)
					? "Duration: 00:00:10.00, start: 0.000000"
					: "Duration: 00:00:20.00, start: 0.000000";
				callback(error, "", error.stderr);
			},
		);

		const { probeMediaDurationSeconds } = await import("./diagnostics");

		await expect(probeMediaDurationSeconds(firstPath)).resolves.toBe(10);
		await expect(probeMediaDurationSeconds(secondPath)).resolves.toBe(20);
		expect(execFileMock.mock.calls.filter(([file]) => file === "ffmpeg")).toHaveLength(2);

		// Both files are cached by distinct identities; hitting the first again
		// reuses its own value without spawning or touching the second entry.
		await expect(probeMediaDurationSeconds(firstPath)).resolves.toBe(10);
		expect(execFileMock.mock.calls.filter(([file]) => file === "ffmpeg")).toHaveLength(2);
	});

	function mockValidVideoProbe() {
		const stderr = "Stream #0:0: Video: h264, yuv420p\nDuration: 00:00:05.00, start: 0.000000";
		// Mirror the real child_process.execFile promisify contract so the
		// successful validation path sees a resolved { stdout, stderr }.
		Object.defineProperty(execFileMock, Symbol.for("nodejs.util.promisify.custom"), {
			value: async () => ({ stdout: "", stderr }),
			configurable: true,
		});
	}

	it("reuses a successful validation for an unchanged file (skips revalidation)", async () => {
		const videoPath = path.join(tempRoot, "recording-skip.mp4");
		await fs.writeFile(videoPath, Buffer.alloc(4096));
		mockValidVideoProbe();

		const { validateRecordedVideo, getRecentSuccessfulVideoValidation } = await import(
			"./diagnostics"
		);

		const result = await validateRecordedVideo(videoPath);
		expect(result.durationSeconds).toBe(5);

		// The unchanged file is recognized as provably validated, so a second
		// full revalidation (e.g. finalizeStoredVideo) is not needed.
		await expect(getRecentSuccessfulVideoValidation(videoPath)).resolves.toEqual({
			fileSizeBytes: 4096,
			durationSeconds: 5,
		});
	});

	it("revalidates when the file size changes", async () => {
		const videoPath = path.join(tempRoot, "recording-size.mp4");
		await fs.writeFile(videoPath, Buffer.alloc(4096));
		mockValidVideoProbe();

		const { validateRecordedVideo, getRecentSuccessfulVideoValidation } = await import(
			"./diagnostics"
		);

		await validateRecordedVideo(videoPath);
		await fs.writeFile(videoPath, Buffer.alloc(8192));

		await expect(getRecentSuccessfulVideoValidation(videoPath)).resolves.toBeNull();
	});

	it("revalidates when the mtime changes without a size change", async () => {
		const videoPath = path.join(tempRoot, "recording-mtime.mp4");
		await fs.writeFile(videoPath, Buffer.alloc(4096));
		mockValidVideoProbe();

		const { validateRecordedVideo, getRecentSuccessfulVideoValidation } = await import(
			"./diagnostics"
		);

		await validateRecordedVideo(videoPath);
		const later = new Date(Date.now() + 5000);
		await fs.utimes(videoPath, later, later);

		await expect(getRecentSuccessfulVideoValidation(videoPath)).resolves.toBeNull();
	});

	it("never authorizes a skip on a path mismatch or missing cache entry", async () => {
		const videoPath = path.join(tempRoot, "recording-mismatch.mp4");
		const otherPath = path.join(tempRoot, "recording-other.mp4");
		await Promise.all([
			fs.writeFile(videoPath, Buffer.alloc(4096)),
			fs.writeFile(otherPath, Buffer.alloc(4096)),
		]);
		mockValidVideoProbe();

		const { validateRecordedVideo, getRecentSuccessfulVideoValidation } = await import(
			"./diagnostics"
		);

		// Missing cache for an untouched file.
		await expect(getRecentSuccessfulVideoValidation(otherPath)).resolves.toBeNull();

		// Validating one path must not authorize a skip for a different file.
		await validateRecordedVideo(videoPath);
		await expect(getRecentSuccessfulVideoValidation(otherPath)).resolves.toBeNull();
	});

	it("never authorizes a skip after a failed validation", async () => {
		const videoPath = path.join(tempRoot, "recording-fail.mp4");
		await fs.writeFile(videoPath, Buffer.alloc(4096));
		execFileMock.mockImplementation(
			(
				_file: string,
				_args: string[],
				_options: Record<string, unknown>,
				callback: ExecFileCallback,
			) => {
				callback(new Error("decode failed"), "", "");
			},
		);

		const { validateRecordedVideo, getRecentSuccessfulVideoValidation } = await import(
			"./diagnostics"
		);

		await expect(validateRecordedVideo(videoPath)).rejects.toThrow();
		await expect(getRecentSuccessfulVideoValidation(videoPath)).resolves.toBeNull();
	});

	it("bounds the validation cache and evicts the oldest entry", async () => {
		mockValidVideoProbe();
		const { validateRecordedVideo, getRecentSuccessfulVideoValidation } = await import(
			"./diagnostics"
		);

		const count = 17;
		const paths: string[] = [];
		for (let index = 0; index < count; index += 1) {
			const videoPath = path.join(tempRoot, `recording-bound-${index}.mp4`);
			await fs.writeFile(videoPath, Buffer.alloc(4096));
			paths.push(videoPath);
			await validateRecordedVideo(videoPath);
		}

		// The newest entry is still authorized to skip.
		await expect(getRecentSuccessfulVideoValidation(paths[count - 1])).resolves.not.toBeNull();
		// The oldest entry was evicted to keep the cache bounded.
		await expect(getRecentSuccessfulVideoValidation(paths[0])).resolves.toBeNull();
	});

	it("clears a validation token once it ages past the TTL", async () => {
		const videoPath = path.join(tempRoot, "recording-ttl.mp4");
		await fs.writeFile(videoPath, Buffer.alloc(4096));
		mockValidVideoProbe();

		const { validateRecordedVideo, getRecentSuccessfulVideoValidation } = await import(
			"./diagnostics"
		);

		vi.useFakeTimers();
		try {
			await validateRecordedVideo(videoPath);
			await expect(getRecentSuccessfulVideoValidation(videoPath)).resolves.not.toBeNull();

			vi.setSystemTime(Date.now() + 61_000);
			await expect(getRecentSuccessfulVideoValidation(videoPath)).resolves.toBeNull();
		} finally {
			vi.useRealTimers();
		}
	});

	it("fresh files with no prior token still validate (no false skip)", async () => {
		const videoPath = path.join(tempRoot, "recording-fresh.mp4");
		await fs.writeFile(videoPath, Buffer.alloc(4096));
		mockValidVideoProbe();

		const { validateRecordedVideo, getRecentSuccessfulVideoValidation } = await import(
			"./diagnostics"
		);

		// Validate once, then rewrite as a brand-new file at the same path (the
		// freshly stored / rewritten-video case). The new identity must not be
		// authorized to skip.
		await validateRecordedVideo(videoPath);
		await fs.writeFile(videoPath, Buffer.alloc(8192));
		await expect(getRecentSuccessfulVideoValidation(videoPath)).resolves.toBeNull();
	});
});
