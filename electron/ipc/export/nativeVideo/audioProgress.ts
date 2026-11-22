import type { NativeVideoAudioMuxProgress } from "./types";

export function parseFfmpegProgressClockSeconds(value: string) {
	const match = value.match(/^(\d+):(\d+):(\d+(?:\.\d+)?)$/);
	if (!match) {
		return null;
	}

	const hours = Number(match[1]);
	const minutes = Number(match[2]);
	const seconds = Number(match[3]);
	if (![hours, minutes, seconds].every(Number.isFinite)) {
		return null;
	}

	return hours * 3600 + minutes * 60 + seconds;
}

export function parseFfmpegProgressLineSeconds(line: string) {
	const separatorIndex = line.indexOf("=");
	if (separatorIndex <= 0) {
		return null;
	}

	const key = line.slice(0, separatorIndex).trim();
	const value = line.slice(separatorIndex + 1).trim();
	if (key === "out_time_us" || key === "out_time_ms") {
		const microseconds = Number(value);
		return Number.isFinite(microseconds) && microseconds >= 0 ? microseconds / 1_000_000 : null;
	}
	if (key === "out_time") {
		return parseFfmpegProgressClockSeconds(value);
	}

	return null;
}

export function createFfmpegMuxProgressHandler(
	totalSec: number | undefined,
	onProgress?: (progress: NativeVideoAudioMuxProgress) => void,
) {
	if (!onProgress || !Number.isFinite(totalSec) || !totalSec || totalSec <= 0) {
		return () => undefined;
	}

	let lineBuffer = "";
	let lastRatio = 0;
	return (chunk: Buffer | string) => {
		lineBuffer += chunk.toString();
		const lines = lineBuffer.split(/\r?\n/);
		lineBuffer = lines.pop() ?? "";
		for (const line of lines) {
			const processedSec = parseFfmpegProgressLineSeconds(line);
			if (processedSec === null) {
				continue;
			}
			const ratio = Math.max(0, Math.min(1, processedSec / totalSec));
			if (ratio < lastRatio + 0.0025 && ratio < 1) {
				continue;
			}
			lastRatio = Math.max(lastRatio, ratio);
			onProgress({
				ratio: lastRatio,
				processedSec,
				totalSec,
			});
		}
	};
}
