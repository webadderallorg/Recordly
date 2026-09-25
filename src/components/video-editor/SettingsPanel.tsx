import { SettingsSections, SettingsCategory } from "./SettingsSections";
import { Card, RadioGroup, Radio, Label, Description } from "@heroui/react";
import { ProgressBar } from "@heroui/react";
import { ColorControl, ColorPalette } from "@/components/ui/color-picker";
import { Palette, Trash as Trash2, UploadSimple as Upload } from "@/components/ui/icons";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "@/components/ui/toast";
import minimalCursorUrl from "@/assets/cursors/custom/minimal-cursor.svg";
import { Button } from "@/components/ui/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ChoiceGroup, ChoiceItem } from "@/components/ui/choice-group";
import { useTheme } from "@/contexts/ThemeContext";
import { getAssetPath, getRenderableVideoUrl, getWallpaperThumbnailUrl } from "@/lib/assetPath";
import { cn } from "@/lib/utils";
import type { BuiltInWallpaper } from "@/lib/wallpapers";
import {
	BUILT_IN_WALLPAPERS,
	getAvailableWallpapers,
	isVideoWallpaperSource,
} from "@/lib/wallpapers";
import { type AspectRatio } from "@/utils/aspectRatioUtils";
import { useI18n, useScopedT } from "../../contexts/I18nContext";
import type { AppLocale } from "../../i18n/config";
import { SUPPORTED_LOCALES } from "../../i18n/config";
import { AnnotationSettingsPanel } from "./AnnotationSettingsPanel";
import CaptionListPanel from "./CaptionListPanel";
import type { CaptionRetimeSpan } from "./captionOps";
import {
	CURSOR_MOTION_PRESETS,
	type CursorMotionPresetId,
	getMatchingCursorMotionPresetId,
} from "./cursorMotionPresets";
import { loadEditorPreferences, saveEditorPreferences } from "./editorPreferences";
import { getDefaultBorderRadiusPercent } from "./projectPersistence";
import { SliderControl } from "./SliderControl";
import { WallpaperGrid } from "./WallpaperGrid";
import { useShortcuts } from "@/contexts/ShortcutsContext";
import { SettingsRow } from "./SettingsRow";
import type {
	AnnotationRegion,
	AnnotationType,
	AutoCaptionAnimation,
	AutoCaptionSettings,
	CaptionCue,
	CropRegion,
	CursorClickEffectStyle,
	CursorStyle,
	EditorEffectSection,
	FigureData,
	Padding,
	WebcamOverlaySettings,
	WebcamPositionPreset,
	ZoomDepth,
	ZoomMode,
	ZoomTransitionEasing,
} from "./types";
import {
	ADVANCED_VERTICAL_PADDING_MAX,
	DEFAULT_AUTO_CAPTION_SETTINGS,
	DEFAULT_CROP_REGION,
	DEFAULT_CURSOR_CLICK_BOUNCE_DURATION,
	DEFAULT_CURSOR_CLICK_EFFECT,
	DEFAULT_CURSOR_CLICK_EFFECT_COLOR,
	DEFAULT_CURSOR_CLICK_EFFECT_DURATION_MS,
	DEFAULT_CURSOR_CLICK_EFFECT_OPACITY,
	DEFAULT_CURSOR_CLICK_EFFECT_SCALE,
	DEFAULT_CURSOR_STYLE,
	DEFAULT_CURSOR_SWAY,
	DEFAULT_PADDING,
	DEFAULT_WEBCAM_MARGIN,
	DEFAULT_WEBCAM_POSITION_PRESET,
	DEFAULT_WEBCAM_POSITION_X,
	DEFAULT_WEBCAM_POSITION_Y,
	DEFAULT_WEBCAM_REACT_TO_ZOOM,
	DEFAULT_WEBCAM_ROUNDNESS,
	DEFAULT_WEBCAM_SHADOW,
	DEFAULT_WEBCAM_SIZE,
	DEFAULT_ZOOM_IN_DURATION_MS,
	DEFAULT_ZOOM_OUT_DURATION_MS,
} from "./types";
import { fromCursorSwaySliderValue, toCursorSwaySliderValue } from "./videoPlayback/cursorSway";
import { isZeroPadding } from "./videoPlayback/layoutUtils";
import { getPreviewPlaybackRateRange } from "./videoPlayback/playbackRate";
import {
	cursorSetAssets,
	getCursorStyleSizeMultiplier,
} from "./videoPlayback/uploadedCursorAssets";
import { WebcamCropControl } from "./WebcamCropControl";
import {
	getCropMatchedWebcamHeightPercent,
	getWebcamPositionForPreset,
	normalizeWebcamCropRegion,
	resolveWebcamCorner,
} from "./webcamOverlay";

const tahoeCursorUrl = cursorSetAssets.tahoe.arrow.url;
const BUILTIN_CURSOR_PREVIEW_SIZE = 28;
const BUILTIN_CURSOR_PREVIEW_FRAME_SIZE = 48;

const GRADIENTS = [
	"linear-gradient( 111.6deg,  rgba(114,167,232,1) 9.4%, rgba(253,129,82,1) 43.9%, rgba(253,129,82,1) 54.8%, rgba(249,202,86,1) 86.3% )",
	"linear-gradient(120deg, #d4fc79 0%, #96e6a1 100%)",
	"radial-gradient( circle farthest-corner at 3.2% 49.6%,  rgba(80,12,139,0.87) 0%, rgba(161,10,144,0.72) 83.6% )",
	"linear-gradient( 111.6deg,  rgba(0,56,68,1) 0%, rgba(163,217,185,1) 51.5%, rgba(231, 148, 6, 1) 88.6% )",
	"linear-gradient( 107.7deg,  rgba(235,230,44,0.55) 8.4%, rgba(252,152,15,1) 90.3% )",
	"linear-gradient( 91deg,  rgba(72,154,78,1) 5.2%, rgba(251,206,70,1) 95.9% )",
	"radial-gradient( circle farthest-corner at 10% 20%,  rgba(2,37,78,1) 0%, rgba(4,56,126,1) 19.7%, rgba(85,245,221,1) 100.2% )",
	"linear-gradient( 109.6deg,  rgba(15,2,2,1) 11.2%, rgba(36,163,190,1) 91.1% )",
	"linear-gradient(135deg, #FBC8B4, #2447B1)",
	"linear-gradient(109.6deg, #F635A6, #36D860)",
	"linear-gradient(90deg, #FF0101, #4DFF01)",
	"linear-gradient(315deg, #EC0101, #5044A9)",
	"linear-gradient(45deg, #ff9a9e 0%, #fad0c4 99%, #fad0c4 100%)",
	"linear-gradient(to top, #a18cd1 0%, #fbc2eb 100%)",
	"linear-gradient(to right, #ff8177 0%, #ff867a 0%, #ff8c7f 21%, #f99185 52%, #cf556c 78%, #b12a5b 100%)",
	"linear-gradient(120deg, #84fab0 0%, #8fd3f4 100%)",
	"linear-gradient(to right, #4facfe 0%, #00f2fe 100%)",
	"linear-gradient(to top, #fcc5e4 0%, #fda34b 15%, #ff7882 35%, #c8699e 52%, #7046aa 71%, #0c1db8 87%, #020f75 100%)",
	"linear-gradient(to right, #fa709a 0%, #fee140 100%)",
	"linear-gradient(to top, #30cfd0 0%, #330867 100%)",
	"linear-gradient(to top, #c471f5 0%, #fa71cd 100%)",
	"linear-gradient(to right, #f78ca0 0%, #f9748f 19%, #fd868c 60%, #fe9a8b 100%)",
	"linear-gradient(to top, #48c6ef 0%, #6f86d6 100%)",
	"linear-gradient(to right, #0acffe 0%, #495aff 100%)",
];

const CAPTION_ANIMATION_OPTIONS: Array<{ value: AutoCaptionAnimation; label: string }> = [
	{ value: "none", label: "Off" },
	{ value: "fade", label: "Fade" },
	{ value: "rise", label: "Rise" },
	{ value: "pop", label: "Pop" },
];

const CLICK_EFFECT_COLOR_OPTIONS = [
	"#2563EB",
	"#EF4444",
	"#F59E0B",
	"#22C55E",
	"#A855F7",
	"#EC4899",
	"#14B8A6",
	"#F97316",
] as const;

type BackgroundTab = "image" | "video" | "color" | "gradient";
function isHexWallpaper(value: string): boolean {
	return /^#(?:[0-9a-f]{3}){1,2}$/i.test(value);
}

