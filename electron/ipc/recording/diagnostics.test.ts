import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type ExecFileCallback = (error: Error | null, stdout?: string, stderr?: string) => void;

const WAV_STREAMING_SIZE = 0xffffffff;

/**
 * Builds a 48 kHz mono 16-bit WAV using the chunk layout FFmpeg emits
 * (`fmt `, `LIST`, `data`). While FFmpeg is still encoding, the RIFF and data
 * sizes hold the 0xFFFFFFFF "unknown length" sentinel and are only patched when
 * the file is finalized.
 */
function buildWavFile(frameCount: number, { finalized }: { finalized: boolean }): Buffer {
	const listPayload = Buffer.alloc(26);
	listPayload.write("INFOISFT", 0, "ascii");
	const pcm = Buffer.alloc(frameCount * 2);
	const dataSize = finalized ? pcm.length : WAV_STREAMING_SIZE;

	const header = Buffer.alloc(12 + 8 + 16 + 8 + listPayload.length + 8);
	let offset = 0;
	header.write("RIFF", offset, "ascii");
	offset += 4;
	header.writeUInt32LE(finalized ? header.length - 8 + pcm.length : WAV_STREAMING_SIZE, offset);
	offset += 4;
	header.write("WAVE", offset, "ascii");
	offset += 4;
	header.write("fmt ", offset, "ascii");
	offset += 4;
	header.writeUInt32LE(16, offset);
	offset += 4;
	header.writeUInt16LE(1, offset); // PCM
	offset += 2;
	header.writeUInt16LE(1, offset); // mono
	offset += 2;
	header.writeUInt32LE(48000, offset);
	offset += 4;
	header.writeUInt32LE(96000, offset); // byte rate
	offset += 4;
	header.writeUInt16LE(2, offset); // block align
	offset += 2;
	header.writeUInt16LE(16, offset); // bits per sample
	offset += 2;
	header.write("LIST", offset, "ascii");
	offset += 4;
	header.writeUInt32LE(listPayload.length, offset);
	offset += 4;
	listPayload.copy(header, offset);
	offset += listPayload.length;
	header.write("data", offset, "ascii");
	offset += 4;
	header.writeUInt32LE(dataSize, offset);

	return Buffer.concat([header, pcm]);
}

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

	it("ignores a microphone sidecar whose WAV header is not finalized yet", async () => {
		const videoPath = path.join(tempRoot, "recording.mp4");
		const systemPath = path.join(tempRoot, "recording.system.wav");
		const micPath = path.join(tempRoot, "recording.mic.wav");

		await Promise.all([
			fs.writeFile(videoPath, "video"),
			fs.writeFile(systemPath, buildWavFile(4800, { finalized: true })),
			// Mid-encode: FFmpeg still advertises an unknown data size, so this file
			// parses as a valid but far too short recording.
			fs.writeFile(micPath, buildWavFile(4800, { finalized: false })),
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

		await expect(getCompanionAudioFallbackPaths(videoPath)).resolves.toEqual([systemPath]);

		// Once the encoder finalizes the header the sidecar becomes usable.
		await fs.writeFile(micPath, buildWavFile(4800, { finalized: true }));
		await expect(getCompanionAudioFallbackPaths(videoPath)).resolves.toEqual([
			systemPath,
			micPath,
		]);
	});

	it("classifies finalized, unfinalized and non-RIFF sidecars", async () => {
		const { isFinalizedWavFile } = await import("./diagnostics");

		const finalizedPath = path.join(tempRoot, "finalized.wav");
		const streamingPath = path.join(tempRoot, "streaming.wav");
		const notRiffPath = path.join(tempRoot, "not-riff.wav");
		const missingPath = path.join(tempRoot, "missing.wav");

		await Promise.all([
			fs.writeFile(finalizedPath, buildWavFile(960, { finalized: true })),
			fs.writeFile(streamingPath, buildWavFile(960, { finalized: false })),
			fs.writeFile(notRiffPath, "mic"),
		]);

		await expect(isFinalizedWavFile(finalizedPath)).resolves.toBe(true);
		await expect(isFinalizedWavFile(streamingPath)).resolves.toBe(false);
		// Non-WAV companions (m4a/webm) and unreadable files are left to other checks.
		await expect(isFinalizedWavFile(notRiffPath)).resolves.toBe(true);
		await expect(isFinalizedWavFile(missingPath)).resolves.toBe(true);
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
});
