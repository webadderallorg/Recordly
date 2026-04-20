import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	calculateOutputDimensions,
	DEFAULT_MP4_CODEC,
	type ExportMp4FrameRate,
	GIF_SIZE_PRESETS,
	probeSupportedMp4Dimensions,
	type SupportedMp4Dimensions,
} from "@/lib/exporter";
import type { VideoPlaybackRef } from "../VideoPlayback";
import {
	calculateMp4ExportDimensions,
	calculateMp4SourceDimensions,
	getSourceQualityBitrate,
} from "../videoEditorUtils";
import { normalizeCursorTelemetry } from "../timeline/zoomSuggestionUtils";
import {
	buildLoopedCursorTelemetry,
	getDisplayedTimelineWindowMs,
} from "../videoPlayback/cursorLoopTelemetry";
import type { CursorTelemetryPoint } from "../types";
import type { EditorHistorySnapshot } from "./useEditorHistory";
import type { RenderConfig } from "./useEditorExport";
import type { useEditorPreferences } from "./useEditorPreferences";
import type { useEditorRegions } from "./useEditorRegions";
import type { useEditorCaptions } from "./useEditorCaptions";

type Prefs = ReturnType<typeof useEditorPreferences>;
type Regions = ReturnType<typeof useEditorRegions>;
type Captions = ReturnType<typeof useEditorCaptions>;

interface UseEditorWiringParams {
	prefs: Prefs;
	regions: Regions;
	captions: Captions;
	videoPath: string | null;
	isPlaying: boolean;
	duration: number;
	sourceAudioFallbackPaths: string[];
	cursorTelemetry: CursorTelemetryPoint[];
	videoPlaybackRef: React.RefObject<VideoPlaybackRef | null>;
}

