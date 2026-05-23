import type { ExportProgress } from "@/lib/exporter";

export function resolveSavingExportProgress(previous: ExportProgress | null): ExportProgress {
	return {
		currentFrame: previous?.totalFrames ?? previous?.currentFrame ?? 1,
		totalFrames: previous?.totalFrames ?? previous?.currentFrame ?? 1,
		percentage: 100,
		estimatedTimeRemaining: 0,
		renderFps: previous?.renderFps,
		renderBackend: previous?.renderBackend,
		encodeBackend: previous?.encodeBackend,
		encoderName: previous?.encoderName,
		phase: "saving",
	};
}
