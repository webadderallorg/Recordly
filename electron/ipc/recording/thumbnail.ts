import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { app } from "electron";
import { getFfmpegBinaryPath } from "../ffmpeg/binary";
import { resolveApprovedLocalMediaPath } from "../project/manager";
import { getRecordingsDir } from "../utils";

const run = promisify(execFile);
const pending = new Map<string, Promise<string>>();
let queue = Promise.resolve();

/** Decode one small still, never a video player per library row. */
export async function getRecordingThumbnail(candidate: string): Promise<string> {
	const root = await fs.realpath(await getRecordingsDir());
	const file = await resolveApprovedLocalMediaPath(candidate);
	if (!file || path.dirname(file) !== root || !/\.(mp4|mov|webm|mkv|m4v)$/i.test(file))
		throw new Error("Recording is outside the Videos library");
	const stat = await fs.stat(file);
	if (!stat.isFile()) throw new Error("Recording is not a file");
	const key = createHash("sha256").update(`${file}:${stat.mtimeMs}:${stat.size}`).digest("hex");
	const existing = pending.get(key);
	if (existing) return existing;
	const cache = path.join(app.getPath("userData"), "recording-thumbnails", `${key}.jpg`);
	const task = queue.then(async () => {
		let jpeg: Buffer;
		try {
			jpeg = await fs.readFile(cache);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			const result = await run(
				getFfmpegBinaryPath(),
				[
					"-hide_banner",
					"-loglevel",
					"error",
					"-nostdin",
					"-threads",
					"1",
					"-i",
					file,
					"-frames:v",
					"1",
					"-an",
					"-vf",
					"scale=160:90:force_original_aspect_ratio=increase,crop=160:90",
					"-q:v",
					"5",
					"-f",
					"image2pipe",
					"-c:v",
					"mjpeg",
					"pipe:1",
				],
				{ encoding: "buffer", maxBuffer: 512 * 1024, timeout: 15000, windowsHide: true },
			);
			jpeg = result.stdout;
			if (!jpeg.length) throw new Error("Recording has no preview frame");
			await fs.mkdir(path.dirname(cache), { recursive: true });
			await fs.writeFile(cache, jpeg);
		}
		return `data:image/jpeg;base64,${jpeg.toString("base64")}`;
	});
	pending.set(key, task);
	queue = task.then(
		() => undefined,
		() => undefined,
	);
	try {
		return await task;
	} finally {
		pending.delete(key);
	}
}
