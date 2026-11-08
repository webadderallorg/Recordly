import { isAacAudioEncodingSupported } from "./audioEncoder";
import {
	getDefaultLightningRenderBackend,
	shouldPreferNativeAutoBackend,
	shouldPreferNativeStaticLayoutBeforeBreeze,
} from "./backendPolicy";
import { requiresClipTimelineRendering } from "./clipTimeline";
import { getExportBackpressureProfile } from "./exportTuning";
import type { ModernExportAttempt, ModernExportFramePlan } from "./modernExportAttemptTypes";
import { getNowMs, NATIVE_EXPORT_ENGINE_NAME } from "./modernExportConstants";
import type { ModernExportHooks } from "./modernExportHooks";
import { cleanup } from "./modernExportResources";
import type { ModernExportSession } from "./modernExportSession";
import { FrameRenderer as ModernFrameRenderer } from "./modernFrameRenderer";
import { VideoMuxer } from "./muxer";

import { StreamingVideoDecoder } from "./streamingDecoder";
import type { ExportResult } from "./types";

type Hooks = Pick<
	ModernExportHooks,
	| "buildNativeAudioPlan"
	| "getNativeStaticLayoutEffectiveDuration"
	| "getRuntimePlatform"
	| "initializeEncoder"
	| "loadNativeStaticLayoutVideoInfo"
	| "tryExportNativeStaticLayout"
	| "tryStartNativeVideoExport"
>;

type Session = Pick<
	ModernExportSession,
	| "backpressureProfile"
	| "browser"
	| "config"
	| "effectiveDurationSec"
	| "flow"
	| "metrics"
	| "native"
	| "progress"
	| "sourceVideoInfo"
>;

export async function prepareExportAttempt(
	session: Session,
	hooks: Hooks,
	control: ModernExportAttempt,
): Promise<
	{ kind: "complete"; result: ExportResult } | { kind: "frames"; plan: ModernExportFramePlan }
