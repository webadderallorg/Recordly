import { isWebcamCropRegionDefault } from "@/components/video-editor/webcamOverlay";
import {
	getCursorIdleIntervals,
	normalizeCursorIdleHideSettings,
} from "@/components/video-editor/videoPlayback/cursorIdleVisibility";
import { isVideoWallpaperSource } from "@/lib/wallpapers";
import { requiresClipTimelineRendering } from "./clipTimeline";
import { getNowMs } from "./modernExportConstants";
import type { ModernExportHooks } from "./modernExportHooks";
import type { ModernExportSession } from "./modernExportSession";
import { type NativeAudioPlan } from "./nativeExportAudioPlan";

import { type DecodedVideoInfo } from "./streamingDecoder";

type Hooks = Pick<
	ModernExportHooks,
	| "buildNativeStaticLayoutVideoTimelineSegments"
	| "getNativeVideoSourcePath"
	| "getNativeWebcamSourcePath"
	| "shouldUseNativeStaticLayoutTimelineMap"
>;

type Session = Pick<ModernExportSession, "config" | "metrics">;

export async function loadNativeStaticLayoutVideoInfo(
	session: Session,
	hooks: Hooks,
): Promise<DecodedVideoInfo | null> {
	if (typeof window === "undefined" || !window.electronAPI?.probeNativeVideoMetadata) {
		return null;
	}

	const sourcePath = hooks.getNativeVideoSourcePath();
	if (!sourcePath) {
		return null;
	}

	const startedAt = getNowMs();
	try {
		const result = await window.electronAPI.probeNativeVideoMetadata(sourcePath);
		session.metrics.metadataLoadTimeMs = getNowMs() - startedAt;
		if (!result.success || !result.metadata) {
			console.info("[VideoExporter] Native metadata probe unavailable", {
				error: result.error,
			});
			return null;
		}

		return result.metadata;
	} catch (error) {
		session.metrics.metadataLoadTimeMs = getNowMs() - startedAt;
		console.info("[VideoExporter] Native metadata probe failed", error);
		return null;
	}
}

export function isDefaultCropRegion(session: Session, _hooks: Hooks): boolean {
	const crop = session.config.cropRegion;
	const epsilon = 0.0001;
	return (
		Math.abs(crop.x) <= epsilon &&
		Math.abs(crop.y) <= epsilon &&
		Math.abs(crop.width - 1) <= epsilon &&
		Math.abs(crop.height - 1) <= epsilon
	);
}

export function getNativeStaticLayoutSourceCrop(
	session: Session,
	_hooks: Hooks,
	videoInfo: DecodedVideoInfo,
): { x: number; y: number; width: number; height: number } {
	const crop = session.config.cropRegion;
	const sourceWidth = Math.max(2, Math.round(videoInfo.width));
	const sourceHeight = Math.max(2, Math.round(videoInfo.height));
	const cropX = Math.min(1, Math.max(0, crop.x));
	const cropY = Math.min(1, Math.max(0, crop.y));
	const cropRight = Math.min(1, Math.max(cropX, crop.x + crop.width));
	const cropBottom = Math.min(1, Math.max(cropY, crop.y + crop.height));

	const left = Math.min(sourceWidth - 2, Math.max(0, Math.floor(cropX * sourceWidth))) & ~1;
	const top = Math.min(sourceHeight - 2, Math.max(0, Math.floor(cropY * sourceHeight))) & ~1;
	const right = Math.min(sourceWidth, Math.max(left + 2, Math.ceil(cropRight * sourceWidth)));
	const bottom = Math.min(sourceHeight, Math.max(top + 2, Math.ceil(cropBottom * sourceHeight)));
	const width = Math.max(2, right - left) & ~1;
	const height = Math.max(2, bottom - top) & ~1;

	return {
		x: left,
		y: top,
		width: Math.min(width, sourceWidth - left),
		height: Math.min(height, sourceHeight - top),
	};
}

export function canUseNativeStaticLayoutAudioPlan(
	_session: Session,
	_hooks: Hooks,
	audioPlan: NativeAudioPlan,
): boolean {
	switch (audioPlan.audioMode) {
		case "none":
		case "copy-source":
			return true;
		case "trim-source":
			return true;
		case "edited-track":
			return (
				audioPlan.strategy === "offline-render-fallback" ||
				audioPlan.strategy === "filtergraph-fast-path"
			);
	}
}

export function hasUnsupportedNativeStaticLayoutWebcamShape(
	session: Session,
	_hooks: Hooks,
): boolean {
	const webcam = session.config.webcam;
	if (!webcam?.enabled) {
		return false;
	}

	const width = webcam.width ?? webcam.size ?? 40;
	const height = webcam.height ?? webcam.size ?? 40;
	return Math.abs(width - height) > 0.001 || !isWebcamCropRegionDefault(webcam.cropRegion);
}

