import {
	type NativeVideoStreamStatsProbe,
	type NvidiaCudaExportSummary,
	type WindowsGpuExportSummary,
} from "./types";

export function parseWindowsGpuExportSummary(stdout: string): WindowsGpuExportSummary | null {
	const summaryLine = stdout
		.trim()
		.split(/\r?\n/)
		.reverse()
		.find((line) => line.trim().startsWith("{"));
	if (!summaryLine) {
		return null;
	}

	try {
		const parsed = JSON.parse(summaryLine) as WindowsGpuExportSummary;
		return parsed && typeof parsed === "object" ? parsed : null;
	} catch {
		return null;
	}
}

export function parseNvidiaCudaExportSummary(stdout: string): NvidiaCudaExportSummary | null {
	const trimmed = stdout.trim();
	const startIndex = trimmed.indexOf("{");
	const endIndex = trimmed.lastIndexOf("}");
	if (startIndex === -1 || endIndex <= startIndex) {
		return null;
	}

	try {
		const parsed = JSON.parse(
			trimmed.slice(startIndex, endIndex + 1),
		) as NvidiaCudaExportSummary;
		return parsed && typeof parsed === "object" ? parsed : null;
	} catch {
		return null;
	}
}

export function getFiniteNumber(value: unknown) {
	const numberValue = typeof value === "string" ? Number(value) : value;
	return typeof numberValue === "number" && Number.isFinite(numberValue) ? numberValue : null;
}

export function getNvidiaCudaOutputStreamNumber(stream: unknown, property: string) {
	if (!stream || typeof stream !== "object") {
		return null;
	}

	return getFiniteNumber((stream as Record<string, unknown>)[property]);
}

export function validateNvidiaCudaExportSummary(
	summary: NvidiaCudaExportSummary,
	expected: {
		durationSec: number;
		targetFrames: number;
		requiresTimelineSync?: boolean;
	},
) {
	const issues: string[] = [];
	const expectedFrames = Math.max(1, Math.round(expected.targetFrames));
	const minimumFrames = Math.max(1, Math.floor(expectedFrames * 0.95));
	const expectedDurationSec = Math.max(0, expected.durationSec);
	const durationToleranceSec = Math.min(2, Math.max(0.5, expectedDurationSec * 0.02));
	const nativeFrames = getFiniteNumber(summary.nativeSummary?.frames);
	const outputVideoFrames = getNvidiaCudaOutputStreamNumber(summary.outputVideo, "nb_frames");
	const outputVideoDurationSec = getNvidiaCudaOutputStreamNumber(summary.outputVideo, "duration");
	const outputAudioDurationSec = getNvidiaCudaOutputStreamNumber(summary.outputAudio, "duration");

	if (!summary.outputVideo) {
		issues.push("missing output video probe");
	}
	if (expected.requiresTimelineSync && !isNvidiaCudaTimestampAlignedSummary(summary)) {
		issues.push("CUDA timeline mode is not timestamp-aligned for audio export");
	}
	if (expected.requiresTimelineSync) {
		if (!summary.outputAudio) {
			issues.push("missing output audio stream");
		} else if (outputAudioDurationSec === null) {
			issues.push("missing output audio duration");
		} else if (outputAudioDurationSec <= 0) {
			issues.push("output audio duration is not positive");
		}
	}
	if (nativeFrames === null) {
		issues.push("missing native frame count");
	} else if (nativeFrames < minimumFrames) {
		issues.push(`native frames ${nativeFrames} below expected minimum ${minimumFrames}`);
	}
	if (outputVideoFrames !== null && outputVideoFrames < minimumFrames) {
		issues.push(
			`output video frames ${outputVideoFrames} below expected minimum ${minimumFrames}`,
		);
	}
	if (
		outputVideoDurationSec !== null &&
		Math.abs(outputVideoDurationSec - expectedDurationSec) > durationToleranceSec
	) {
		issues.push(
			`output video duration ${outputVideoDurationSec.toFixed(
				3,
			)}s differs from expected ${expectedDurationSec.toFixed(3)}s`,
		);
	}
	if (
		outputAudioDurationSec !== null &&
		outputAudioDurationSec > 0 &&
		Math.abs(outputAudioDurationSec - expectedDurationSec) > durationToleranceSec
	) {
		issues.push(
			`output audio duration ${outputAudioDurationSec.toFixed(
				3,
			)}s differs from expected ${expectedDurationSec.toFixed(3)}s`,
		);
	}

	return issues;
}

