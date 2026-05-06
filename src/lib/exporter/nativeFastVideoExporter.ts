import type {
	AnnotationRegion,
	AudioRegion,
	CaptionCue,
	CropRegion,
	CursorTelemetryPoint,
	Padding,
	SpeedRegion,
	TrimRegion,
	WebcamOverlaySettings,
	ZoomRegion,
} from "@/components/video-editor/types";
import { getLocalFilePath } from "./localMediaSource";
import type { ExportConfig, ExportMetrics, ExportResult } from "./types";

interface NativeFastVideoExporterConfig extends ExportConfig {
	videoUrl: string;
	sourceWidth: number;
	sourceHeight: number;
	sourceDurationMs: number;
	wallpaper: string;
	zoomRegions?: ZoomRegion[];
	trimRegions?: TrimRegion[];
	speedRegions?: SpeedRegion[];
	showShadow?: boolean;
	shadowIntensity?: number;
	backgroundBlur?: number;
	borderRadius?: number;
	padding?: Padding | number;
	cropRegion: CropRegion;
	webcam?: WebcamOverlaySettings;
	webcamUrl?: string | null;
	annotationRegions?: AnnotationRegion[];
	autoCaptions?: CaptionCue[];
	cursorTelemetry?: CursorTelemetryPoint[];
	showCursor?: boolean;
	frame?: string | null;
	audioRegions?: AudioRegion[];
	sourceAudioFallbackPaths?: string[];
}

export type NativeFastVideoExportPlan =
	| {
			eligible: true;
			sourcePath: string;
			segments?: Array<{ startMs: number; endMs: number }>;
			reason: string;
	  }
	| {
			eligible: false;
			reason: string;
	  };

const ASPECT_RATIO_TOLERANCE = 0.002;

type NativeFastVideoExportIpcResult = Awaited<
	ReturnType<Window["electronAPI"]["nativeFastVideoExport"]>
>;

function isEmpty<T>(items: readonly T[] | null | undefined): boolean {
	return !items || items.length === 0;
}

function isZeroPaddingValue(padding: Padding | number | null | undefined): boolean {
	if (padding === undefined || padding === null) {
		return true;
	}
	if (typeof padding === "number") {
		return padding === 0;
	}
	return padding.top === 0 && padding.bottom === 0 && padding.left === 0 && padding.right === 0;
}

function isDefaultCrop(cropRegion: CropRegion): boolean {
	return (
		cropRegion.x === 0 &&
		cropRegion.y === 0 &&
		cropRegion.width === 1 &&
		cropRegion.height === 1
	);
}

function hasMatchingAspectRatio(config: NativeFastVideoExporterConfig): boolean {
	const sourceAspect = config.sourceWidth / config.sourceHeight;
	const outputAspect = config.width / config.height;
	return Math.abs(sourceAspect - outputAspect) <= ASPECT_RATIO_TOLERANCE;
}

function buildSingleKeptSegment(
	trimRegions: TrimRegion[] | undefined,
	sourceDurationMs: number,
): Array<{ startMs: number; endMs: number }> | null {
	if (!trimRegions || trimRegions.length === 0) {
		return [];
	}

	if (!Number.isFinite(sourceDurationMs) || sourceDurationMs <= 0) {
		return null;
	}

	const sorted = [...trimRegions].sort((a, b) => a.startMs - b.startMs);
	const segments: Array<{ startMs: number; endMs: number }> = [];
	let cursorMs = 0;

	for (const region of sorted) {
		const startMs = Math.max(0, Math.min(region.startMs, sourceDurationMs));
		const endMs = Math.max(startMs, Math.min(region.endMs, sourceDurationMs));
		if (startMs > cursorMs) {
			segments.push({ startMs: cursorMs, endMs: startMs });
		}
		cursorMs = Math.max(cursorMs, endMs);
	}

	if (cursorMs < sourceDurationMs) {
		segments.push({ startMs: cursorMs, endMs: sourceDurationMs });
	}

	const keptSegments = segments.filter((segment) => segment.endMs - segment.startMs > 0.5);
	return keptSegments.length <= 1 ? keptSegments : null;
}

