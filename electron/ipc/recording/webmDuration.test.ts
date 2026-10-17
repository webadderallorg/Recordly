import { execFile, spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import ffmpegStatic from "ffmpeg-static";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeWebmDuration } from "./webmDuration";

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

/** Writes WebM to a pipe, so the muxer cannot seek back: like MediaRecorder. */
function writeLiveStyleWebm(filePath: string) {
	return new Promise<void>((resolve, reject) => {
		const child = spawn(ffmpegPath as string, [
			"-hide_banner",
			"-loglevel",
			"error",
			"-f",
			"lavfi",
			"-i",
			"testsrc=duration=2:size=160x120:rate=15",
			"-c:v",
			"libvpx",
			"-f",
			"webm",
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