export function validateWindowsGpuExportSummary(
	summary: WindowsGpuExportSummary,
	expected: {
		durationSec: number;
		targetFrames: number;
	},
) {
	const issues: string[] = [];
	const expectedFrames = Math.max(1, Math.round(expected.targetFrames));
	const minimumFrames = Math.max(1, Math.floor(expectedFrames * 0.95));
	const expectedDurationSec = Math.max(0, expected.durationSec);
	const durationToleranceSec = Math.min(2, Math.max(0.5, expectedDurationSec * 0.02));
	const frames = getFiniteNumber(summary.frames);
	const mediaMs = getFiniteNumber(summary.mediaMs);
	const seconds = getFiniteNumber(summary.seconds) ?? (mediaMs !== null ? mediaMs / 1000 : null);

	if (frames === null) {
		issues.push("missing Windows GPU frame count");
	} else if (frames < minimumFrames) {
		issues.push(`Windows GPU frames ${frames} below expected minimum ${minimumFrames}`);
	}
	if (
		seconds !== null &&
		Number.isFinite(seconds) &&
		Math.abs(seconds - expectedDurationSec) > durationToleranceSec
	) {
		issues.push(
			`Windows GPU duration ${seconds.toFixed(3)}s differs from expected ${expectedDurationSec.toFixed(3)}s`,
		);
	}

	return issues;
}

export function parseRationalFrameRate(value: unknown) {
	if (typeof value !== "string") {
		return null;
	}
	const [numeratorRaw, denominatorRaw] = value.split("/");
	const numerator = Number(numeratorRaw);
	const denominator = Number(denominatorRaw);
	if (
		!Number.isFinite(numerator) ||
		!Number.isFinite(denominator) ||
		numerator <= 0 ||
		denominator <= 0
	) {
		return null;
	}

	return numerator / denominator;
}

export function parseOptionalPositiveNumber(value: unknown) {
	const parsed =
		typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
	return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function parseOptionalPositiveInteger(value: unknown) {
	const parsed = parseOptionalPositiveNumber(value);
	return parsed === null ? null : Math.max(0, Math.round(parsed));
}

export function parseNativeVideoStreamStatsProbeOutput(
	output: string,
): NativeVideoStreamStatsProbe | null {
	const parsed = JSON.parse(output) as {
		streams?: Array<{
			duration?: unknown;
			nb_frames?: unknown;
			nb_read_frames?: unknown;
			avg_frame_rate?: unknown;
			r_frame_rate?: unknown;
		}>;
	};
	const stream = parsed.streams?.[0];
	if (!stream) {
		return null;
	}

	return {
		durationSec: parseOptionalPositiveNumber(stream.duration),
		frameCount:
			parseOptionalPositiveInteger(stream.nb_read_frames) ??
			parseOptionalPositiveInteger(stream.nb_frames),
		frameRate:
			parseRationalFrameRate(stream.avg_frame_rate) ??
			parseRationalFrameRate(stream.r_frame_rate),
	};
}

export function validateNativeVideoStreamStats(
	stats: NativeVideoStreamStatsProbe,
	expected: {
		durationSec: number;
		targetFrames: number;
	},
) {
	const issues: string[] = [];
	const expectedFrames = Math.max(1, Math.round(expected.targetFrames));
	const minimumFrames = Math.max(1, Math.floor(expectedFrames * 0.95));
	const expectedDurationSec = Math.max(0, expected.durationSec);
	const durationToleranceSec = Math.min(2, Math.max(0.5, expectedDurationSec * 0.02));

	if (stats.frameCount === null) {
		issues.push("missing video frame count");
	} else if (stats.frameCount < minimumFrames) {
		issues.push(`video frames ${stats.frameCount} below expected minimum ${minimumFrames}`);
	}

	if (stats.durationSec === null) {
		issues.push("missing video stream duration");
	} else if (Math.abs(stats.durationSec - expectedDurationSec) > durationToleranceSec) {
		issues.push(
			`video stream duration ${stats.durationSec.toFixed(
				3,
			)}s differs from expected ${expectedDurationSec.toFixed(3)}s`,
		);
	}

	return issues;
}

export function isNvidiaCudaTimestampAlignedSummary(summary: NvidiaCudaExportSummary) {
	const nativeSummary = summary.nativeSummary;
	const timelineFields = [
		nativeSummary?.sourceTimestampMode,
		nativeSummary?.timelineMode,
		nativeSummary?.selectionStage,
	];
	return timelineFields.some((value) => {
		const normalized = String(value ?? "").toLowerCase();
		return normalized.includes("pts") || normalized.includes("timestamp");
	});
}
