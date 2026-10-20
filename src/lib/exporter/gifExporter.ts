import GIF from "gif.js";
import type {
	AnnotationRegion,
	AutoCaptionSettings,
	CaptionCue,
	CursorClickEffectStyle,
	CropRegion,
	CursorStyle,
	CursorTelemetryPoint,
	Padding,
	SpeedRegion,
	TrimRegion,
	WebcamOverlaySettings,
	ZoomMotionBlurTuning,
	ZoomRegion,
	ZoomTransitionEasing,
} from "@/components/video-editor/types";
import { FrameRenderer } from "./frameRenderer";
import { StreamingVideoDecoder } from "./streamingDecoder";
import type {
	ExportProgress,
	ExportResult,
	GIF_SIZE_PRESETS,
	GifFrameRate,
	GifSizePreset,
} from "./types";

const GIF_WORKER_URL = new URL("gif.js/dist/gif.worker.js", import.meta.url).toString();

const PROGRESS_SAMPLE_WINDOW_MS = 1_000;

interface GifExporterConfig {
	clipRegions?: import("@/components/video-editor/types").ClipRegion[];
	videoUrl: string;
	width: number;
	height: number;
	frameRate: GifFrameRate;
	loop: boolean;
	sizePreset: GifSizePreset;
	wallpaper: string;
	zoomRegions: ZoomRegion[];
	trimRegions?: TrimRegion[];
	speedRegions?: SpeedRegion[];
	showShadow: boolean;
	shadowIntensity: number;
	backgroundBlur: number;
	zoomMotionBlur?: number;
	zoomMotionBlurTuning?: ZoomMotionBlurTuning;
	connectZooms?: boolean;
	zoomInDurationMs?: number;
	zoomInOverlapMs?: number;
	zoomOutDurationMs?: number;
	connectedZoomGapMs?: number;
	connectedZoomDurationMs?: number;
	zoomInEasing?: ZoomTransitionEasing;
	zoomOutEasing?: ZoomTransitionEasing;
	connectedZoomEasing?: ZoomTransitionEasing;
	borderRadius?: number;
	padding?: Padding | number;
	videoPadding?: Padding | number;
	cropRegion: CropRegion;
	webcam?: WebcamOverlaySettings;
	webcamUrl?: string | null;
	annotationRegions?: AnnotationRegion[];
	autoCaptions?: CaptionCue[];
	autoCaptionSettings?: AutoCaptionSettings;
	cursorTelemetry?: CursorTelemetryPoint[];
	showCursor?: boolean;
	cursorStyle?: CursorStyle;
	cursorSize?: number;
	cursorSmoothing?: number;
	cursorSpringStiffnessMultiplier?: number;
	cursorSpringDampingMultiplier?: number;
	cursorSpringMassMultiplier?: number;
	cameraSpringStiffnessMultiplier?: number;
	cameraSpringDampingMultiplier?: number;
	cameraSpringMassMultiplier?: number;
	zoomSmoothness?: number;
	zoomClassicMode?: boolean;
	cursorMotionBlur?: number;
	cursorClickEffect?: CursorClickEffectStyle;
	cursorClickEffectColor?: string;
	cursorClickEffectScale?: number;
	cursorClickEffectOpacity?: number;
	cursorClickEffectDurationMs?: number;
	cursorClickBounce?: number;
	cursorClickBounceDuration?: number;
	cursorSway?: number;
	previewWidth?: number;
	previewHeight?: number;
	maxDecodeQueue?: number;
	maxPendingFrames?: number;
	onProgress?: (progress: ExportProgress) => void;
}

/**
 * Calculate output dimensions based on size preset and source dimensions while preserving aspect ratio.
 * @param sourceWidth - Original video width
 * @param sourceHeight - Original video height
 * @param sizePreset - The size preset to use
 * @param sizePresets - The size presets configuration
 * @returns The calculated output dimensions
 */
