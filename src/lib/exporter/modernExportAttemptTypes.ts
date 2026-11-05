import type { NativeAudioPlan } from "./nativeExportAudioPlan";

/** Retry decisions and the currently failing stage survive a pipeline attempt. */

export interface ModernExportAttempt {
	useFallbackMediaSource: boolean;
	retriedWithFallbackMediaSource: boolean;
	nativeFailure: string | null;
	retryWithWebgl: boolean;
	inNativeStage: boolean;
	inRendererStage: boolean;
}

/** Metadata/backend choices shared by the render loop and finalization. */
export interface ModernExportFramePlan {
	useNativeEncoder: boolean;
	nativeAudioPlan: NativeAudioPlan;
	totalFrames: number;
	shouldUseFfmpegAudioFallback: boolean;
	shouldUsePitchPreservingFfmpegAudio: boolean;
}
