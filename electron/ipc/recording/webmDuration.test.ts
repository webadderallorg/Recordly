import { execFile, spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import ffmpegStatic from "ffmpeg-static";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { finishWebmRecording, remuxH264WebmToMp4, writeWebmDuration } from "./webmDuration";

const execFileAsync = promisify(execFile);
const ffmpegPath = ffmpegStatic as unknown as string | null;

async function hasFfmpeg() {
	if (!ffmpegPath) {
		return false;
	}
	return fs
		.access(ffmpegPath)
		.then(() => true)
		.catch(() => false);
}

async function readFormatDuration(filePath: string): Promise<string | null> {
	// ffmpeg prints "Duration: N/A" for a WebM that has no duration element.
	const result = await execFileAsync(ffmpegPath as string, [
		"-hide_banner",
		"-i",
		filePath,
	]).catch((error: { stderr?: string }) => ({ stderr: error.stderr ?? "" }));
	return /Duration: ([^,]+),/.exec(result.stderr)?.[1] ?? null;
}

async function readVideoCodec(filePath: string): Promise<string | null> {
	const result = await execFileAsync(ffmpegPath as string, [
		"-hide_banner",
		"-i",
		filePath,
	]).catch((error: { stderr?: string }) => ({ stderr: error.stderr ?? "" }));
	return /Video: (\w+)/.exec(result.stderr)?.[1] ?? null;
}

/** Writes WebM to a pipe, so the muxer cannot seek back: like MediaRecorder. */
function writeLiveStyleWebm(filePath: string, codec: "vp8" | "h264" = "vp8") {
	return new Promise<void>((resolve, reject) => {
		const child = spawn(ffmpegPath as string, [
			"-hide_banner",
			"-loglevel",
			"error",
			"-f",
			"lavfi",
			"-i",
			"testsrc=duration=2:size=160x120:rate=15",
			...(codec === "vp8"
				? ["-c:v", "libvpx", "-f", "webm"]
				: // ffmpeg's webm muxer refuses H.264; MediaRecorder's WebM is Matroska with H.264
					["-c:v", "libx264", "-pix_fmt", "yuv420p", "-f", "matroska"]),
			"pipe:1",
		]);
		const out = createWriteStream(filePath);
		child.stdout.pipe(out);
		child.on("error", reject);
		out.on("finish", resolve);
	});
}

describe.runIf(await hasFfmpeg())("writeWebmDuration", () => {
	let dir: string;

	beforeEach(async () => {
		dir = await fs.mkdtemp(path.join(os.tmpdir(), "recordly-webm-duration-"));
	});

	afterEach(async () => {
		await fs.rm(dir, { recursive: true, force: true });
	});

	it("adds the duration to a WebM written as a live stream", async () => {
		const filePath = path.join(dir, "recording-1-webcam.webm");
		await writeLiveStyleWebm(filePath);
		expect(await readFormatDuration(filePath)).toBe("N/A");

		await expect(writeWebmDuration(ffmpegPath as string, filePath)).resolves.toBe(true);

		expect(await readFormatDuration(filePath)).toMatch(/^00:00:0[12]\.\d+$/);
		await expect(fs.access(`${filePath}.remux.webm`)).rejects.toThrow();
	});

	it("keeps the original file when the remux fails", async () => {
		const filePath = path.join(dir, "recording-1-webcam.webm");
		await fs.writeFile(filePath, "not a webm file");

		await expect(writeWebmDuration(ffmpegPath as string, filePath)).resolves.toBe(false);

		expect(await fs.readFile(filePath, "utf8")).toBe("not a webm file");
		await expect(fs.access(`${filePath}.remux.webm`)).rejects.toThrow();
	});
});

describe.runIf(await hasFfmpeg())("finishWebmRecording", () => {
	let dir: string;

	beforeEach(async () => {
		dir = await fs.mkdtemp(path.join(os.tmpdir(), "recordly-webm-finish-"));
	});

	afterEach(async () => {
		await fs.rm(dir, { recursive: true, force: true });
	});

	it("turns H.264 in WebM into an MP4 with a duration and deletes the WebM", async () => {
		const filePath = path.join(dir, "recording-1-webcam.webm");
		await writeLiveStyleWebm(filePath, "h264");

		const finalPath = await finishWebmRecording(ffmpegPath as string, filePath);

		expect(finalPath).toBe(path.join(dir, "recording-1-webcam.mp4"));
		expect(await readVideoCodec(finalPath)).toBe("h264");
		expect(await readFormatDuration(finalPath)).toMatch(/^00:00:0[12]\.\d+$/);
		await expect(fs.access(filePath)).rejects.toThrow();
		expect(await fs.readdir(dir)).toEqual(["recording-1-webcam.mp4"]);
	});

	it("turns a webcam WebM cut off mid-write (a crashed renderer) into a playable MP4", async () => {
		const filePath = path.join(dir, "recording-1-webcam.webm");
		await writeLiveStyleWebm(filePath, "h264");
		const full = await fs.readFile(filePath);
		await fs.writeFile(filePath, full.subarray(0, Math.floor(full.length * 0.6)));

		const finalPath = await finishWebmRecording(ffmpegPath as string, filePath);

		// Either way exactly one file is left, and it plays.
		expect(await fs.readdir(dir)).toEqual([path.basename(finalPath)]);
		expect(await readVideoCodec(finalPath)).toBe("h264");
		const decode = await execFileAsync(ffmpegPath as string, [
			"-hide_banner",
			"-v",
			"error",
			"-i",
			finalPath,
			"-f",
			"null",
			"-",
		]).catch((error: { stderr?: string }) => ({ stderr: error.stderr ?? "decode failed" }));
		expect(finalPath).toBe(path.join(dir, "recording-1-webcam.mp4"));
		expect(decode.stderr).toBe("");
	});

	it("never replaces an MP4 that is already there", async () => {
		const filePath = path.join(dir, "recording-1-webcam.webm");
		const existing = path.join(dir, "recording-1-webcam.mp4");
		await writeLiveStyleWebm(filePath, "h264");
		await fs.writeFile(existing, "an earlier recording");

		const finalPath = await finishWebmRecording(ffmpegPath as string, filePath);

		expect(finalPath).toBe(filePath);
		expect(await fs.readFile(existing, "utf8")).toBe("an earlier recording");
		expect((await fs.readdir(dir)).sort()).toEqual([
			"recording-1-webcam.mp4",
			"recording-1-webcam.webm",
		]);
	});

	it("keeps an H.264 screen WebM as WebM: only webcam files become MP4", async () => {
		const filePath = path.join(dir, "recording-1.webm");
		await writeLiveStyleWebm(filePath, "h264");

		const finalPath = await finishWebmRecording(ffmpegPath as string, filePath);

		expect(finalPath).toBe(filePath);
		expect(await readVideoCodec(filePath)).toBe("h264");
		expect(await fs.readdir(dir)).toEqual(["recording-1.webm"]);
	});

	it("keeps a VP8 WebM as WebM and writes its duration", async () => {
		const filePath = path.join(dir, "recording-1-webcam.webm");
		await writeLiveStyleWebm(filePath, "vp8");

		const finalPath = await finishWebmRecording(ffmpegPath as string, filePath);

		expect(finalPath).toBe(filePath);
		expect(await readFormatDuration(filePath)).toMatch(/^00:00:0[12]\.\d+$/);
		expect(await fs.readdir(dir)).toEqual(["recording-1-webcam.webm"]);
	});

	it("leaves a non-H.264 WebM untouched on the store path", async () => {
		const filePath = path.join(dir, "recording-1-webcam.webm");
		await writeLiveStyleWebm(filePath, "vp8");
		const before = await fs.readFile(filePath);

		await expect(remuxH264WebmToMp4(ffmpegPath as string, filePath)).resolves.toBeNull();

		expect((await fs.readFile(filePath)).equals(before)).toBe(true);
	});
});
