import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import { promisify } from "node:util";
import { getFfmpegBinaryPath } from "../ipc/ffmpeg/binary";

const execFileAsync = promisify(execFile);
const PROBE_TIMEOUT_MS = 20_000;
const DURATION = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/;

export type AudioFacts = { durationMs: number };

export async function probeAudioFile(filePath: string): Promise<AudioFacts> {
	const stat = await fs.stat(filePath).catch(() => null);
	if (!stat) throw new Error(`There is no file at ${filePath}.`);
	if (!stat.isFile()) throw new Error(`${filePath} is a folder, not a file.`);
	if (stat.size <= 0) throw new Error(`${filePath} is empty.`);

	let stderr = "";
	try {
		await execFileAsync(getFfmpegBinaryPath(), ["-hide_banner", "-i", filePath], {
			timeout: PROBE_TIMEOUT_MS,
			killSignal: "SIGKILL",
		});
	} catch (error) {
		const failure = error as { stderr?: string; killed?: boolean; code?: string };
		if (failure.killed) {
			throw new Error(`Reading ${filePath} took longer than ${PROBE_TIMEOUT_MS / 1000} s.`);
		}
		if (failure.code === "ENOENT")
			throw new Error("FFmpeg was not found, so the file cannot be read.");
		stderr = failure.stderr ?? "";
	}
	if (!/Stream #\d+:\d+.*: Audio:/.test(stderr)) {
		throw new Error(`${filePath} has no audio track Recordly can read.`);
	}
	const matched = DURATION.exec(stderr);
	if (!matched) throw new Error(`${filePath} has no readable duration.`);
	const [, hours, minutes, seconds] = matched;
	const durationMs = Math.round(
		(Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds)) * 1000,
	);
	if (!Number.isFinite(durationMs) || durationMs <= 0) {
		throw new Error(`${filePath} is ${durationMs} ms long, so there is nothing to add.`);
	}
	return { durationMs };
}
