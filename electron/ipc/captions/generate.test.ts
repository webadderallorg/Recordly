import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isMissingWindowsWhisperRuntimeDependency } from "./runtimeErrors";

type ExecFileCallback = (error: Error | null, stdout?: string, stderr?: string) => void;

describe("isMissingWindowsWhisperRuntimeDependency", () => {
	it("recognizes the signed and unsigned STATUS_DLL_NOT_FOUND exit codes on Windows", () => {
		if (process.platform !== "win32") return;

		expect(isMissingWindowsWhisperRuntimeDependency({ code: -1073741515 })).toBe(true);
		expect(isMissingWindowsWhisperRuntimeDependency({ code: 3221225781 })).toBe(true);
	});

	it("does not classify ordinary Whisper failures as missing runtimes", () => {
		expect(isMissingWindowsWhisperRuntimeDependency({ code: 1 })).toBe(false);
		expect(isMissingWindowsWhisperRuntimeDependency(new Error("bad model"))).toBe(false);
	});
});

describe("extractCaptionAudioSource", () => {
	let tempRoot: string;
	let capturedFfmpegCalls: Array<{ args: string[] }>;
	let execFileMock: ReturnType<typeof vi.fn>;

	beforeEach(async () => {
		tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "recordly-caption-test-"));
		capturedFfmpegCalls = [];

		execFileMock = vi.fn(
			(
				_file: string,
				args: string[],
				_options: Record<string, unknown>,
				callback: ExecFileCallback,
			) => {
				capturedFfmpegCalls.push({ args });
				const inputArgIdx = args.indexOf("-i");
				const inputPath = inputArgIdx !== -1 ? args[inputArgIdx + 1] : "";

				// If attempting to extract audio from an mp4 without audio, simulate ffmpeg failure
				if (inputPath.endsWith(".mp4") && inputPath.includes("no-audio")) {
					const err = new Error("Stream map '0:a:0' matches no streams.") as Error & {
						stderr?: string;
					};
					err.stderr = "Stream map '0:a:0' matches no streams.";
					callback(err, "", err.stderr);
					return;
				}

				callback(null, "", "");
			},
		);

		vi.resetModules();
		vi.doMock("electron", () => ({
			app: {
				isPackaged: false,
				getPath: () => tempRoot,
				getAppPath: () => tempRoot,
			},
		}));
		vi.doMock("node:child_process", () => ({
			execFile: execFileMock,
			spawnSync: vi.fn(),
		}));
	});

	afterEach(async () => {
		vi.resetModules();
		vi.doUnmock("electron");
		vi.doUnmock("node:child_process");
		if (tempRoot) {
			await fs.rm(tempRoot, { recursive: true, force: true });
		}
	});

	it("correctly offsets companion audio by its recorded startDelayMs on an untrimmed video", async () => {
		const videoPath = path.join(tempRoot, "recording-no-audio.mp4");
		const systemPath = path.join(tempRoot, "recording-no-audio.system.wav");
		const wavPath = path.join(tempRoot, "out.wav");

		await Promise.all([
			fs.writeFile(videoPath, "fake-video"),
			fs.writeFile(systemPath, "fake-system-audio"),
			fs.writeFile(`${systemPath}.json`, JSON.stringify({ startDelayMs: 20486 })),
		]);

		const { extractCaptionAudioSource } = await import("./generate");

		const result = await extractCaptionAudioSource({
			videoPath,
			ffmpegPath: "ffmpeg",
			wavPath,
			clipStartMs: 0,
		});

		expect(result.path).toBe(systemPath);
		expect(result.startDelayMs).toBe(20486);
		expect(result.audioStartMs).toBe(0);
		expect(result.effectiveTimelineOffsetMs).toBe(20486);

		// Verify FFmpeg was called without -ss for audioStartMs = 0
		const systemCall = capturedFfmpegCalls.find((c) => c.args.includes(systemPath));
		expect(systemCall).toBeDefined();
		expect(systemCall?.args).not.toContain("-ss");
	});

	it("correctly offsets companion audio when video clip is trimmed past startDelayMs", async () => {
		const videoPath = path.join(tempRoot, "recording-no-audio.mp4");
		const systemPath = path.join(tempRoot, "recording-no-audio.system.wav");
		const wavPath = path.join(tempRoot, "out.wav");

		await Promise.all([
			fs.writeFile(videoPath, "fake-video"),
			fs.writeFile(systemPath, "fake-system-audio"),
			fs.writeFile(`${systemPath}.json`, JSON.stringify({ startDelayMs: 20486 })),
		]);

		const { extractCaptionAudioSource } = await import("./generate");

		// Clip starts at 50,000 ms (50 seconds)
		const result = await extractCaptionAudioSource({
			videoPath,
			ffmpegPath: "ffmpeg",
			wavPath,
			clipStartMs: 50000,
		});

		expect(result.path).toBe(systemPath);
		expect(result.startDelayMs).toBe(20486);
		expect(result.audioStartMs).toBe(50000 - 20486); // 29514 ms
		expect(result.effectiveTimelineOffsetMs).toBe(50000);

		// Verify FFmpeg extracted from 29.514 seconds
		const systemCall = capturedFfmpegCalls.find((c) => c.args.includes(systemPath));
		expect(systemCall).toBeDefined();
		const ssIndex = systemCall?.args.indexOf("-ss");
		expect(ssIndex).toBeGreaterThan(-1);
		expect(systemCall?.args[(ssIndex ?? 0) + 1]).toBe("29.514");
	});

	it("handles companion audio when video clip is trimmed before startDelayMs", async () => {
		const videoPath = path.join(tempRoot, "recording-no-audio.mp4");
		const systemPath = path.join(tempRoot, "recording-no-audio.system.wav");
		const wavPath = path.join(tempRoot, "out.wav");

		await Promise.all([
			fs.writeFile(videoPath, "fake-video"),
			fs.writeFile(systemPath, "fake-system-audio"),
			fs.writeFile(`${systemPath}.json`, JSON.stringify({ startDelayMs: 20486 })),
		]);

		const { extractCaptionAudioSource } = await import("./generate");

		// Clip starts at 10,000 ms (10 seconds), before audio began at 20.486s
		const result = await extractCaptionAudioSource({
			videoPath,
			ffmpegPath: "ffmpeg",
			wavPath,
			clipStartMs: 10000,
		});

		expect(result.path).toBe(systemPath);
		expect(result.startDelayMs).toBe(20486);
		expect(result.audioStartMs).toBe(0);
		expect(result.effectiveTimelineOffsetMs).toBe(20486);

		const systemCall = capturedFfmpegCalls.find((c) => c.args.includes(systemPath));
		expect(systemCall).toBeDefined();
		expect(systemCall?.args).not.toContain("-ss");
	});

	it("handles standard video with embedded audio without companion delay", async () => {
		const videoPath = path.join(tempRoot, "recording-with-audio.mp4");
		const wavPath = path.join(tempRoot, "out.wav");

		await fs.writeFile(videoPath, "fake-video");

		const { extractCaptionAudioSource } = await import("./generate");

		const result = await extractCaptionAudioSource({
			videoPath,
			ffmpegPath: "ffmpeg",
			wavPath,
			clipStartMs: 15000,
		});

		expect(result.path).toBe(videoPath);
		expect(result.startDelayMs).toBe(0);
		expect(result.audioStartMs).toBe(15000);
		expect(result.effectiveTimelineOffsetMs).toBe(15000);

		const call = capturedFfmpegCalls.find((c) => c.args.includes(videoPath));
		expect(call).toBeDefined();
		const ssIndex = call?.args.indexOf("-ss");
		expect(ssIndex).toBeGreaterThan(-1);
		expect(call?.args[(ssIndex ?? 0) + 1]).toBe("15.000");
	});
});
