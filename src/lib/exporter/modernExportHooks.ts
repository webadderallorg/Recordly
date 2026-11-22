import { computePaddedLayout } from "@/components/video-editor/videoPlayback/layoutUtils";
import { normalizeLightningRuntimePlatform } from "./backendPolicy";

import type { ExportRuntimeDiagnostics } from "./modernExportSession";
import { type SupportedMp4EncoderPath } from "./mp4Support";
import { type NativeAudioPlan } from "./nativeExportAudioPlan";
import { buildNativeStaticLayoutVideoTimelineSegments } from "./nativeExportTimeline";
import { type NativeStaticLayoutBackground } from "./nativeStaticLayoutBackground";
import {
	getNativeStaticLayoutCursorTelemetry,
	getNativeStaticLayoutWebcamOverlay,
	getNativeStaticLayoutZoomTelemetry,
} from "./nativeStaticLayoutOverlays";
import { type DecodedVideoInfo } from "./streamingDecoder";
import type { ExportResult } from "./types";

export type NativeStaticLayoutAudioOptions = Omit<
	NonNullable<Parameters<Window["electronAPI"]["nativeStaticLayoutExport"]>[0]["audioOptions"]>,
	"outputDurationSec"
>;

export interface ModernExportHooks {
	shouldRetryWithFallbackMediaSource(error: unknown): boolean;

	getRuntimePlatform(): ReturnType<typeof normalizeLightningRuntimePlatform>;
	collectRuntimeDiagnostics(): Promise<ExportRuntimeDiagnostics>;

	buildLightningExportError(error: unknown): string;

	getNativeVideoSourcePath(): string | null;
	getNativeWebcamSourcePath(): string | null;
	loadNativeStaticLayoutVideoInfo(): Promise<DecodedVideoInfo | null>;
	getNativeStaticLayoutEffectiveDuration(videoInfo: DecodedVideoInfo): number;
	buildNativeStaticLayoutVideoTimelineSegments(
		videoInfo: DecodedVideoInfo,
	): ReturnType<typeof buildNativeStaticLayoutVideoTimelineSegments>;
	shouldUseNativeStaticLayoutTimelineMap(
		videoInfo: DecodedVideoInfo,
		effectiveDurationSec: number,
	): boolean;
	buildNativeAudioPlan(videoInfo: DecodedVideoInfo): NativeAudioPlan;
	isDefaultCropRegion(): boolean;
	getNativeStaticLayoutSourceCrop(videoInfo: DecodedVideoInfo): {
		x: number;
		y: number;
		width: number;
		height: number;
	};

	getNativeStaticLayoutSkipReason(
		audioPlan: NativeAudioPlan,
		videoInfo: DecodedVideoInfo,
		effectiveDurationSec: number,
	): string | null;
	getNativeStaticLayoutSkipReasons(
		audioPlan: NativeAudioPlan,
		videoInfo: DecodedVideoInfo,
		effectiveDurationSec: number,
	): string[];
	resolveNativeStaticLayoutBackground(): Promise<NativeStaticLayoutBackground | null>;
	cleanupNativeStaticLayoutBackground(
		background: NativeStaticLayoutBackground | null | undefined,
	): Promise<void>;
	renderEditedAudioForNativeMux(
		description: string,
		onProgress: (progress: number) => void,
		sourceAudioFallbackPaths?: string[],
	): Promise<{ editedAudioData: ArrayBuffer; editedAudioMimeType: string | null }>;

	getNativeStaticLayoutAudioOptions(
		audioPlan: NativeAudioPlan,
		totalFrames: number,
	): Promise<NativeStaticLayoutAudioOptions>;
	getNativeStaticLayoutWebcamOverlay(): ReturnType<typeof getNativeStaticLayoutWebcamOverlay>;
	getNativeStaticLayoutCursorTelemetry(): ReturnType<typeof getNativeStaticLayoutCursorTelemetry>;
	getNativeStaticLayoutCursorSize(contentWidth: number): number;
	getNativeStaticLayoutZoomTelemetry(
		layout: ReturnType<typeof computePaddedLayout>,
		totalFrames: number,
	): ReturnType<typeof getNativeStaticLayoutZoomTelemetry>;
	tryExportNativeStaticLayout(
		videoInfo: DecodedVideoInfo,
		audioPlan: NativeAudioPlan,
		effectiveDuration: number,
		totalFrames: number,
	): Promise<ExportResult | null>;

	tryStartNativeVideoExport(): Promise<boolean>;

	encodeRenderedFrameNative(
		timestamp: number,
		frameDuration: number,
		frameIndex: number,
	): Promise<void>;
	finishNativeVideoExport(audioPlan: NativeAudioPlan): Promise<ExportResult>;
	finalizeExportWithFfmpegAudio(
		videoSource: import("./muxer").MuxerFinalizeResult,
		audioPlan: NativeAudioPlan,
	): Promise<ExportResult>;
	encodeRenderedFrame(
		timestamp: number,
		frameDuration: number,
		frameIndex: number,
	): Promise<void>;

	initializeEncoder(): Promise<SupportedMp4EncoderPath>;
}