export function useEditorWiring({
	prefs,
	regions,
	captions,
	videoPath,
	isPlaying,
	duration,
	sourceAudioFallbackPaths,
	cursorTelemetry,
	videoPlaybackRef,
}: UseEditorWiringParams) {
	// ── Build/apply history snapshot (bridge regions + captions) ─────
	const buildHistorySnapshot = useCallback((): EditorHistorySnapshot => {
		return {
			zoomRegions: regions.zoomRegions,
			clipRegions: regions.clipRegions,
			annotationRegions: regions.annotationRegions,
			audioRegions: regions.audioRegions,
			autoCaptions: captions.autoCaptions,
			selectedZoomId: regions.selectedZoomId,
			selectedClipId: regions.selectedClipId,
			selectedAnnotationId: regions.selectedAnnotationId,
			selectedAudioId: regions.selectedAudioId,
		};
	}, [
		regions.zoomRegions, regions.clipRegions, regions.annotationRegions,
		regions.audioRegions, captions.autoCaptions, regions.selectedZoomId,
		regions.selectedClipId, regions.selectedAnnotationId, regions.selectedAudioId,
	]);

	const applyHistorySnapshot = useCallback(
		(snapshot: EditorHistorySnapshot) => {
			regions.setZoomRegions(snapshot.zoomRegions);
			regions.setClipRegions(snapshot.clipRegions);
			regions.setAnnotationRegions(snapshot.annotationRegions);
			regions.setAudioRegions(snapshot.audioRegions);
			captions.setAutoCaptions(snapshot.autoCaptions);
			regions.setSelectedZoomId(snapshot.selectedZoomId);
			regions.setSelectedClipId(snapshot.selectedClipId);
			regions.setSelectedAnnotationId(snapshot.selectedAnnotationId);
			regions.setSelectedAudioId(snapshot.selectedAudioId);
		},
		[
			regions.setZoomRegions, regions.setClipRegions, regions.setAnnotationRegions,
			regions.setAudioRegions, captions.setAutoCaptions, regions.setSelectedZoomId,
			regions.setSelectedClipId, regions.setSelectedAnnotationId, regions.setSelectedAudioId,
		],
	);

	// ── Dimension calculations ───────────────────────────────────────
	const [supportedMp4SourceDimensions, setSupportedMp4SourceDimensions] =
		useState<SupportedMp4Dimensions>({
			width: 1920,
			height: 1080,
			capped: false,
			encoderPath: null,
		});

	const gifOutputDimensions = useMemo(
		() =>
			calculateOutputDimensions(
				videoPlaybackRef.current?.video?.videoWidth || 1920,
				videoPlaybackRef.current?.video?.videoHeight || 1080,
				prefs.gifSizePreset,
				GIF_SIZE_PRESETS,
			),
		[prefs.gifSizePreset],
	);

	const desiredMp4SourceDimensions = useMemo(
		() =>
			calculateMp4SourceDimensions(
				videoPlaybackRef.current?.video?.videoWidth || 1920,
				videoPlaybackRef.current?.video?.videoHeight || 1080,
				prefs.aspectRatio,
			),
		[prefs.aspectRatio],
	);

	const mp4OutputDimensions = useMemo(() => {
		const baseWidth = supportedMp4SourceDimensions.encoderPath
			? supportedMp4SourceDimensions.width
			: desiredMp4SourceDimensions.width;
		const baseHeight = supportedMp4SourceDimensions.encoderPath
			? supportedMp4SourceDimensions.height
			: desiredMp4SourceDimensions.height;
		return {
			medium: calculateMp4ExportDimensions(baseWidth, baseHeight, "medium"),
			good: calculateMp4ExportDimensions(baseWidth, baseHeight, "good"),
			high: calculateMp4ExportDimensions(baseWidth, baseHeight, "high"),
			source: calculateMp4ExportDimensions(baseWidth, baseHeight, "source"),
		};
	}, [desiredMp4SourceDimensions, supportedMp4SourceDimensions]);

	const ensureSupportedMp4SourceDimensions = useCallback(
		async (frameRate: ExportMp4FrameRate) => {
			const result = await probeSupportedMp4Dimensions({
				width: desiredMp4SourceDimensions.width,
				height: desiredMp4SourceDimensions.height,
				frameRate,
				codec: DEFAULT_MP4_CODEC,
				getBitrate: getSourceQualityBitrate,
			});
			if (!result.encoderPath) {
				throw new Error(
					`Video encoding not supported on this system. Tried codec ${DEFAULT_MP4_CODEC} at ${frameRate} FPS up to ${desiredMp4SourceDimensions.width}x${desiredMp4SourceDimensions.height}.`,
				);
			}
			setSupportedMp4SourceDimensions((current) => {
				if (
					current.width === result.width &&
					current.height === result.height &&
					current.capped === result.capped &&
					current.encoderPath?.codec === result.encoderPath?.codec &&
					current.encoderPath?.hardwareAcceleration ===
						result.encoderPath?.hardwareAcceleration
				) {
					return current;
				}
				return result;
			});
			return result;
		},
		[desiredMp4SourceDimensions.height, desiredMp4SourceDimensions.width],
	);

	const mp4SupportRequestRef = useRef(0);
	useEffect(() => {
		let cancelled = false;
		const requestId = mp4SupportRequestRef.current + 1;
		mp4SupportRequestRef.current = requestId;
		setSupportedMp4SourceDimensions({
			width: desiredMp4SourceDimensions.width,
			height: desiredMp4SourceDimensions.height,
			capped: false,
			encoderPath: null,
		});
		void ensureSupportedMp4SourceDimensions(prefs.mp4FrameRate)
			.then((result) => {
				if (cancelled || requestId !== mp4SupportRequestRef.current) return;
				setSupportedMp4SourceDimensions(result);
			})
			.catch(() => {
				if (cancelled || requestId !== mp4SupportRequestRef.current) return;
				setSupportedMp4SourceDimensions({
					width: desiredMp4SourceDimensions.width,
					height: desiredMp4SourceDimensions.height,
					capped: false,
					encoderPath: null,
				});
			});
		return () => { cancelled = true; };
	}, [
		desiredMp4SourceDimensions.height,
		desiredMp4SourceDimensions.width,
		ensureSupportedMp4SourceDimensions,
		prefs.mp4FrameRate,
	]);

	// ── Cursor telemetry memos ───────────────────────────────────────
	const normalizedCursorTelemetry = useMemo(() => {
		if (cursorTelemetry.length === 0) return [] as CursorTelemetryPoint[];
		const totalMs = Math.max(0, Math.round(duration * 1000));
		return normalizeCursorTelemetry(
			cursorTelemetry,
			totalMs > 0 ? totalMs : Number.MAX_SAFE_INTEGER,
		);
	}, [cursorTelemetry, duration]);

	const displayedTimelineWindow = useMemo(() => {
		const totalMs = Math.max(0, Math.round(duration * 1000));
		return getDisplayedTimelineWindowMs(totalMs, regions.trimRegions);
	}, [duration, regions.trimRegions]);

	const effectiveCursorTelemetry = useMemo(() => {
		if (!prefs.loopCursor) return normalizedCursorTelemetry;
		if (
			normalizedCursorTelemetry.length < 2 ||
			displayedTimelineWindow.endMs <= displayedTimelineWindow.startMs
		) {
			return normalizedCursorTelemetry;
		}
		return buildLoopedCursorTelemetry(
			normalizedCursorTelemetry,
			displayedTimelineWindow.endMs,
			displayedTimelineWindow.startMs,
		);
	}, [prefs.loopCursor, normalizedCursorTelemetry, displayedTimelineWindow]);

	// ── getRenderConfig (for export hook) ────────────────────────────
	const getRenderConfig = useCallback((): RenderConfig => {
		return {
			videoPath,
			wallpaper: prefs.wallpaper,
			shadowIntensity: prefs.shadowIntensity,
			backgroundBlur: prefs.backgroundBlur,
			zoomMotionBlur: prefs.zoomMotionBlur,
			connectZooms: prefs.connectZooms,
			zoomInDurationMs: prefs.zoomInDurationMs,
			zoomInOverlapMs: prefs.zoomInOverlapMs,
			zoomOutDurationMs: prefs.zoomOutDurationMs,
			connectedZoomGapMs: prefs.connectedZoomGapMs,
			connectedZoomDurationMs: prefs.connectedZoomDurationMs,
			zoomInEasing: prefs.zoomInEasing,
			zoomOutEasing: prefs.zoomOutEasing,
			connectedZoomEasing: prefs.connectedZoomEasing,
			showCursor: prefs.showCursor,
			cursorStyle: prefs.cursorStyle,
			effectiveCursorTelemetry,
			cursorSize: prefs.cursorSize,
			cursorSmoothing: prefs.cursorSmoothing,
			zoomSmoothness: prefs.zoomSmoothness,
			zoomClassicMode: prefs.zoomClassicMode,
			cursorMotionBlur: prefs.cursorMotionBlur,
			cursorClickBounce: prefs.cursorClickBounce,
			cursorClickBounceDuration: prefs.cursorClickBounceDuration,
			cursorSway: prefs.cursorSway,
			audioRegions: regions.audioRegions,
			sourceAudioFallbackPaths,
			exportEncodingMode: prefs.exportEncodingMode,
			exportBackendPreference: prefs.exportBackendPreference,
			exportPipelineModel: prefs.exportPipelineModel,
			borderRadius: prefs.borderRadius,
			padding: prefs.padding,
			cropRegion: prefs.cropRegion,
			webcam: prefs.webcam,
			resolvedWebcamVideoUrl: prefs.resolvedWebcamVideoUrl,
			annotationRegions: regions.annotationRegions,
			autoCaptions: captions.autoCaptions,
			autoCaptionSettings: captions.autoCaptionSettings,
			isPlaying,
			exportQuality: prefs.exportQuality,
			effectiveZoomRegions: regions.effectiveZoomRegions,
			effectiveSpeedRegions: regions.effectiveSpeedRegions,
			trimRegions: regions.trimRegions,
			mp4FrameRate: prefs.mp4FrameRate,
			frame: prefs.frame,
			exportFormat: prefs.exportFormat,
			gifFrameRate: prefs.gifFrameRate,
			gifLoop: prefs.gifLoop,
			gifSizePreset: prefs.gifSizePreset,
		};
	}, [
		videoPath, prefs.wallpaper, prefs.shadowIntensity, prefs.backgroundBlur,
		prefs.zoomMotionBlur, prefs.connectZooms, prefs.zoomInDurationMs, prefs.zoomInOverlapMs,
		prefs.zoomOutDurationMs, prefs.connectedZoomGapMs, prefs.connectedZoomDurationMs,
		prefs.zoomInEasing, prefs.zoomOutEasing, prefs.connectedZoomEasing, prefs.showCursor,
		prefs.cursorStyle, effectiveCursorTelemetry, prefs.cursorSize, prefs.cursorSmoothing,
		prefs.zoomSmoothness, prefs.zoomClassicMode, prefs.cursorMotionBlur,
		prefs.cursorClickBounce, prefs.cursorClickBounceDuration, prefs.cursorSway,
		regions.audioRegions, sourceAudioFallbackPaths, prefs.exportEncodingMode,
		prefs.exportBackendPreference, prefs.exportPipelineModel, prefs.borderRadius,
		prefs.padding, prefs.cropRegion, prefs.webcam, prefs.resolvedWebcamVideoUrl,
		regions.annotationRegions, captions.autoCaptions, captions.autoCaptionSettings,
		isPlaying, prefs.exportQuality, regions.effectiveZoomRegions,
		regions.effectiveSpeedRegions, regions.trimRegions, prefs.mp4FrameRate, prefs.frame,
		prefs.exportFormat, prefs.gifFrameRate, prefs.gifLoop, prefs.gifSizePreset,
	]);

	// ── getCurrentPersistedState (for project save/load) ─────────────
	const getCurrentPersistedState = useCallback(() => {
		return {
			wallpaper: prefs.wallpaper,
			shadowIntensity: prefs.shadowIntensity,
			backgroundBlur: prefs.backgroundBlur,
			zoomMotionBlur: prefs.zoomMotionBlur,
			connectZooms: prefs.connectZooms,
			zoomInDurationMs: prefs.zoomInDurationMs,
			zoomInOverlapMs: prefs.zoomInOverlapMs,
			zoomOutDurationMs: prefs.zoomOutDurationMs,
			connectedZoomGapMs: prefs.connectedZoomGapMs,
			connectedZoomDurationMs: prefs.connectedZoomDurationMs,
			zoomInEasing: prefs.zoomInEasing,
			zoomOutEasing: prefs.zoomOutEasing,
			connectedZoomEasing: prefs.connectedZoomEasing,
			showCursor: prefs.showCursor,
			loopCursor: prefs.loopCursor,
			cursorStyle: prefs.cursorStyle,
			cursorSize: prefs.cursorSize,
			cursorSmoothing: prefs.cursorSmoothing,
			zoomSmoothness: prefs.zoomSmoothness,
			zoomClassicMode: prefs.zoomClassicMode,
			cursorMotionBlur: prefs.cursorMotionBlur,
			cursorClickBounce: prefs.cursorClickBounce,
			cursorClickBounceDuration: prefs.cursorClickBounceDuration,
			cursorSway: prefs.cursorSway,
			borderRadius: prefs.borderRadius,
			padding: prefs.padding,
			frame: prefs.frame,
			webcam: prefs.webcam,
			zoomRegions: regions.zoomRegions,
			trimRegions: regions.trimRegions,
			clipRegions: regions.clipRegions,
			speedRegions: regions.effectiveSpeedRegions,
			annotationRegions: regions.annotationRegions,
			audioRegions: regions.audioRegions,
			autoCaptions: captions.autoCaptions,
			autoCaptionSettings: captions.autoCaptionSettings,
			aspectRatio: prefs.aspectRatio,
			exportEncodingMode: prefs.exportEncodingMode,
			exportBackendPreference: prefs.exportBackendPreference,
			exportPipelineModel: prefs.exportPipelineModel,
			exportQuality: prefs.exportQuality,
			mp4FrameRate: prefs.mp4FrameRate,
			exportFormat: prefs.exportFormat,
			gifFrameRate: prefs.gifFrameRate,
			gifLoop: prefs.gifLoop,
			gifSizePreset: prefs.gifSizePreset,
		};
	}, [
		prefs.wallpaper, prefs.shadowIntensity, prefs.backgroundBlur, prefs.zoomMotionBlur,
		prefs.connectZooms, prefs.zoomInDurationMs, prefs.zoomInOverlapMs, prefs.zoomOutDurationMs,
		prefs.connectedZoomGapMs, prefs.connectedZoomDurationMs, prefs.zoomInEasing,
		prefs.zoomOutEasing, prefs.connectedZoomEasing, prefs.showCursor, prefs.loopCursor,
		prefs.cursorStyle, prefs.cursorSize, prefs.cursorSmoothing, prefs.zoomSmoothness,
		prefs.zoomClassicMode, prefs.cursorMotionBlur, prefs.cursorClickBounce,
		prefs.cursorClickBounceDuration, prefs.cursorSway, prefs.borderRadius, prefs.padding,
		prefs.frame, prefs.webcam, prefs.aspectRatio, prefs.exportEncodingMode,
		prefs.exportBackendPreference, prefs.exportPipelineModel, prefs.exportQuality,
		prefs.mp4FrameRate, prefs.exportFormat, prefs.gifFrameRate, prefs.gifLoop,
		prefs.gifSizePreset, regions.zoomRegions, regions.trimRegions, regions.clipRegions,
		regions.effectiveSpeedRegions, regions.annotationRegions, regions.audioRegions,
		captions.autoCaptions, captions.autoCaptionSettings,
	]);

	return {
		buildHistorySnapshot,
		applyHistorySnapshot,
		gifOutputDimensions,
		mp4OutputDimensions,
		ensureSupportedMp4SourceDimensions,
		normalizedCursorTelemetry,
		effectiveCursorTelemetry,
		getRenderConfig,
		getCurrentPersistedState,
	};
}
