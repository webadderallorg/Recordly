import GIF from "gif.js";
import type {
	AnnotationRegion,
	AutoCaptionSettings,
	CaptionCue,
	CropRegion,
	CursorStyle,
	CursorTelemetryPoint,
	Padding,
	SpeedRegion,
	TrimRegion,
	WebcamOverlaySettings,
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
	zoomTemporalMotionBlur?: number;
	zoomMotionBlurSampleCount?: number | null;
	zoomMotionBlurShutterFraction?: number | null;
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
	zoomSmoothness?: number;
	zoomClassicMode?: boolean;
	cursorMotionBlur?: number;
	cursorClickBounce?: number;
	cursorClickBounceDuration?: number;
	cursorSway?: number;
	frame?: string | null;
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

export class GifExporter {
	private config: GifExporterConfig;
	private streamingDecoder: StreamingVideoDecoder | null = null;
	private renderer: FrameRenderer | null = null;
	private gif: GIF | null = null;
	private cancelled = false;
	private exportStartTimeMs = 0;
	private progressSampleStartTimeMs = 0;
	private progressSampleStartFrame = 0;
	private lastRenderFps: number | undefined;

	constructor(config: GifExporterConfig) {
		this.config = config;
	}

	async export(): Promise<ExportResult> {
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
			this.renderer = new FrameRenderer({
				width: this.config.width,
				height: this.config.height,
				wallpaper: this.config.wallpaper,
				zoomRegions: this.config.zoomRegions,
				showShadow: this.config.showShadow,
				shadowIntensity: this.config.shadowIntensity,
				backgroundBlur: this.config.backgroundBlur,
				zoomMotionBlur: this.config.zoomMotionBlur,
				zoomTemporalMotionBlur: this.config.zoomTemporalMotionBlur,
				zoomMotionBlurSampleCount: this.config.zoomMotionBlurSampleCount,
				zoomMotionBlurShutterFraction: this.config.zoomMotionBlurShutterFraction,
				connectZooms: this.config.connectZooms,
				zoomInDurationMs: this.config.zoomInDurationMs,
				zoomInOverlapMs: this.config.zoomInOverlapMs,
				zoomOutDurationMs: this.config.zoomOutDurationMs,
				connectedZoomGapMs: this.config.connectedZoomGapMs,
				connectedZoomDurationMs: this.config.connectedZoomDurationMs,
				zoomInEasing: this.config.zoomInEasing,
				zoomOutEasing: this.config.zoomOutEasing,
				connectedZoomEasing: this.config.connectedZoomEasing,
				borderRadius: this.config.borderRadius,
				padding: this.config.padding,
				cropRegion: this.config.cropRegion,
				webcam: this.config.webcam,
				webcamUrl: this.config.webcamUrl,
				videoWidth: videoInfo.width,
				videoHeight: videoInfo.height,
				annotationRegions: this.config.annotationRegions,
				autoCaptions: this.config.autoCaptions,
				autoCaptionSettings: this.config.autoCaptionSettings,
				speedRegions: this.config.speedRegions,
				previewWidth: this.config.previewWidth,
				previewHeight: this.config.previewHeight,
				cursorTelemetry: this.config.cursorTelemetry,
				showCursor: this.config.showCursor,
				cursorStyle: this.config.cursorStyle,
				cursorSize: this.config.cursorSize,
				cursorSmoothing: this.config.cursorSmoothing,
				cursorSpringStiffnessMultiplier: this.config.cursorSpringStiffnessMultiplier,
				cursorSpringDampingMultiplier: this.config.cursorSpringDampingMultiplier,
				cursorSpringMassMultiplier: this.config.cursorSpringMassMultiplier,
				zoomSmoothness: this.config.zoomSmoothness,
				zoomClassicMode: this.config.zoomClassicMode,
				cursorMotionBlur: this.config.cursorMotionBlur,
				cursorClickBounce: this.config.cursorClickBounce,
				cursorClickBounceDuration: this.config.cursorClickBounceDuration,
				cursorSway: this.config.cursorSway,
				frame: this.config.frame,
			});
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
					if (this.cancelled) {
						videoFrame.close();
						return;
					}

					const sourceTimestampUs = sourceTimestampMs * 1000;
					const cursorTimestampUs = cursorTimestampMs * 1000;
					await this.renderer!.renderFrame(
						videoFrame,
						sourceTimestampUs,
						cursorTimestampUs,
						frameDurationUs,
						frameIndex * frameDurationUs,
					);
					videoFrame.close();

					this.addRenderedGifFrame(frameDelay);
					frameIndex++;
					this.reportProgress(frameIndex, totalFrames);
				},
			);

			if (this.cancelled) {
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

			// Render the GIF
			const blob = await new Promise<Blob>((resolve, _reject) => {
				this.gif!.on("finished", (blob: Blob) => {
					resolve(blob);
				});

				// Track rendering progress
				this.gif!.on("progress", (progress: number) => {
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

				// gif.js doesn't have a typed 'error' event, but we can catch errors in the try/catch
				this.gif!.render();
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

	private addRenderedGifFrame(frameDelay: number) {
		const canvas = this.renderer!.getCanvas();
		this.gif!.addFrame(canvas, { delay: frameDelay, copy: true });
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
