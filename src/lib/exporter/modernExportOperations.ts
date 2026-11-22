import { computePaddedLayout } from "@/components/video-editor/videoPlayback/layoutUtils";
import { getLocalFilePath } from "./localMediaSource";

import * as modernExportDiagnostics from "./modernExportDiagnostics";
import type { ModernExportHooks } from "./modernExportHooks";
import { ModernExportSession } from "./modernExportSession";
import * as modernNativeAudioMux from "./modernNativeAudioMux";
import * as modernNativeStaticBackend from "./modernNativeStaticBackend";
import * as modernNativeStaticEligibility from "./modernNativeStaticEligibility";
import * as modernNativeStreamFrames from "./modernNativeStreamFrames";
import * as modernNativeStreamStart from "./modernNativeStreamStart";
import * as modernWebCodecsBackend from "./modernWebCodecsBackend";
import { buildNativeAudioPlan, type NativeAudioPlan } from "./nativeExportAudioPlan";
import {
	buildNativeStaticLayoutVideoTimelineSegments,
	getNativeStaticLayoutEffectiveDuration,
	shouldUseNativeStaticLayoutTimelineMap,
} from "./nativeExportTimeline";
import { type NativeStaticLayoutBackground } from "./nativeStaticLayoutBackground";
import {
	getNativeStaticLayoutCursorSize,
	getNativeStaticLayoutCursorTelemetry,
	getNativeStaticLayoutWebcamOverlay,
	getNativeStaticLayoutZoomTelemetry,
} from "./nativeStaticLayoutOverlays";
import { type DecodedVideoInfo } from "./streamingDecoder";