function hexToRgba(hex: string, alpha: number) {
	const normalized = isHexWallpaper(hex) ? hex : DEFAULT_CURSOR_CLICK_EFFECT_COLOR;
	const value =
		normalized.length === 4
			? `#${normalized[1]}${normalized[1]}${normalized[2]}${normalized[2]}${normalized[3]}${normalized[3]}`
			: normalized;
	const color = Number.parseInt(value.slice(1), 16);
	const red = (color >> 16) & 255;
	const green = (color >> 8) & 255;
	const blue = color & 255;
	return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function getBackgroundTabForWallpaper(value: string): BackgroundTab {
	if (GRADIENTS.includes(value)) {
		return "gradient";
	}

	if (isHexWallpaper(value)) {
		return "color";
	}

	if (isVideoWallpaperSource(value)) {
		return "video";
	}

	return "image";
}

function SectionLabel({ children }: { children: React.ReactNode }) {
	return <Label className="text-[13px]">{children}</Label>;
}

const MOTION_PRESET_ORDER: CursorMotionPresetId[] = ["focused", "smooth"];

const CURSOR_CLICK_EFFECT_OPTIONS: Array<{
	id: CursorClickEffectStyle;
	label: string;
	description: string;
}> = [
	{
		id: "none",
		label: "Off",
		description: "No click animation. Keeps the pointer steady on every tap.",
	},
	{
		id: "spotlight",
		label: "Spotlight",
		description: "A soft pulse that blooms behind the cursor on click.",
	},
	{
		id: "ripple",
		label: "Ripple",
		description: "Concentric rings that expand from the click point.",
	},
	{
		id: "echo",
		label: "Echo",
		description: "A pair of soft rings that spread outward with a cleaner pulse.",
	},
];

function MotionPresetCards({
	title,
	activePresetId,
	onApply,
	tSettings,
}: {
	title: string;
	activePresetId: CursorMotionPresetId | null;
	onApply: (presetId: CursorMotionPresetId) => void;
	tSettings: (key: string, fallback?: string) => string;
}) {
	return (
		<RadioGroup
			value={activePresetId ?? undefined}
			onChange={(value) => onApply(value as CursorMotionPresetId)}
		>
			<Label className="text-[13px] font-medium">{title}</Label>
			{MOTION_PRESET_ORDER.map((presetId) => (
				<Radio
					key={presetId}
					value={presetId}
					className="rounded-xl border border-separator p-3"
				>
					<Radio.Content>
						<Radio.Control>
							<Radio.Indicator />
						</Radio.Control>
						<div className="flex min-w-0 flex-col gap-1">
							<Label className="text-[13px] font-medium">
								{tSettings(`effects.motionPresets.${presetId}.label`)}
							</Label>
							<Description className="text-xs leading-relaxed">
								{tSettings(`effects.motionPresets.${presetId}.description`)}
							</Description>
						</div>
					</Radio.Content>
				</Radio>
			))}
		</RadioGroup>
	);
}

function CursorClickEffectPreview({
	effect,
	color = DEFAULT_CURSOR_CLICK_EFFECT_COLOR,
}: {
	effect: CursorClickEffectStyle;
	color?: string;
}) {
	return (
		<div
			className="relative flex items-center justify-center"
			style={{
				width: `${BUILTIN_CURSOR_PREVIEW_FRAME_SIZE}px`,
				height: `${BUILTIN_CURSOR_PREVIEW_FRAME_SIZE}px`,
			}}
		>
			{effect === "none" ? (
				<svg
					className="absolute h-10 w-10 text-foreground/40"
					viewBox="0 0 40 40"
					aria-hidden="true"
				>
					<circle
						cx="20"
						cy="20"
						r="11.5"
						fill="none"
						stroke="currentColor"
						strokeWidth="1.8"
						opacity="0.75"
					/>
					<path
						d="M12.5 27.5 27.5 12.5"
						fill="none"
						stroke="currentColor"
						strokeLinecap="round"
						strokeWidth="2.2"
						opacity="0.92"
					/>
				</svg>
			) : null}
			{effect === "ripple" ? (
				<svg
					className="absolute h-12 w-12"
					style={{ color }}
					viewBox="0 0 48 48"
					aria-hidden="true"
				>
					<circle
						cx="24"
						cy="24"
						r="13"
						fill="none"
						stroke="currentColor"
						strokeWidth="2"
						opacity="0.72"
					/>
				</svg>
			) : null}
			{effect === "spotlight" ? (
				<svg
					className="absolute h-12 w-12"
					style={{ color: hexToRgba(color, 0.92) }}
					viewBox="0 0 48 48"
					aria-hidden="true"
				>
					<g fill="none" stroke="currentColor">
						<circle cx="24" cy="24" r="13.5" strokeWidth="1.5" opacity="0.3" />
						<circle cx="24" cy="24" r="9.75" strokeWidth="1.7" opacity="0.56" />
					</g>
				</svg>
			) : null}
			{effect === "echo" ? (
				<svg
					className="absolute h-12 w-12"
					style={{ color: hexToRgba(color, 0.92) }}
					viewBox="0 0 48 48"
					aria-hidden="true"
				>
					<g fill="none" stroke="currentColor">
						<circle cx="24" cy="24" r="9" strokeWidth="1.8" opacity="0.72" />
						<circle cx="24" cy="24" r="14.5" strokeWidth="1.5" opacity="0.4" />
						<circle
							cx="24"
							cy="24"
							r="4.25"
							fill="currentColor"
							opacity="0.22"
							stroke="none"
						/>
					</g>
				</svg>
			) : null}
		</div>
	);
}

function CursorClickEffectCards({
	title,
	activeEffectId,
	effectColor,
	onApply,
	tSettings,
}: {
	title: string;
	activeEffectId: CursorClickEffectStyle;
	effectColor: string;
	onApply: (effectId: CursorClickEffectStyle) => void;
	tSettings: (key: string, fallback?: string) => string;
}) {
	return (
		<div className="flex flex-col gap-4">
			<div className="flex items-center justify-between">
				<Label>{title}</Label>
			</div>
			<ChoiceGroup
				type="single"
				value={activeEffectId}
				onValueChange={(value) => {
					if (value) {
						onApply(value as CursorClickEffectStyle);
					}
				}}
				className="grid grid-cols-4 gap-2"
				aria-label={title}
			>
				{CURSOR_CLICK_EFFECT_OPTIONS.map((effect) => {
					const label = tSettings(
						`effects.cursorClickEffects.${effect.id}.label`,
						effect.label,
					);
					const description = tSettings(
						`effects.cursorClickEffects.${effect.id}.description`,
						effect.description,
					);

					return (
						<ChoiceItem
							key={effect.id}
							value={effect.id}
							aria-label={label}
							title={`${label} - ${description}`}
							className={cn("group aspect-square h-auto min-w-0 p-3 text-left")}
						>
							<div className="flex h-full flex-col items-center justify-between gap-3">
								<div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-[8px] px-2 py-1.5">
									<CursorClickEffectPreview
										effect={effect.id}
										color={effectColor}
									/>
								</div>
							</div>
						</ChoiceItem>
					);
				})}
			</ChoiceGroup>
		</div>
	);
}

interface SettingsPanelProps {
	advanced?: boolean;
	panelMode?: "editor" | "background";
	activeEffectSection?: EditorEffectSection;
	selected: string;
	onWallpaperChange: (path: string) => void;
	selectedZoomDepth?: ZoomDepth | null;
	onZoomDepthChange?: (depth: ZoomDepth) => void;
	selectedZoomId?: string | null;
	selectedZoomMode?: ZoomMode | null;
	onZoomModeChange?: (mode: ZoomMode) => void;
	onZoomDelete?: (id: string) => void;
	selectedClipId?: string | null;
	selectedClipSpeed?: number | null;
	selectedClipMuted?: boolean | null;
	hasClipAudioOverrides?: boolean;
	onResetClipAudio?: () => void;
	onClipSpeedChange?: (speed: number) => void;
	onClipMutedChange?: (muted: boolean) => void;
	onClipDelete?: (id: string) => void;
	selectedAudioId?: string | null;
	selectedAudioVolume?: number | null;
	selectedAudioNormalize?: boolean | null;
	onAudioVolumeChange?: (volume: number) => void;
	onAudioNormalizeChange?: (normalize: boolean) => void;
	onAudioDelete?: (id: string) => void;
	shadowIntensity?: number;
	onShadowChange?: (intensity: number) => void;
	backgroundBlur?: number;
	onBackgroundBlurChange?: (amount: number) => void;
	connectZooms?: boolean;
	onConnectZoomsChange?: (enabled: boolean) => void;
	autoApplyFreshRecordingAutoZooms?: boolean;
	onAutoApplyFreshRecordingAutoZoomsChange?: (enabled: boolean) => void;
	zoomInDurationMs?: number;
	onZoomInDurationMsChange?: (duration: number) => void;
	zoomInOverlapMs?: number;
	onZoomInOverlapMsChange?: (duration: number) => void;
	zoomOutDurationMs?: number;
	onZoomOutDurationMsChange?: (duration: number) => void;
	connectedZoomGapMs?: number;
	onConnectedZoomGapMsChange?: (duration: number) => void;
	connectedZoomDurationMs?: number;
	onConnectedZoomDurationMsChange?: (duration: number) => void;
	zoomInEasing?: ZoomTransitionEasing;
	onZoomInEasingChange?: (easing: ZoomTransitionEasing) => void;
	zoomOutEasing?: ZoomTransitionEasing;
	onZoomOutEasingChange?: (easing: ZoomTransitionEasing) => void;
	connectedZoomEasing?: ZoomTransitionEasing;
	onConnectedZoomEasingChange?: (easing: ZoomTransitionEasing) => void;
	showCursor?: boolean;
	onShowCursorChange?: (enabled: boolean) => void;
	loopCursor?: boolean;
	onLoopCursorChange?: (enabled: boolean) => void;
	cursorStyle?: CursorStyle;
	onCursorStyleChange?: (style: CursorStyle) => void;
	cursorSize?: number;
	onCursorSizeChange?: (size: number) => void;
	cursorSmoothing?: number;
	onCursorSmoothingChange?: (smoothing: number) => void;
	cursorSpringStiffnessMultiplier?: number;
	onCursorSpringStiffnessMultiplierChange?: (multiplier: number) => void;
	cursorSpringDampingMultiplier?: number;
	onCursorSpringDampingMultiplierChange?: (multiplier: number) => void;
	cursorSpringMassMultiplier?: number;
	onCursorSpringMassMultiplierChange?: (multiplier: number) => void;
	cameraSpringStiffnessMultiplier?: number;
	onCameraSpringStiffnessMultiplierChange?: (multiplier: number) => void;
	cameraSpringDampingMultiplier?: number;
	onCameraSpringDampingMultiplierChange?: (multiplier: number) => void;
	cameraSpringMassMultiplier?: number;
	onCameraSpringMassMultiplierChange?: (multiplier: number) => void;
	zoomClassicMode?: boolean;
	onZoomClassicModeChange?: (enabled: boolean) => void;
	cursorClickEffect?: CursorClickEffectStyle;
	onCursorClickEffectChange?: (effect: CursorClickEffectStyle) => void;
	cursorClickEffectColor?: string;
	onCursorClickEffectColorChange?: (color: string) => void;
	cursorClickEffectScale?: number;
	onCursorClickEffectScaleChange?: (scale: number) => void;
	cursorClickEffectOpacity?: number;
	onCursorClickEffectOpacityChange?: (opacity: number) => void;
	cursorClickEffectDurationMs?: number;
	onCursorClickEffectDurationMsChange?: (duration: number) => void;
	cursorClickBounce?: number;
	onCursorClickBounceChange?: (amount: number) => void;
	cursorClickBounceDuration?: number;
	onCursorClickBounceDurationChange?: (duration: number) => void;
	cursorSway?: number;
	onCursorSwayChange?: (amount: number) => void;
	borderRadius?: number;
	onBorderRadiusChange?: (radius: number) => void;
	webcam?: WebcamOverlaySettings;
	webcamPreviewSrc?: string | null;
	webcamPreviewCurrentTime?: number;
	webcamPreviewPlaying?: boolean;
	onWebcamChange?: (webcam: WebcamOverlaySettings) => void;
	onUploadWebcam?: () => void;
	onClearWebcam?: () => void;
	padding?: Padding;
	onPaddingChange?: (padding: Padding) => void;
	cropRegion?: CropRegion;
	onCropChange?: (region: CropRegion) => void;
	aspectRatio: AspectRatio;
	onAspectRatioChange?: (ratio: AspectRatio) => void;
	selectedAnnotationId?: string | null;
	annotationRegions?: AnnotationRegion[];
	onAnnotationContentChange?: (id: string, content: string) => void;
	onAnnotationTypeChange?: (id: string, type: AnnotationType) => void;
	onAnnotationStyleChange?: (id: string, style: Partial<AnnotationRegion["style"]>) => void;
	onAnnotationFigureDataChange?: (id: string, figureData: FigureData) => void;
	onAnnotationBlurIntensityChange?: (id: string, intensity: number) => void;
	onAnnotationBlurColorChange?: (id: string, color: string) => void;
	onAnnotationDelete?: (id: string) => void;
	autoCaptions?: CaptionCue[];
	autoCaptionSettings?: AutoCaptionSettings;
	whisperExecutablePath?: string | null;
	whisperModelPath?: string | null;
	whisperModelDownloadStatus?: "idle" | "downloading" | "downloaded" | "error";
	whisperModelDownloadProgress?: number;
	isGeneratingCaptions?: boolean;
	onAutoCaptionSettingsChange?: (settings: AutoCaptionSettings) => void;
	onPickWhisperExecutable?: () => void;
	onPickWhisperModel?: () => void;
	onGenerateAutoCaptions?: () => void;
	onClearAutoCaptions?: () => void;
	onDownloadWhisperSmallModel?: () => void;
	onDeleteWhisperSmallModel?: () => void;
	captionCurrentTimeMs?: number;
	selectedCaptionId?: string | null;
	onBeginCaptionEdit?: (id: string) => void;
	onCaptionTextEdit?: (id: string, text: string) => void;
	onCaptionRetime?: (id: string, span: CaptionRetimeSpan) => void;
	onCaptionSplit?: (id: string, atMs: number) => void;
	onCaptionMerge?: (idA: string, idB: string) => void;
	onCaptionDelete?: (id: string) => void;
	nativeCaptureUnavailableSession?: boolean;
	onOpenNativeCaptureUnavailableModal?: () => void;
}

const ZOOM_DEPTH_OPTIONS: Array<{ depth: ZoomDepth; label: string }> = [
	{ depth: 1, label: "1.25×" },
	{ depth: 2, label: "1.5×" },
	{ depth: 3, label: "1.8×" },
	{ depth: 4, label: "2.2×" },
	{ depth: 5, label: "3.5×" },
	{ depth: 6, label: "5×" },
];

const WEBCAM_POSITION_PRESETS: Array<{
	preset: Exclude<WebcamPositionPreset, "custom">;
	label: string;
}> = [
	{ preset: "top-left", label: "↖" },
	{ preset: "top-center", label: "↑" },
	{ preset: "top-right", label: "↗" },
	{ preset: "center-left", label: "←" },
	{ preset: "center", label: "•" },
	{ preset: "center-right", label: "→" },
	{ preset: "bottom-left", label: "↙" },
	{ preset: "bottom-center", label: "↓" },
	{ preset: "bottom-right", label: "↘" },
];

type CursorStyleOption = { value: CursorStyle; label: string };

type WallpaperTile = {
	key: string;
	label: string;
	value: string;
	previewUrl: string;
};

const BUILTIN_CURSOR_STYLE_OPTIONS: CursorStyleOption[] = [
	{ value: "macos", label: "macOS" },
	{ value: "tahoe", label: "Tahoe" },
	{ value: "tahoe-inverted", label: "Tahoe Inverted" },
	{ value: "windows11", label: "Windows 11" },
	{ value: "dot", label: "Dot" },
	{ value: "figma", label: "Minimal" },
];

const CAPTION_LANGUAGE_OPTIONS = [
	{ value: "auto", label: "Auto Detect" },
	{ value: "en", label: "English" },
	{ value: "es", label: "Spanish" },
	{ value: "fr", label: "French" },
	{ value: "de", label: "German" },
	{ value: "it", label: "Italian" },
	{ value: "pt", label: "Portuguese" },
	{ value: "zh", label: "Chinese (Simplified)" },
	{ value: "ja", label: "Japanese" },
	{ value: "ko", label: "Korean" },
] as const;

const APP_LANGUAGE_LABELS: Record<AppLocale, string> = {
	en: "English",
	es: "Español",
	fr: "Français",
	de: "Deutsch",
	it: "Italiano",
	nl: "Nederlands",
	ko: "한국어",
	"pt-BR": "Português",
	ru: "Русский",
	"zh-CN": "簡體中文",
	"zh-TW": "繁體中文",
};

function loadPreviewImage(url: string) {
	return new Promise<HTMLImageElement>((resolve, reject) => {
		const image = new Image();
		image.onload = () => resolve(image);
		image.onerror = () => reject(new Error(`Failed to load preview asset: ${url}`));
		image.src = url;
	});
}

function trimCanvasToAlpha(canvas: HTMLCanvasElement, hotspot?: { x: number; y: number }) {
	const ctx = canvas.getContext("2d");
	if (!ctx) {
		return {
			dataUrl: canvas.toDataURL("image/png"),
			width: canvas.width,
			height: canvas.height,
			hotspot,
		};
	}

	const { width, height } = canvas;
	const imageData = ctx.getImageData(0, 0, width, height);
	const { data } = imageData;
	let minX = width;
	let minY = height;
	let maxX = -1;
	let maxY = -1;

	for (let y = 0; y < height; y += 1) {
		for (let x = 0; x < width; x += 1) {
			const alpha = data[(y * width + x) * 4 + 3];
			if (alpha === 0) {
				continue;
			}

			minX = Math.min(minX, x);
			minY = Math.min(minY, y);
			maxX = Math.max(maxX, x);
			maxY = Math.max(maxY, y);
		}
	}

	if (maxX < minX || maxY < minY) {
		return {
			dataUrl: canvas.toDataURL("image/png"),
			width,
			height,
			hotspot,
		};
	}

	const croppedWidth = maxX - minX + 1;
	const croppedHeight = maxY - minY + 1;
	const croppedCanvas = document.createElement("canvas");
	croppedCanvas.width = croppedWidth;
	croppedCanvas.height = croppedHeight;
	const croppedCtx = croppedCanvas.getContext("2d")!;
	croppedCtx.drawImage(
		canvas,
		minX,
		minY,
		croppedWidth,
		croppedHeight,
		0,
		0,
		croppedWidth,
		croppedHeight,
	);

	return {
		dataUrl: croppedCanvas.toDataURL("image/png"),
		width: croppedWidth,
		height: croppedHeight,
		hotspot: hotspot
			? {
					x: hotspot.x - minX,
					y: hotspot.y - minY,
				}
			: undefined,
	};
}

async function createTrimmedSvgPreview(
	url: string,
	sampleSize: number,
	trim?: { x: number; y: number; width: number; height: number },
) {
	const image = await loadPreviewImage(url);
	const sourceCanvas = document.createElement("canvas");
	sourceCanvas.width = sampleSize;
	sourceCanvas.height = sampleSize;
	const sourceCtx = sourceCanvas.getContext("2d")!;
	sourceCtx.drawImage(image, 0, 0, sampleSize, sampleSize);

	if (trim) {
		const croppedCanvas = document.createElement("canvas");
		croppedCanvas.width = trim.width;
		croppedCanvas.height = trim.height;
		const croppedCtx = croppedCanvas.getContext("2d")!;
		croppedCtx.drawImage(
			sourceCanvas,
			trim.x,
			trim.y,
			trim.width,
			trim.height,
			0,
			0,
			trim.width,
			trim.height,
		);
		return croppedCanvas.toDataURL("image/png");
	}

	return trimCanvasToAlpha(sourceCanvas).dataUrl;
}

async function createInvertedPreview(url: string) {
	const image = await loadPreviewImage(url);
	const canvas = document.createElement("canvas");
	canvas.width = image.naturalWidth;
	canvas.height = image.naturalHeight;
	const ctx = canvas.getContext("2d")!;
	ctx.drawImage(image, 0, 0);
	const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
	const { data } = imageData;
	for (let index = 0; index < data.length; index += 4) {
		if (data[index + 3] === 0) {
			continue;
		}
		data[index] = 255 - data[index];
		data[index + 1] = 255 - data[index + 1];
		data[index + 2] = 255 - data[index + 2];
	}
	ctx.putImageData(imageData, 0, 0);
	return canvas.toDataURL("image/png");
}

function CursorStylePreview({
	style,
	previewUrls,
	frameSize = BUILTIN_CURSOR_PREVIEW_FRAME_SIZE,
	previewSize,
}: {
	style: CursorStyle;
	previewUrls: Partial<Record<string, string>>;
	frameSize?: number;
	previewSize?: number;
}) {
	const previewSrc =
		style === "macos"
			? (previewUrls.macos ?? tahoeCursorUrl)
			: style === "tahoe"
				? (previewUrls.tahoe ?? tahoeCursorUrl)
				: style === "windows11"
					? (previewUrls.windows11 ?? tahoeCursorUrl)
					: style === "figma"
						? (previewUrls.figma ?? minimalCursorUrl)
						: style === "tahoe-inverted"
							? (previewUrls["tahoe-inverted"] ?? tahoeCursorUrl)
							: previewUrls[style];

	if (
		style === "macos" ||
		style === "tahoe" ||
		style === "tahoe-inverted" ||
		style === "windows11"
	) {
		const resolvedPreviewSize =
			(previewSize ?? BUILTIN_CURSOR_PREVIEW_SIZE) *
			(style === "windows11" ? 1 : getCursorStyleSizeMultiplier(style));
		return (
			<div
				className="flex items-center justify-center"
				style={{
					width: `${frameSize}px`,
					height: `${frameSize}px`,
				}}
			>
				<img
					src={previewSrc ?? tahoeCursorUrl}
					alt=""
					className="max-w-none object-contain drop-shadow-[0_8px_12px_rgba(15,23,42,0.18)]"
					draggable={false}
					style={{
						width: `${resolvedPreviewSize}px`,
						height: `${resolvedPreviewSize}px`,
					}}
				/>
			</div>
		);
	}

	if (style === "figma") {
		const resolvedPreviewSize = previewSize ?? 28;
		return (
			<div
				className="flex items-center justify-center"
				style={{ width: `${frameSize}px`, height: `${frameSize}px` }}
			>
				<img
					src={previewSrc}
					alt=""
					className="object-contain"
					draggable={false}
					style={{
						width: `${resolvedPreviewSize}px`,
						height: `${resolvedPreviewSize}px`,
					}}
				/>
			</div>
		);
	}

	if (style === "dot") {
		const resolvedPreviewSize = previewSize ?? 14;
		return (
			<div
				className="flex items-center justify-center"
				style={{ width: `${frameSize}px`, height: `${frameSize}px` }}
			>
				<span
					className="rounded-full border-[2.5px] border-neutral-800 bg-white shadow-[0_8px_12px_rgba(15,23,42,0.16)]"
					style={{
						width: `${resolvedPreviewSize}px`,
						height: `${resolvedPreviewSize}px`,
					}}
				/>
			</div>
		);
	}

	const resolvedPreviewSize = previewSize ?? 28;
	return (
		<div
			className="flex items-center justify-center"
			style={{ width: `${frameSize}px`, height: `${frameSize}px` }}
		>
			<img
				src={previewSrc ?? tahoeCursorUrl}
				alt=""
				className="object-contain"
				draggable={false}
				style={{ width: `${resolvedPreviewSize}px`, height: `${resolvedPreviewSize}px` }}
			/>
		</div>
	);
}

export function SettingsPanel({
	advanced = false,
	panelMode = "editor",
	activeEffectSection: activeEffectSectionProp,
	selected,
	onWallpaperChange,
	selectedZoomDepth,
	onZoomDepthChange,
	selectedZoomId,
	selectedZoomMode,
	onZoomModeChange,
	onZoomDelete,
	selectedClipId,
	selectedClipSpeed,
	selectedClipMuted,
	hasClipAudioOverrides = false,
	onResetClipAudio,
	onClipSpeedChange,
	onClipMutedChange,
	onClipDelete,
	selectedAudioId,
	selectedAudioVolume,
	selectedAudioNormalize,
	onAudioVolumeChange,
	onAudioNormalizeChange,
	onAudioDelete,
	shadowIntensity = 0.67,
	onShadowChange,
	backgroundBlur = 0,
	onBackgroundBlurChange,
	connectZooms = true,
	onConnectZoomsChange,
	autoApplyFreshRecordingAutoZooms = true,
	onAutoApplyFreshRecordingAutoZoomsChange,
	zoomInDurationMs = DEFAULT_ZOOM_IN_DURATION_MS,
	onZoomInDurationMsChange,
	zoomOutDurationMs = DEFAULT_ZOOM_OUT_DURATION_MS,
	onZoomOutDurationMsChange,
	showCursor = false,
	onShowCursorChange,
	loopCursor = false,
	onLoopCursorChange,
	cursorStyle = DEFAULT_CURSOR_STYLE,
	onCursorStyleChange,
	cursorSize = 5,
	onCursorSizeChange,
	cursorSmoothing = 2,
	onCursorSmoothingChange,
	cursorSpringStiffnessMultiplier = 1,
	onCursorSpringStiffnessMultiplierChange,
	cursorSpringDampingMultiplier = 1,
	onCursorSpringDampingMultiplierChange,
	cursorSpringMassMultiplier = 1,
	onCursorSpringMassMultiplierChange,
	cameraSpringStiffnessMultiplier = 1,
	onCameraSpringStiffnessMultiplierChange,
	cameraSpringDampingMultiplier = 1.13,
	onCameraSpringDampingMultiplierChange,
	cameraSpringMassMultiplier = 1.12,
	onCameraSpringMassMultiplierChange,
	zoomClassicMode = false,
	onZoomClassicModeChange,
	cursorClickEffect = DEFAULT_CURSOR_CLICK_EFFECT,
	onCursorClickEffectChange,
	cursorClickEffectColor = DEFAULT_CURSOR_CLICK_EFFECT_COLOR,
	onCursorClickEffectColorChange,
	cursorClickEffectScale = DEFAULT_CURSOR_CLICK_EFFECT_SCALE,
	onCursorClickEffectScaleChange,
	cursorClickEffectOpacity = DEFAULT_CURSOR_CLICK_EFFECT_OPACITY,
	onCursorClickEffectOpacityChange,
	cursorClickEffectDurationMs = DEFAULT_CURSOR_CLICK_EFFECT_DURATION_MS,
	onCursorClickEffectDurationMsChange,
	cursorClickBounce = 1,
	onCursorClickBounceChange,
	cursorClickBounceDuration = DEFAULT_CURSOR_CLICK_BOUNCE_DURATION,
	onCursorClickBounceDurationChange,
	cursorSway = DEFAULT_CURSOR_SWAY,
	onCursorSwayChange,
	borderRadius = getDefaultBorderRadiusPercent(),
	onBorderRadiusChange,
	webcam,
	webcamPreviewSrc = null,
	webcamPreviewCurrentTime = 0,
	webcamPreviewPlaying = false,
	onWebcamChange,
	onUploadWebcam,
	onClearWebcam,
	padding = DEFAULT_PADDING,
	onPaddingChange,
	cropRegion,
	onCropChange,
	aspectRatio,
	onAspectRatioChange,
	selectedAnnotationId,
	annotationRegions = [],
	onAnnotationContentChange,
	onAnnotationTypeChange,
	onAnnotationStyleChange,
	onAnnotationFigureDataChange,
	onAnnotationBlurIntensityChange,
	onAnnotationBlurColorChange,
	onAnnotationDelete,
	autoCaptions = [],
	autoCaptionSettings = DEFAULT_AUTO_CAPTION_SETTINGS,
	whisperModelPath,
	whisperModelDownloadStatus = "idle",
	whisperModelDownloadProgress = 0,
	isGeneratingCaptions = false,
	onAutoCaptionSettingsChange,
	onPickWhisperModel,
	onGenerateAutoCaptions,
	onClearAutoCaptions,
	onDownloadWhisperSmallModel,
	onDeleteWhisperSmallModel,
	captionCurrentTimeMs = 0,
	selectedCaptionId = null,
	onBeginCaptionEdit,
	onCaptionTextEdit,
	onCaptionRetime,
	onCaptionSplit,
	onCaptionMerge,
	onCaptionDelete,
	nativeCaptureUnavailableSession = false,
	onOpenNativeCaptureUnavailableModal,
}: SettingsPanelProps) {
	const tSettings = useScopedT("settings");
	const { locale, setLocale, t } = useI18n();
	const { preference: themePreference, setPreference: setThemePreference } = useTheme();
	const isBackgroundPanel = panelMode === "background";
	const initialEditorPreferences = useMemo(() => loadEditorPreferences(), []);
	const clipSpeedRange = useMemo(getPreviewPlaybackRateRange, []);
	const [builtInWallpapers, setBuiltInWallpapers] =
		useState<BuiltInWallpaper[]>(BUILT_IN_WALLPAPERS);
	const [wallpaperPreviewPaths, setWallpaperPreviewPaths] = useState<string[]>([]);
	const [customImages, setCustomImages] = useState<string[]>(
		initialEditorPreferences.customWallpapers,
	);
	const [experimentalUpdatesEnabled, setExperimentalUpdatesEnabled] = useState(false);
	const [savingExperimentalUpdates, setSavingExperimentalUpdates] = useState(false);
	const { openConfig: openShortcutsConfig } = useShortcuts();
	const [internalActiveEffectSection] = useState<EditorEffectSection>("scene");
	const activeEffectSection = activeEffectSectionProp ?? internalActiveEffectSection;
	const removeBackgroundStateRef = useRef<{
		aspectRatio: AspectRatio;
		padding: Padding;
	} | null>(null);
	const fileInputRef = useRef<HTMLInputElement>(null);
	const builtInWallpaperPaths = useMemo(
		() => builtInWallpapers.map((wallpaper) => wallpaper.publicPath),
		[builtInWallpapers],
	);
	const captionCueCount = autoCaptions.length;
	const updateAutoCaptionSettings = (partial: Partial<AutoCaptionSettings>) => {
		onAutoCaptionSettingsChange?.({
			...autoCaptionSettings,
			...partial,
		});
	};

	useEffect(() => {
		let cancelled = false;
		void window.electronAPI
			.getExperimentalUpdatesEnabled()
			.then((enabled) => {
				if (!cancelled) setExperimentalUpdatesEnabled(enabled);
			})
			.catch((error) => {
				console.error("Failed to load experimental updates preference:", error);
			});
		return () => {
			cancelled = true;
		};
	}, []);

	const updateExperimentalUpdatesPreference = async (enabled: boolean) => {
		const previousValue = experimentalUpdatesEnabled;
		setExperimentalUpdatesEnabled(enabled);
		setSavingExperimentalUpdates(true);
		try {
			const result = await window.electronAPI.setExperimentalUpdatesEnabled(enabled);
			setExperimentalUpdatesEnabled(result.enabled);
			if (!result.success) {
				toast.error(
					result.error ||
						tSettings("updates.saveFailed", "Failed to change the update channel."),
				);
			}
		} catch (error) {
			setExperimentalUpdatesEnabled(previousValue);
			toast.error(
				`${tSettings("updates.saveFailed", "Failed to change the update channel.")} ${String(error)}`,
			);
		} finally {
			setSavingExperimentalUpdates(false);
		}
	};

	useEffect(() => {
		if (
			!isBackgroundPanel &&
			activeEffectSection !== "scene" &&
			activeEffectSection !== "frame" &&
			activeEffectSection !== "crop" &&
			activeEffectSection !== "extensions" &&
			!activeEffectSection.startsWith("ext:")
		) {
			return;
		}

		let mounted = true;
		(async () => {
			try {
				const availableWallpapers = await getAvailableWallpapers();
				const resolved = await Promise.all(
					availableWallpapers.map(async (wallpaper) => {
						const assetUrl = await getAssetPath(wallpaper.relativePath);
						// Use tiny thumbnails for the grid; full-res loads on selection
						if (isVideoWallpaperSource(wallpaper.publicPath)) {
							return getRenderableVideoUrl(assetUrl);
						}
						return getWallpaperThumbnailUrl(assetUrl);
					}),
				);
				if (mounted) {
					setBuiltInWallpapers(availableWallpapers);
					setWallpaperPreviewPaths(resolved);
				}
			} catch {
				if (mounted) {
					setBuiltInWallpapers(BUILT_IN_WALLPAPERS);
					setWallpaperPreviewPaths(
						BUILT_IN_WALLPAPERS.map((wallpaper) => wallpaper.publicPath),
					);
				}
			}
		})();
		return () => {
			mounted = false;
		};
	}, [activeEffectSection, isBackgroundPanel]);

	const colorPalette = [
		"#FF0000",
		"#FFD700",
		"#00FF00",
		"#FFFFFF",
		"#0000FF",
		"#FF6B00",
		"#9B59B6",
		"#E91E63",
		"#00BCD4",
		"#FF5722",
		"#8BC34A",
		"#FFC107",
		"#2563EB",
		"#000000",
		"#607D8B",
		"#795548",
	];

	const [selectedColor, setSelectedColor] = useState(
		isHexWallpaper(selected) ? selected : "#ADADAD",
	);
	const [gradient, setGradient] = useState<string>(
		GRADIENTS.includes(selected) ? selected : GRADIENTS[0],
	);
	const removeBackgroundEnabled = aspectRatio === "native" && isZeroPadding(padding);

	const [backgroundTab, setBackgroundTab] = useState<BackgroundTab>(() =>
		getBackgroundTabForWallpaper(selected),
	);

	const defaultWebcam = initialEditorPreferences.webcam;
	const [builtInCursorPreviewUrls, setBuiltInCursorPreviewUrls] = useState<
		Partial<Record<string, string>>
	>({});

	const cursorPreviewUrls = builtInCursorPreviewUrls;
	const showDevMotionControls = import.meta.env.DEV;
	const cursorStyleOptions = BUILTIN_CURSOR_STYLE_OPTIONS;

	useEffect(() => {
		let cancelled = false;

		void (async () => {
			try {
				const macosPreview = cursorSetAssets.macos.arrow.url;
				const tahoePreview = cursorSetAssets.tahoe.arrow.url;
				const [windows11Preview, minimalPreview] = await Promise.all([
					createTrimmedSvgPreview(cursorSetAssets.windows11.arrow.url, 512),
					createTrimmedSvgPreview(minimalCursorUrl, 512),
				]);
				const invertedPreview = await createInvertedPreview(tahoePreview);

				if (!cancelled) {
					setBuiltInCursorPreviewUrls({
						macos: macosPreview,
						tahoe: tahoePreview,
						windows11: windows11Preview,
						figma: minimalPreview,
						"tahoe-inverted": invertedPreview,
					});
				}
			} catch {
				if (!cancelled) {
					setBuiltInCursorPreviewUrls({
						macos: tahoeCursorUrl,
						tahoe: tahoeCursorUrl,
						windows11: tahoeCursorUrl,
						figma: minimalCursorUrl,
						"tahoe-inverted": tahoeCursorUrl,
					});
				}
			}
		})();

		return () => {
			cancelled = true;
		};
	}, []);

	useEffect(() => {
		setBackgroundTab(getBackgroundTabForWallpaper(selected));

		if (isHexWallpaper(selected)) {
			setSelectedColor(selected);
		}

		if (GRADIENTS.includes(selected)) {
			setGradient(selected);
		}
	}, [selected]);

	useEffect(() => {
		if (selected.startsWith("data:image")) {
			setCustomImages((prev) => (prev.includes(selected) ? prev : [selected, ...prev]));
			return;
		}

		const isKnownWallpaper =
			builtInWallpaperPaths.includes(selected) || wallpaperPreviewPaths.includes(selected);

		if (!isKnownWallpaper && isVideoWallpaperSource(selected)) {
			setCustomImages((prev) => (prev.includes(selected) ? prev : [selected, ...prev]));
		}
	}, [builtInWallpaperPaths, selected, wallpaperPreviewPaths]);

	const imageWallpaperTiles = useMemo<WallpaperTile[]>(() => {
		const imageWallpapers = builtInWallpapers.filter(
			(wallpaper) => !isVideoWallpaperSource(wallpaper.publicPath),
		);
		const builtInTiles = (
			wallpaperPreviewPaths.length > 0 ? wallpaperPreviewPaths : builtInWallpaperPaths
		)
			.filter((path) => !isVideoWallpaperSource(path))
			.map((previewPath, index) => {
				const wallpaper = imageWallpapers[index];
				return {
					key: wallpaper ? `builtin/${wallpaper.id}` : previewPath,
					label: wallpaper?.label ?? `Wallpaper ${index + 1}`,
					value: wallpaper?.publicPath ?? previewPath,
					previewUrl: wallpaperPreviewPaths.length ? previewPath : "",
				};
			});

		return builtInTiles;
	}, [builtInWallpaperPaths, builtInWallpapers, wallpaperPreviewPaths]);

	const videoWallpaperTiles = useMemo<WallpaperTile[]>(() => {
		const builtInTiles = builtInWallpapers
			.filter((wallpaper) => isVideoWallpaperSource(wallpaper.publicPath))
			.map((wallpaper) => ({
				key: `builtin/${wallpaper.id}`,
				label: wallpaper.label,
				value: wallpaper.publicPath,
				previewUrl: wallpaper.publicPath,
			}));

		return builtInTiles;
	}, [builtInWallpapers]);

	useEffect(() => {
		saveEditorPreferences({ customWallpapers: customImages });
	}, [customImages]);

	const handleRemoveBackgroundToggle = (checked: boolean) => {
		if (checked) {
			removeBackgroundStateRef.current = {
				aspectRatio,
				padding,
			};
			onAspectRatioChange?.("native");
			onPaddingChange?.({ top: 0, bottom: 0, left: 0, right: 0, linked: padding.linked });
			return;
		}

		const previousState = removeBackgroundStateRef.current;
		if (previousState) {
			onAspectRatioChange?.(previousState.aspectRatio);
			onPaddingChange?.(previousState.padding);
			removeBackgroundStateRef.current = null;
			return;
		}

		// Fallback if the project loaded in a "background removed" state already
		onAspectRatioChange?.(initialEditorPreferences.aspectRatio);
		onPaddingChange?.({ ...DEFAULT_PADDING });
	};

	const togglePaddingLink = () => {
		const isLinked = padding.linked !== false;
		const nextLinked = !isLinked;
		if (nextLinked) {
			// Compute average for relinking to avoid sudden shifts
			const avg = Math.round(
				(padding.top + padding.bottom + padding.left + padding.right) / 4,
			);
			onPaddingChange?.({
				top: avg,
				bottom: avg,
				left: avg,
				right: avg,
				linked: true,
			});
		} else {
			onPaddingChange?.({
				...padding,
				linked: false,
			});
		}
	};

	const handlePaddingSideChange = (side: keyof Padding, value: number) => {
		if (padding.linked !== false) {
			onPaddingChange?.({
				top: value,
				bottom: value,
				left: value,
				right: value,
				linked: true,
			});
		} else {
			onPaddingChange?.({
				...padding,
				[side]: value,
			});
		}
	};

	const webcamFileName = webcam?.sourcePath?.split(/[\\/]/).pop() ?? null;
	const visibleColorPalette = colorPalette.slice(0, 15);
	const webcamPositionPreset = webcam?.positionPreset ?? DEFAULT_WEBCAM_POSITION_PRESET;
	const webcamPositionX = webcam?.positionX ?? DEFAULT_WEBCAM_POSITION_X;
	const webcamPositionY = webcam?.positionY ?? DEFAULT_WEBCAM_POSITION_Y;
	const webcamWidth = webcam?.width ?? webcam?.size ?? DEFAULT_WEBCAM_SIZE;
	const webcamHeight = webcam?.height ?? webcam?.size ?? DEFAULT_WEBCAM_SIZE;
	const webcamCrop = normalizeWebcamCropRegion(webcam?.cropRegion);

	const getWallpaperTileState = (candidateValue: string, previewPath?: string) => {
		if (!selected) return false;
		if (selected === candidateValue || (previewPath && selected === previewPath)) return true;
		try {
			const clean = (s: string) => s.replace(/^file:\/\//, "").replace(/^\//, "");
			if (clean(selected).endsWith(clean(candidateValue))) return true;
			if (clean(candidateValue).endsWith(clean(selected))) return true;
			if (previewPath && clean(selected).endsWith(clean(previewPath))) return true;
			if (previewPath && clean(previewPath).endsWith(clean(selected))) return true;
		} catch {
			return false;
		}
		return false;
	};

	const wallpaperTileClass = (isSelected: boolean) =>
		cn(
			"group relative aspect-[4/3] h-auto w-full min-w-0 overflow-hidden rounded-md p-1",
			isSelected && "opacity-70",
		);

	const crop = cropRegion ?? {
		x: 0,
		y: 0,
		width: 1,
		height: 1,
	};
	const cropTop = Math.round(crop.y * 100);
	const cropLeft = Math.round(crop.x * 100);
	const cropBottom = Math.round((1 - crop.y - crop.height) * 100);
	const cropRight = Math.round((1 - crop.x - crop.width) * 100);
	const isCropped = cropTop > 0 || cropLeft > 0 || cropBottom > 0 || cropRight > 0;

	const setCropInset = (side: "top" | "bottom" | "left" | "right", pct: number) => {
		if (!onCropChange) return;

		const v = pct / 100;
		let { x, y, width, height } = crop;

		if (side === "top") {
			const nextY = Math.min(v, 1 - y - height + v);
			y = nextY;
			height = Math.max(0.05, height - (nextY - crop.y));
		}

		if (side === "left") {
			const nextX = Math.min(v, 1 - x - width + v);
			x = nextX;
			width = Math.max(0.05, width - (nextX - crop.x));
		}

		if (side === "bottom") {
			height = Math.max(0.05, 1 - crop.y - v);
		}

		if (side === "right") {
			width = Math.max(0.05, 1 - crop.x - v);
		}

		onCropChange({ x, y, width, height });
	};

	const resetBackgroundSection = () => {
		onBackgroundBlurChange?.(initialEditorPreferences.backgroundBlur);

		const preferredWallpaper = initialEditorPreferences.wallpaper;
		const hasPreferredWallpaper =
			(preferredWallpaper && builtInWallpaperPaths.includes(preferredWallpaper)) ||
			(preferredWallpaper && customImages.includes(preferredWallpaper)) ||
			(preferredWallpaper && isHexWallpaper(preferredWallpaper)) ||
			(preferredWallpaper && GRADIENTS.includes(preferredWallpaper));

		onWallpaperChange(
			(hasPreferredWallpaper ? preferredWallpaper : "") ||
				builtInWallpaperPaths[0] ||
				BUILT_IN_WALLPAPERS[0]?.publicPath ||
				"",
		);
	};

	const resetZoomSection = () => {
		onCameraSpringStiffnessMultiplierChange?.(
			initialEditorPreferences.cameraSpringStiffnessMultiplier,
		);
		onCameraSpringDampingMultiplierChange?.(
			initialEditorPreferences.cameraSpringDampingMultiplier,
		);
		onCameraSpringMassMultiplierChange?.(initialEditorPreferences.cameraSpringMassMultiplier);
		onZoomInDurationMsChange?.(initialEditorPreferences.zoomInDurationMs);
		onZoomOutDurationMsChange?.(initialEditorPreferences.zoomOutDurationMs);
		onZoomClassicModeChange?.(false);
	};

	const resetCursorSection = () => {
		onShowCursorChange?.(initialEditorPreferences.showCursor);
		onLoopCursorChange?.(initialEditorPreferences.loopCursor);
		onCursorStyleChange?.(initialEditorPreferences.cursorStyle);
		onCursorSizeChange?.(initialEditorPreferences.cursorSize);
		onCursorSmoothingChange?.(initialEditorPreferences.cursorSmoothing);
		onCursorSpringStiffnessMultiplierChange?.(
			initialEditorPreferences.cursorSpringStiffnessMultiplier,
		);
		onCursorSpringDampingMultiplierChange?.(
			initialEditorPreferences.cursorSpringDampingMultiplier,
		);
		onCursorSpringMassMultiplierChange?.(initialEditorPreferences.cursorSpringMassMultiplier);
		onCursorClickEffectChange?.(initialEditorPreferences.cursorClickEffect);
		onCursorClickEffectColorChange?.(initialEditorPreferences.cursorClickEffectColor);
		onCursorClickEffectScaleChange?.(initialEditorPreferences.cursorClickEffectScale);
		onCursorClickEffectOpacityChange?.(initialEditorPreferences.cursorClickEffectOpacity);
		onCursorClickEffectDurationMsChange?.(initialEditorPreferences.cursorClickEffectDurationMs);
		onCursorClickBounceChange?.(initialEditorPreferences.cursorClickBounce);
		onCursorClickBounceDurationChange?.(initialEditorPreferences.cursorClickBounceDuration);
		onCursorSwayChange?.(initialEditorPreferences.cursorSway);
	};

	const activeMotionPresetId = useMemo(() => {
		return (
			getMatchingCursorMotionPresetId({
				zoomInDurationMs,
				zoomOutDurationMs,
				cursorSize,
				cursorSmoothing,
				cursorSpringStiffnessMultiplier,
				cursorSpringDampingMultiplier,
				cursorSpringMassMultiplier,
				cursorClickBounce,
				cursorClickBounceDuration,
			}) ?? "focused"
		);
	}, [
		cursorClickBounce,
		cursorClickBounceDuration,
		cursorSize,
		cursorSmoothing,
		cursorSpringDampingMultiplier,
		cursorSpringMassMultiplier,
		cursorSpringStiffnessMultiplier,
		zoomInDurationMs,
		zoomOutDurationMs,
	]);

	const applyMotionPreset = (presetId: CursorMotionPresetId) => {
		const preset = CURSOR_MOTION_PRESETS[presetId];
		onZoomInDurationMsChange?.(preset.zoomInDurationMs);
		onZoomOutDurationMsChange?.(preset.zoomOutDurationMs);
		onCursorSizeChange?.(preset.cursorSize);
		onCursorSmoothingChange?.(preset.cursorSmoothing);
		onCursorSpringStiffnessMultiplierChange?.(preset.cursorSpringStiffnessMultiplier);
		onCursorSpringDampingMultiplierChange?.(preset.cursorSpringDampingMultiplier);
		onCursorSpringMassMultiplierChange?.(preset.cursorSpringMassMultiplier);
		onCursorClickBounceChange?.(preset.cursorClickBounce);
		onCursorClickBounceDurationChange?.(preset.cursorClickBounceDuration);
	};

	const resetFrameSection = () => {
		onShadowChange?.(initialEditorPreferences.shadowIntensity);
		onBorderRadiusChange?.(initialEditorPreferences.borderRadius);
		onAspectRatioChange?.(initialEditorPreferences.aspectRatio);
		onPaddingChange?.({ ...initialEditorPreferences.padding });
		removeBackgroundStateRef.current = null;
	};

	const resetWebcamSection = () => {
		if (!onWebcamChange) return;
		onWebcamChange({ ...defaultWebcam });
	};

	const resetCropSection = () => {
		onCropChange?.(DEFAULT_CROP_REGION);
	};

	const updateWebcam = (patch: Partial<WebcamOverlaySettings>) => {
		if (!webcam || !onWebcamChange) return;
		onWebcamChange({ ...webcam, ...patch });
	};

	const applyWebcamPositionPreset = (preset: WebcamPositionPreset) => {
		if (!webcam) return;

		if (preset === "custom") {
			updateWebcam({ positionPreset: "custom" });
			return;
		}

		const position = getWebcamPositionForPreset(preset);
		updateWebcam({
			positionPreset: preset,
			positionX: position.x,
			positionY: position.y,
			corner: resolveWebcamCorner(preset, webcam.corner),
		});
	};

	const handleImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
		const files = event.target.files;
		if (!files || files.length === 0) return;

		const file = files[0];

		// Validate file type - only allow JPG/JPEG
		const validTypes = ["image/jpeg", "image/jpg"];
		if (!validTypes.includes(file.type)) {
			toast.error(tSettings("background.uploadError"), {
				description: tSettings("background.uploadErrorDescription"),
			});
			event.target.value = "";
			return;
		}

		const reader = new FileReader();

		reader.onload = (e) => {
			const dataUrl = e.target?.result as string;
			if (dataUrl) {
				setCustomImages((prev) => [...prev, dataUrl]);
				onWallpaperChange(dataUrl);
				toast.success(tSettings("background.uploadSuccess"));
			}
		};

		reader.onerror = () => {
			toast.error(t("common.errors.failedToUploadImage"), {
				description: t("common.errors.fileReadError"),
			});
		};

		reader.readAsDataURL(file);
		// Reset input so the same file can be selected again
		event.target.value = "";
	};

	const handleVideoUpload = async () => {
		try {
			const result = await window.electronAPI.openVideoFilePicker();
			if (!result?.success || !result.path) return;
			const filePath = result.path;
			if (!isVideoWallpaperSource(filePath)) {
				toast.error("Unsupported format", {
					description: "Please select a video file (mp4, webm, mov, etc.)",
				});
				return;
			}
			setCustomImages((prev) => [filePath, ...prev]);
			onWallpaperChange(filePath);
			toast.success("Video background added");
		} catch {
			toast.error("Failed to import video background");
		}
	};

	const handleRemoveCustomImage = (imageUrl: string) => {
		setCustomImages((prev) => prev.filter((img) => img !== imageUrl));
		// If the removed image was selected, clear selection
		if (selected === imageUrl) {
			onWallpaperChange(builtInWallpaperPaths[0] ?? BUILT_IN_WALLPAPERS[0]?.publicPath ?? "");
		}
	};

	// Find selected annotation
	const selectedAnnotation = selectedAnnotationId
		? annotationRegions.find((a) => a.id === selectedAnnotationId)
		: null;

	const backgroundSettingsContent = (
		<div className="space-y-5">
			<section className="flex flex-col gap-4">
				<div className="flex items-center justify-between gap-3">
					<SectionLabel>{tSettings("background.title")}</SectionLabel>
					<Button
						variant="ghost"
						size="sm"
						className="text-xs text-muted"
						type="button"
						onClick={resetBackgroundSection}
					>
						{t("common.actions.reset", "Reset")}
					</Button>
				</div>
				<SliderControl
					label={tSettings("effects.backgroundBlur")}
					value={backgroundBlur}
					min={0}
					max={8}
					step={0.25}
					onChange={(v) => onBackgroundBlurChange?.(v)}
					formatValue={(v) => `${v.toFixed(1)}px`}
				/>
			</section>

			<div className="w-full">
				<ChoiceGroup
					type="single"
					value={backgroundTab}
					onValueChange={(value) => {
						if (value) {
							setBackgroundTab(value as typeof backgroundTab);
						}
					}}
					aria-label={tSettings("background.title", "Background type")}
					className="grid w-full grid-cols-4 gap-2"
				>
					{(
						[
							{ value: "image", label: tSettings("background.image") },
							{ value: "video", label: tSettings("background.video", "Video") },
							{ value: "color", label: tSettings("background.color") },
							{ value: "gradient", label: tSettings("background.gradient") },
						] as const
					).map((option) => (
						<ChoiceItem
							key={option.value}
							value={option.value}
							className="flex-1 min-w-0 px-2"
						>
							{option.label}
						</ChoiceItem>
					))}
				</ChoiceGroup>

				<input
					type="file"
					ref={fileInputRef}
					onChange={handleImageUpload}
					accept=".jpg,.jpeg,image/jpeg"
					className="hidden"
				/>
				<div className="grid pt-4 overflow-hidden" data-testid="background-slider">
					<div
						key={backgroundTab}
						data-background-panel={backgroundTab}
						className="editor-section-enter min-w-0"
					>
						{backgroundTab === "image" || backgroundTab === "video" ? (
							<>
								<WallpaperGrid
									addLabel={
										backgroundTab === "image"
											? tSettings("background.addWallpaper", "Add wallpaper")
											: tSettings(
													"background.addVideoWallpaper",
													"Add video wallpaper",
												)
									}
									onAdd={
										backgroundTab === "image"
											? () => fileInputRef.current?.click()
											: handleVideoUpload
									}
									onSelect={onWallpaperChange}
									onRemove={handleRemoveCustomImage}
									isSelected={getWallpaperTileState}
									items={[
										...customImages
											.filter(
												(url) =>
													isVideoWallpaperSource(url) ===
													(backgroundTab === "video"),
											)
											.map((url, index) => ({
												key: `custom-${index}`,
												value: url,
												previewUrl: url,
												label: isVideoWallpaperSource(url)
													? (url.split(/[\\/]/).pop() ??
														"Custom video wallpaper")
													: `${tSettings("background.customWallpaper", "Custom wallpaper")} ${index + 1}`,
												removable: true,
											})),
										...(backgroundTab === "image"
											? imageWallpaperTiles
											: videoWallpaperTiles),
									]}
								/>
							</>
						) : backgroundTab === "color" ? (
							<div className="mt-0 space-y-4">
								<div className="flex flex-col gap-3">
									<ColorPalette
										color={selectedColor}
										colors={visibleColorPalette}
										onChange={({ hex }) => {
											setSelectedColor(hex);
											onWallpaperChange(hex);
										}}
									/>
									<ColorControl
										label="Custom color"
										value={selectedColor}
										onChange={(color) => {
											setSelectedColor(color);
											onWallpaperChange(color);
										}}
									/>
								</div>
							</div>
						) : (
							<div className="mt-0 grid grid-cols-5 gap-2">
								{GRADIENTS.map((g, idx) => (
									<Button
										variant="ghost"
										key={g}
										className={wallpaperTileClass(gradient === g)}
										aria-label={`Gradient ${idx + 1}`}
										onClick={() => {
											setGradient(g);
											onWallpaperChange(g);
										}}
										role="button"
									>
										<div
											className="absolute inset-[1px] overflow-hidden rounded-[8px]"
											style={{ background: g }}
										/>
									</Button>
								))}
							</div>
						)}
					</div>
				</div>
			</div>
		</div>
	);

	// If an annotation is selected, show annotation settings instead
	if (
		!isBackgroundPanel &&
		selectedAnnotation &&
		onAnnotationContentChange &&
		onAnnotationTypeChange &&
		onAnnotationStyleChange &&
		onAnnotationDelete
	) {
		return (
			<AnnotationSettingsPanel
				annotation={selectedAnnotation}
				onContentChange={(content) =>
					onAnnotationContentChange(selectedAnnotation.id, content)
				}
				onTypeChange={(type) => onAnnotationTypeChange(selectedAnnotation.id, type)}
				onStyleChange={(style) => onAnnotationStyleChange(selectedAnnotation.id, style)}
				onFigureDataChange={
					onAnnotationFigureDataChange
						? (figureData) =>
								onAnnotationFigureDataChange(selectedAnnotation.id, figureData)
						: undefined
				}
				onBlurIntensityChange={
					onAnnotationBlurIntensityChange
						? (intensity) =>
								onAnnotationBlurIntensityChange(selectedAnnotation.id, intensity)
						: undefined
				}
				onBlurColorChange={
					onAnnotationBlurColorChange
						? (color) => onAnnotationBlurColorChange(selectedAnnotation.id, color)
						: undefined
				}
				onDelete={() => onAnnotationDelete(selectedAnnotation.id)}
			/>
		);
	}

	if (isBackgroundPanel) {
		return (
			<Card className="flex min-h-0 flex-1 flex-col gap-0 overflow-hidden rounded-none bg-transparent p-0 shadow-none">
				<div
					className="flex-1 min-h-0 overflow-y-auto custom-scrollbar px-5 pb-6 pt-1"
					style={{ scrollbarGutter: "stable" }}
				>
					<div className="mb-4 flex items-center gap-2">
						<Palette className="w-4 h-4 text-accent" />
						<span className="text-sm font-medium text-foreground">
							{tSettings("background.title")}
						</span>
					</div>
					{backgroundSettingsContent}
				</div>
			</Card>
		);
	}

	const frameSectionContent = (
		<section className="flex flex-col gap-4">
			<div className="flex items-center justify-between gap-3">
				<SectionLabel>{tSettings("sections.frame", "Frame")}</SectionLabel>
				<Button
					variant="ghost"
					size="sm"
					className="text-xs text-muted"
					type="button"
					onClick={resetFrameSection}
				>
					{t("common.actions.reset", "Reset")}
				</Button>
			</div>
			<div className="flex flex-col gap-3">
				<SliderControl
					label={tSettings("effects.shadow")}
					value={shadowIntensity}
					min={0}
					max={1}
					step={0.01}
					onChange={(v) => onShadowChange?.(v)}
					formatValue={(v) => `${Math.round(v * 100)}%`}
				/>
				<SliderControl
					label={tSettings("effects.radius", "Radius")}
					value={borderRadius}
					min={0}
					max={50}
					step={0.1}
					onChange={(v) => onBorderRadiusChange?.(v)}
					formatValue={(v) => `${v}%`}
				/>
				<div className="flex flex-col gap-3 pt-0.5">
					{advanced && (
						<div className="flex items-center justify-between gap-3">
							<Label>Link padding sides</Label>
							<Switch
								aria-label="Link padding sides"
								checked={padding.linked !== false}
								onCheckedChange={togglePaddingLink}
							/>
						</div>
					)}

					{padding.linked !== false ? (
						<SliderControl
							label={tSettings("effects.padding")}
							value={padding.top}
							min={0}
							max={100}
							step={1}
							onChange={(v) => handlePaddingSideChange("top", v)}
							formatValue={(v) => `${v}%`}
						/>
					) : (
						<div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
							<SliderControl
								label={tSettings("effects.paddingTop", "Top")}
								value={padding.top}
								min={0}
								max={ADVANCED_VERTICAL_PADDING_MAX}
								step={1}
								onChange={(v) => handlePaddingSideChange("top", v)}
								formatValue={(v) => `${v}%`}
							/>
							<SliderControl
								label={tSettings("effects.paddingBottom", "Bottom")}
								value={padding.bottom}
								min={0}
								max={ADVANCED_VERTICAL_PADDING_MAX}
								step={1}
								onChange={(v) => handlePaddingSideChange("bottom", v)}
								formatValue={(v) => `${v}%`}
							/>
							<SliderControl
								label={tSettings("effects.paddingLeft", "Left")}
								value={padding.left}
								min={0}
								max={100}
								step={1}
								onChange={(v) => handlePaddingSideChange("left", v)}
								formatValue={(v) => `${v}%`}
							/>
							<SliderControl
								label={tSettings("effects.paddingRight", "Right")}
								value={padding.right}
								min={0}
								max={100}
								step={1}
								onChange={(v) => handlePaddingSideChange("right", v)}
								formatValue={(v) => `${v}%`}
							/>
						</div>
					)}
				</div>
				<div className="flex items-center justify-between py-2">
					<span className="text-xs text-muted-foreground">
						{tSettings("effects.removeBackground")}
					</span>
					<Switch
						aria-label={tSettings("effects.removeBackground")}
						checked={removeBackgroundEnabled}
						onCheckedChange={handleRemoveBackgroundToggle}
					/>
				</div>
			</div>
		</section>
	);

	const cropSectionContent = (
		<section className="flex flex-col gap-4">
			<div className="flex items-center justify-between gap-3">
				<SectionLabel>{tSettings("sections.crop", "Crop")}</SectionLabel>
				{isCropped ? (
					<Button
						variant="ghost"
						size="sm"
						className="text-xs text-muted"
						type="button"
						onClick={resetCropSection}
					>
						{t("common.actions.reset", "Reset")}
					</Button>
				) : null}
			</div>
			<div className="flex flex-col gap-3">
				<SliderControl
					label={tSettings("crop.top", "Top")}
					value={cropTop}
					min={0}
					max={50}
					step={1}
					onChange={(v) => setCropInset("top", v)}
					formatValue={(v) => `${Math.round(v)}%`}
				/>
				<SliderControl
					label={tSettings("crop.bottom", "Bottom")}
					value={cropBottom}
					min={0}
					max={50}
					step={1}
					onChange={(v) => setCropInset("bottom", v)}
					formatValue={(v) => `${Math.round(v)}%`}
				/>
				<SliderControl
					label={tSettings("crop.left", "Left")}
					value={cropLeft}
					min={0}
					max={50}
					step={1}
					onChange={(v) => setCropInset("left", v)}
					formatValue={(v) => `${Math.round(v)}%`}
				/>
				<SliderControl
					label={tSettings("crop.right", "Right")}
					value={cropRight}
					min={0}
					max={50}
					step={1}
					onChange={(v) => setCropInset("right", v)}
					formatValue={(v) => `${Math.round(v)}%`}
				/>
			</div>
		</section>
	);

	const captionsSectionContent = (
		<section className="flex flex-col gap-4">
			<div className="flex items-center justify-between gap-3">
				<div className="flex items-center gap-3">
					<SectionLabel>{tSettings("captions.generation", "Generation")}</SectionLabel>
					<Button
						className="text-xs text-muted"
						size="sm"
						variant="ghost"
						type="button"
						onClick={() => onAutoCaptionSettingsChange?.(DEFAULT_AUTO_CAPTION_SETTINGS)}
					>
						{t("common.actions.reset", "Reset")}
					</Button>
				</div>
				<div className="flex items-center gap-2 text-xs text-muted-foreground">
					<span>{tSettings("captions.enabled", "Show")}</span>
					<Switch
						aria-label={tSettings("captions.enabled", "Show")}
						checked={autoCaptionSettings.enabled}
						onCheckedChange={(enabled) => updateAutoCaptionSettings({ enabled })}
					/>
				</div>
			</div>

			<div className="py-2 space-y-3">
				{advanced && (
					<div>
						<Button
							type="button"
							variant="outline"
							onClick={onPickWhisperModel}
							className="h-9 w-full px-4 text-sm"
						>
							{tSettings("captions.useCustomModel", "Use custom")}
						</Button>
					</div>
				)}
				<div className="flex items-center justify-between gap-3">
					<div className="text-sm font-medium text-foreground">
						{tSettings("captions.language", "Language")}
					</div>
					<Select
						value={autoCaptionSettings.language || "auto"}
						onValueChange={(value) => updateAutoCaptionSettings({ language: value })}
					>
						<SelectTrigger className="h-9 w-[180px] text-sm">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{CAPTION_LANGUAGE_OPTIONS.map((option) => (
								<SelectItem key={option.value} value={option.value}>
									{option.label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
				<div className="flex items-center justify-between gap-3">
					<div className="text-sm font-medium text-foreground">
						{tSettings("captions.animation", "Animation")}
					</div>
					<Select
						value={autoCaptionSettings.animationStyle}
						onValueChange={(value) =>
							updateAutoCaptionSettings({
								animationStyle: value as AutoCaptionAnimation,
							})
						}
					>
						<SelectTrigger className="h-9 w-[180px] text-sm">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{CAPTION_ANIMATION_OPTIONS.map((option) => (
								<SelectItem key={option.value} value={option.value}>
									{option.label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
				<div className="flex flex-wrap items-center gap-2">
					<div className="grid w-full grid-cols-1 gap-2">
						{whisperModelDownloadStatus === "downloading" ? (
							<Button type="button" disabled className="h-9 w-full px-4 text-sm">
								{tSettings("captions.downloading", "Downloading...")}{" "}
								{Math.round(whisperModelDownloadProgress)}%
							</Button>
						) : whisperModelPath ? (
							<Button
								type="button"
								variant="outline"
								onClick={onDeleteWhisperSmallModel}
								className="h-9 w-full px-4 text-sm"
							>
								{tSettings("captions.deleteModel", "Delete Model")}
							</Button>
						) : (
							<Button
								type="button"
								onClick={onDownloadWhisperSmallModel}
								className="h-9 w-full px-4 text-sm"
							>
								{tSettings("captions.downloadModel", "Download Model")}
							</Button>
						)}
						<Button
							type="button"
							variant="outline"
							onClick={onClearAutoCaptions}
							disabled={captionCueCount === 0}
							className="h-9 w-full px-4 text-sm"
						>
							{tSettings("captions.clearFull", "Clear Captions")}
						</Button>
					</div>
				</div>
				<div className="flex flex-col gap-4">
					<Button
						type="button"
						onClick={onGenerateAutoCaptions}
						disabled={isGeneratingCaptions || !whisperModelPath}
						className="h-9 w-full px-4 text-sm"
					>
						{isGeneratingCaptions
							? tSettings("captions.generating", "Generating...")
							: captionCueCount > 0
								? tSettings("captions.regenerateFull", "Regenerate Captions")
								: tSettings("captions.generateFull", "Generate Captions")}
					</Button>
					{isGeneratingCaptions ? (
						<div className="space-y-1">
							<div className="text-xs text-muted-foreground">
								{tSettings(
									"captions.generatingStatus",
									"Generating captions. This can take a moment.",
								)}
							</div>
							<ProgressBar aria-label="Downloading caption model" isIndeterminate>
								<ProgressBar.Track>
									<ProgressBar.Fill />
								</ProgressBar.Track>
							</ProgressBar>
						</div>
					) : null}
				</div>
				{whisperModelDownloadStatus === "downloading" ? (
					<div className="h-2 overflow-hidden rounded-full bg-foreground/5">
						<div
							className="h-full rounded-full bg-accent transition-all"
							style={{ width: `${whisperModelDownloadProgress}%` }}
						/>
					</div>
				) : null}
			</div>

			<div className="flex flex-col gap-3">
				{advanced && (
					<div className="flex items-center justify-between gap-3 py-2">
						<div className="text-xs text-muted-foreground">
							{tSettings("captions.timelineQuickAdd", "Hover to add on timeline")}
						</div>
						<Switch
							checked={autoCaptionSettings.timelineQuickAdd}
							onCheckedChange={(timelineQuickAdd) =>
								updateAutoCaptionSettings({ timelineQuickAdd })
							}
							aria-label={tSettings(
								"captions.timelineQuickAdd",
								"Hover to add on timeline",
							)}
						/>
					</div>
				)}

				<div className="mb-1 text-sm font-medium text-foreground">
					{tSettings("captions.fontSettings", "Font Settings")}
				</div>
				<SliderControl
					label={tSettings("captions.fontSize", "Font size")}
					value={autoCaptionSettings.fontSize}
					min={16}
					max={72}
					step={1}
					onChange={(value) => updateAutoCaptionSettings({ fontSize: value })}
					formatValue={(value) => `${Math.round(value)}px`}
				/>
				<div className="flex items-center justify-between py-2">
					<span className="text-sm font-medium text-foreground">
						{tSettings("captions.textColor", "Text color")}
					</span>
					<ColorControl
						compact
						label={tSettings("captions.textColor", "Text color")}
						value={autoCaptionSettings.textColor}
						onChange={(color) => updateAutoCaptionSettings({ textColor: color })}
					/>
				</div>
				{advanced && (
					<SliderControl
						label={tSettings("captions.rowCount", "Rows")}
						value={autoCaptionSettings.maxRows}
						min={1}
						max={4}
						step={1}
						onChange={(value) =>
							updateAutoCaptionSettings({ maxRows: Math.round(value) })
						}
						formatValue={(value) => `${Math.round(value)}`}
					/>
				)}
				{advanced && (
					<SliderControl
						label={tSettings("captions.bottomOffset", "Bottom offset")}
						value={autoCaptionSettings.bottomOffset}
						min={0}
						max={30}
						step={1}
						onChange={(value) => updateAutoCaptionSettings({ bottomOffset: value })}
						formatValue={(value) => `${Math.round(value)}%`}
					/>
				)}
				{advanced && (
					<SliderControl
						label={tSettings("captions.maxWidth", "Max width")}
						value={autoCaptionSettings.maxWidth}
						min={40}
						max={95}
						step={1}
						onChange={(value) => updateAutoCaptionSettings({ maxWidth: value })}
						formatValue={(value) => `${Math.round(value)}%`}
					/>
				)}
				{advanced && (
					<SliderControl
						label={tSettings("captions.boxRadius", "Box radius")}
						value={autoCaptionSettings.boxRadius}
						min={0}
						max={40}
						step={0.5}
						onChange={(value) => updateAutoCaptionSettings({ boxRadius: value })}
						formatValue={(value) =>
							`${Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1)}px`
						}
					/>
				)}
				{advanced && (
					<SliderControl
						label={tSettings("captions.backgroundOpacity", "Background opacity")}
						value={autoCaptionSettings.backgroundOpacity}
						min={0}
						max={1}
						step={0.01}
						onChange={(value) =>
							updateAutoCaptionSettings({ backgroundOpacity: value })
						}
						formatValue={(value) => `${Math.round(value * 100)}%`}
					/>
				)}
			</div>
		</section>
	);

	const effectSectionContent = (() => {
		const settingsSectionContent = (
			<SettingsSections
				categories={advanced ? ["general", "motion", "advanced"] : ["general", "motion"]}
			>
				<SettingsCategory category="general">
					<SettingsRow title={t("editor.theme.appearance", "Appearance")} stacked>
						<ChoiceGroup
							type="single"
							aria-label={t("editor.theme.appearance", "Appearance")}
							value={themePreference}
							onValueChange={(value) => {
								if (value === "light" || value === "dark" || value === "system")
									setThemePreference(value);
							}}
							fullWidth
							size="sm"
						>
							<ChoiceItem value="light" className="flex-1">
								{t("editor.theme.light", "Light")}
							</ChoiceItem>
							<ChoiceItem value="dark" className="flex-1">
								{t("editor.theme.dark", "Dark")}
							</ChoiceItem>
							<ChoiceItem value="system" className="flex-1">
								{t("editor.theme.system", "System")}
							</ChoiceItem>
						</ChoiceGroup>
					</SettingsRow>

					<SettingsRow title={t("common.app.language", "Language")} stacked>
						<Select
							value={locale}
							onValueChange={(value) => setLocale(value as AppLocale)}
						>
							<SelectTrigger className="h-9 w-full text-sm">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{SUPPORTED_LOCALES.map((candidateLocale) => (
									<SelectItem key={candidateLocale} value={candidateLocale}>
										{APP_LANGUAGE_LABELS[candidateLocale]}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</SettingsRow>
				</SettingsCategory>
				<SettingsCategory category="advanced">
					{advanced && (
						<section className="flex flex-col gap-4">
							<SectionLabel>{tSettings("updates.title", "Updates")}</SectionLabel>
							<SettingsRow
								title={tSettings("updates.experimental", "Experimental updates")}
								description={tSettings(
									"updates.experimentalDescription",
									"This is the front line of user testing - highly experimental so expect bugs",
								)}
							>
								<Switch
									checked={experimentalUpdatesEnabled}
									disabled={savingExperimentalUpdates}
									onCheckedChange={(enabled) =>
										void updateExperimentalUpdatesPreference(enabled)
									}
									aria-label={tSettings(
										"updates.experimental",
										"Experimental updates",
									)}
								/>
							</SettingsRow>
						</section>
					)}
				</SettingsCategory>
				<SettingsCategory category="motion">
					<section className="flex flex-col gap-6">
						<SettingsRow
							title={tSettings(
								"effects.autoApplyFreshRecordingZooms",
								"Auto-apply fresh recording zooms",
							)}
							description={tSettings(
								"effects.autoApplyFreshRecordingZoomsDescription",
								"Suggest cursor-follow zooms automatically when you open a new recording.",
							)}
						>
							<Switch
								aria-label={tSettings(
									"effects.autoApplyFreshRecordingZooms",
									"Auto-apply fresh recording zooms",
								)}
								checked={autoApplyFreshRecordingAutoZooms}
								onCheckedChange={onAutoApplyFreshRecordingAutoZoomsChange}
							/>
						</SettingsRow>
						<SettingsRow
							title={tSettings("effects.connectZooms", "Connect neighboring zooms")}
							description={tSettings(
								"effects.connectZoomsDescription",
								"Smooth consecutive zoom regions into a continuous camera move.",
							)}
						>
							<Switch
								aria-label={tSettings(
									"effects.connectZooms",
									"Connect neighboring zooms",
								)}
								checked={connectZooms}
								onCheckedChange={onConnectZoomsChange}
							/>
						</SettingsRow>
					</section>

					<section className="flex flex-col gap-4">
						<MotionPresetCards
							title={tSettings("effects.motionPresetsTitle", "Motion Presets")}
							activePresetId={activeMotionPresetId}
							onApply={applyMotionPreset}
							tSettings={tSettings}
						/>
					</section>
				</SettingsCategory>
				<SettingsCategory category="general">
					<SettingsRow title={t("editor.keyboardShortcuts.title")}>
						<Button variant="secondary" size="sm" onClick={openShortcutsConfig}>
							{t("editor.keyboardShortcuts.customize")}
						</Button>
					</SettingsRow>
				</SettingsCategory>
				<SettingsCategory category="advanced">
					{advanced && showDevMotionControls ? (
						<section className="flex flex-col gap-4 rounded-xl border border-separator bg-surface-secondary p-3">
							<div className="flex items-center justify-between gap-3">
								<div>
									<SectionLabel>
										{tSettings("effects.devSection", "Dev")}
									</SectionLabel>
									<div className="mt-0.5 text-xs text-muted-foreground">
										{tSettings(
											"effects.devSectionHint",
											"Temporary testing controls for native capture and motion tuning.",
										)}
									</div>
								</div>
								<span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs font-medium uppercase tracking-wider text-accent">
									DEV
								</span>
							</div>

							<div className="rounded-lg border border-foreground/10 bg-background/60 px-3 py-3">
								<div className="flex items-start justify-between gap-3">
									<div>
										<div className="text-sm font-medium text-foreground">
											{tSettings(
												"effects.nativeCaptureWarningTester",
												"Native capture warning",
											)}
										</div>
										<div className="mt-0.5 text-xs text-muted-foreground">
											{nativeCaptureUnavailableSession
												? tSettings(
														"effects.nativeCaptureWarningTesterUnavailable",
														"This project is currently marked as native capture unavailable.",
													)
												: tSettings(
														"effects.nativeCaptureWarningTesterAvailable",
														"This project is not marked as unsupported, but you can still open the modal for UI testing.",
													)}
										</div>
									</div>
									<Button
										type="button"
										variant="outline"
										size="sm"
										onClick={() => onOpenNativeCaptureUnavailableModal?.()}
										className="h-8 shrink-0"
									>
										{tSettings(
											"effects.openNativeCaptureWarning",
											"Open warning",
										)}
									</Button>
								</div>
							</div>

							<div className="space-y-1.5 rounded-lg border border-foreground/10 bg-background/60 px-3 py-3">
								<div>
									<div className="text-sm font-medium text-foreground">
										{tSettings(
											"effects.cameraDebugTuning",
											"Camera Debug Tuning",
										)}
									</div>
									<div className="mt-0.5 text-xs text-muted-foreground">
										{tSettings(
											"effects.cameraDebugTuningHint",
											"Development-only spring tuning controls for camera motion.",
										)}
									</div>
								</div>
								<SliderControl
									label={tSettings(
										"effects.cameraSpringStiffnessMultiplier",
										"Camera stiffness",
									)}
									value={cameraSpringStiffnessMultiplier}
									min={0.25}
									max={3}
									step={0.01}
									onChange={(value) =>
										onCameraSpringStiffnessMultiplierChange?.(value)
									}
									formatValue={(value) => `${value.toFixed(2)}×`}
								/>
								<SliderControl
									label={tSettings(
										"effects.cameraSpringDampingMultiplier",
										"Camera damping",
									)}
									value={cameraSpringDampingMultiplier}
									min={0.25}
									max={3}
									step={0.01}
									onChange={(value) =>
										onCameraSpringDampingMultiplierChange?.(value)
									}
									formatValue={(value) => `${value.toFixed(2)}×`}
								/>
								<SliderControl
									label={tSettings(
										"effects.cameraSpringMassMultiplier",
										"Camera mass",
									)}
									value={cameraSpringMassMultiplier}
									min={0.25}
									max={3}
									step={0.01}
									onChange={(value) =>
										onCameraSpringMassMultiplierChange?.(value)
									}
									formatValue={(value) => `${value.toFixed(2)}×`}
								/>
							</div>

							<div className="space-y-1.5 rounded-lg border border-foreground/10 bg-background/60 px-3 py-3">
								<div>
									<div className="text-sm font-medium text-foreground">
										{tSettings(
											"effects.cursorDebugTuning",
											"Cursor Debug Tuning",
										)}
									</div>
									<div className="mt-0.5 text-xs text-muted-foreground">
										{tSettings(
											"effects.cursorDebugTuningHint",
											"Development-only spring tuning controls.",
										)}
									</div>
								</div>
								<SliderControl
									label={tSettings(
										"effects.cursorSpringStiffnessMultiplier",
										"Spring stiffness",
									)}
									value={cursorSpringStiffnessMultiplier}
									min={0.25}
									max={3}
									step={0.01}
									onChange={(value) =>
										onCursorSpringStiffnessMultiplierChange?.(value)
									}
									formatValue={(value) => `${value.toFixed(2)}×`}
								/>
								<SliderControl
									label={tSettings(
										"effects.cursorSpringDampingMultiplier",
										"Spring damping",
									)}
									value={cursorSpringDampingMultiplier}
									min={0.25}
									max={3}
									step={0.01}
									onChange={(value) =>
										onCursorSpringDampingMultiplierChange?.(value)
									}
									formatValue={(value) => `${value.toFixed(2)}×`}
								/>
								<SliderControl
									label={tSettings(
										"effects.cursorSpringMassMultiplier",
										"Spring mass",
									)}
									value={cursorSpringMassMultiplier}
									min={0.25}
									max={3}
									step={0.01}
									onChange={(value) =>
										onCursorSpringMassMultiplierChange?.(value)
									}
									formatValue={(value) => `${value.toFixed(2)}×`}
								/>
							</div>
						</section>
					) : null}
				</SettingsCategory>
			</SettingsSections>
		);

		const sceneSectionContent = (
			<div className="space-y-5">
				{backgroundSettingsContent}
				{frameSectionContent}
				{advanced && cropSectionContent}
			</div>
		);

		const zoomItemSectionContent = (
			<section className="flex flex-col gap-4">
				{selectedZoomId && (
					<>
						<SectionLabel>{tSettings("zoom.mode", "Mode")}</SectionLabel>
						<div className="mb-1">
							<ChoiceGroup
								aria-label="Zoom mode"
								value={selectedZoomMode ?? "auto"}
								onValueChange={(value) => onZoomModeChange?.(value as ZoomMode)}
								className="grid grid-cols-2 gap-2"
							>
								<ChoiceItem value="auto">
									{tSettings("zoom.modeAuto", "Auto")}
								</ChoiceItem>
								<ChoiceItem value="manual">
									{tSettings("zoom.modeManual", "Manual")}
								</ChoiceItem>
							</ChoiceGroup>
							<p className="mt-1.5 text-xs text-muted-foreground/70">
								{selectedZoomMode === "manual"
									? tSettings(
											"zoom.modeManualDescription",
											"Set a fixed focus point for this zoom",
										)
									: tSettings(
											"zoom.modeAutoDescription",
											"Camera recenters when the cursor nears the edge of the zoomed view",
										)}
							</p>
						</div>
						<SectionLabel>{tSettings("zoom.amount", "Amount")}</SectionLabel>
						<ChoiceGroup
							aria-label="Zoom level"
							value={String(selectedZoomDepth)}
							onValueChange={(value) =>
								onZoomDepthChange?.(Number(value) as ZoomDepth)
							}
							className="grid grid-cols-3 gap-2"
						>
							{ZOOM_DEPTH_OPTIONS.map((option) => (
								<ChoiceItem key={option.depth} value={String(option.depth)}>
									{option.label}
								</ChoiceItem>
							))}
						</ChoiceGroup>
					</>
				)}
				{advanced && (
					<>
						<div className="flex items-center justify-between gap-3">
							<SectionLabel>
								{tSettings("zoom.globalSettings", "Animation")}
							</SectionLabel>
							<Button
								variant="ghost"
								size="sm"
								className="text-xs text-muted"
								type="button"
								onClick={resetZoomSection}
							>
								{t("common.actions.reset", "Reset")}
							</Button>
						</div>
						<div className="flex items-center justify-between py-2">
							<span className="text-xs text-muted-foreground">
								{tSettings("effects.classicZoom", "Classic Animation")}
							</span>
							<Switch
								aria-label={tSettings("effects.classicZoom", "Classic Animation")}
								checked={zoomClassicMode}
								onCheckedChange={(v) => onZoomClassicModeChange?.(v)}
							/>
						</div>
						{!zoomClassicMode && (
							<div className="text-xs text-muted-foreground">
								{tSettings(
									"effects.motionPresetsZoomHint",
									"Zoom motion presets are available in Settings.",
								)}
							</div>
						)}
					</>
				)}
			</section>
		);

		const audioSectionContent = (
			<section className="flex flex-col gap-3">
				<div className="flex items-center justify-between gap-3">
					<SectionLabel>{tSettings("audio.volumeTitle", "Audio")}</SectionLabel>
					<Button
						className="text-xs text-muted"
						size="sm"
						variant="ghost"
						type="button"
						onClick={() => {
							onAudioVolumeChange?.(1);
							onAudioNormalizeChange?.(false);
						}}
					>
						{t("common.actions.reset", "Reset")}
					</Button>
				</div>
				<SliderControl
					label={tSettings("audio.volume", "Volume")}
					value={selectedAudioVolume ?? 1}
					min={0}
					max={1}
					step={0.01}
					onChange={(v) => onAudioVolumeChange?.(v)}
					formatValue={(v) => `${Math.round(v * 100)}%`}
				/>
				<div className="flex items-center justify-between py-2">
					<span className="text-xs text-muted-foreground">
						{tSettings("audio.normalize", "Normalize")}
					</span>
					<Switch
						aria-label={tSettings("audio.normalize", "Normalize")}
						checked={Boolean(selectedAudioNormalize)}
						onCheckedChange={(v) => onAudioNormalizeChange?.(v)}
					/>
				</div>
			</section>
		);

		const clipSectionContent = (
			<section className="flex flex-col gap-3">
				<SliderControl
					label={tSettings("speed.label", "Speed")}
					value={Math.min(
						clipSpeedRange.max,
						Math.max(clipSpeedRange.min, selectedClipSpeed ?? 1),
					)}
					min={clipSpeedRange.min}
					max={clipSpeedRange.max}
					step={0.25}
					onChange={(value) => onClipSpeedChange?.(value)}
					formatValue={(value) => `${value}×`}
				/>
				{selectedClipSpeed != null &&
					(selectedClipSpeed < clipSpeedRange.min ||
						selectedClipSpeed > clipSpeedRange.max) && (
						<p className="text-xs text-muted-foreground" role="status">
							{selectedClipSpeed}× —{" "}
							{tSettings(
								"speed.unsupported",
								"Not supported for preview on this device",
							)}
						</p>
					)}
				<label className="flex items-center justify-between py-2">
					<span className="text-xs text-muted-foreground">
						{tSettings("clip.mute", "Mute clip")}
					</span>
					<Switch
						checked={selectedClipMuted ?? false}
						onCheckedChange={(muted) => onClipMutedChange?.(muted)}
						aria-label={tSettings("clip.mute", "Mute clip")}
					/>
				</label>
				{hasClipAudioOverrides && onResetClipAudio && (
					<Button type="button" variant="ghost" onClick={onResetClipAudio}>
						{tSettings("clip.resetAudioSettings", "Reset audio settings")}
					</Button>
				)}
			</section>
		);

		const captionSectionContent = (
			<section className="flex flex-col gap-4">
				{selectedCaptionId !== null ? (
					<CaptionListPanel
						cues={autoCaptions}
						selectedCaptionId={selectedCaptionId}
						currentTimeMs={captionCurrentTimeMs}
						onBeginCaptionEdit={(id) => onBeginCaptionEdit?.(id)}
						onCaptionTextEdit={(id, text) => onCaptionTextEdit?.(id, text)}
						onCaptionRetime={(id, span) => onCaptionRetime?.(id, span)}
						onCaptionSplit={(id, atMs) => onCaptionSplit?.(id, atMs)}
						onCaptionMerge={(idA, idB) => onCaptionMerge?.(idA, idB)}
						onCaptionDelete={(id) => onCaptionDelete?.(id)}
					/>
				) : (
					<div className="rounded-lg bg-foreground/[0.03] px-2.5 py-6 text-center">
						<p className="text-xs text-muted-foreground">
							{tSettings(
								"captions.selectOnTimeline",
								"Select a caption on the timeline to edit it.",
							)}
						</p>
					</div>
				)}
			</section>
		);

		switch (activeEffectSection) {
			case "settings":
				return settingsSectionContent;
			case "scene":
				return sceneSectionContent;
			case "zoom":
				return zoomItemSectionContent;
			case "clip":
				return clipSectionContent;
			case "audio":
				return audioSectionContent;
			case "frame":
				return sceneSectionContent;
			case "crop":
				return sceneSectionContent;
			case "captions":
				return captionsSectionContent;
			case "caption":
				return captionSectionContent;
			case "cursor":
				return (
					<section className="flex flex-col gap-4">
						<div className="flex flex-col gap-4">
							<div className="flex items-center justify-between gap-3">
								<SectionLabel>
									{tSettings("sections.appearance", "Appearance")}
								</SectionLabel>
								<Button
									variant="ghost"
									size="sm"
									className="text-xs text-muted"
									type="button"
									onClick={resetCursorSection}
								>
									{t("common.actions.reset", "Reset")}
								</Button>
							</div>
							{advanced && (
								<div className="flex flex-col gap-3">
									<label className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
										<span>{tSettings("effects.showCursor")}</span>
										<Switch
											aria-label={tSettings("effects.showCursor")}
											checked={showCursor}
											onCheckedChange={onShowCursorChange}
										/>
									</label>
									<label className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
										<span>{tSettings("effects.loopCursor")}</span>
										<Switch
											aria-label={tSettings("effects.loopCursor")}
											checked={loopCursor}
											onCheckedChange={onLoopCursorChange}
										/>
									</label>
								</div>
							)}
						</div>
						<div className="flex flex-col gap-3">
							<div className="space-y-1.5">
								<ChoiceGroup
									type="single"
									value={cursorStyle}
									onValueChange={(value) => {
										if (value) {
											onCursorStyleChange?.(value as CursorStyle);
										}
									}}
									className="grid grid-cols-4 gap-2"
									aria-label={tSettings("effects.cursorStyle", "Cursor Style")}
								>
									{cursorStyleOptions.map((option) => (
										<ChoiceItem
											key={option.value}
											value={option.value}
											title={option.label}
											aria-label={option.label}
											className={cn(
												"group aspect-square h-auto min-w-0 p-3 text-left",
											)}
										>
											<div className="flex h-full flex-col items-center justify-between gap-3">
												<div className="flex min-h-0 flex-1 items-center justify-center rounded-lg px-2 py-1.5">
													<CursorStylePreview
														style={option.value}
														previewUrls={cursorPreviewUrls}
													/>
												</div>
											</div>
										</ChoiceItem>
									))}
								</ChoiceGroup>
							</div>
							<SliderControl
								label={tSettings("effects.cursorSize")}
								value={cursorSize}
								min={0.5}
								max={10}
								step={0.05}
								onChange={(v) => onCursorSizeChange?.(v)}
								formatValue={(v) => `${v.toFixed(2)}×`}
							/>
							<CursorClickEffectCards
								title={tSettings(
									"effects.cursorClickEffects.title",
									"Click Effects",
								)}
								activeEffectId={cursorClickEffect}
								effectColor={cursorClickEffectColor}
								onApply={(effectId) => onCursorClickEffectChange?.(effectId)}
								tSettings={tSettings}
							/>
							{advanced ? (
								<div className="grid gap-3">
									<div className="grid gap-1">
										<div className="text-xs text-muted-foreground">
											{tSettings(
												"effects.cursorClickEffects.color",
												"Effect Color",
											)}
										</div>
										<div className="flex flex-col gap-3">
											<ColorPalette
												color={cursorClickEffectColor}
												colors={CLICK_EFFECT_COLOR_OPTIONS}
												onChange={({ hex }) =>
													onCursorClickEffectColorChange?.(hex)
												}
											/>
											<ColorControl
												label="Custom effect color"
												value={cursorClickEffectColor}
												onChange={(color) =>
													onCursorClickEffectColorChange?.(color)
												}
											/>
										</div>
									</div>
									<SliderControl
										label={tSettings(
											"effects.cursorClickEffects.size",
											"Effect Size",
										)}
										value={cursorClickEffectScale}
										min={0.5}
										max={2}
										step={0.05}
										onChange={(v) => onCursorClickEffectScaleChange?.(v)}
										formatValue={(v) => `${v.toFixed(2)}×`}
									/>
									<SliderControl
										label={tSettings(
											"effects.cursorClickEffects.opacity",
											"Effect Opacity",
										)}
										value={cursorClickEffectOpacity}
										min={0}
										max={1}
										step={0.01}
										onChange={(v) => onCursorClickEffectOpacityChange?.(v)}
										formatValue={(v) => `${Math.round(v * 100)}%`}
									/>
									<SliderControl
										label={tSettings(
											"effects.cursorClickEffects.duration",
											"Effect Duration",
										)}
										value={cursorClickEffectDurationMs}
										min={120}
										max={1200}
										step={10}
										onChange={(v) => onCursorClickEffectDurationMsChange?.(v)}
										formatValue={(v) => `${Math.round(v)} ms`}
									/>
								</div>
							) : null}
							<SliderControl
								label={tSettings("effects.cursorClickBounce")}
								value={cursorClickBounce}
								min={0}
								max={5}
								step={0.05}
								onChange={(v) => onCursorClickBounceChange?.(v)}
								formatValue={(v) => `${v.toFixed(2)}×`}
							/>
							{advanced && (
								<SliderControl
									label={tSettings(
										"effects.cursorClickBounceDuration",
										"Bounce Speed",
									)}
									value={cursorClickBounceDuration}
									min={60}
									max={500}
									step={5}
									onChange={(v) => onCursorClickBounceDurationChange?.(v)}
									formatValue={(v) => `${Math.round(v)} ms`}
								/>
							)}
							{advanced && (
								<SliderControl
									label={tSettings("effects.cursorSway")}
									value={toCursorSwaySliderValue(cursorSway)}
									min={0}
									max={toCursorSwaySliderValue(2)}
									step={toCursorSwaySliderValue(0.05)}
									onChange={(v) =>
										onCursorSwayChange?.(fromCursorSwaySliderValue(v))
									}
									formatValue={(v) =>
										v <= 0 ? tSettings("effects.off") : `${v.toFixed(2)}×`
									}
								/>
							)}
							{advanced && showDevMotionControls ? (
								<div className="rounded-lg border border-foreground/10 bg-foreground/[0.03] px-3 py-2">
									<div className="text-xs text-muted-foreground">
										{tSettings(
											"effects.cursorDebugMovedToDev",
											"Cursor spring tuning is available in Settings > Dev.",
										)}
									</div>
								</div>
							) : null}
						</div>
					</section>
				);
			case "webcam":
				return (
					<section className="flex flex-col gap-4">
						<div className="flex items-center justify-between gap-3">
							<SectionLabel>
								{tSettings("sections.appearance", "Appearance")}
							</SectionLabel>
							<Button
								variant="ghost"
								size="sm"
								className="text-xs text-muted"
								type="button"
								onClick={resetWebcamSection}
							>
								{t("common.actions.reset", "Reset")}
							</Button>
						</div>
						<div className="flex flex-col gap-3">
							<div className="flex items-center justify-between py-2">
								<span className="text-xs text-muted-foreground">
									{tSettings("effects.show", "Show")}
								</span>
								<Switch
									aria-label={tSettings("effects.show", "Show")}
									checked={webcam?.enabled ?? false}
									onCheckedChange={(enabled) => updateWebcam({ enabled })}
								/>
							</div>
							{advanced && (
								<>
									<div className="flex items-center justify-between py-2">
										<span className="text-xs text-muted-foreground">
											{tSettings("effects.webcamReactToZoom")}
										</span>
										<Switch
											aria-label={tSettings("effects.webcamReactToZoom")}
											checked={
												webcam?.reactToZoom ?? DEFAULT_WEBCAM_REACT_TO_ZOOM
											}
											onCheckedChange={(reactToZoom) =>
												updateWebcam({ reactToZoom })
											}
										/>
									</div>
									<div className="flex items-center justify-between py-2">
										<span className="text-xs text-muted-foreground">
											{tSettings("effects.webcamMirror", "Mirror webcam")}
										</span>
										<Switch
											aria-label={tSettings(
												"effects.webcamMirror",
												"Mirror webcam",
											)}
											checked={webcam?.mirror ?? true}
											onCheckedChange={(mirror) => updateWebcam({ mirror })}
										/>
									</div>
								</>
							)}
							<SliderControl
								label={tSettings("effects.webcamWidth", "Webcam Width")}
								value={webcamWidth}
								min={10}
								max={100}
								step={1}
								onChange={(v) => updateWebcam({ width: v, size: v })}
								formatValue={(v) => `${Math.round(v)}%`}
							/>
							{advanced && (
								<SliderControl
									label={tSettings("effects.webcamHeight", "Webcam Height")}
									value={webcamHeight}
									min={10}
									max={100}
									step={1}
									onChange={(v) => updateWebcam({ height: v })}
									formatValue={(v) => `${Math.round(v)}%`}
								/>
							)}
							{advanced && (
								<div className="py-2">
									<div className="mb-2 flex items-center justify-between gap-2">
										<div className="text-xs text-muted-foreground">
											{tSettings("effects.webcamCrop", "Crop")}
										</div>
										<Button
											className="text-xs text-muted"
											size="sm"
											variant="ghost"
											type="button"
											onClick={() =>
												updateWebcam({ cropRegion: DEFAULT_CROP_REGION })
											}
										>
											{t("common.actions.reset", "Reset")}
										</Button>
									</div>
									<div className="mx-auto w-full max-w-56">
										<WebcamCropControl
											cropRegion={webcamCrop}
											mirrored={webcam?.mirror ?? true}
											previewSrc={webcamPreviewSrc}
											previewCurrentTime={webcamPreviewCurrentTime}
											previewPlaying={webcamPreviewPlaying}
											previewTimeOffsetMs={webcam?.timeOffsetMs}
											onCropChange={(cropRegion, previewFrame) =>
												updateWebcam({
													cropRegion,
													height: previewFrame
														? getCropMatchedWebcamHeightPercent(
																webcamWidth,
																webcamHeight,
																previewFrame.width,
																previewFrame.height,
																cropRegion,
															)
														: webcamHeight,
												})
											}
										/>
									</div>
								</div>
							)}
							<div className="py-2">
								<div className="mb-2 text-xs text-muted-foreground">
									{tSettings("effects.webcamPosition", "Position")}
								</div>
								<ChoiceGroup
									aria-label={tSettings("effects.webcamPosition", "Position")}
									value={webcamPositionPreset}
									onValueChange={(value) =>
										applyWebcamPositionPreset(value as WebcamPositionPreset)
									}
									className="grid grid-cols-3 gap-2"
								>
									{WEBCAM_POSITION_PRESETS.map((option) => (
										<ChoiceItem
											key={option.preset}
											value={option.preset}
											textValue={option.preset}
										>
											{option.label}
										</ChoiceItem>
									))}
								</ChoiceGroup>
								{advanced && (
									<div className="mt-2 flex items-center justify-between py-3">
										<span className="text-xs text-muted-foreground">
											{tSettings(
												"effects.webcamCustomPosition",
												"Custom position",
											)}
										</span>
										<Switch
											aria-label={tSettings(
												"effects.webcamCustomPosition",
												"Custom position",
											)}
											checked={webcamPositionPreset === "custom"}
											onCheckedChange={(checked) =>
												applyWebcamPositionPreset(
													checked
														? "custom"
														: DEFAULT_WEBCAM_POSITION_PRESET,
												)
											}
										/>
									</div>
								)}
							</div>
							{advanced && webcamPositionPreset === "custom" ? (
								<>
									<SliderControl
										label={tSettings("effects.webcamHorizontal", "Horizontal")}
										value={webcamPositionX * 100}
										min={0}
										max={100}
										step={1}
										onChange={(v) =>
											updateWebcam({
												positionPreset: "custom",
												positionX: v / 100,
											})
										}
										formatValue={(v) => `${Math.round(v)}%`}
									/>
									<SliderControl
										label={tSettings("effects.webcamVertical", "Vertical")}
										value={webcamPositionY * 100}
										min={0}
										max={100}
										step={1}
										onChange={(v) =>
											updateWebcam({
												positionPreset: "custom",
												positionY: v / 100,
											})
										}
										formatValue={(v) => `${Math.round(v)}%`}
									/>
								</>
							) : null}
							{advanced && (
								<SliderControl
									label={tSettings("effects.webcamMargin", "Margin")}
									value={webcam?.margin ?? DEFAULT_WEBCAM_MARGIN}
									min={0}
									max={96}
									step={1}
									onChange={(v) => updateWebcam({ margin: v })}
									formatValue={(v) => `${Math.round(v)}px`}
								/>
							)}
							<SliderControl
								label={tSettings("effects.webcamRoundness")}
								value={webcam?.roundness ?? DEFAULT_WEBCAM_ROUNDNESS}
								min={0}
								max={100}
								step={1}
								onChange={(v) => updateWebcam({ roundness: v })}
								formatValue={(v) => `${Math.round(v)}%`}
							/>
							{advanced && (
								<SliderControl
									label={tSettings("effects.webcamShadow")}
									value={webcam?.shadow ?? DEFAULT_WEBCAM_SHADOW}
									min={0}
									max={1}
									step={0.01}
									onChange={(v) => updateWebcam({ shadow: v })}
									formatValue={(v) => `${Math.round(v * 100)}%`}
								/>
							)}
							<div className="py-2">
								<div className="flex flex-col gap-4">
									<div className="min-w-0">
										<div className="text-xs text-muted-foreground">
											{tSettings("effects.webcamFootage")}
										</div>
										<div className="mt-0.5 break-all text-xs leading-4 text-muted-foreground/70">
											{webcamFileName ??
												tSettings("effects.webcamFootageDescription")}
										</div>
									</div>
									<div className="grid grid-cols-1 gap-2">
										<Button
											type="button"
											variant="outline"
											onClick={onUploadWebcam}
											className="h-9 w-full min-w-0 justify-start gap-2 px-3"
										>
											<Upload className="h-3 w-3" />
											<span className="min-w-0 truncate">
												{webcam?.sourcePath
													? tSettings("effects.replaceWebcamFootage")
													: tSettings("effects.uploadWebcamFootage")}
											</span>
										</Button>
										{webcam?.sourcePath ? (
											<Button
												type="button"
												variant="outline"
												onClick={onClearWebcam}
												className="h-9 w-full min-w-0 justify-start gap-2 px-3"
											>
												<Trash2 className="h-3 w-3" />
												<span className="min-w-0 truncate">
													{tSettings("effects.removeWebcamFootage")}
												</span>
											</Button>
										) : null}
									</div>
								</div>
							</div>
						</div>
					</section>
				);
			default: {
				return sceneSectionContent;
			}
		}
	})();

	return (
		<Card className="flex min-h-0 flex-1 flex-col gap-0 overflow-hidden rounded-none bg-transparent p-0 shadow-none">
			<div
				className="flex-1 min-h-0 overflow-y-auto custom-scrollbar px-5 pb-6 pt-1"
				style={{ scrollbarGutter: "stable" }}
			>
				<AnimatePresence mode="wait" initial={false}>
					<motion.div
						key={activeEffectSection}
						initial={{ opacity: 0 }}
						animate={{ opacity: 1 }}
						exit={{ opacity: 0 }}
						transition={{ duration: 0.18, ease: "easeOut" }}
					>
						{effectSectionContent}
					</motion.div>
				</AnimatePresence>
			</div>

			<div
				className={cn(
					"shrink-0 px-5 py-4",
					(() => {
						if (activeEffectSection === "clip" && selectedClipId) return false;
						if (activeEffectSection === "zoom" && selectedZoomId) return false;
						if (activeEffectSection === "audio" && selectedAudioId) return false;
						if (selectedAnnotationId) return false; // Annotation editor handles its own but let's see
						return true;
					})() && "hidden",
				)}
			>
				{activeEffectSection === "clip" && selectedClipId && (
					<Button
						onClick={() => {
							if (selectedClipId && onClipDelete) onClipDelete(selectedClipId);
						}}
						variant="destructive-soft"
						size="sm"
						className="h-9 w-full gap-2 text-xs"
					>
						<Trash2 className="h-3 w-3" />
						{tSettings("clip.delete", "Delete Clip")}
					</Button>
				)}
				{activeEffectSection === "zoom" && selectedZoomId && (
					<Button
						onClick={() => {
							if (selectedZoomId && onZoomDelete) onZoomDelete(selectedZoomId);
						}}
						variant="destructive-soft"
						size="sm"
						className="h-9 w-full gap-2 text-xs"
					>
						<Trash2 className="h-3 w-3" />
						{tSettings("zoom.deleteZoom", "Delete Zoom")}
					</Button>
				)}
				{activeEffectSection === "audio" && selectedAudioId && (
					<Button
						onClick={() => {
							if (selectedAudioId && onAudioDelete) onAudioDelete(selectedAudioId);
						}}
						variant="destructive-soft"
						size="sm"
						className="h-9 w-full gap-2 text-xs"
					>
						<Trash2 className="h-3 w-3" />
						{tSettings("audio.deleteRegion", "Delete Audio")}
					</Button>
				)}
				{selectedAnnotationId && (
					<Button
						onClick={() => {
							if (selectedAnnotationId && onAnnotationDelete)
								onAnnotationDelete(selectedAnnotationId);
						}}
						variant="destructive-soft"
						size="sm"
						className="h-9 w-full gap-2 text-xs"
					>
						<Trash2 className="h-3 w-3" />
						{tSettings("annotation.delete", "Delete Annotation")}
					</Button>
				)}
			</div>
		</Card>
	);
}
