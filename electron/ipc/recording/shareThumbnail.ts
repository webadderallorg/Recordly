import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getFfmpegBinaryPath } from "../ffmpeg/binary";

const run = promisify(execFile);

/** The caller must validate the local export path before decoding it. */
export async function createShareThumbnail(filePath: string, signal: AbortSignal): Promise<Buffer> {
	const { stdout } = await run(
		getFfmpegBinaryPath(),
		[
			"-hide_banner",
			"-loglevel",
			"error",
			"-nostdin",
			"-threads",
			"1",
			"-i",
			filePath,
			"-frames:v",
			"1",
			"-an",
			"-vf",
			"scale=640:640:force_original_aspect_ratio=decrease",
			"-q:v",
			"4",
			"-f",
			"image2pipe",
			"-c:v",
			"mjpeg",
			"pipe:1",
		],
		{ encoding: "buffer", maxBuffer: 1024 * 1024, timeout: 15000, windowsHide: true, signal },
	);
	if (!stdout.length) throw new Error("Video has no preview frame");
	return stdout;
}
