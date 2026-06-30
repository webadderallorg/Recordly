import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function getWhisperCliName() {
	return process.platform === "win32" ? "whisper-cli.exe" : "whisper-cli";
}

async function writeExecutable(filePath: string) {
	await fs.mkdir(path.dirname(filePath), { recursive: true });
	await fs.writeFile(filePath, "");
	if (process.platform !== "win32") {
		await fs.chmod(filePath, 0o755);
	}
}

describe("Whisper executable resolution", () => {
	let tempRoot: string;
	let appPath: string;

	beforeEach(async () => {
		tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "recordly-whisper-paths-"));
		appPath = path.join(tempRoot, "App");

		vi.resetModules();
		vi.doMock("electron", () => ({
			app: {
				isPackaged: false,
				getAppPath: () => appPath,
				getPath: () => tempRoot,
			},
		}));
	});

	afterEach(async () => {
		vi.resetModules();
		vi.doUnmock("electron");
		vi.doUnmock("node:child_process");
		vi.unstubAllEnvs();
		await fs.rm(tempRoot, { recursive: true, force: true });
	});

	it("does not treat a directory as an executable", async () => {
		const { isExecutableFile } = await import("./generate");

		expect(await isExecutableFile(tempRoot)).toBe(false);
	});

	it("reports a labeled missing file clearly", async () => {
		const { ensureReadableFile } = await import("./generate");
		const missingModelPath = path.join(tempRoot, "missing", "ggml-small.bin");

		await expect(
			ensureReadableFile(missingModelPath, { label: "Whisper model file" }),
		).rejects.toThrow(`Whisper model file was not found at ${missingModelPath}.`);
	});

	it("parses Whisper progress output", async () => {
		const { parseWhisperProgressPercent } = await import("./generate");

		expect(
			parseWhisperProgressPercent("whisper_print_progress_callback: progress =  42%"),
		).toBe(42);
		expect(parseWhisperProgressPercent("progress = 5%\nprogress = 100%")).toBe(100);
		expect(parseWhisperProgressPercent("no progress here")).toBeNull();
	});

	it("resolves WHISPER_CPP_PATH when it points to a runtime directory", async () => {
		const runtimeDir = path.join(tempRoot, "whisper-runtime");
		const executablePath = path.join(runtimeDir, getWhisperCliName());
		await writeExecutable(executablePath);
		vi.stubEnv("WHISPER_CPP_PATH", runtimeDir);

		const { resolveWhisperExecutablePath } = await import("./generate");

		expect(await resolveWhisperExecutablePath()).toBe(executablePath);
	});

	it("resolves WHISPER_CPP_PATH when it points directly to an executable", async () => {
		const executablePath = path.join(tempRoot, "direct", getWhisperCliName());
		await writeExecutable(executablePath);
		vi.stubEnv("WHISPER_CPP_PATH", executablePath);

		const { resolveWhisperExecutablePath } = await import("./generate");

		expect(await resolveWhisperExecutablePath()).toBe(executablePath);
	});

	it("resolves a selected runtime directory", async () => {
		const runtimeDir = path.join(tempRoot, "selected-runtime");
		const executablePath = path.join(runtimeDir, getWhisperCliName());
		await writeExecutable(executablePath);

		const { resolveWhisperExecutablePath } = await import("./generate");

		expect(await resolveWhisperExecutablePath(runtimeDir)).toBe(executablePath);
	});

	it("resolves a selected executable file", async () => {
		const executablePath = path.join(tempRoot, "selected-file", getWhisperCliName());
		await writeExecutable(executablePath);

		const { resolveWhisperExecutablePath } = await import("./generate");

		expect(await resolveWhisperExecutablePath(executablePath)).toBe(executablePath);
	});

	it("resolves WHISPER_CPP_PATH when it points to a whisper.cpp checkout", async () => {
		const checkoutDir = path.join(tempRoot, "whisper.cpp");
		const executablePath = path.join(
			checkoutDir,
			"build",
			"bin",
			"Release",
			getWhisperCliName(),
		);
		await writeExecutable(executablePath);
		vi.stubEnv("WHISPER_CPP_PATH", checkoutDir);

		const { resolveWhisperExecutablePath } = await import("./generate");

		expect(await resolveWhisperExecutablePath()).toBe(executablePath);
	});

	it("adds companion audio sidecars as caption fallback candidates", async () => {
		const videoPath = path.join(tempRoot, "recording-1.mp4");
		const micPath = path.join(tempRoot, "recording-1.mic.wav");
		const systemPath = path.join(tempRoot, "recording-1.system.wav");
		await fs.writeFile(micPath, "mic audio");
		await fs.writeFile(systemPath, "system audio");

		const { resolveCaptionAudioCandidates } = await import("./generate");

		expect(await resolveCaptionAudioCandidates(videoPath)).toEqual([
			{ path: videoPath, label: "recording" },
			{ path: systemPath, label: "source system audio" },
			{ path: micPath, label: "source microphone audio" },
		]);
	});

	it("falls back to companion audio when the recording audio cannot be extracted", async () => {
		const videoPath = path.join(tempRoot, "recording-2.mp4");
		const systemPath = path.join(tempRoot, "recording-2.system.wav");
		const wavPath = path.join(tempRoot, "captions.wav");
		await fs.writeFile(videoPath, "video without extractable audio");
		await fs.writeFile(systemPath, "system audio");

		const execFileMock = vi.fn(
			(
				_: string,
				args: string[],
				__: unknown,
				callback: (error: Error | null, stdout?: string, stderr?: string) => void,
			) => {
				const inputPath = args[args.indexOf("-i") + 1];
				if (inputPath === videoPath) {
					callback(new Error("Stream map '0:a:0' matches no streams."));
					return;
				}

				callback(null, "", "");
			},
		);
		vi.doMock("node:child_process", () => ({
			execFile: execFileMock,
			spawn: vi.fn(),
			spawnSync: vi.fn(() => ({ status: 1, stdout: "" })),
		}));

		const { extractCaptionAudioSource } = await import("./generate");

		await expect(
			extractCaptionAudioSource({
				videoPath,
				ffmpegPath: "ffmpeg",
				wavPath,
			}),
		).resolves.toEqual({ path: systemPath, label: "source system audio" });
		expect(execFileMock).toHaveBeenCalledTimes(2);
	});
});