export function calculateOutputDimensions(
	sourceWidth: number,
	sourceHeight: number,
	sizePreset: GifSizePreset,
	sizePresets: typeof GIF_SIZE_PRESETS,
): { width: number; height: number } {
	const preset = sizePresets[sizePreset];
	const maxHeight = preset.maxHeight;

	// If original is smaller than max height or preset is 'original', use source dimensions
	if (sourceHeight <= maxHeight || sizePreset === "original") {
		return { width: sourceWidth, height: sourceHeight };
	}

	// Calculate scaled dimensions preserving aspect ratio
	const aspectRatio = sourceWidth / sourceHeight;
	const newHeight = maxHeight;
	const newWidth = Math.round(newHeight * aspectRatio);

	// Ensure dimensions are even (required for some encoders)
	return {
		width: newWidth % 2 === 0 ? newWidth : newWidth + 1,
		height: newHeight % 2 === 0 ? newHeight : newHeight + 1,
	};
}

export function getGifRepeat(loop: boolean): 0 | 1 {
	return loop ? 0 : 1;
}

/**
 * Wire a gif.js render into a promise. Resolves on the encoder's "finished"
 * event and rejects on "abort" so a mid-render cancel does not leave the
 * promise pending forever. Progress ticks are forwarded when provided.
 */
export function awaitGifRender(
	gif: GIF,
	onProgress?: (percent: number) => void,
): Promise<Blob> {
	return new Promise<Blob>((resolve, reject) => {
		gif.once("finished", (blob: Blob) => {
			resolve(blob);
		});
		gif.once("abort", () => {
			reject(new Error("Export cancelled"));
		});
		if (onProgress) {
			gif.on("progress", onProgress);
		}
		gif.render();
	});
}

export function buildGifFrameRendererConfig(
	config: GifExporterConfig,
	videoInfo: { width: number; height: number },
) {
	return {
		width: config.width,
		timelineEffects: config.clipRegions !== undefined,
		height: config.height,
		wallpaper: config.wallpaper,
		zoomRegions: config.zoomRegions,
		showShadow: config.showShadow,
		shadowIntensity: config.shadowIntensity,
		backgroundBlur: config.backgroundBlur,
		zoomMotionBlur: config.zoomMotionBlur,
		zoomMotionBlurTuning: config.zoomMotionBlurTuning,
		connectZooms: config.connectZooms,
		zoomInDurationMs: config.zoomInDurationMs,
		zoomInOverlapMs: config.zoomInOverlapMs,
		zoomOutDurationMs: config.zoomOutDurationMs,
		connectedZoomGapMs: config.connectedZoomGapMs,
		connectedZoomDurationMs: config.connectedZoomDurationMs,
		zoomInEasing: config.zoomInEasing,
		zoomOutEasing: config.zoomOutEasing,
		connectedZoomEasing: config.connectedZoomEasing,
		borderRadius: config.borderRadius,
		padding: config.padding,
		cropRegion: config.cropRegion,
		webcam: config.webcam,
		webcamUrl: config.webcamUrl,
		videoWidth: videoInfo.width,
		videoHeight: videoInfo.height,
		annotationRegions: config.annotationRegions,
		autoCaptions: config.autoCaptions,
		autoCaptionSettings: config.autoCaptionSettings,
		speedRegions: config.speedRegions,
		previewWidth: config.previewWidth,
		previewHeight: config.previewHeight,
		cursorTelemetry: config.cursorTelemetry,
		showCursor: config.showCursor,
		cursorStyle: config.cursorStyle,
		cursorSize: config.cursorSize,
		cursorSmoothing: config.cursorSmoothing,
		cursorSpringStiffnessMultiplier: config.cursorSpringStiffnessMultiplier,
		cursorSpringDampingMultiplier: config.cursorSpringDampingMultiplier,
		cursorSpringMassMultiplier: config.cursorSpringMassMultiplier,
		cameraSpringStiffnessMultiplier: config.cameraSpringStiffnessMultiplier,
		cameraSpringDampingMultiplier: config.cameraSpringDampingMultiplier,
		cameraSpringMassMultiplier: config.cameraSpringMassMultiplier,
		zoomSmoothness: config.zoomSmoothness,
		zoomClassicMode: config.zoomClassicMode,
		cursorMotionBlur: config.cursorMotionBlur,
		cursorClickEffect: config.cursorClickEffect,
		cursorClickEffectColor: config.cursorClickEffectColor,
		cursorClickEffectScale: config.cursorClickEffectScale,
		cursorClickEffectOpacity: config.cursorClickEffectOpacity,
		cursorClickEffectDurationMs: config.cursorClickEffectDurationMs,
		cursorClickBounce: config.cursorClickBounce,
		cursorClickBounceDuration: config.cursorClickBounceDuration,
		cursorSway: config.cursorSway,
	};
}

