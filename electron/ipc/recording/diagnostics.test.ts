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

	it("loads saved sidecar timing metadata alongside companion audio paths", async () => {
		const videoPath = path.join(tempRoot, "recording.mp4");
		const micPath = path.join(tempRoot, "recording.mic.webm");

		await Promise.all([
			fs.writeFile(videoPath, "video"),
			fs.writeFile(micPath, "mic"),
			fs.writeFile(`${micPath}.json`, JSON.stringify({ startDelayMs: 2750 })),
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

	it("ignores invalid sidecar timing metadata values", async () => {
		const micPath = path.join(tempRoot, "recording.mic.wav");
		await Promise.all([
			fs.writeFile(micPath, "mic"),
			fs.writeFile(`${micPath}.json`, JSON.stringify({ startDelayMs: -250 })),
		]);

		const { getCompanionAudioStartDelayMs } = await import("./diagnostics");

		await expect(getCompanionAudioStartDelayMs(micPath)).resolves.toBeNull();
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