> {
	cleanup(session);
	session.browser.encoderError = null;
	session.native.nativeEncoderError = null;
	session.native.nativeStaticLayoutSkipReason = null;
	session.native.nativeStaticLayoutSkipReasons = [];
	session.native.nativeStaticLayoutBackgroundSkipReason = null;
	session.sourceVideoInfo = null;
	session.metrics.totalExportStartTimeMs = getNowMs();
	// Forced software constrains routing too, including cloud and native fallbacks.
	const backendPreference =
		control.nativeFailure || session.config.forceSoftwareEncoding
			? "webcodecs"
			: (session.config.backendPreference ?? "auto");
	const runtimePlatform = hooks.getRuntimePlatform();
	let useNativeEncoder = false;
	let triedNativeStaticLayoutWithProbe = false;
	const prefersNativeStaticLayoutBeforeBreeze = shouldPreferNativeStaticLayoutBeforeBreeze(
		runtimePlatform,
		backendPreference,
	);
	if (
		!prefersNativeStaticLayoutBeforeBreeze &&
		runtimePlatform === "win32" &&
		backendPreference === "auto" &&
		!control.nativeFailure &&
		!session.config.experimentalNvidiaCudaExport
	) {
		session.metrics.recordBackendAttempt({
			route: "native-static-layout",
			status: "skipped",
			reason: "windows-auto-static-layout-disabled",
		});
	}
	const cloudCompression =
		session.config.deliveryProfile === "cloud" &&
		!control.nativeFailure &&
		!session.config.forceSoftwareEncoding;
	const shouldTryNativeStaticLayout =
		!session.config.forceSoftwareEncoding &&
		!cloudCompression &&
		!control.nativeFailure &&
		(backendPreference === "breeze" ||
			session.config.experimentalNvidiaCudaExport === true ||
			prefersNativeStaticLayoutBeforeBreeze);
	let shouldDeferNativeEncoderStart = shouldTryNativeStaticLayout;
	session.native.lastNativeExportError = control.nativeFailure;

	let stageStartedAt = getNowMs();
	if (shouldDeferNativeEncoderStart) {
		// Defer the streaming native encoder until after metadata is known so
		// static-layout exports can use the fastest compatible compositor first.
	} else if (
		cloudCompression ||
		(backendPreference === "auto" && shouldPreferNativeAutoBackend(runtimePlatform))
	) {
		stageStartedAt = getNowMs();
		useNativeEncoder = await hooks.tryStartNativeVideoExport();
		session.metrics.nativeSessionStartTimeMs = getNowMs() - stageStartedAt;

		if (!useNativeEncoder) {
			console.warn(
				`[VideoExporter] ${NATIVE_EXPORT_ENGINE_NAME} auto-preferred native export was unavailable; falling back to WebCodecs.`,
				session.native.lastNativeExportError,
			);
			stageStartedAt = getNowMs();
			await hooks.initializeEncoder();
		}
	} else {
		try {
			const configuredWebCodecsPath = await hooks.initializeEncoder();
			if (
				backendPreference === "auto" &&
				configuredWebCodecsPath.hardwareAcceleration === "prefer-software"
			) {
				console.warn(
					"[VideoExporter] Auto backend resolved to a software WebCodecs encoder; trying Breeze native export instead.",
				);
				stageStartedAt = getNowMs();
				useNativeEncoder = await hooks.tryStartNativeVideoExport();
				session.metrics.nativeSessionStartTimeMs = getNowMs() - stageStartedAt;
				if (useNativeEncoder) {
					session.browser.disposeEncoder(session.flow, session.metrics);
				}
			}
		} catch (error) {
			const webCodecsError = error instanceof Error ? error : new Error(String(error));
			if (backendPreference === "webcodecs") {
				throw webCodecsError;
			}

			console.warn(
				`[VideoExporter] WebCodecs encoder unavailable, trying ${NATIVE_EXPORT_ENGINE_NAME} native export fallback`,
				webCodecsError,
			);
			session.browser.disposeEncoder(session.flow, session.metrics);

			stageStartedAt = getNowMs();
			useNativeEncoder = await hooks.tryStartNativeVideoExport();
			session.metrics.nativeSessionStartTimeMs = getNowMs() - stageStartedAt;

			if (!useNativeEncoder) {
				throw webCodecsError;
			}
		}
	}

	session.backpressureProfile = getExportBackpressureProfile({
		encodeBackend: shouldDeferNativeEncoderStart || useNativeEncoder ? "ffmpeg" : "webcodecs",
		width: session.config.width,
		height: session.config.height,
		frameRate: session.config.frameRate,
		encodingMode: session.config.encodingMode,
	});
	session.flow.maxNativeWriteInFlight = useNativeEncoder
		? Math.max(
				1,
				Math.floor(
					session.config.maxInFlightNativeWrites ??
						session.backpressureProfile.maxInFlightNativeWrites,
				),
			)
		: 1;

	console.log("[VideoExporter] Backpressure profile", {
		profile: session.backpressureProfile.name,
		encodeBackend: shouldDeferNativeEncoderStart || useNativeEncoder ? "ffmpeg" : "webcodecs",
		maxEncodeQueue: session.config.maxEncodeQueue ?? session.backpressureProfile.maxEncodeQueue,
		maxDecodeQueue: session.config.maxDecodeQueue ?? session.backpressureProfile.maxDecodeQueue,
		maxPendingFrames:
			session.config.maxPendingFrames ?? session.backpressureProfile.maxPendingFrames,
		maxInFlightNativeWrites: session.flow.maxNativeWriteInFlight,
	});

	if (shouldTryNativeStaticLayout && !useNativeEncoder) {
		const nativeVideoInfo = await hooks.loadNativeStaticLayoutVideoInfo();
		if (nativeVideoInfo) {
			session.sourceVideoInfo = nativeVideoInfo;
			triedNativeStaticLayoutWithProbe = true;
			const nativeAudioPlan = hooks.buildNativeAudioPlan(nativeVideoInfo);
			const effectiveDuration = hooks.getNativeStaticLayoutEffectiveDuration(nativeVideoInfo);
			session.effectiveDurationSec = effectiveDuration;
			const totalFrames = Math.ceil(effectiveDuration * session.config.frameRate);
			const staticLayoutResult = await hooks.tryExportNativeStaticLayout(
				nativeVideoInfo,
				nativeAudioPlan,
				effectiveDuration,
				totalFrames,
			);
			if (staticLayoutResult) {
				session.browser.disposeEncoder(session.flow, session.metrics);
				return { kind: "complete", result: staticLayoutResult };
			}
		}
	}

	session.browser.streamingDecoder = new StreamingVideoDecoder({
		maxDecodeQueue: session.config.maxDecodeQueue ?? session.backpressureProfile.maxDecodeQueue,
		maxPendingFrames:
			session.config.maxPendingFrames ?? session.backpressureProfile.maxPendingFrames,
	});
	stageStartedAt = getNowMs();
	const videoInfo = await session.browser.streamingDecoder.loadMetadata(session.config.videoUrl, {
		useFallbackMediaSource: control.useFallbackMediaSource,
	});
	session.sourceVideoInfo = videoInfo;
	session.metrics.metadataLoadTimeMs = getNowMs() - stageStartedAt;
	const nativeAudioPlan = hooks.buildNativeAudioPlan(videoInfo);
	const shouldUsePitchPreservingFfmpegAudio =
		nativeAudioPlan.audioMode === "edited-track" &&
		nativeAudioPlan.strategy === "filtergraph-fast-path";
	const shouldUseFfmpegAudioFallback =
		!useNativeEncoder &&
		nativeAudioPlan.audioMode !== "none" &&
		// The PCM/FFmpeg path preserves AAC priming; WebCodecs AAC can shift clip cuts.
		(requiresClipTimelineRendering(session.config.clipRegions) ||
			shouldUsePitchPreservingFfmpegAudio ||
			!(await isAacAudioEncodingSupported()));
	const effectiveDuration = session.browser.streamingDecoder.getEffectiveDuration(
		session.config.trimRegions,
		session.config.speedRegions,
		session.config.clipRegions,
	);
	session.effectiveDurationSec = effectiveDuration;
	const totalFrames = Math.ceil(effectiveDuration * session.config.frameRate);

	if (shouldTryNativeStaticLayout && !useNativeEncoder && !triedNativeStaticLayoutWithProbe) {
		const staticLayoutResult = await hooks.tryExportNativeStaticLayout(
			videoInfo,
			nativeAudioPlan,
			effectiveDuration,
			totalFrames,
		);
		if (staticLayoutResult) {
			session.browser.disposeEncoder(session.flow, session.metrics);
			return { kind: "complete", result: staticLayoutResult };
		}
	}

	if (shouldDeferNativeEncoderStart && !useNativeEncoder) {
		stageStartedAt = getNowMs();
		useNativeEncoder = await hooks.tryStartNativeVideoExport();
		session.metrics.nativeSessionStartTimeMs = getNowMs() - stageStartedAt;
		if (useNativeEncoder) {
			session.flow.maxNativeWriteInFlight = Math.max(
				1,
				Math.floor(
					session.config.maxInFlightNativeWrites ??
						session.backpressureProfile.maxInFlightNativeWrites,
				),
			);
		} else {
			const nativeUnavailableReason =
				session.native.lastNativeExportError ??
				`${NATIVE_EXPORT_ENGINE_NAME} export is unavailable for this output profile on this system.`;
			console.warn(
				`[VideoExporter] ${NATIVE_EXPORT_ENGINE_NAME} native export unavailable after static-layout fallback; falling back to WebCodecs.`,
				nativeUnavailableReason,
			);
			shouldDeferNativeEncoderStart = false;
			session.backpressureProfile = getExportBackpressureProfile({
				encodeBackend: "webcodecs",
				width: session.config.width,
				height: session.config.height,
				frameRate: session.config.frameRate,
				encodingMode: session.config.encodingMode,
			});
			session.flow.maxNativeWriteInFlight = 1;
			await hooks.initializeEncoder();
		}
	}

	stageStartedAt = getNowMs();
	control.inRendererStage = true;
	session.browser.renderer = new ModernFrameRenderer({
		timelineEffects: session.config.clipRegions !== undefined,
		width: session.config.width,
		height: session.config.height,
		preferredRenderBackend: control.retryWithWebgl
			? "webgl"
			: (session.config.preferredRenderBackend ?? getDefaultLightningRenderBackend()),
		wallpaper: session.config.wallpaper,
		zoomRegions: session.config.zoomRegions,
		showShadow: session.config.showShadow,
		shadowIntensity: session.config.shadowIntensity,
		backgroundBlur: session.config.backgroundBlur,
		zoomMotionBlur: session.config.zoomMotionBlur,
		zoomMotionBlurTuning: session.config.zoomMotionBlurTuning,
		connectZooms: session.config.connectZooms,
		zoomInDurationMs: session.config.zoomInDurationMs,
		zoomInOverlapMs: session.config.zoomInOverlapMs,
		zoomOutDurationMs: session.config.zoomOutDurationMs,
		connectedZoomGapMs: session.config.connectedZoomGapMs,
		connectedZoomDurationMs: session.config.connectedZoomDurationMs,
		zoomInEasing: session.config.zoomInEasing,
		zoomOutEasing: session.config.zoomOutEasing,
		connectedZoomEasing: session.config.connectedZoomEasing,
		borderRadius: session.config.borderRadius,
		padding: session.config.padding,
		cropRegion: session.config.cropRegion,
		webcam: session.config.webcam,
		webcamUrl: session.config.webcamUrl,
		videoWidth: videoInfo.width,
		videoHeight: videoInfo.height,
		annotationRegions: session.config.annotationRegions,
		autoCaptions: session.config.autoCaptions,
		autoCaptionSettings: session.config.autoCaptionSettings,
		speedRegions: session.config.speedRegions,
		previewWidth: session.config.previewWidth,
		previewHeight: session.config.previewHeight,
		cursorTelemetry: session.config.cursorTelemetry,
		showCursor: session.config.showCursor,
		cursorStyle: session.config.cursorStyle,
		cursorSize: session.config.cursorSize,
		cursorSmoothing: session.config.cursorSmoothing,
		cursorSpringStiffnessMultiplier: session.config.cursorSpringStiffnessMultiplier,
		cursorSpringDampingMultiplier: session.config.cursorSpringDampingMultiplier,
		cursorSpringMassMultiplier: session.config.cursorSpringMassMultiplier,
		cameraSpringStiffnessMultiplier: session.config.cameraSpringStiffnessMultiplier,
		cameraSpringDampingMultiplier: session.config.cameraSpringDampingMultiplier,
		cameraSpringMassMultiplier: session.config.cameraSpringMassMultiplier,
		cursorMotionBlur: session.config.cursorMotionBlur,
		cursorClickEffect: session.config.cursorClickEffect,
		cursorClickEffectColor: session.config.cursorClickEffectColor,
		cursorClickEffectScale: session.config.cursorClickEffectScale,
		cursorClickEffectOpacity: session.config.cursorClickEffectOpacity,
		cursorClickEffectDurationMs: session.config.cursorClickEffectDurationMs,
		cursorClickBounce: session.config.cursorClickBounce,
		cursorClickBounceDuration: session.config.cursorClickBounceDuration,
		cursorSway: session.config.cursorSway,
		cursorIdleHide: session.config.cursorIdleHide,
		zoomSmoothness: session.config.zoomSmoothness,
		zoomClassicMode: session.config.zoomClassicMode,
	});
	await session.browser.renderer.initialize();
	control.inRendererStage = false;
	session.metrics.rendererInitTimeMs = getNowMs() - stageStartedAt;
	session.metrics.renderBackend = session.browser.renderer.getRendererBackend();
	console.log(`[VideoExporter] Using ${session.metrics.renderBackend} render backend`);

	if (!useNativeEncoder) {
		const hasAudio = nativeAudioPlan.audioMode !== "none";
		session.browser.muxer = new VideoMuxer(
			session.config,
			hasAudio && !shouldUseFfmpegAudioFallback,
		);
		await session.browser.muxer.initialize();
	}

	console.log("[VideoExporter] Original duration:", videoInfo.duration, "s");
	console.log("[VideoExporter] Effective duration:", effectiveDuration, "s");
	console.log("[VideoExporter] Total frames to export:", totalFrames);
	console.log(
		`[VideoExporter] Using ${useNativeEncoder ? `${NATIVE_EXPORT_ENGINE_NAME} native` : "WebCodecs"} encode path`,
	);

	return {
		kind: "frames",
		plan: {
			useNativeEncoder,
			nativeAudioPlan,
			totalFrames,
			shouldUseFfmpegAudioFallback,
			shouldUsePitchPreservingFfmpegAudio,
		},
	};
}
