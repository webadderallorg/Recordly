import type {
	AnnotationRegion,
	AudioRegion,
	AutoCaptionSettings,
	CaptionCue,
	CropRegion,
	CursorStyle,
	CursorTelemetryPoint,
	SpeedRegion,
	TrimRegion,
	WebcamOverlaySettings,
	ZoomRegion,
	ZoomTransitionEasing,
} from "@/components/video-editor/types";
import type { AudioProcessor } from "../audioEncoder";
import type { ExportBackpressureProfile } from "../exportTuning";
import type { SupportedMp4EncoderPath } from "../mp4Support";
import type { VideoMuxer } from "../muxer";
import type {
	ExportConfig,
	ExportEncodeBackend,
	ExportProgress,
	ExportRenderBackend,
} from "../types";

export const NATIVE_EXPORT_ENGINE_NAME = "Breeze";
export const LIGHTNING_PIPELINE_NAME = "Lightning (Beta)";
export const NATIVE_ENCODER_QUEUE_LIMIT = 32;
export const FINALIZATION_TIMEOUT_MS = 600_000;

export interface VideoExporterConfig extends ExportConfig {
	videoUrl: string;
	wallpaper: string;
	zoomRegions: ZoomRegion[];
	trimRegions?: TrimRegion[];
	speedRegions?: SpeedRegion[];
	showShadow: boolean;
	shadowIntensity: number;
	backgroundBlur: number;
	zoomMotionBlur?: number;
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
	padding?: number;
	videoPadding?: number;
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
	cursorMotionBlur?: number;
	cursorClickBounce?: number;
	cursorClickBounceDuration?: number;
	cursorSway?: number;
	zoomSmoothness?: number;
	zoomClassicMode?: boolean;
	frame?: string | null;
	audioRegions?: AudioRegion[];
	sourceAudioFallbackPaths?: string[];
	previewWidth?: number;
	previewHeight?: number;
	onProgress?: (progress: ExportProgress) => void;
	preferredEncoderPath?: SupportedMp4EncoderPath | null;
}

export type NativeAudioPlan =
	| { audioMode: "none" }
	| {
			audioMode: "copy-source" | "trim-source";
			audioSourcePath: string;
			trimSegments?: Array<{ startMs: number; endMs: number }>;
	  }
	| { audioMode: "edited-track" };

/** Shared mutable state for helper functions. The class instance satisfies this. */
export interface ExporterHost {
	config: VideoExporterConfig;
	muxer: VideoMuxer | null;
	audioProcessor: AudioProcessor | null;
	cancelled: boolean;

	// WebCodecs encoder
	encoder: VideoEncoder | null;
	encodeQueue: number;
	webCodecsEncodeQueueLimit: number;
	keyFrameInterval: number;
	videoDescription: Uint8Array | undefined;
	videoColorSpace: VideoColorSpaceInit | undefined;
	pendingMuxing: Promise<void>;
	chunkCount: number;
	encoderError: Error | null;
	peakEncodeQueueSize: number;
	encodeWaitTimeMs: number;
	encodeWaitEvents: number;

	// Native export
	nativeExportSessionId: string | null;
	nativeH264Encoder: VideoEncoder | null;
	nativeEncoderError: Error | null;
	nativeWritePromises: Set<Promise<void>>;
	nativeWriteError: Error | null;
	maxNativeWriteInFlight: number;
	peakNativeWriteInFlight: number;
	lastNativeExportError: string | null;

	// Backends
	renderBackend: ExportRenderBackend | null;
	encodeBackend: ExportEncodeBackend | null;
	encoderName: string | null;
	backpressureProfile: ExportBackpressureProfile | null;

	// Timing & progress
	totalExportStartTimeMs: number;
	exportStartTimeMs: number;
	metadataLoadTimeMs: number;
	rendererInitTimeMs: number;
	nativeSessionStartTimeMs: number;
	decodeLoopTimeMs: number;
	frameCallbackTimeMs: number;
	renderFrameTimeMs: number;
	nativeCaptureTimeMs: number;
	nativeWriteTimeMs: number;
	finalizationTimeMs: number;
	processedFrameCount: number;
	lastThroughputLogTimeMs: number;
	lastProgressSampleTimeMs: number;
	lastProgressSampleFrame: number;
}
