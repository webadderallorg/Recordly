import { execFileAsync } from "./constants";
import { type NativeVideoStreamStatsProbe } from "./types";
import {
	parseNativeVideoStreamStatsProbeOutput,
	validateNativeVideoStreamStats,
} from "./validation";

export async function probeNativeVideoStreamStats(
	ffprobePath: string,
	inputPath: string,
): Promise<NativeVideoStreamStatsProbe> {
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
		{ timeout: 120_000, maxBuffer: 2 * 1024 * 1024 },
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
	const stats = await probeNativeVideoStreamStats(ffprobePath, videoPath);
	const issues = validateNativeVideoStreamStats(stats, expected);
	if (issues.length > 0) {
		throw new Error(`Native video output is invalid: ${issues.join("; ")}`);
	}
}
