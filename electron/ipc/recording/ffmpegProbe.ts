import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Shared probe timeout: ffmpeg listings must never hang the start flow. */
export const FFMPEG_PROBE_TIMEOUT_MS = 10_000;

/** ffmpeg's `-encoders` listing (what the binary can encode with). */
export async function listFfmpegEncoders(ffmpegPath: string): Promise<string> {
	return (
		await execFileAsync(ffmpegPath, ["-hide_banner", "-encoders"], {
			timeout: FFMPEG_PROBE_TIMEOUT_MS,
			maxBuffer: 1024 * 1024,
		})
	).stdout;
}

/** ffmpeg's `-devices` listing (what it can capture from / write to). */
export async function listFfmpegDevices(ffmpegPath: string): Promise<string> {
	return (
		await execFileAsync(ffmpegPath, ["-hide_banner", "-devices"], {
			timeout: FFMPEG_PROBE_TIMEOUT_MS,
			maxBuffer: 1024 * 1024,
		})
	).stdout;
}

/**
 * Picks the first candidate binary that passes `hasSupport`, skipping null
 * entries and duplicates so each path is probed at most once.
 */
export async function pickFirstCapableFfmpeg(
	candidates: Array<string | null | undefined>,
	hasSupport: (ffmpegPath: string) => Promise<boolean>,
): Promise<string | null> {
	const tried = new Set<string>();
	for (const candidate of candidates) {
		if (!candidate || tried.has(candidate)) continue;
		tried.add(candidate);
		if (await hasSupport(candidate)) {
			return candidate;
		}
	}
	return null;
}
