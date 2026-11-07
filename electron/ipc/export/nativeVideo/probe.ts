import { execFileAsync } from "./constants";
import { type NativeVideoStreamStatsProbe } from "./types";
import {
	parseNativeVideoStreamStatsProbeOutput,
	validateNativeVideoStreamStats,
} from "./validation";

export async function probeNativeVideoStreamStats(
	ffprobePath: string,
	inputPath: string,
	expected?: { durationSec: number; targetFrames: number },
): Promise<NativeVideoStreamStatsProbe> {
	// Counting frames scans the completed video. Allow real-time decoding at
	// half speed (or 15 fps for high-frame-rate video), plus startup overhead.
	const duration = Number.isFinite(expected?.durationSec)
		? Math.max(0, expected!.durationSec)
		: 0;
	const frames = Number.isFinite(expected?.targetFrames)
		? Math.max(0, expected!.targetFrames)
		: 0;
	const timeout = Math.min(
		2_147_483_647,
		Math.max(120_000, Math.ceil(Math.max(duration, frames / 30) * 2000) + 30_000),
	);
	const result = await execFileAsync(
		ffprobePath,
		[
			"-v",
			"error",
			"-select_streams",
			"v:0",
			"-count_frames",
			"-show_entries",
			"stream=duration,nb_frames,nb_read_frames,avg_frame_rate,r_frame_rate",
			"-of",
			"json",
			inputPath,
		],
		{ timeout, maxBuffer: 2 * 1024 * 1024 },
	);
	const stats = parseNativeVideoStreamStatsProbeOutput(result.stdout);
	if (!stats) {
		throw new Error("Unable to parse native video stream stats from FFprobe output");
	}

	return stats;
}

export async function validateNativeVideoOutputFile(
	ffprobePath: string,
	videoPath: string,
	expected: {
		durationSec: number;
		targetFrames: number;
	},
) {
	const stats = await probeNativeVideoStreamStats(ffprobePath, videoPath, expected);
	const issues = validateNativeVideoStreamStats(stats, expected);
	if (issues.length > 0) {
		throw new Error(`Native video output is invalid: ${issues.join("; ")}`);
	}
}