export function getNativeStaticLayoutSkipReasons(
	session: Session,
	hooks: Hooks,
	audioPlan: NativeAudioPlan,
	videoInfo: DecodedVideoInfo,
	effectiveDurationSec: number,
): string[] {
	const reasons: string[] = [];
	if (requiresClipTimelineRendering(session.config.clipRegions))
		reasons.push("explicit-clip-timeline");
	if (
		typeof window === "undefined" ||
		!window.electronAPI?.nativeStaticLayoutExport ||
		!window.electronAPI?.nativeStaticLayoutExportCancel
	) {
		reasons.push("native-static-api-unavailable");
	}

	if (session.config.width % 2 !== 0 || session.config.height % 2 !== 0) {
		reasons.push("odd-output-dimensions");
	}

	if (!canUseNativeStaticLayoutAudioPlan(session, hooks, audioPlan)) {
		reasons.push(`unsupported-audio-mode:${audioPlan.audioMode}`);
	}

	const speedRegions = session.config.speedRegions ?? [];
	const hasCursorClickEffect =
		(session.config.cursorTelemetry?.length ?? 0) > 0 &&
		(session.config.cursorClickEffect ?? "none") !== "none";
	const configuredWallpaper = session.config.wallpaper?.trim() ?? "";
	if (isVideoWallpaperSource(configuredWallpaper)) {
		reasons.push("unsupported-background-video");
	}
	if (hasCursorClickEffect) {
		reasons.push("unsupported-cursor-click-effect");
	}
	if (
		session.config.showCursor === true &&
		getCursorIdleIntervals(
			session.config.cursorTelemetry ?? [],
			normalizeCursorIdleHideSettings(session.config.cursorIdleHide),
		).length > 0
	) {
		// Native compositors lack cursor alpha animation. Encode shared-renderer
		// frames when a qualifying pause actually needs a fade.
		reasons.push("unsupported-cursor-idle-fade");
	}

	const hasZoomRegions = (session.config.zoomRegions ?? []).length > 0;
	if (hasZoomRegions && (session.config.zoomMotionBlur ?? 0) > 0) {
		// Native static/GPU compositors animate the pose but do not implement
		// camera motion blur. Encode the shared renderer's finished frames instead.
		reasons.push("native-zoom-motion-blur-mismatch");
	}
	const needsTimelineMap = hooks.shouldUseNativeStaticLayoutTimelineMap(
		videoInfo,
		effectiveDurationSec,
	);
	if (needsTimelineMap && session.config.experimentalNativeExport !== true) {
		reasons.push("native-timeline-requires-windows-gpu");
	}
	if (
		needsTimelineMap &&
		hooks.buildNativeStaticLayoutVideoTimelineSegments(videoInfo).length === 0
	) {
		reasons.push(
			speedRegions.length > 0
				? "unsupported-native-speed-timeline"
				: "unsupported-native-trim-timeline",
		);
	}
	if (hasZoomRegions && session.config.experimentalNativeExport !== true) {
		reasons.push("native-zoom-requires-windows-gpu");
	}
	if ((session.config.annotationRegions ?? []).length > 0) {
		reasons.push("unsupported-annotation-overlay");
	}
	if ((session.config.autoCaptions ?? []).length > 0) {
		reasons.push("unsupported-caption-overlay");
	}
	if (session.config.webcam?.enabled) {
		// Native GPU compositors use a different corner and shadow model.
		// Keep webcam exports on the shared renderer used by preview.
		reasons.push("native-webcam-style-mismatch");
	}

	if (session.config.webcam?.enabled && !hooks.getNativeWebcamSourcePath()) {
		reasons.push("unsupported-webcam-source");
	}
	if (hasUnsupportedNativeStaticLayoutWebcamShape(session, hooks)) {
		reasons.push("unsupported-rectangular-webcam-overlay");
	}

	const crop = session.config.cropRegion;
	if (
		!Number.isFinite(crop.x) ||
		!Number.isFinite(crop.y) ||
		!Number.isFinite(crop.width) ||
		!Number.isFinite(crop.height) ||
		crop.width <= 0 ||
		crop.height <= 0
	) {
		reasons.push("invalid-crop-region");
	}

	return reasons;
}

export function getNativeStaticLayoutSkipReason(
	session: Session,
	hooks: Hooks,
	audioPlan: NativeAudioPlan,
	videoInfo: DecodedVideoInfo,
	effectiveDurationSec: number,
): string | null {
	return (
		getNativeStaticLayoutSkipReasons(
			session,
			hooks,
			audioPlan,
			videoInfo,
			effectiveDurationSec,
		)[0] ?? null
	);
}
