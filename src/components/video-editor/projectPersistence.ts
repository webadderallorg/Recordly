import { normalizeCursorIdleHideSettings } from "./videoPlayback/cursorIdleVisibility";
import { DEFAULT_WALLPAPER_PATH } from "@/lib/wallpapers";
import { ASPECT_RATIOS, type AspectRatio, isCustomAspectRatio } from "@/utils/aspectRatioUtils";
import { rippleRegionAnchors, rippleRegions } from "./clipSequence";
import { normalizeProjectCaptions } from "./projectCaptionsNormalization";
import { normalizeProjectCrop } from "./projectCropNormalization";
import { normalizeProjectCursorMotion } from "./projectCursorMotionNormalization";
import { normalizeProjectEffects } from "./projectEffectsNormalization";
import { normalizeProjectOverlayRegions } from "./projectOverlayRegionsNormalization";
import type { EditorProjectData, ProjectEditorState } from "./projectPersistenceTypes";
import {
	clamp,
	getDefaultBorderRadiusPercent,
	isFiniteNumber,
	normalizeZoomTransitionEasing,
	PROJECT_VERSION,
} from "./projectPersistenceUtils";
import { normalizeProjectTimeline } from "./projectTimelineNormalization";
import { normalizeProjectWebcam } from "./projectWebcamNormalization";
import {
	ADVANCED_VERTICAL_PADDING_MAX,
	DEFAULT_CONNECTED_ZOOM_EASING,
	DEFAULT_CURSOR_CLICK_EFFECT,
	DEFAULT_CURSOR_MOTION_BLUR,
	DEFAULT_CURSOR_SWAY,
	DEFAULT_PADDING,
	DEFAULT_SHADOW_INTENSITY,
	DEFAULT_ZOOM_IN_EASING,
	DEFAULT_ZOOM_OUT_EASING,
	DEFAULT_ZOOM_SMOOTHNESS,
	normalizeCursorClickEffectStyle,
} from "./types";

export { fromFileUrl, resolveVideoUrl, toFileUrl } from "./projectMediaPaths";
export { type EditorProjectData, type ProjectEditorState } from "./projectPersistenceTypes";
export {
	getDefaultBorderRadiusPercent,
	legacyBorderRadiusPixelsToPercent,
	MACOS_DEFAULT_BORDER_RADIUS_PERCENT,
	PROJECT_VERSION,
	stripPersistedDevMotionBlurSettings,
} from "./projectPersistenceUtils";

export function deriveNextId(prefix: string, ids: string[]): number {
	const max = ids.reduce((acc, id) => {
		const match = id.match(new RegExp(`^${prefix}-(\\d+)$`));
		if (!match) return acc;
		const value = Number(match[1]);
		return Number.isFinite(value) ? Math.max(acc, value) : acc;
	}, 0);
	return max + 1;
}