export class GifExporter {
	private config: GifExporterConfig;
	private streamingDecoder: StreamingVideoDecoder | null = null;
	private renderer: FrameRenderer | null = null;
	private gif: GIF | null = null;
	private cancelled = false;
	private currentRunId = 0;
	private exportStartTimeMs = 0;
	private progressSampleStartTimeMs = 0;
	private progressSampleStartFrame = 0;
	private lastRenderFps: number | undefined;

	constructor(config: GifExporterConfig) {
		this.config = config;
	}

	async export(): Promise<ExportResult> {
		const runId = ++this.currentRunId;
		try {
			this.cleanup();
			this.cancelled = false;
			this.exportStartTimeMs = this.getNowMs();
			this.progressSampleStartTimeMs = this.exportStartTimeMs;
			this.progressSampleStartFrame = 0;
			this.lastRenderFps = undefined;

			// Initialize streaming decoder and load video metadata
			this.streamingDecoder = new StreamingVideoDecoder({
				maxDecodeQueue: this.config.maxDecodeQueue,
				maxPendingFrames: this.config.maxPendingFrames,
			});
			const videoInfo = await this.streamingDecoder.loadMetadata(this.config.videoUrl);

			// Initialize frame renderer
			this.renderer = new FrameRenderer(buildGifFrameRendererConfig(this.config, videoInfo));
			await this.renderer.initialize();

			// Initialize GIF encoder
			// Loop: 0 = infinite loop, 1 = play once (no loop)
			const repeat = getGifRepeat(this.config.loop);
			const cores = navigator.hardwareConcurrency || 4;
			const WORKER_COUNT = Math.max(1, Math.min(8, cores - 1));

			this.gif = new GIF({
				workers: WORKER_COUNT,
				quality: 10,
				width: this.config.width,
				height: this.config.height,
				workerScript: GIF_WORKER_URL,
				repeat,
				background: "#000000",
				transparent: null,
				dither: "FloydSteinberg",
			});

			// Calculate effective duration and frame count (excluding trim regions)
			const effectiveDuration = this.streamingDecoder.getEffectiveDuration(
				this.config.trimRegions,
				this.config.speedRegions,
				this.config.clipRegions,
			);
			const totalFrames = Math.ceil(effectiveDuration * this.config.frameRate);

			// Calculate frame delay in milliseconds (gif.js uses ms)
			const frameDelay = Math.round(1000 / this.config.frameRate);

			console.log("[GifExporter] Original duration:", videoInfo.duration, "s");
			console.log("[GifExporter] Effective duration:", effectiveDuration, "s");
			console.log("[GifExporter] Total frames to export:", totalFrames);
			console.log("[GifExporter] Frame rate:", this.config.frameRate, "FPS");
			console.log("[GifExporter] Frame delay:", frameDelay, "ms");
			console.log("[GifExporter] Loop:", this.config.loop ? "infinite" : "once");
			console.log("[GifExporter] Using streaming decode (web-demuxer + VideoDecoder)");

			let frameIndex = 0;
			const frameDurationUs = 1_000_000 / this.config.frameRate;

			// Stream decode and process frames — no seeking!
			await this.streamingDecoder.decodeAll(
				this.config.frameRate,
				this.config.trimRegions,
				this.config.speedRegions,
				async (videoFrame, _exportTimestampUs, sourceTimestampMs, cursorTimestampMs) => {
					if (!this.isCurrentRun(runId)) {
						return;
					}

					// Capture a local renderer reference so a concurrent cancel()
					// nulling this.renderer between the guard and the render call
					// cannot NPE the callback.
					const renderer = this.renderer;
					if (!renderer) {
						return;
					}

					const sourceTimestampUs = sourceTimestampMs * 1000;
					const cursorTimestampUs = cursorTimestampMs * 1000;
					await renderer.renderFrame(
						videoFrame,
						sourceTimestampUs,
						cursorTimestampUs,
						frameDurationUs,
						frameIndex * frameDurationUs,
					);

					// Re-check after the renderFrame await — cancel() may have
					// fired during the await and invalidated the run.
					if (!this.isCurrentRun(runId)) {
						return;
					}

					if (!this.addRenderedGifFrame(frameDelay)) {
						return;
					}
					frameIndex++;
					this.reportProgress(frameIndex, totalFrames);
				},
				this.config.clipRegions,
			);

			if (!this.isCurrentRun(runId)) {
				return { success: false, error: "Export cancelled" };
			}

			// Update progress to show we're now in the finalizing phase
			if (this.config.onProgress) {
				this.config.onProgress({
					currentFrame: totalFrames,
					totalFrames,
					percentage: 100,
					estimatedTimeRemaining: 0,
					phase: "finalizing",
					renderFps: this.lastRenderFps,
				});
			}

			// Capture a local reference so cancel() nulling this.gif via
			// cleanup() between here and awaitGifRender's render() call cannot
			// NPE the render.
			const gif = this.gif;
			if (!gif) {
				return { success: false, error: "Export cancelled" };
			}

			// Render the GIF. awaitGifRender listens for both "finished" and
			// "abort" so a mid-render cancel does not hang the promise.
			const blob = await awaitGifRender(gif, (progress: number) => {
				if (this.config.onProgress) {
					this.config.onProgress({
						currentFrame: totalFrames,
						totalFrames,
						percentage: 100,
						estimatedTimeRemaining: 0,
						phase: "finalizing",
						renderFps: this.lastRenderFps,
						renderProgress: Math.round(progress * 100),
					});
				}
			});

			return { success: true, blob };
		} catch (error) {
			console.error("GIF Export error:", error);
			return {
				success: false,
				error: error instanceof Error ? error.message : String(error),
			};
		} finally {
			this.cleanup();
		}
	}

