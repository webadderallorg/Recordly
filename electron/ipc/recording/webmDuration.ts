import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Stream copy runs at disk speed (a 2 GB file took 1 to 2 s); this only stops a hung
 * ffmpeg from blocking Stop forever. On timeout the file is kept as written.
 */
const REMUX_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * MediaRecorder writes WebM without a duration or cues, because it cannot seek
 * back in a live stream. Remuxing the finished file with stream copy writes
 * both, without decoding and without loading the file into memory.
 *
 * The original file is kept if the remux fails: a WebM without a duration
 * still plays, so the recording is never lost over this step.
 */
export async function writeWebmDuration(ffmpegPath: string, filePath: string): Promise<boolean> {
	const tempPath = `${filePath}.remux.webm`;
	try {
		await execFileAsync(
			ffmpegPath,
			["-y", "-hide_banner", "-loglevel", "error", "-i", filePath, "-c", "copy", tempPath],
			{ maxBuffer: 10 * 1024 * 1024, timeout: REMUX_TIMEOUT_MS },
		);
		await fs.rename(tempPath, filePath);
		return true;
	} catch (error) {
		console.warn("Failed to write WebM duration; keeping the recording as written:", error);
		await fs.rm(tempPath, { force: true }).catch(() => undefined);
		return false;
	}
}

/**
 * Finishes a WebM recording on disk and returns the path to use from now on.
 *
 * A webcam WebM with H.264 video is remuxed (stream copy) to an MP4 next to it, and the
 * WebM is deleted. The webcam records H.264 in WebM on purpose: Chromium's MediaRecorder
 * MP4 muxer keeps its write position in a uint32 and crashes the renderer once a file
 * passes 4 GiB (media/muxers/output_position_tracker.cc), while the WebM muxer has no such
 * limit. The webcam was MP4 before, and the exporters and the editor's codec checks still
 * expect MP4/H.264 for it (canPlayType reports H.264 in WebM as unplayable).
 *
 * Any other WebM gets its duration written (writeWebmDuration). If the remux fails, the
 * WebM is kept the same way, so the recording is never lost over this step.
 */
export async function finishWebmRecording(ffmpegPath: string, filePath: string): Promise<string> {
	const mp4Path = await remuxH264WebmToMp4(ffmpegPath, filePath);
	if (mp4Path) {
		return mp4Path;
	}
	await writeWebmDuration(ffmpegPath, filePath);
	return filePath;
}

/**
 * Remuxes a webcam WebM (`*-webcam.webm`) whose video is H.264 to an MP4 next to it and
 * deletes the WebM. Returns the MP4 path, or null for any other file, any other codec, or a
 * failed remux (the WebM is then left as it was). Screen recordings keep their format.
 */
export async function remuxH264WebmToMp4(
	ffmpegPath: string,
	filePath: string,
): Promise<string | null> {
	if (
		!/-webcam\.webm$/i.test(filePath) ||
		(await probeVideoCodec(ffmpegPath, filePath)) !== "h264"
	) {
		return null;
	}
	const mp4Path = filePath.replace(/\.webm$/i, ".mp4");
	const tempPath = `${mp4Path}.remux.mp4`;
	try {
		await execFileAsync(
			ffmpegPath,
			[
				"-y",
				"-hide_banner",
				"-loglevel",
				"error",
				"-i",
				filePath,
				"-map",
				"0",
				"-c",
				"copy",
				"-f",
				"mp4",
				tempPath,
			],
			{ maxBuffer: 10 * 1024 * 1024, timeout: REMUX_TIMEOUT_MS },
		);
		// link, unlike rename, fails if the MP4 already exists: never replace another recording.
		await fs.link(tempPath, mp4Path);
		await fs.rm(tempPath, { force: true });
		await fs.rm(filePath, { force: true });
		return mp4Path;
	} catch (error) {
		console.warn("Failed to remux H.264 WebM to MP4; keeping the WebM:", error);
		await fs.rm(tempPath, { force: true }).catch(() => undefined);
		return null;
	}
}

async function probeVideoCodec(ffmpegPath: string, filePath: string): Promise<string | null> {
	// `ffmpeg -i` with no output exits 1 and prints the stream list on stderr.
	const { stderr } = await execFileAsync(ffmpegPath, ["-hide_banner", "-i", filePath], {
		timeout: 60_000,
	}).catch((error: { stderr?: string }) => ({ stderr: error.stderr ?? "" }));
	return /Stream #\S+.*?: Video: (\w+)/.exec(stderr)?.[1] ?? null;
}
