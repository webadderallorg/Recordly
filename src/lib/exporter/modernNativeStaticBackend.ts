import { buildNativeCursorAtlas } from "@/components/video-editor/videoPlayback/cursorRenderer";
import {
	computePaddedLayout,
	scalePreviewBorderRadius,
} from "@/components/video-editor/videoPlayback/layoutUtils";
import { getSceneEffectMetrics } from "@/components/video-editor/videoPlayback/sceneEffects";
import { normalizeLightningRuntimePlatform } from "./backendPolicy";
import {
	getNowMs,
	NATIVE_STATIC_LAYOUT_FRAME_COMPLETE_PROGRESS,
	NATIVE_STATIC_LAYOUT_MAX_EXTRACTING_PROGRESS,
	STATIC_LAYOUT_CHUNK_DURATION_SEC,
} from "./modernExportConstants";
import type { ModernExportHooks } from "./modernExportHooks";
import type { ModernExportSession } from "./modernExportSession";
import { type NativeAudioPlan } from "./nativeExportAudioPlan";

import { roundNativeStaticLayoutContentSize } from "./nativeStaticLayoutGeometry";

import { type DecodedVideoInfo } from "./streamingDecoder";
import type { ExportFfmpegAudioMuxBreakdown, ExportResult } from "./types";

type Hooks = Pick<
	ModernExportHooks,
	| "buildNativeStaticLayoutVideoTimelineSegments"
	| "cleanupNativeStaticLayoutBackground"
	| "getNativeStaticLayoutAudioOptions"
	| "getNativeStaticLayoutCursorSize"
	| "getNativeStaticLayoutCursorTelemetry"
	| "getNativeStaticLayoutSkipReason"
	| "getNativeStaticLayoutSkipReasons"
	| "getNativeStaticLayoutSourceCrop"
	| "getNativeStaticLayoutWebcamOverlay"
	| "getNativeStaticLayoutZoomTelemetry"
	| "getNativeVideoSourcePath"
	| "isDefaultCropRegion"
	| "resolveNativeStaticLayoutBackground"
	| "shouldUseNativeStaticLayoutTimelineMap"
>;

type Session = Pick<
	ModernExportSession,
	"cancelled" | "config" | "metrics" | "native" | "progress" | "throwIfCancelled"
>;

export async function tryExportNativeStaticLayout(
	session: Session,
	hooks: Hooks,
	videoInfo: DecodedVideoInfo,
	audioPlan: NativeAudioPlan,
	effectiveDuration: number,
	totalFrames: number,
): Promise<ExportResult | null> {
	session.metrics.recordBackendAttempt({ route: "native-static-layout", status: "attempted" });
	const result = await exportNativeStaticLayout(
		session,
		hooks,
		videoInfo,
		audioPlan,
		effectiveDuration,
		totalFrames,
	);
	session.metrics.recordBackendAttempt({
		route: "native-static-layout",
		status: result?.success ? "selected" : "unavailable",
		reason: session.native.nativeStaticLayoutSkipReasons.join(", ") || result?.error,
	});
	// Capture the selected route in metrics returned by a successful native export.
	if (result?.metrics) result.metrics.diagnostics = session.metrics.buildDiagnosticSnapshot();
	return result;
}

