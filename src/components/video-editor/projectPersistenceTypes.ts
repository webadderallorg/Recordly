import type { SourceAudioTrackSettings } from "@/components/video-editor/audio/audioTypes";
import { type AspectRatio } from "@/utils/aspectRatioUtils";
import {
	type AnnotationRegion,
	type AudioRegion,
	type AutoCaptionSettings,
	type CaptionCue,
	type ClipRegion,
	type CropRegion,
	type CursorClickEffectStyle,
	type CursorStyle,
	type Padding,
	type SpeedRegion,
	type TrimRegion,
	type WebcamOverlaySettings,
	type ZoomMotionBlurTuning,
	type ZoomRegion,
	type ZoomTransitionEasing,
} from "./types";
import type { CursorIdleHideSettings } from "./videoPlayback/cursorIdleVisibility";
import type { PersistedEditorHistory } from "./editorHistoryPersistence";
export interface ProjectEditorState {
	cursorIdleHide: CursorIdleHideSettings;
	wallpaper: string;
	shadowIntensity: number;
	backgroundBlur: number;
	zoomMotionBlur: number;
	zoomMotionBlurTuning: ZoomMotionBlurTuning;
	connectZooms: boolean;
	zoomInDurationMs: number;
	zoomInOverlapMs: number;
	zoomOutDurationMs: number;
	connectedZoomGapMs: number;
	connectedZoomDurationMs: number;
	zoomInEasing: ZoomTransitionEasing;
	zoomOutEasing: ZoomTransitionEasing;
	connectedZoomEasing: ZoomTransitionEasing;
	showCursor: boolean;
	loopCursor: boolean;
	cursorStyle: CursorStyle;
	cursorClickEffect: CursorClickEffectStyle;
	cursorClickEffectColor: string;
	cursorClickEffectScale: number;
	cursorClickEffectOpacity: number;
	cursorClickEffectDurationMs: number;
	cursorSize: number;
	cursorSmoothing: number;
	cursorSpringStiffnessMultiplier: number;
	cursorSpringDampingMultiplier: number;
	cursorSpringMassMultiplier: number;
	cameraSpringStiffnessMultiplier: number;
	cameraSpringDampingMultiplier: number;
	cameraSpringMassMultiplier: number;
	zoomSmoothness: number;
	zoomClassicMode: boolean;
	cursorMotionBlur: number;
	cursorClickBounce: number;
	cursorClickBounceDuration: number;
	cursorSway: number;
	borderRadius: number;
	padding: Padding;
	cropRegion: CropRegion;
	zoomRegions: ZoomRegion[];
	trimRegions: TrimRegion[];
	clipRegions: ClipRegion[];
	autoFullTrackClipId?: string | null;
	autoFullTrackClipEndMs?: number | null;
	speedRegions: SpeedRegion[];
	annotationRegions: AnnotationRegion[];
	audioRegions: AudioRegion[];
	autoCaptions: CaptionCue[];
	autoCaptionSettings: AutoCaptionSettings;
	webcam: WebcamOverlaySettings;
	aspectRatio: AspectRatio;
	sourceAudioTrackSettingsByClip?: Record<string, SourceAudioTrackSettings>;
	defaultSourceAudioTrackSettings?: SourceAudioTrackSettings;
}

export interface EditorProjectData {
	version: number;
	projectId?: string;
	videoPath: string;
	editor: Partial<ProjectEditorState>;
	history?: PersistedEditorHistory;
}

export type PersistedDevMotionBlurSettings = {
	zoomMotionBlurTuning?: unknown;
};
