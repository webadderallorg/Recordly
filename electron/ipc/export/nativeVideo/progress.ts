import { type NativeStaticLayoutExportProgress } from "./types";

export function parseWindowsGpuExportProgressLine(
	line: string,
): NativeStaticLayoutExportProgress | null {
	const trimmed = line.trim();
	const prefix = "PROGRESS ";
	if (!trimmed.startsWith(prefix)) {
		return null;
	}

	try {
		const parsed = JSON.parse(trimmed.slice(prefix.length)) as {
			currentFrame?: unknown;
			totalFrames?: unknown;
			percentage?: unknown;
			averageFps?: unknown;
			instantFps?: unknown;
			intervalMs?: unknown;
			intervalFrames?: unknown;
			intervalDecodeWallMs?: unknown;
			intervalEncodeMs?: unknown;
			intervalPipelineWaitMs?: unknown;
			intervalCompositeMs?: unknown;
			intervalNvencMs?: unknown;
			intervalPacketWriteMs?: unknown;
			intervalWebcamDecodeMs?: unknown;
			intervalWebcamCopyMs?: unknown;
			intervalRoiCompositeFrames?: unknown;
			intervalMonolithicCompositeFrames?: unknown;
			intervalCopyCompositeFrames?: unknown;
			stage?: unknown;
		};
		const currentFrame = Number(parsed.currentFrame);
		const totalFrames = Number(parsed.totalFrames);
		const percentage = Number(parsed.percentage);
		if (
			!Number.isFinite(currentFrame) ||
			!Number.isFinite(totalFrames) ||
			!Number.isFinite(percentage) ||
			totalFrames <= 0
		) {
			return null;
		}

		const progress: NativeStaticLayoutExportProgress = {
			currentFrame: Math.max(0, Math.floor(currentFrame)),
			totalFrames: Math.max(1, Math.floor(totalFrames)),
			percentage: Math.min(100, Math.max(0, percentage)),
		};
		if (parsed.stage === "preparing" || parsed.stage === "finalizing") {
			progress.stage = parsed.stage;
		}
		const optionalNumberFields = [
			"averageFps",
			"instantFps",
			"intervalMs",
			"intervalFrames",
			"intervalDecodeWallMs",
			"intervalEncodeMs",
			"intervalPipelineWaitMs",
			"intervalCompositeMs",
			"intervalNvencMs",
			"intervalPacketWriteMs",
			"intervalWebcamDecodeMs",
			"intervalWebcamCopyMs",
			"intervalRoiCompositeFrames",
			"intervalMonolithicCompositeFrames",
			"intervalCopyCompositeFrames",
		] as const;
		for (const field of optionalNumberFields) {
			const value = Number(parsed[field]);
			if (Number.isFinite(value) && value >= 0) {
				progress[field] = value;
			}
		}
		return progress;
	} catch {
		return null;
	}
}

export function mapNvidiaCudaWrapperProgressPercentage(progress: NativeStaticLayoutExportProgress) {
	if (progress.stage === "finalizing") {
		return progress.percentage;
	}

	if (progress.currentFrame > 0 || progress.percentage === 0) {
		return Math.min(98, 3 + progress.percentage * 0.95);
	}

	return progress.percentage;
}

export function hasNativeStaticLayoutProgressAdvanced(
	progress: { currentFrame: number; percentage: number; stage?: string },
	previous: { currentFrame: number; percentage: number; stage?: string },
) {
	const currentFrame = Math.max(0, Math.floor(progress.currentFrame));
	const percentage =
		typeof progress.percentage === "number" && Number.isFinite(progress.percentage)
			? progress.percentage
			: 0;
	if (currentFrame > previous.currentFrame) {
		return true;
	}
	if (percentage > previous.percentage + 0.1) {
		return true;
	}
	return progress.stage === "finalizing" && previous.stage !== "finalizing";
}