export function classifyNativeFastVideoExportPlan(
	config: NativeFastVideoExporterConfig,
): NativeFastVideoExportPlan {
	if (typeof window === "undefined" || !window.electronAPI?.nativeFastVideoExport) {
		return { eligible: false, reason: "native fast export IPC is unavailable" };
	}

	const sourcePath = getLocalFilePath(config.videoUrl);
	if (!sourcePath) {
		return { eligible: false, reason: "source is not a local file" };
	}

	if (
		!Number.isFinite(config.sourceWidth) ||
		!Number.isFinite(config.sourceHeight) ||
		config.sourceWidth <= 0 ||
		config.sourceHeight <= 0 ||
		!Number.isFinite(config.width) ||
		!Number.isFinite(config.height) ||
		config.width <= 0 ||
		config.height <= 0
	) {
		return { eligible: false, reason: "source or output dimensions are unavailable" };
	}

	if (!hasMatchingAspectRatio(config)) {
		return { eligible: false, reason: "output aspect ratio differs from the source" };
	}

	if (!isEmpty(config.zoomRegions)) {
		return { eligible: false, reason: "zoom regions require composed rendering" };
	}

	if (!isEmpty(config.speedRegions)) {
		return { eligible: false, reason: "speed regions require timeline rendering" };
	}

	if (!isEmpty(config.annotationRegions) || !isEmpty(config.autoCaptions)) {
		return { eligible: false, reason: "overlays require composed rendering" };
	}

	if (config.showCursor && !isEmpty(config.cursorTelemetry)) {
		return { eligible: false, reason: "cursor telemetry requires composed rendering" };
	}

	if (config.webcam?.enabled && (config.webcam.sourcePath || config.webcamUrl)) {
		return { eligible: false, reason: "webcam overlay requires composed rendering" };
	}

	if (!isEmpty(config.audioRegions) || !isEmpty(config.sourceAudioFallbackPaths)) {
		return { eligible: false, reason: "external audio regions require audio mixing" };
	}

	if (
		config.frame ||
		(config.showShadow && (config.shadowIntensity ?? 0) > 0) ||
		(config.backgroundBlur ?? 0) > 0 ||
		(config.borderRadius ?? 0) > 0 ||
		!isZeroPaddingValue(config.padding) ||
		!isDefaultCrop(config.cropRegion)
	) {
		return { eligible: false, reason: "scene styling requires composed rendering" };
	}

	const segments = buildSingleKeptSegment(config.trimRegions, config.sourceDurationMs);
	if (!segments) {
		return { eligible: false, reason: "multiple kept trim segments need composed export" };
	}
	if ((config.trimRegions?.length ?? 0) > 0 && segments.length === 0) {
		return { eligible: false, reason: "trim regions remove the whole source" };
	}

	return {
		eligible: true,
		sourcePath,
		segments: segments.length > 0 ? segments : undefined,
		reason: "source-only timeline can bypass renderer",
	};
}

export class NativeFastVideoExporter {
	private cancelled = false;

	constructor(private readonly config: NativeFastVideoExporterConfig) {}

	cancel(): void {
		this.cancelled = true;
	}

	async exportIfEligible(): Promise<ExportResult | null> {
		const plan = classifyNativeFastVideoExportPlan(this.config);
		if (!plan.eligible) {
			console.log(`[NativeFastVideoExporter] Skipping fast path: ${plan.reason}`);
			return null;
		}

		const startedAt = performance.now();
		console.log(`[NativeFastVideoExporter] Using FFmpeg render-bypass: ${plan.reason}`);
		const result: NativeFastVideoExportIpcResult = await window.electronAPI
			.nativeFastVideoExport({
				sourcePath: plan.sourcePath,
				width: this.config.width,
				height: this.config.height,
				frameRate: this.config.frameRate,
				bitrate: this.config.bitrate,
				encodingMode: this.config.encodingMode ?? "balanced",
				segments: plan.segments,
			})
			.catch(
				(error): NativeFastVideoExportIpcResult => ({
					success: false,
					error: error instanceof Error ? error.message : String(error),
				}),
			);

		if (this.cancelled) {
			return {
				success: false,
				error: "Export cancelled",
				metrics: this.buildMetrics(startedAt, result.encoderName, result.metrics),
			};
		}

		if (!result.success || !result.tempPath) {
			console.warn(
				"[NativeFastVideoExporter] Fast path failed; falling back to composed export:",
				result.error,
			);
			return null;
		}

		return {
			success: true,
			tempFilePath: result.tempPath,
			metrics: this.buildMetrics(startedAt, result.encoderName, result.metrics),
		};
	}

	private buildMetrics(
		startedAt: number,
		encoderName?: string,
		ffmpegMetrics?: { ffmpegExecMs?: number },
	): ExportMetrics {
		const totalElapsedMs = performance.now() - startedAt;
		const ffmpegExecMs = ffmpegMetrics?.ffmpegExecMs;

		return {
			totalElapsedMs,
			decodeLoopMs: 0,
			frameCallbackMs: 0,
			renderFrameMs: 0,
			encodeWaitMs: 0,
			encodeWaitEvents: 0,
			frameCount: 0,
			encodeBackend: "ffmpeg",
			encoderName: encoderName ? `ffmpeg-direct-${encoderName}` : "ffmpeg-direct",
			finalizationMs: ffmpegExecMs,
			finalizationStageMs: {
				nativeExportFinalizeMs: ffmpegExecMs,
				ffmpegAudioMuxBreakdown: ffmpegMetrics,
			},
		};
	}
}