export function createModernExportOperations(session: ModernExportSession): ModernExportHooks {
	const hooks: ModernExportHooks = {
		shouldRetryWithFallbackMediaSource(error: unknown) {
			return modernExportDiagnostics.shouldRetryWithFallbackMediaSource(
				session,
				hooks,
				error,
			);
		},

		getRuntimePlatform: () => modernExportDiagnostics.getRuntimePlatform(),
		collectRuntimeDiagnostics() {
			return modernExportDiagnostics.collectRuntimeDiagnostics(session, hooks);
		},

		buildLightningExportError(error: unknown) {
			return modernExportDiagnostics.buildLightningExportError(session, hooks, error);
		},

		getNativeVideoSourcePath() {
			return session.config.videoUrl ? getLocalFilePath(session.config.videoUrl) : null;
		},
		getNativeWebcamSourcePath() {
			const source = session.config.webcam?.sourcePath || session.config.webcamUrl || "";
			return source ? getLocalFilePath(source) : null;
		},
		loadNativeStaticLayoutVideoInfo() {
			return modernNativeStaticEligibility.loadNativeStaticLayoutVideoInfo(session, hooks);
		},
		getNativeStaticLayoutEffectiveDuration(videoInfo: DecodedVideoInfo) {
			return getNativeStaticLayoutEffectiveDuration(session.config, videoInfo);
		},
		buildNativeStaticLayoutVideoTimelineSegments(videoInfo: DecodedVideoInfo) {
			return buildNativeStaticLayoutVideoTimelineSegments(session.config, videoInfo);
		},
		shouldUseNativeStaticLayoutTimelineMap(
			videoInfo: DecodedVideoInfo,
			effectiveDurationSec: number,
		) {
			return shouldUseNativeStaticLayoutTimelineMap(
				session.config,
				videoInfo,
				effectiveDurationSec,
			);
		},
		buildNativeAudioPlan(videoInfo: DecodedVideoInfo) {
			return buildNativeAudioPlan(session.config, videoInfo);
		},
		isDefaultCropRegion() {
			return modernNativeStaticEligibility.isDefaultCropRegion(session, hooks);
		},
		getNativeStaticLayoutSourceCrop(videoInfo: DecodedVideoInfo) {
			return modernNativeStaticEligibility.getNativeStaticLayoutSourceCrop(
				session,
				hooks,
				videoInfo,
			);
		},

		getNativeStaticLayoutSkipReason(
			audioPlan: NativeAudioPlan,
			videoInfo: DecodedVideoInfo,
			effectiveDurationSec: number,
		) {
			return modernNativeStaticEligibility.getNativeStaticLayoutSkipReason(
				session,
				hooks,
				audioPlan,
				videoInfo,
				effectiveDurationSec,
			);
		},
		getNativeStaticLayoutSkipReasons(audioPlan, videoInfo, effectiveDurationSec) {
			return modernNativeStaticEligibility.getNativeStaticLayoutSkipReasons(
				session,
				hooks,
				audioPlan,
				videoInfo,
				effectiveDurationSec,
			);
		},
		async resolveNativeStaticLayoutBackground() {
			session.native.nativeStaticLayoutBackgroundSkipReason = null;
			const background = await session.native.nativeBackgroundAssets.resolve();
			session.native.nativeStaticLayoutBackgroundSkipReason =
				session.native.nativeBackgroundAssets.skipReason;
			return background;
		},
		async cleanupNativeStaticLayoutBackground(
			background: NativeStaticLayoutBackground | null | undefined,
		) {
			await session.native.nativeBackgroundAssets.cleanup(background);
		},
		renderEditedAudioForNativeMux(
			description: string,
			onProgress: (progress: number) => void,
			sourceAudioFallbackPaths: string[] | undefined = session.config
				.sourceAudioFallbackPaths,
		) {
			return modernNativeAudioMux.renderEditedAudioForNativeMux(
				session,
				hooks,
				description,
				onProgress,
				sourceAudioFallbackPaths,
			);
		},

		getNativeStaticLayoutAudioOptions(audioPlan: NativeAudioPlan, totalFrames: number) {
			return modernNativeAudioMux.getNativeStaticLayoutAudioOptions(
				session,
				hooks,
				audioPlan,
				totalFrames,
			);
		},
		getNativeStaticLayoutWebcamOverlay() {
			if (!session.config.webcam?.enabled) return null;
			return getNativeStaticLayoutWebcamOverlay(
				session.config,
				hooks.getNativeWebcamSourcePath(),
			);
		},
		getNativeStaticLayoutCursorTelemetry() {
			return getNativeStaticLayoutCursorTelemetry(
				session.config,
				session.effectiveDurationSec,
			);
		},
		getNativeStaticLayoutCursorSize(contentWidth: number) {
			return getNativeStaticLayoutCursorSize(session.config, contentWidth);
		},
		getNativeStaticLayoutZoomTelemetry(
			layout: ReturnType<typeof computePaddedLayout>,
			totalFrames: number,
		) {
			return getNativeStaticLayoutZoomTelemetry(session.config, layout, totalFrames);
		},
		tryExportNativeStaticLayout(
			videoInfo: DecodedVideoInfo,
			audioPlan: NativeAudioPlan,
			effectiveDuration: number,
			totalFrames: number,
		) {
			return modernNativeStaticBackend.tryExportNativeStaticLayout(
				session,
				hooks,
				videoInfo,
				audioPlan,
				effectiveDuration,
				totalFrames,
			);
		},

		tryStartNativeVideoExport() {
			return modernNativeStreamStart.tryStartNativeVideoExport(session, hooks);
		},

		encodeRenderedFrameNative(timestamp: number, frameDuration: number, frameIndex: number) {
			return modernNativeStreamFrames.encodeRenderedFrameNative(
				session,
				hooks,
				timestamp,
				frameDuration,
				frameIndex,
			);
		},
		finishNativeVideoExport(audioPlan: NativeAudioPlan) {
			return modernNativeAudioMux.finishNativeVideoExport(session, hooks, audioPlan);
		},
		finalizeExportWithFfmpegAudio(
			videoSource: import("./muxer").MuxerFinalizeResult,
			audioPlan: NativeAudioPlan,
		) {
			return modernNativeAudioMux.finalizeExportWithFfmpegAudio(
				session,
				hooks,
				videoSource,
				audioPlan,
			);
		},
		encodeRenderedFrame(timestamp: number, frameDuration: number, frameIndex: number) {
			return modernWebCodecsBackend.encodeRenderedFrame(
				session,
				hooks,
				timestamp,
				frameDuration,
				frameIndex,
			);
		},

		initializeEncoder() {
			return modernWebCodecsBackend.initializeEncoder(session, hooks);
		},
	};
	return hooks;
}
