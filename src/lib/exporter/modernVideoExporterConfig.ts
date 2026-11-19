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
import type { SupportedMp4EncoderPath } from "./mp4Support";
import type { ExportConfig, ExportProgress } from "./types";

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
	/** Internal recovery route; never changes resolution, timing or bitrate. */
	forceSoftwareEncoding?: boolean;
}
