import type { ExportProgress } from "@/lib/exporter";

/** Stage changes and backend retries must not rewind the overall progress bar. */
export function resolveExportProgressUpdate(
	previous: ExportProgress | null,
	next: ExportProgress | null,
): ExportProgress | null {
	if (!next) return null;
	const percent = (value: number) =>
		Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;
	return {
		...next,
		percentage: Math.max(
			percent(previous?.percentage ?? 0),
			next.phase === "preparing" ? 0 : percent(next.percentage),
		),
	};
}

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
