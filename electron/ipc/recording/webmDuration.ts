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
