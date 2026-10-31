import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execFileAsync = promisify(execFile);

export interface NativeVideoMetadataProbe {
	width: number;
	height: number;
	duration: number;
	mediaStartTime?: number;
	streamStartTime?: number;
	streamDuration?: number;
	frameRate: number;
	codec: string;
	hasAudio: boolean;
	audioCodec?: string;
	audioSampleRate?: number;
}

export function parseFfmpegDurationSeconds(value: string): number | null {
	const parts = value.trim().split(":");
	if (parts.length !== 3) {
		return null;
	}

	const [hours, minutes, seconds] = parts.map(Number);
	if (![hours, minutes, seconds].every(Number.isFinite)) {
		return null;
	}

	return hours * 3600 + minutes * 60 + seconds;
}

export function parseFfmpegFrameRate(line: string): number | null {
	const fpsMatch = line.match(/,\s*([0-9]+(?:\.[0-9]+)?)\s*fps\b/i);
	if (fpsMatch) {
		const frameRate = Number(fpsMatch[1]);
		return Number.isFinite(frameRate) && frameRate > 0 ? frameRate : null;
	}

	const tbrMatch = line.match(/,\s*([0-9]+(?:\.[0-9]+)?)\s*tbr\b/i);
	if (tbrMatch) {
		const frameRate = Number(tbrMatch[1]);
		return Number.isFinite(frameRate) && frameRate > 0 ? frameRate : null;
	}

	return null;
}

export function parseNativeVideoMetadataProbeOutput(
	output: string,
): NativeVideoMetadataProbe | null {
	const durationMatch = output.match(
		/Duration:\s*([0-9:.]+),\s*start:\s*(-?[0-9]+(?:\.[0-9]+)?)/i,
	);
	const duration = durationMatch ? parseFfmpegDurationSeconds(durationMatch[1]) : null;
	if (!duration || duration <= 0) {
		return null;
	}

	const mediaStartTime = durationMatch ? Number(durationMatch[2]) : 0;
	const lines = output.split(/\r?\n/);
	const videoLine = lines.find((line) => /\bVideo:\s*/i.test(line));
	if (!videoLine) {
		return null;
	}

	const dimensionsMatch = videoLine.match(/,\s*([0-9]{2,5})x([0-9]{2,5})(?:[,\s]|$)/);
	if (!dimensionsMatch) {
		return null;
	}

	const width = Number(dimensionsMatch[1]);
	const height = Number(dimensionsMatch[2]);
	if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
		return null;
	}

	const videoCodecMatch = videoLine.match(/Video:\s*([^,\r\n]+)/i);
	const videoStartMatch = videoLine.match(/\bstart:\s*(-?[0-9]+(?:\.[0-9]+)?)/i);
	const frameRate = parseFfmpegFrameRate(videoLine) ?? 60;
	const audioLine = lines.find((line) => /\bAudio:\s*/i.test(line));
	const audioCodecMatch = audioLine?.match(/Audio:\s*([^,\r\n]+)/i);
	const audioSampleRateMatch = audioLine?.match(/,\s*([0-9]+)\s*Hz\b/i);

	return {
		width,
		height,
		duration,
		mediaStartTime: Number.isFinite(mediaStartTime) ? mediaStartTime : 0,
		streamStartTime: videoStartMatch ? Number(videoStartMatch[1]) : mediaStartTime,
		streamDuration: duration,
		frameRate,
		codec: videoCodecMatch?.[1]?.trim() || "unknown",
		hasAudio: Boolean(audioLine),
		audioCodec: audioCodecMatch?.[1]?.trim(),
		audioSampleRate: audioSampleRateMatch ? Number(audioSampleRateMatch[1]) : undefined,
	};
}

export async function probeNativeVideoMetadata(
	ffmpegPath: string,
	inputPath: string,
	signal?: AbortSignal,
): Promise<NativeVideoMetadataProbe> {
	let output = "";
	try {
		const result = await execFileAsync(ffmpegPath, ["-hide_banner", "-i", inputPath], {
			signal,
			timeout: 30_000,
			maxBuffer: 4 * 1024 * 1024,
		});
		output = `${result.stdout}\n${result.stderr}`;
	} catch (error) {
		signal?.throwIfAborted();
		const processOutput = error as { stdout?: unknown; stderr?: unknown };
		output = [processOutput.stdout, processOutput.stderr]
			.filter((value): value is string => typeof value === "string")
			.join("\n");
		if (!output) {
			throw error;
		}
	}

	const metadata = parseNativeVideoMetadataProbeOutput(output);
	if (!metadata) {
		throw new Error("Unable to parse native video metadata from FFmpeg output");
	}

	return metadata;
}
