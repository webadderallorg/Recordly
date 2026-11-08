import type { CursorIdleHideSettings } from "@/components/video-editor/videoPlayback/cursorIdleVisibility";
import type {
	AnnotationRegion,
	AudioRegion,
	AutoCaptionSettings,
	CaptionCue,
	ClipRegion,
	CropRegion,
	CursorClickEffectStyle,
	CursorStyle,
	CursorTelemetryPoint,
	Padding,
	SourceAudioTrackSettings,
	SpeedRegion,
	TrimRegion,
	WebcamOverlaySettings,
	ZoomMotionBlurTuning,
	ZoomRegion,
	ZoomTransitionEasing,
} from "@/components/video-editor/types";
import { AudioProcessor } from "./audioEncoder";
import {
	type FinalizationProgressWatchdog,
	type FinalizationTimeoutWorkload,
} from "./finalizationTimeout";
import { FrameRenderer } from "./frameRenderer";
import type { SupportedMp4EncoderPath } from "./mp4Support";
import { VideoMuxer } from "./muxer";
import { type DecodedVideoInfo, StreamingVideoDecoder } from "./streamingDecoder";
import type {
	ExportConfig,
	ExportFinalizationStageMetrics,
	ExportMetrics,
	ExportProgress,
	ExportResult,
} from "./types";

export const DEFAULT_MAX_ENCODE_QUEUE = 240;

export const PROGRESS_SAMPLE_WINDOW_MS = 1_000;

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
	cursorMotionBlur?: number;
	cursorClickEffect?: CursorClickEffectStyle;
	cursorClickEffectColor?: string;
	cursorClickEffectScale?: number;
	cursorClickEffectOpacity?: number;
	cursorClickEffectDurationMs?: number;
	cursorClickBounce?: number;
	cursorClickBounceDuration?: number;
	cursorSway?: number;
	cursorIdleHide?: CursorIdleHideSettings;
	zoomSmoothness?: number;
	zoomClassicMode?: boolean;
	audioRegions?: AudioRegion[];
	clipRegions?: ClipRegion[];
	sourceAudioFallbackPaths?: string[];
	sourceAudioFallbackStartDelayMsByPath?: Record<string, number>;
	sourceAudioTrackSettings?: SourceAudioTrackSettings;
	sourceAudioTrackSettingsByClip?: Record<string, SourceAudioTrackSettings>;
	previewWidth?: number;
	previewHeight?: number;
	onProgress?: (progress: ExportProgress) => void;
	preferredEncoderPath?: SupportedMp4EncoderPath | null;
}

export type NativeAudioPlan =
	| {
			audioMode: "none";
	  }
	| {
			audioMode: "copy-source" | "trim-source";
			audioSourcePath: string;
			trimSegments?: Array<{ startMs: number; endMs: number }>;
	  }
	| {
			audioMode: "edited-track";
			strategy: "offline-render-fallback";
	  }
	| {
			audioMode: "edited-track";
			strategy: "filtergraph-fast-path";
			audioSourcePath: string;
			audioSourceSampleRate: number;
			editedTrackSegments: Array<{ startMs: number; endMs: number; speed: number }>;
	  };

export const FILTERGRAPH_FALLBACK_AUDIO_SAMPLE_RATE = 48_000;

export function hasNonDefaultSourceTrackSettings(
	sourceAudioTrackSettings?: SourceAudioTrackSettings,
) {
	if (!sourceAudioTrackSettings) {
		return false;
	}
	return Object.values(sourceAudioTrackSettings).some(
		(settings) =>
			Math.abs((settings?.volume ?? 1) - 1) > 0.0005 || Boolean(settings?.normalize),
	);
}

export interface LegacyVideoExporterContext {
	config: VideoExporterConfig;
	streamingDecoder: StreamingVideoDecoder | null;
	renderer: FrameRenderer | null;
	encoder: VideoEncoder | null;
	muxer: VideoMuxer | null;
	audioProcessor: AudioProcessor | null;
	cancelled: boolean;
	encodeQueue: number;
	videoDescription: Uint8Array | undefined;
	videoColorSpace: VideoColorSpaceInit | undefined;
	pendingMuxing: Promise<void>;
	chunkCount: number;
	effectiveDurationSec: number;
	exportStartTimeMs: number;
	progressSampleStartTimeMs: number;
	progressSampleStartFrame: number;
	encoderError: Error | null;
	nativeExportSessionId: string | null;
	nativeH264Encoder: VideoEncoder | null;
	nativePendingWrite: Promise<void>;
	nativeWritePromises: Set<Promise<void>>;
	nativeWriteError: Error | null;
	maxNativeWriteInFlight: number;
	nativeEncoderError: Error | null;
	activeFinalizationProgressWatchdog: FinalizationProgressWatchdog | null;
	lastFinalizationRenderProgress: number;
	lastFinalizationAudioProgress: number;
	finalizationTimeMs: number;
	finalizationStageMs: ExportFinalizationStageMetrics;
	processedFrameCount: number;
	export(): Promise<ExportResult>;
	shouldUseExperimentalNativeExport(): boolean;
	awaitWithFinalizationTimeout<T>(
		promise: Promise<T>,
		stage: string,
		workload?: FinalizationTimeoutWorkload,
		progressAware?: boolean,
	): Promise<T>;
	getNativeVideoSourcePath(): string | null;
	buildNativeTrimSegments(durationMs: number): Array<{ startMs: number; endMs: number }>;
	buildNativeAudioPlan(videoInfo: DecodedVideoInfo): NativeAudioPlan;
	tryStartNativeVideoExport(): Promise<boolean>;
	encodeRenderedFrameNative(
		timestamp: number,
		frameDuration: number,
		frameIndex: number,
	): Promise<void>;
	finishNativeVideoExport(audioPlan: NativeAudioPlan, totalFrames: number): Promise<ExportResult>;
	finalizeExportWithFfmpegAudio(
		videoSource: import("./muxer").MuxerFinalizeResult,
		audioPlan: NativeAudioPlan,
		totalFrames: number,
	): Promise<ExportResult>;
	encodeRenderedFrame(
		timestamp: number,
		frameDuration: number,
		frameIndex: number,
	): Promise<void>;
	trackNativeWritePromise(writePromise: Promise<void>): void;
	awaitOldestNativeWrite(): Promise<void>;
	awaitPendingNativeWrites(): Promise<void>;
	reportFinalizingProgress(
		totalFrames: number,
		renderProgress: number,
		audioProgress?: number,
	): void;
	reportProgress(
		currentFrame: number,
		totalFrames: number,
		phase?: ExportProgress["phase"],
		renderProgress?: number,
		audioProgress?: number,
	): void;
	getNowMs(): number;
	measureFinalizationStage<T>(
		stage: keyof ExportFinalizationStageMetrics,
		task: () => Promise<T>,
	): Promise<T>;
	buildExportMetrics(): ExportMetrics;
	initializeEncoder(): Promise<void>;
	cancel(): void;
	cleanup(): void;
}