export async function exportNativeStaticLayout(
	session: Session,
	hooks: Hooks,
	videoInfo: DecodedVideoInfo,
	audioPlan: NativeAudioPlan,
	effectiveDuration: number,
	totalFrames: number,
): Promise<ExportResult | null> {
	const skipReason = hooks.getNativeStaticLayoutSkipReason(
		audioPlan,
		videoInfo,
		effectiveDuration,
	);
	const skipReasons = skipReason
		? hooks.getNativeStaticLayoutSkipReasons(audioPlan, videoInfo, effectiveDuration)
		: [];
	if (skipReason) {
		session.native.nativeStaticLayoutSkipReason = skipReason;
		session.native.nativeStaticLayoutSkipReasons = skipReasons;
		console.info("[VideoExporter] Native static layout skipped", {
			reason: skipReason,
			reasons: skipReasons,
			audioMode: audioPlan.audioMode,
			zoomRegions: session.config.zoomRegions?.length ?? 0,
			speedRegions: session.config.speedRegions?.length ?? 0,
			audioRegions: session.config.audioRegions?.length ?? 0,
			annotationRegions: session.config.annotationRegions?.length ?? 0,
			backgroundBlur: session.config.backgroundBlur,
			hasCursorOverlay:
				session.config.showCursor === true &&
				(session.config.cursorTelemetry?.length ?? 0) > 0,
			experimentalNativeExport: session.config.experimentalNativeExport === true,
		});
		return null;
	}

	const sourcePath = hooks.getNativeVideoSourcePath();
	const audioOptions = await hooks.getNativeStaticLayoutAudioOptions(audioPlan, totalFrames);
	if (!sourcePath || !audioOptions) {
		session.native.nativeStaticLayoutSkipReason = !sourcePath
			? "missing-source-path"
			: "missing-audio-options";
		session.native.nativeStaticLayoutSkipReasons = [
			session.native.nativeStaticLayoutSkipReason,
		];
		return null;
	}
	const background = await hooks.resolveNativeStaticLayoutBackground();
	if (!background) {
		session.native.nativeStaticLayoutSkipReason =
			session.native.nativeStaticLayoutBackgroundSkipReason ?? "unsupported-background";
		session.native.nativeStaticLayoutSkipReasons = [
			session.native.nativeStaticLayoutSkipReason,
		];
		return null;
	}

	const layout = computePaddedLayout({
		width: session.config.width,
		height: session.config.height,
		padding: session.config.padding ?? 0,
		cropRegion: session.config.cropRegion,
		videoWidth: videoInfo.width,
		videoHeight: videoInfo.height,
	});
	const contentSize = roundNativeStaticLayoutContentSize({
		width: layout.croppedDisplayWidth,
		height: layout.croppedDisplayHeight,
	});
	const contentWidth = contentSize.width;
	const contentHeight = contentSize.height;
	if (
		contentWidth > session.config.width ||
		contentHeight > session.config.height ||
		!Number.isFinite(effectiveDuration) ||
		effectiveDuration <= 0
	) {
		session.native.nativeStaticLayoutSkipReason = "invalid-layout-or-duration";
		session.native.nativeStaticLayoutSkipReasons = [
			session.native.nativeStaticLayoutSkipReason,
		];
		await hooks.cleanupNativeStaticLayoutBackground(background);
		return null;
	}

	const offsetX = Math.round(layout.centerOffsetX);
	const offsetY = Math.round(layout.centerOffsetY);
	const sourceCrop = hooks.isDefaultCropRegion()
		? null
		: hooks.getNativeStaticLayoutSourceCrop(videoInfo);
	// Decide whether the video fills the frame before rounding for the encoder.
	// Even-size rounding can otherwise turn a full-frame fit into a rounded inset.
	const logicalBorderRadius = scalePreviewBorderRadius(
		layout.croppedDisplayWidth,
		layout.croppedDisplayHeight,
		session.config.borderRadius ?? 0,
		{ width: session.config.width, height: session.config.height },
	);
	const borderRadius =
		logicalBorderRadius === 0
			? 0
			: scalePreviewBorderRadius(
					contentWidth,
					contentHeight,
					session.config.borderRadius ?? 0,
				);
	const shadowIntensity = session.config.showShadow
		? Math.min(1, Math.max(0, session.config.shadowIntensity))
		: 0;
	const webcamOverlay = hooks.getNativeStaticLayoutWebcamOverlay();
	const cursorTelemetry = hooks.getNativeStaticLayoutCursorTelemetry();
	const zoomTelemetry = hooks.getNativeStaticLayoutZoomTelemetry(layout, totalFrames);
	const needsTimelineMap = hooks.shouldUseNativeStaticLayoutTimelineMap(
		videoInfo,
		effectiveDuration,
	);
	const timelineSegments = needsTimelineMap
		? hooks.buildNativeStaticLayoutVideoTimelineSegments(videoInfo)
		: undefined;
	if (needsTimelineMap && !timelineSegments?.length) {
		session.native.nativeStaticLayoutSkipReason =
			(session.config.speedRegions ?? []).length > 0
				? "invalid-native-speed-timeline"
				: "invalid-native-trim-timeline";
		session.native.nativeStaticLayoutSkipReasons = [
			session.native.nativeStaticLayoutSkipReason,
		];
		await hooks.cleanupNativeStaticLayoutBackground(background);
		return null;
	}
	const cursorAtlas =
		cursorTelemetry && cursorTelemetry.length > 0
			? await buildNativeCursorAtlas(session.config.cursorStyle ?? "tahoe").catch((error) => {
					console.warn("[VideoExporter] Native cursor atlas unavailable", error);
					return null;
				})
			: null;
	if (cursorTelemetry && cursorTelemetry.length > 0 && !cursorAtlas) {
		session.native.nativeStaticLayoutSkipReason = "cursor-atlas-unavailable";
		session.native.nativeStaticLayoutSkipReasons = [
			session.native.nativeStaticLayoutSkipReason,
		];
		await hooks.cleanupNativeStaticLayoutBackground(background);
		return null;
	}
	const startedAt = getNowMs();
	const sessionId = `recordly-static-layout-${Date.now()}-${Math.random()
		.toString(36)
		.slice(2, 8)}`;
	const previousEncodeBackend = session.metrics.encodeBackend;
	const previousEncoderName = session.metrics.encoderName;
	const previousDiagnosticEncoder = session.metrics.diagnosticEncoder;
	const previousDiagnosticMuxer = session.metrics.diagnosticMuxer;
	const restoreEncoderState = () => {
		session.metrics.encodeBackend = previousEncodeBackend;
		session.metrics.encoderName = previousEncoderName;
		session.metrics.diagnosticEncoder = previousDiagnosticEncoder;
		session.metrics.diagnosticMuxer = previousDiagnosticMuxer;
	};

	session.progress.exportStartTimeMs = startedAt;
	session.progress.lastThroughputLogTimeMs = startedAt;
	session.progress.lastProgressSampleTimeMs = startedAt;
	session.progress.lastProgressSampleFrame = 0;
	session.native.nativeStaticLayoutSessionId = sessionId;
	session.metrics.diagnosticEncoder = undefined;
	session.metrics.diagnosticMuxer = "native-static-layout";
	session.native.nativeStaticLayoutSkipReason = null;
	session.native.nativeStaticLayoutSkipReasons = [];
	session.progress.nativeStaticLayoutAverageFps = null;
	session.metrics.encodeBackend = "ffmpeg";
	const runtimePlatform =
		typeof navigator !== "undefined"
			? normalizeLightningRuntimePlatform(navigator.userAgent)
			: "unknown";
	session.metrics.encoderName =
		session.config.experimentalNativeExport === true && runtimePlatform === "win32"
			? "windows-native-compositor"
			: "static-layout-h264-nvenc";
	session.progress.reportProgress(0, totalFrames, "preparing");
	let unsubscribeNativeProgress: (() => void) | undefined;
	unsubscribeNativeProgress = window.electronAPI.onNativeStaticLayoutExportProgress?.(
		(progress) => {
			if (progress.sessionId && progress.sessionId !== sessionId) {
				return;
			}
			if (!Number.isFinite(progress.currentFrame) || !Number.isFinite(progress.totalFrames)) {
				return;
			}

			const nativeTotalFrames = Math.max(1, Math.floor(progress.totalFrames));
			const rawNativeCurrentFrame = Math.max(0, Math.floor(progress.currentFrame));
			const rawNativePercentage = Number.isFinite(progress.percentage)
				? Math.max(0, progress.percentage)
				: 0;
			if (
				progress.backend === "nvidia-cuda-compositor" ||
				progress.backend === "windows-d3d11-compositor"
			) {
				session.metrics.encoderName = progress.backend;
			}
			if (
				progress.stage === "preparing" ||
				(progress.stage !== "finalizing" &&
					rawNativeCurrentFrame === 0 &&
					rawNativePercentage <= 3)
			) {
				session.progress.nativeStaticLayoutAverageFps = null;
				session.metrics.processedFrameCount = 0;
				session.progress.reportProgress(0, totalFrames, "preparing");
				return;
			}
			const progressPercentFrame = Number.isFinite(progress.percentage)
				? Math.floor((nativeTotalFrames * progress.percentage) / 100)
				: 0;
			const nativeCurrentFrame = Math.max(rawNativeCurrentFrame, progressPercentFrame);
			const nativeFramesComplete = nativeCurrentFrame >= nativeTotalFrames;
			const nativeFinalizingProgress =
				progress.stage === "finalizing" && Number.isFinite(progress.percentage)
					? Math.max(
							NATIVE_STATIC_LAYOUT_FRAME_COMPLETE_PROGRESS,
							Math.min(99, progress.percentage),
						)
					: NATIVE_STATIC_LAYOUT_FRAME_COMPLETE_PROGRESS;
			const maxExtractingFrame = Math.max(
				0,
				Math.min(
					totalFrames - 1,
					Math.floor(totalFrames * (NATIVE_STATIC_LAYOUT_MAX_EXTRACTING_PROGRESS / 100)),
				),
			);
			const currentFrame = Math.min(
				maxExtractingFrame,
				Math.max(session.metrics.processedFrameCount, nativeCurrentFrame),
			);
			session.progress.nativeStaticLayoutAverageFps =
				progress.stage === "finalizing"
					? null
					: typeof progress.instantFps === "number" &&
							Number.isFinite(progress.instantFps) &&
							progress.instantFps > 0
						? progress.instantFps
						: typeof progress.averageFps === "number" &&
								Number.isFinite(progress.averageFps) &&
								progress.averageFps > 0
							? progress.averageFps
							: null;
			session.metrics.processedFrameCount = currentFrame;
			if (progress.stage === "finalizing" || nativeFramesComplete) {
				session.progress.reportFinalizingProgress(totalFrames, nativeFinalizingProgress);
			} else {
				session.progress.reportProgress(currentFrame, totalFrames, "extracting");
			}
		},
	);

	try {
		session.throwIfCancelled();
		const result = await window.electronAPI.nativeStaticLayoutExport({
			sessionId,
			inputPath: sourcePath,
			width: session.config.width,
			height: session.config.height,
			frameRate: session.config.frameRate,
			bitrate: session.config.bitrate,
			encodingMode: session.config.encodingMode ?? "balanced",
			durationSec: effectiveDuration,
			contentWidth,
			contentHeight,
			offsetX,
			offsetY,
			sourceCropX: sourceCrop?.x,
			sourceCropY: sourceCrop?.y,
			sourceCropWidth: sourceCrop?.width,
			sourceCropHeight: sourceCrop?.height,
			backgroundColor: background.backgroundColor,
			backgroundImagePath: background.backgroundImagePath ?? null,
			backgroundBlurPx: getSceneEffectMetrics({
				viewportWidth: session.config.width,
				backgroundBlur: session.config.backgroundBlur ?? 0,
				shadowIntensity: 0,
			}).backgroundBlurPx,
			borderRadius,
			shadowIntensity,
			webcamInputPath: webcamOverlay?.inputPath ?? null,
			webcamLeft: webcamOverlay?.left,
			webcamTop: webcamOverlay?.top,
			webcamSize: webcamOverlay?.size,
			webcamRadius: webcamOverlay?.radius,
			webcamShadowIntensity: webcamOverlay?.shadowIntensity,
			webcamMirror: webcamOverlay?.mirror,
			webcamTimeOffsetMs: webcamOverlay?.timeOffsetMs,
			cursorTelemetry,
			cursorSize: hooks.getNativeStaticLayoutCursorSize(contentWidth),
			cursorAtlasPngDataUrl: cursorAtlas?.dataUrl ?? null,
			cursorAtlasEntries: cursorAtlas?.entries,
			zoomTelemetry,
			timelineSegments,
			chunkDurationSec: STATIC_LAYOUT_CHUNK_DURATION_SEC,
			experimentalWindowsGpuCompositor: session.config.experimentalNativeExport === true,
			experimentalNvidiaCudaExport: session.config.experimentalNvidiaCudaExport === true,
			audioOptions: {
				...audioOptions,
				outputDurationSec: effectiveDuration,
			},
		});

		if (session.cancelled) {
			return {
				success: false,
				error: "Export cancelled",
				metrics: session.metrics.buildExportMetrics(),
			};
		}

		if (!result.success || !result.tempPath) {
			console.warn("[VideoExporter] Native static layout export unavailable", {
				error: result.error,
			});
			restoreEncoderState();
			return null;
		}

		const elapsedMs = getNowMs() - startedAt;
		session.metrics.encoderName = result.encoderName ?? "static-layout-h264-nvenc";
		session.progress.nativeStaticLayoutAverageFps = null;
		session.metrics.processedFrameCount = totalFrames;
		session.metrics.decodeLoopTimeMs = result.metrics?.chunkExecMs ?? elapsedMs;
		session.metrics.finalizationTimeMs = Math.max(
			0,
			elapsedMs - session.metrics.decodeLoopTimeMs,
		);
		session.metrics.finalizationStageMs.nativeExportFinalizeMs = elapsedMs;
		if (result.metrics) {
			const metrics: ExportFfmpegAudioMuxBreakdown = {
				tempVideoWriteMs: result.metrics.tempVideoWriteMs,
				tempEditedAudioWriteMs: result.metrics.tempEditedAudioWriteMs,
				ffmpegExecMs: result.metrics.ffmpegExecMs,
				muxedVideoReadMs: result.metrics.muxedVideoReadMs,
				tempVideoBytes: result.metrics.tempVideoBytes,
				tempEditedAudioBytes: result.metrics.tempEditedAudioBytes,
				muxedVideoBytes: result.metrics.muxedVideoBytes,
				chunkCount: result.metrics.chunkCount,
				chunkDurationSec: result.metrics.chunkDurationSec,
				chunkExecMs: result.metrics.chunkExecMs,
				concatExecMs: result.metrics.concatExecMs,
				staticAssetExecMs: result.metrics.staticAssetExecMs,
				fallbackChunkCount: result.metrics.fallbackChunkCount,
				videoOnlyBytes: result.metrics.videoOnlyBytes,
				chunks: result.metrics.chunks,
			};
			session.metrics.finalizationStageMs.ffmpegAudioMuxBreakdown = metrics;
		}
		session.progress.reportFinalizingProgress(totalFrames, 99);

		return {
			success: true,
			tempFilePath: result.tempPath,
			metrics: session.metrics.buildExportMetrics(),
		};
	} catch (error) {
		if (session.cancelled) {
			return {
				success: false,
				error: "Export cancelled",
				metrics: session.metrics.buildExportMetrics(),
			};
		}

		console.warn("[VideoExporter] Native static layout export failed; falling back", error);
		session.native.nativeStaticLayoutSkipReason = "native-static-runtime-failed";
		session.native.nativeStaticLayoutSkipReasons = [
			session.native.nativeStaticLayoutSkipReason,
		];
		restoreEncoderState();
		return null;
	} finally {
		unsubscribeNativeProgress?.();
		await hooks.cleanupNativeStaticLayoutBackground(background);
		if (session.native.nativeStaticLayoutSessionId === sessionId) {
			session.native.nativeStaticLayoutSessionId = null;
		}
	}
}