export function validateProjectData(candidate: unknown): candidate is EditorProjectData {
	if (!candidate || typeof candidate !== "object") return false;
	const project = candidate as Partial<EditorProjectData>;
	if (typeof project.version !== "number") return false;
	if (project.projectId !== undefined && typeof project.projectId !== "string") return false;
	if (typeof project.videoPath !== "string" || !project.videoPath) return false;
	if (!project.editor || typeof project.editor !== "object") return false;
	return true;
}
export function normalizeProjectEditor(editor: Partial<ProjectEditorState>): ProjectEditorState {
	const validAspectRatios = new Set<AspectRatio>(ASPECT_RATIOS);
	const {
		normalizedZoomMotionBlur,
		normalizedZoomMotionBlurTuning,
		normalizedBackgroundBlur,
		normalizedZoomInDurationMs,
		normalizedZoomInOverlapMs,
		normalizedZoomOutDurationMs,
		normalizedConnectedZoomGapMs,
		normalizedConnectedZoomDurationMs,
	} = normalizeProjectEffects(editor);
	const {
		normalizedZoomRegions,
		normalizedTrimRegions,
		normalizedClipRegions,
		sequenceClips,
		sequenceChanged,
		normalizedAutoFullTrackClipId,
		normalizedAutoFullTrackClipEndMs,
		normalizedSpeedRegions,
	} = normalizeProjectTimeline(editor);
	const { normalizedAnnotationRegions, normalizedAudioRegions } =
		normalizeProjectOverlayRegions(editor);
	const { normalizedAutoCaptions, normalizedAutoCaptionSettings } =
		normalizeProjectCaptions(editor);
	const { cropX, cropY, cropWidth, cropHeight } = normalizeProjectCrop(editor);
	const {
		normalizedCursorStyle,
		normalizedCursorClickEffectScale,
		normalizedCursorClickEffectOpacity,
		normalizedCursorClickEffectDurationMs,
		normalizedCursorClickEffectColor,
		normalizedMotionPreset,
	} = normalizeProjectCursorMotion(
		editor,
		normalizedZoomInDurationMs,
		normalizedZoomOutDurationMs,
	);
	const clipIds = new Set(sequenceClips.map(({ id }) => id));

	return {
		wallpaper: typeof editor.wallpaper === "string" ? editor.wallpaper : DEFAULT_WALLPAPER_PATH,
		shadowIntensity:
			typeof editor.shadowIntensity === "number" ? editor.shadowIntensity : DEFAULT_SHADOW_INTENSITY,
		backgroundBlur: normalizedBackgroundBlur,
		zoomMotionBlur: normalizedZoomMotionBlur,
		zoomMotionBlurTuning: normalizedZoomMotionBlurTuning,
		connectZooms: typeof editor.connectZooms === "boolean" ? editor.connectZooms : true,
		zoomInDurationMs: normalizedMotionPreset.zoomInDurationMs,
		zoomInOverlapMs: normalizedZoomInOverlapMs,
		zoomOutDurationMs: normalizedMotionPreset.zoomOutDurationMs,
		connectedZoomGapMs: normalizedConnectedZoomGapMs,
		connectedZoomDurationMs: normalizedConnectedZoomDurationMs,
		zoomInEasing: normalizeZoomTransitionEasing(editor.zoomInEasing, DEFAULT_ZOOM_IN_EASING),
		zoomOutEasing: normalizeZoomTransitionEasing(editor.zoomOutEasing, DEFAULT_ZOOM_OUT_EASING),
		connectedZoomEasing: normalizeZoomTransitionEasing(
			editor.connectedZoomEasing,
			DEFAULT_CONNECTED_ZOOM_EASING,
		),
		showCursor: typeof editor.showCursor === "boolean" ? editor.showCursor : true,
		loopCursor: typeof editor.loopCursor === "boolean" ? editor.loopCursor : false,
		cursorStyle: normalizedCursorStyle,
		cursorClickEffect: normalizeCursorClickEffectStyle(
			(editor as Partial<ProjectEditorState>).cursorClickEffect,
			DEFAULT_CURSOR_CLICK_EFFECT,
		),
		cursorClickEffectColor: normalizedCursorClickEffectColor,
		cursorClickEffectScale: normalizedCursorClickEffectScale,
		cursorClickEffectOpacity: normalizedCursorClickEffectOpacity,
		cursorClickEffectDurationMs: normalizedCursorClickEffectDurationMs,
		cursorSize: normalizedMotionPreset.cursorSize,
		cursorSmoothing: normalizedMotionPreset.cursorSmoothing,
		cursorSpringStiffnessMultiplier: normalizedMotionPreset.cursorSpringStiffnessMultiplier,
		cursorSpringDampingMultiplier: normalizedMotionPreset.cursorSpringDampingMultiplier,
		cursorSpringMassMultiplier: normalizedMotionPreset.cursorSpringMassMultiplier,
		cameraSpringStiffnessMultiplier: isFiniteNumber(editor.cameraSpringStiffnessMultiplier)
			? clamp(editor.cameraSpringStiffnessMultiplier, 0.25, 3)
			: 1,
		cameraSpringDampingMultiplier: isFiniteNumber(editor.cameraSpringDampingMultiplier)
			? clamp(editor.cameraSpringDampingMultiplier, 0.25, 3)
			: 1.13,
		cameraSpringMassMultiplier: isFiniteNumber(editor.cameraSpringMassMultiplier)
			? clamp(editor.cameraSpringMassMultiplier, 0.25, 3)
			: 1.12,
		zoomSmoothness: DEFAULT_ZOOM_SMOOTHNESS,
		zoomClassicMode:
			typeof editor.zoomClassicMode === "boolean" ? editor.zoomClassicMode : false,
		cursorIdleHide: normalizeCursorIdleHideSettings(editor.cursorIdleHide),
		cursorMotionBlur: DEFAULT_CURSOR_MOTION_BLUR,
		cursorClickBounce: normalizedMotionPreset.cursorClickBounce,
		cursorClickBounceDuration: normalizedMotionPreset.cursorClickBounceDuration,
		cursorSway: isFiniteNumber((editor as Partial<ProjectEditorState>).cursorSway)
			? clamp((editor as Partial<ProjectEditorState>).cursorSway as number, 0, 2)
			: DEFAULT_CURSOR_SWAY,
		borderRadius: isFiniteNumber(editor.borderRadius)
			? clamp(editor.borderRadius, 0, 50)
			: getDefaultBorderRadiusPercent(),
		padding: (() => {
			const p = editor.padding;
			if (p && typeof p === "object") {
				const linked = typeof p.linked === "boolean" ? p.linked : true;
				const verticalMax = linked ? 100 : ADVANCED_VERTICAL_PADDING_MAX;
				const top = isFiniteNumber(p.top)
					? clamp(p.top, 0, verticalMax)
					: DEFAULT_PADDING.top;
				if (linked) {
					return { top, bottom: top, left: top, right: top, linked: true };
				}
				return {
					top,
					bottom: isFiniteNumber(p.bottom)
						? clamp(p.bottom, 0, verticalMax)
						: DEFAULT_PADDING.bottom,
					left: isFiniteNumber(p.left) ? clamp(p.left, 0, 100) : DEFAULT_PADDING.left,
					right: isFiniteNumber(p.right) ? clamp(p.right, 0, 100) : DEFAULT_PADDING.right,
					linked: false,
				};
			}
			if (typeof p === "number" && isFiniteNumber(p)) {
				const val = clamp(p, 0, 100);
				return { top: val, bottom: val, left: val, right: val, linked: true };
			}
			return { ...DEFAULT_PADDING };
		})(),
		cropRegion: {
			x: cropX,
			y: cropY,
			width: cropWidth,
			height: cropHeight,
		},
		zoomRegions: sequenceChanged
			? rippleRegions(normalizedZoomRegions, normalizedClipRegions, sequenceClips)
			: normalizedZoomRegions,
		trimRegions: normalizedTrimRegions,
		clipRegions: sequenceClips,
		autoFullTrackClipId: normalizedAutoFullTrackClipId,
		autoFullTrackClipEndMs: normalizedAutoFullTrackClipEndMs,
		speedRegions: normalizedSpeedRegions,
		annotationRegions: sequenceChanged
			? rippleRegions(normalizedAnnotationRegions, normalizedClipRegions, sequenceClips)
			: normalizedAnnotationRegions,
		audioRegions: sequenceChanged
			? rippleRegionAnchors(normalizedAudioRegions, normalizedClipRegions, sequenceClips)
			: normalizedAudioRegions,
		autoCaptions: normalizedAutoCaptions,
		autoCaptionSettings: normalizedAutoCaptionSettings,
		webcam: normalizeProjectWebcam(editor),
		sourceAudioTrackSettingsByClip:
			editor.sourceAudioTrackSettingsByClip &&
			typeof editor.sourceAudioTrackSettingsByClip === "object"
				? Object.fromEntries(
						Object.entries(editor.sourceAudioTrackSettingsByClip).filter(([id]) =>
							clipIds.has(id),
						),
					)
				: {},
		defaultSourceAudioTrackSettings:
			editor.defaultSourceAudioTrackSettings &&
			typeof editor.defaultSourceAudioTrackSettings === "object"
				? editor.defaultSourceAudioTrackSettings
				: {},
		aspectRatio:
			typeof editor.aspectRatio === "string" &&
			(validAspectRatios.has(editor.aspectRatio as AspectRatio) ||
				isCustomAspectRatio(editor.aspectRatio))
				? (editor.aspectRatio as AspectRatio)
				: "native",
	};
}

export function createProjectData(
	videoPath: string,
	editor: Partial<ProjectEditorState>,
	projectId?: string | null,
	history?: EditorProjectData["history"],
): EditorProjectData {
	return {
		version: PROJECT_VERSION,
		...(typeof projectId === "string" && projectId.trim().length > 0 ? { projectId } : {}),
		videoPath,
		editor: stripProjectUserPreferences(editor),
		...(history ? { history } : {}),
	};
}

// Older project files may contain app preferences. Never write or compare them as edits.
export function stripProjectUserPreferences<T extends object>(editor: T): T {
	const result = { ...editor };
	for (const key of [
		"exportEncodingMode",
		"exportBackendPreference",
		"exportPipelineModel",
		"exportQuality",
		"advancedExportSettings",
		"customExportResolution",
		"mp4FrameRate",
		"exportFormat",
		"gifFrameRate",
		"gifLoop",
		"gifSizePreset",
		"publishDestination",
		"includeCaptionSidecar",
		"whisperExecutablePath",
		"whisperModelPath",
	]) {
		delete (result as Record<string, unknown>)[key];
	}
	return result;
}
