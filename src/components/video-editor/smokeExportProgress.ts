import type { ExportProgress } from "@/lib/exporter/types";

const DEFAULT_SAMPLE_INTERVAL_MS = 1000;

export type SmokeExportProgressSample = {
	elapsedMs: number;
	phase: NonNullable<ExportProgress["phase"]> | "extracting";
	currentFrame: number;
	totalFrames: number;
	percentage: number;
	estimatedTimeRemaining: number;
	renderFps?: number;
	renderBackend?: ExportProgress["renderBackend"];
	encodeBackend?: ExportProgress["encodeBackend"];
	encoderName?: string;
};

type SmokeExportProgressSamplerOptions = {
	enabled: boolean;
	startedAtMs: number | null;
	now?: () => number;
	sampleIntervalMs?: number;
};

export function createSmokeExportProgressSampler({
	enabled,
	startedAtMs,
	now = () => performance.now(),
	sampleIntervalMs = DEFAULT_SAMPLE_INTERVAL_MS,
}: SmokeExportProgressSamplerOptions) {
	const samples: SmokeExportProgressSample[] = [];
	let lastSampleAt = 0;
	let lastSamplePhase: ExportProgress["phase"] | "extracting" | undefined;

	const record = (progress: ExportProgress) => {
		if (!enabled || startedAtMs === null) {
			return;
		}

		const timestamp = now();
		const phase = progress.phase ?? "extracting";
		const shouldSample =
			samples.length === 0 ||
			phase !== lastSamplePhase ||
			timestamp - lastSampleAt >= sampleIntervalMs ||
			progress.currentFrame >= progress.totalFrames;

		if (!shouldSample) {
			return;
		}

		samples.push({
			elapsedMs: Math.round(timestamp - startedAtMs),
			phase,
			currentFrame: progress.currentFrame,
			totalFrames: progress.totalFrames,
			percentage: progress.percentage,
			estimatedTimeRemaining: progress.estimatedTimeRemaining,
			renderFps: progress.renderFps,
			renderBackend: progress.renderBackend,
			encodeBackend: progress.encodeBackend,
			encoderName: progress.encoderName,
		});
		lastSampleAt = timestamp;
		lastSamplePhase = phase;
	};

	return {
		record,
		samples,
	};
}