	private addRenderedGifFrame(frameDelay: number): boolean {
		const renderer = this.renderer;
		const gif = this.gif;
		if (!renderer || !gif) {
			return false;
		}
		gif.addFrame(renderer.getCanvas(), { delay: frameDelay, copy: true });
		return true;
	}

	private isCurrentRun(runId: number): boolean {
		return !this.cancelled && this.currentRunId === runId;
	}

	private reportProgress(currentFrame: number, totalFrames: number) {
		const nowMs = this.getNowMs();
		const elapsedSeconds = Math.max((nowMs - this.exportStartTimeMs) / 1000, 0.001);
		const averageRenderFps = currentFrame / elapsedSeconds;
		const sampleElapsedMs = Math.max(nowMs - this.progressSampleStartTimeMs, 1);
		const sampleFrameDelta = Math.max(currentFrame - this.progressSampleStartFrame, 0);
		const renderFps = (sampleFrameDelta * 1000) / sampleElapsedMs;
		const remainingFrames = Math.max(totalFrames - currentFrame, 0);
		const estimatedTimeRemaining =
			averageRenderFps > 0 ? remainingFrames / averageRenderFps : 0;
		this.lastRenderFps = renderFps;

		if (sampleElapsedMs >= PROGRESS_SAMPLE_WINDOW_MS) {
			this.progressSampleStartTimeMs = nowMs;
			this.progressSampleStartFrame = currentFrame;
		}

		if (this.config.onProgress) {
			this.config.onProgress({
				currentFrame,
				totalFrames,
				percentage: totalFrames > 0 ? (currentFrame / totalFrames) * 100 : 100,
				estimatedTimeRemaining,
				renderFps,
			});
		}
	}

	private getNowMs(): number {
		return typeof performance !== "undefined" ? performance.now() : Date.now();
	}

	cancel(): void {
		this.cancelled = true;
		// Bump the run id so any in-flight decode callbacks from a previous
		// export() invocation short-circuit before touching state a later
		// export() may have reassigned.
		this.currentRunId++;
		if (this.streamingDecoder) {
			this.streamingDecoder.cancel();
		}
		if (this.gif) {
			this.gif.abort();
		}
		this.cleanup();
	}

	private cleanup(): void {
		if (this.streamingDecoder) {
			try {
				this.streamingDecoder.destroy();
			} catch (e) {
				console.warn("Error destroying streaming decoder:", e);
			}
			this.streamingDecoder = null;
		}

		if (this.renderer) {
			try {
				this.renderer.destroy();
			} catch (e) {
				console.warn("Error destroying renderer:", e);
			}
			this.renderer = null;
		}

		this.gif = null;
	}
}
