import { Palette, Trash2, Upload, X } from "lucide-react";
import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { getAssetPath, getRenderableAssetUrl } from "@/lib/assetPath";
import { cn } from "@/lib/utils";
import type { BuiltInWallpaper } from "@/lib/wallpapers";
import { BUILT_IN_WALLPAPERS, getAvailableWallpapers, isVideoWallpaperSource } from "@/lib/wallpapers";
import { type AspectRatio } from "@/utils/aspectRatioUtils";
import minimalCursorUrl from "../../../Minimal Cursor.svg";
import amongusCursorUrl from "../../assets/cursors/amongus/default.png";
import tahoeCursorUrl from "../../assets/cursors/Cursor=Default.svg";
import chooperCursorUrl from "../../assets/cursors/chooper/default.png";
import lavenderCursorUrl from "../../assets/cursors/lavender/default.png";
import parchedCursorUrl from "../../assets/cursors/parched/default.png";
import turtleCursorUrl from "../../assets/cursors/turtle/default.png";
import { useI18n, useScopedT } from "../../contexts/I18nContext";
import { AnnotationSettingsPanel } from "./AnnotationSettingsPanel";
import { loadEditorPreferences, saveEditorPreferences } from "./editorPreferences";
import { SliderControl } from "./SliderControl";
import type {
	AnnotationRegion,
	AnnotationType,
	AutoCaptionAnimation,
	AutoCaptionSettings,
	CaptionCue,
	CropRegion,
	CursorStyle,
	FigureData,
	PlaybackSpeed,
	WebcamOverlaySettings,
	WebcamPositionPreset,
	ZoomDepth,
	ZoomTransitionEasing,
} from "./types";
import {
	DEFAULT_AUTO_CAPTION_SETTINGS,
	DEFAULT_CROP_REGION,
	DEFAULT_CURSOR_CLICK_BOUNCE,
	DEFAULT_CURSOR_CLICK_BOUNCE_DURATION,
	DEFAULT_CURSOR_MOTION_BLUR,
	DEFAULT_CURSOR_SIZE,
	DEFAULT_CURSOR_SMOOTHING,
	DEFAULT_CURSOR_STYLE,
	DEFAULT_CURSOR_SWAY,
	DEFAULT_WEBCAM_CORNER_RADIUS,
	DEFAULT_WEBCAM_MARGIN,
	DEFAULT_WEBCAM_POSITION_PRESET,
	DEFAULT_WEBCAM_POSITION_X,
	DEFAULT_WEBCAM_POSITION_Y,
	DEFAULT_WEBCAM_REACT_TO_ZOOM,
	DEFAULT_WEBCAM_SHADOW,
	DEFAULT_WEBCAM_SIZE,
	DEFAULT_ZOOM_MOTION_BLUR,
	SPEED_OPTIONS,
} from "./types";
import { fromCursorSwaySliderValue, toCursorSwaySliderValue } from "./videoPlayback/cursorSway";
import {
	UPLOADED_CURSOR_SAMPLE_SIZE,
	uploadedCursorAssets,
} from "./videoPlayback/uploadedCursorAssets";
import { getWebcamPositionForPreset, resolveWebcamCorner } from "./webcamOverlay";

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

type BackgroundTab = "image" | "video" | "color" | "gradient";
export type EditorEffectSection =
	| "scene"
	| "cursor"
	| "captions"
	| "webcam"
	| "zoom"
	| "frame"
	| "crop";

function isHexWallpaper(value: string): boolean {
	return /^#(?:[0-9a-f]{3}){1,2}$/i.test(value);
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
	return (
		<p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">{children}</p>
	);
}

interface SettingsPanelProps {
	panelMode?: "editor" | "background";
	activeEffectSection?: EditorEffectSection;
	selected: string;
	onWallpaperChange: (path: string) => void;
	selectedZoomDepth?: ZoomDepth | null;
	onZoomDepthChange?: (depth: ZoomDepth) => void;
	selectedZoomId?: string | null;
	onZoomDelete?: (id: string) => void;
	selectedTrimId?: string | null;
	onTrimDelete?: (id: string) => void;
	selectedClipId?: string | null;
	selectedClipSpeed?: number | null;
	onClipSpeedChange?: (speed: number) => void;
	onClipDelete?: (id: string) => void;
	shadowIntensity?: number;
	onShadowChange?: (intensity: number) => void;
	backgroundBlur?: number;
	onBackgroundBlurChange?: (amount: number) => void;
	zoomMotionBlur?: number;
	onZoomMotionBlurChange?: (amount: number) => void;
	connectZooms?: boolean;
	onConnectZoomsChange?: (enabled: boolean) => void;
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
	cursorMotionBlur?: number;
	onCursorMotionBlurChange?: (amount: number) => void;
	cursorClickBounce?: number;
	onCursorClickBounceChange?: (amount: number) => void;
	cursorClickBounceDuration?: number;
	onCursorClickBounceDurationChange?: (duration: number) => void;
	cursorSway?: number;
	onCursorSwayChange?: (amount: number) => void;
	borderRadius?: number;
	onBorderRadiusChange?: (radius: number) => void;
	webcam?: WebcamOverlaySettings;
	onWebcamChange?: (webcam: WebcamOverlaySettings) => void;
	onUploadWebcam?: () => void;
	onClearWebcam?: () => void;
	padding?: number;
	onPaddingChange?: (padding: number) => void;
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
	selectedSpeedId?: string | null;
	selectedSpeedValue?: PlaybackSpeed | null;
	onSpeedChange?: (speed: PlaybackSpeed) => void;
	onSpeedDelete?: (id: string) => void;
}

export default SettingsPanel;

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

const CURSOR_STYLE_OPTIONS: Array<{ value: CursorStyle; label: string }> = [
	{ value: "tahoe", label: "Tahoe" },
	{ value: "dot", label: "Dot" },
	{ value: "figma", label: "Minimal" },
	{ value: "mono", label: "Inverted" },
	{ value: "lavender", label: "Lavender" },
	{ value: "parched", label: "Parched" },
	{ value: "chooper", label: "Chooper" },
	{ value: "amongus", label: "Among Us" },
	{ value: "turtle", label: "Turtle" },
];

const CAPTION_LANGUAGE_OPTIONS = [
	{ value: "auto", label: "Auto Detect" },
	{ value: "en", label: "English" },
	{ value: "es", label: "Spanish" },
	{ value: "fr", label: "French" },
	{ value: "de", label: "German" },
	{ value: "it", label: "Italian" },
	{ value: "pt", label: "Portuguese" },
	{ value: "zh", label: "Chinese" },
	{ value: "ja", label: "Japanese" },
	{ value: "ko", label: "Korean" },
] as const;

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
}: {
	style: CursorStyle;
	previewUrls: Partial<Record<"tahoe" | "figma" | "mono", string>>;
}) {
	if (style === "tahoe") {
		return (
			<img
				src={previewUrls.tahoe ?? tahoeCursorUrl}
				alt=""
				className="h-7 w-7 object-contain drop-shadow-[0_8px_12px_rgba(15,23,42,0.18)]"
				draggable={false}
			/>
		);
	}

	if (style === "figma") {
		return (
			<img
				src={previewUrls.figma ?? minimalCursorUrl}
				alt=""
				className="h-7 w-7 object-contain"
				draggable={false}
			/>
		);
	}

	if (style === "dot") {
		return (
			<span className="h-[14px] w-[14px] rounded-full border-[2.5px] border-slate-900 bg-white shadow-[0_8px_12px_rgba(15,23,42,0.16)]" />
		);
	}

	if (style === "lavender") {
		return (
			<img src={lavenderCursorUrl} alt="" className="h-7 w-7 object-contain" draggable={false} />
		);
	}

	if (style === "parched") {
		return (
			<img src={parchedCursorUrl} alt="" className="h-7 w-7 object-contain" draggable={false} />
		);
	}

	if (style === "chooper") {
		return (
			<img src={chooperCursorUrl} alt="" className="h-7 w-7 object-contain" draggable={false} />
		);
	}

	if (style === "amongus") {
		return (
			<img src={amongusCursorUrl} alt="" className="h-7 w-7 object-contain" draggable={false} />
		);
	}

	if (style === "turtle") {
		return (
			<img src={turtleCursorUrl} alt="" className="h-7 w-7 object-contain" draggable={false} />
		);
	}

	return (
		<img
			src={previewUrls.mono ?? tahoeCursorUrl}
			alt=""
			className="h-7 w-7 object-contain"
			draggable={false}
		/>
	);
}

export function SettingsPanel({
	panelMode = "editor",
	activeEffectSection: activeEffectSectionProp,
	selected,
	onWallpaperChange,
	selectedZoomDepth,
	onZoomDepthChange,
	selectedZoomId,
	onZoomDelete,
	selectedTrimId,
	onTrimDelete,
	selectedClipId,
	selectedClipSpeed,
	onClipSpeedChange,
	onClipDelete,
	shadowIntensity = 0.67,
	onShadowChange,
	backgroundBlur = 0,
	onBackgroundBlurChange,
	zoomMotionBlur = 0,
	onZoomMotionBlurChange,
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
	cursorMotionBlur = DEFAULT_CURSOR_MOTION_BLUR,
	onCursorMotionBlurChange,
	cursorClickBounce = 1,
	onCursorClickBounceChange,
	cursorClickBounceDuration = DEFAULT_CURSOR_CLICK_BOUNCE_DURATION,
	onCursorClickBounceDurationChange,
	cursorSway = DEFAULT_CURSOR_SWAY,
	onCursorSwayChange,
	borderRadius = 12.5,
	onBorderRadiusChange,
	webcam,
	onWebcamChange,
	onUploadWebcam,
	onClearWebcam,
	padding = 50,
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
	selectedSpeedId,
	selectedSpeedValue,
	onSpeedChange,
	onSpeedDelete,
}: SettingsPanelProps) {
	const tSettings = useScopedT("settings");
	const { t } = useI18n();
	const isBackgroundPanel = panelMode === "background";
	const initialEditorPreferences = useMemo(() => loadEditorPreferences(), []);
	const [builtInWallpapers, setBuiltInWallpapers] =
		useState<BuiltInWallpaper[]>(BUILT_IN_WALLPAPERS);
	const [wallpaperPreviewPaths, setWallpaperPreviewPaths] = useState<string[]>([]);
	const [customImages, setCustomImages] = useState<string[]>(
		initialEditorPreferences.customWallpapers,
	);
	const removeBackgroundStateRef = useRef<{
		aspectRatio: AspectRatio;
		padding: number;
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
		let mounted = true;
		(async () => {
			try {
				const availableWallpapers = await getAvailableWallpapers();
				const resolved = await Promise.all(
					availableWallpapers.map(async (wallpaper) =>
						getRenderableAssetUrl(await getAssetPath(wallpaper.relativePath)),
					),
				);
				if (mounted) {
					setBuiltInWallpapers(availableWallpapers);
					setWallpaperPreviewPaths(resolved);
				}
			} catch {
				if (mounted) {
					setBuiltInWallpapers(BUILT_IN_WALLPAPERS);
					setWallpaperPreviewPaths(BUILT_IN_WALLPAPERS.map((wallpaper) => wallpaper.publicPath));
				}
			}
		})();
		return () => {
			mounted = false;
		};
	}, []);
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
	const removeBackgroundEnabled = aspectRatio === "native" && padding === 0;
	const [backgroundTab, setBackgroundTab] = useState<BackgroundTab>(() =>
		getBackgroundTabForWallpaper(selected),
	);
	const customColorInputRef = useRef<HTMLInputElement | null>(null);
	const defaultWebcam = initialEditorPreferences.webcam;
	const [internalActiveEffectSection] = useState<EditorEffectSection>("scene");
	const activeEffectSection = activeEffectSectionProp ?? internalActiveEffectSection;
	const [cursorPreviewUrls, setCursorPreviewUrls] = useState<
		Partial<Record<"tahoe" | "figma" | "mono", string>>
	>({});

	useEffect(() => {
		let cancelled = false;

		void (async () => {
			try {
				const tahoeAsset = uploadedCursorAssets.arrow;
				const tahoePreview = tahoeAsset
					? await createTrimmedSvgPreview(
							tahoeAsset.url,
							UPLOADED_CURSOR_SAMPLE_SIZE,
							tahoeAsset.trim,
						)
					: tahoeCursorUrl;
				const minimalPreview = await createTrimmedSvgPreview(minimalCursorUrl, 512);
				const invertedPreview = await createInvertedPreview(tahoePreview);

				if (!cancelled) {
					setCursorPreviewUrls({
						tahoe: tahoePreview,
						figma: minimalPreview,
						mono: invertedPreview,
					});
				}
			} catch {
				if (!cancelled) {
					setCursorPreviewUrls({
						tahoe: tahoeCursorUrl,
						figma: minimalCursorUrl,
						mono: tahoeCursorUrl,
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

		if (selected.startsWith("data:image") && !customImages.includes(selected)) {
			setCustomImages((prev) => [selected, ...prev]);
		}

		const isBuiltInWallpaper =
			builtInWallpaperPaths.includes(selected) || wallpaperPreviewPaths.includes(selected);

		if (
			!isBuiltInWallpaper &&
			isVideoWallpaperSource(selected) &&
			!customImages.includes(selected)
		) {
			setCustomImages((prev) => [selected, ...prev]);
		}
	}, [builtInWallpaperPaths, customImages, selected, wallpaperPreviewPaths]);

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
			onPaddingChange?.(0);
			return;
		}

		if (removeBackgroundStateRef.current) {
			onAspectRatioChange?.(removeBackgroundStateRef.current.aspectRatio);
			onPaddingChange?.(removeBackgroundStateRef.current.padding);
			removeBackgroundStateRef.current = null;
		}
	};

	const webcamFileName = webcam?.sourcePath?.split(/[\\/]/).pop() ?? null;
	const visibleColorPalette = colorPalette.slice(0, 15);
	const webcamPositionPreset = webcam?.positionPreset ?? DEFAULT_WEBCAM_POSITION_PRESET;
	const webcamPositionX = webcam?.positionX ?? DEFAULT_WEBCAM_POSITION_X;
	const webcamPositionY = webcam?.positionY ?? DEFAULT_WEBCAM_POSITION_Y;

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
			"group relative aspect-square w-full overflow-hidden rounded-[10px] border bg-[#101115] transition-colors duration-150",
			isSelected
				? "border-[#2563EB] bg-white/8"
				: "border-white/10 bg-white/[0.045] hover:border-white/20 hover:bg-white/[0.07]",
		);

	const renderWallpaperImageTile = (
		wallpaperUrl: string,
		isSelected: boolean,
		props?: {
			key?: string;
			ariaLabel?: string;
			title?: string;
			onClick?: () => void;
			children?: React.ReactNode;
		},
	) => (
		<div
			key={props?.key}
			className={wallpaperTileClass(isSelected)}
			aria-label={props?.ariaLabel}
			title={props?.title}
			onClick={props?.onClick}
			role="button"
		>
			<div className="absolute inset-[1px] overflow-hidden rounded-[8px] bg-[#0d0e11]">
				{isVideoWallpaperSource(wallpaperUrl) ? (
					<video
						src={wallpaperUrl}
						muted
						playsInline
						preload="metadata"
						className="h-full w-full select-none object-cover [transform:translateZ(0)]"
						draggable={false}
						onMouseEnter={(e) => e.currentTarget.play().catch((err) => console.warn("Hover play fail:", err))}
						onMouseLeave={(e) => { e.currentTarget.pause(); e.currentTarget.currentTime = 0; }}
					/>
				) : (
					<img
						src={wallpaperUrl}
						alt={
							props?.title ??
							props?.ariaLabel ??
							tSettings("background.wallpaperPreview", "Wallpaper preview")
						}
						className="h-full w-full select-none object-cover [transform:translateZ(0)]"
						draggable={false}
					/>
				)}
			</div>
			{props?.children}
		</div>
	);


	const handleDeleteClick = () => {
		if (selectedZoomId && onZoomDelete) {
			onZoomDelete(selectedZoomId);
		}
	};

	const handleTrimDeleteClick = () => {
		if (selectedTrimId && onTrimDelete) {
			onTrimDelete(selectedTrimId);
		}
	};

	const handleClipDeleteClick = () => {
		if (selectedClipId && onClipDelete) {
			onClipDelete(selectedClipId);
		}
	};

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
	};

	const resetZoomSection = () => {
		onZoomMotionBlurChange?.(initialEditorPreferences.zoomMotionBlur);
	};

	const resetCursorSection = () => {
		onShowCursorChange?.(initialEditorPreferences.showCursor);
		onLoopCursorChange?.(initialEditorPreferences.loopCursor);
		onCursorStyleChange?.(initialEditorPreferences.cursorStyle);
		onCursorSizeChange?.(initialEditorPreferences.cursorSize);
		onCursorSmoothingChange?.(initialEditorPreferences.cursorSmoothing);
		onCursorMotionBlurChange?.(initialEditorPreferences.cursorMotionBlur);
		onCursorClickBounceChange?.(initialEditorPreferences.cursorClickBounce);
		onCursorClickBounceDurationChange?.(DEFAULT_CURSOR_CLICK_BOUNCE_DURATION);
		onCursorSwayChange?.(initialEditorPreferences.cursorSway);
	};

	const resetFrameSection = () => {
		onShadowChange?.(initialEditorPreferences.shadowIntensity);
		onBorderRadiusChange?.(initialEditorPreferences.borderRadius);
		onPaddingChange?.(initialEditorPreferences.padding);
		onAspectRatioChange?.(initialEditorPreferences.aspectRatio);
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
			toast.error(t("common.failedToUploadImage"), {
				description: t("common.errorReadingFile"),
			});
		};

		reader.readAsDataURL(file);
		// Reset input so the same file can be selected again
		event.target.value = "";
	};

	const handleVideoUpload = async () => {
		try {
			const result = await (window as any).electronAPI.openVideoFilePicker();
			if (!result?.success || !result.path) return;
			const filePath = result.path as string;
			if (!isVideoWallpaperSource(filePath)) {
				toast.error("Unsupported format", { description: "Please select a video file (mp4, webm, mov, etc.)" });
				return;
			}
			setCustomImages((prev) => [filePath, ...prev]);
			onWallpaperChange(filePath);
			toast.success("Video background added");
		} catch {
			toast.error("Failed to import video background");
		}
	};

	const handleRemoveCustomImage = (imageUrl: string, event: React.MouseEvent) => {
		event.stopPropagation();
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
		<div className="space-y-4">
			<section className="flex flex-col gap-2">
				<div className="flex items-center justify-between gap-3">
					<SectionLabel>{tSettings("background.title")}</SectionLabel>
					<button
						type="button"
						onClick={resetBackgroundSection}
						className="text-[10px] text-[#2563EB] transition-opacity hover:opacity-80"
					>
						{t("common.actions.reset", "Reset")}
					</button>
				</div>
				<SliderControl
					label={tSettings("effects.backgroundBlur")}
					value={backgroundBlur}
					defaultValue={initialEditorPreferences.backgroundBlur}
					min={0}
					max={8}
					step={0.25}
					onChange={(v) => onBackgroundBlurChange?.(v)}
					formatValue={(v) => `${v.toFixed(1)}px`}
					parseInput={(text) => parseFloat(text.replace(/px$/, ""))}
				/>
			</section>

			<div className="w-full">
				<LayoutGroup id="background-picker-switcher">
					<div className="grid h-8 w-full grid-cols-4 rounded-xl border border-white/10 bg-white/[0.04] p-1">
						{(
							[
								{ value: "image", label: tSettings("background.image") },
								{ value: "video", label: tSettings("background.video", "Video") },
								{ value: "color", label: tSettings("background.color") },
								{ value: "gradient", label: tSettings("background.gradient") },
							] as const
						).map((option) => {
							const isActive = backgroundTab === option.value;
							return (
								<button
									key={option.value}
									type="button"
									onClick={() => setBackgroundTab(option.value)}
									className="relative rounded-lg text-[10px] font-semibold tracking-wide transition-colors"
								>
									{isActive ? (
										<motion.span
											layoutId="background-picker-pill"
											className="absolute inset-0 rounded-lg bg-[#2563EB]"
											transition={{ type: "spring", stiffness: 420, damping: 34 }}
										/>
									) : null}
									<span
										className={cn(
											"relative z-10",
											isActive ? "text-white" : "text-slate-400 hover:text-slate-200",
										)}
									>
										{option.label}
									</span>
								</button>
							);
						})}
					</div>
				</LayoutGroup>

				<div className="pt-2">
					<AnimatePresence mode="wait" initial={false}>
						<motion.div
							key={backgroundTab}
							initial={{ opacity: 0, y: 10, filter: "blur(8px)" }}
							animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
							exit={{ opacity: 0, y: -8, filter: "blur(6px)" }}
							transition={{ duration: 0.2, ease: "easeOut" }}
						>
							{backgroundTab === "image" ? (
								<div className="mt-0 space-y-2">
									<input
										type="file"
										ref={fileInputRef}
										onChange={handleImageUpload}
										accept=".jpg,.jpeg,image/jpeg"
										className="hidden"
									/>
									<Button
										onClick={() => fileInputRef.current?.click()}
										variant="outline"
										className="w-full gap-2 bg-white/5 text-slate-200 border-white/10 hover:bg-[#2563EB] hover:text-white hover:border-[#2563EB] transition-all h-7 text-[10px]"
									>
										<Upload className="w-3 h-3" />
										{tSettings("background.uploadCustom")}
									</Button>

									<div className="grid grid-cols-8 gap-1.5">
										{customImages.map((imageUrl, idx) => {
											const isSelected = getWallpaperTileState(imageUrl);
											return renderWallpaperImageTile(imageUrl, isSelected, {
												key: `custom-${idx}`,
												ariaLabel: isVideoWallpaperSource(imageUrl)
													? imageUrl.split(/[\\/]/).pop() ?? tSettings("background.video", "Video background")
													: undefined,
												title: isVideoWallpaperSource(imageUrl)
													? imageUrl.split(/[\\/]/).pop()
													: undefined,
												onClick: () => onWallpaperChange(imageUrl),
												children: (
													<button
														onClick={(e) => handleRemoveCustomImage(imageUrl, e)}
														className="absolute top-0.5 right-0.5 w-3 h-3 bg-red-500/90 hover:bg-red-500 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-10"
													>
														<X className="w-2 h-2 text-white" />
													</button>
												),
											});
										})}

										{(wallpaperPreviewPaths.length > 0
											? wallpaperPreviewPaths
											: builtInWallpaperPaths
										).filter(p => !isVideoWallpaperSource(p)).map((previewPath, filteredIndex) => {
											const imageWallpapers = builtInWallpapers.filter(w => !isVideoWallpaperSource(w.publicPath));
											const wallpaper = imageWallpapers[filteredIndex];
											const wallpaperValue =
												wallpaper?.publicPath ?? previewPath;
											const isSelected = getWallpaperTileState(wallpaperValue, previewPath);
											return renderWallpaperImageTile(previewPath, isSelected, {
												key: wallpaperValue,
												ariaLabel: wallpaper?.label ?? `Wallpaper ${filteredIndex + 1}`,
												title: wallpaper?.label ?? `Wallpaper ${filteredIndex + 1}`,
												onClick: () => onWallpaperChange(wallpaperValue),
											});
										})}
									</div>
								</div>
							) : backgroundTab === "video" ? (
								<div className="mt-0 space-y-2">
									<Button
										onClick={handleVideoUpload}
										variant="outline"
										className="w-full gap-2 bg-white/5 text-slate-200 border-white/10 hover:bg-[#2563EB] hover:text-white hover:border-[#2563EB] transition-all h-7 text-[10px]"
									>
										<Upload className="w-3 h-3" />
										{tSettings("background.uploadCustomVideo", "Upload Video")}
									</Button>

									<div className="grid grid-cols-8 gap-1.5">
										{customImages.filter(isVideoWallpaperSource).map((videoUrl, idx) => {
											const isSelected = getWallpaperTileState(videoUrl);
											return renderWallpaperImageTile(videoUrl, isSelected, {
												key: `custom-video-${idx}`,
												ariaLabel: videoUrl.split(/[\\/]/).pop() ?? "Video background",
												title: videoUrl.split(/[\\/]/).pop(),
												onClick: () => onWallpaperChange(videoUrl),
												children: (
													<button
														onClick={(e) => handleRemoveCustomImage(videoUrl, e)}
														className="absolute top-0.5 right-0.5 w-3 h-3 bg-red-500/90 hover:bg-red-500 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-10"
													>
														<X className="w-2 h-2 text-white" />
													</button>
												),
											});
										})}

										{BUILT_IN_WALLPAPERS.filter(w => isVideoWallpaperSource(w.publicPath)).map((wallpaper) => {
											const wallpaperValue = wallpaper.publicPath;
											const isSelected = selected === wallpaperValue;
											return renderWallpaperImageTile(wallpaperValue, isSelected, {
												key: wallpaperValue,
												ariaLabel: wallpaper.label,
												title: wallpaper.label,
												onClick: () => onWallpaperChange(wallpaperValue),
											});
										})}
									</div>
								</div>
							) : backgroundTab === "color" ? (
								<div className="mt-0 space-y-2">
									<input
										ref={customColorInputRef}
										type="color"
										value={selectedColor}
										onChange={(event) => {
											setSelectedColor(event.target.value);
											onWallpaperChange(event.target.value);
										}}
										className="sr-only"
									/>
									<div className="grid grid-cols-8 gap-1.5">
										{visibleColorPalette.map((color) => {
											const isSelected = selected.toLowerCase() === color.toLowerCase();
											return (
												<button
													key={color}
													type="button"
													onClick={() => {
														setSelectedColor(color);
														onWallpaperChange(color);
													}}
													className={wallpaperTileClass(isSelected)}
													style={{ background: color }}
													aria-label={`Color ${color}`}
												/>
											);
										})}
										<button
											type="button"
											onClick={() => customColorInputRef.current?.click()}
											className={wallpaperTileClass(
												isHexWallpaper(selected) &&
													!visibleColorPalette.some(
														(color) => color.toLowerCase() === selected.toLowerCase(),
													),
											)}
											style={{
												background: `linear-gradient(135deg, ${selectedColor} 0%, ${selectedColor} 58%, rgba(255,255,255,0.92) 58%, rgba(255,255,255,0.92) 100%)`,
											}}
											aria-label="Custom color picker"
										>
											<div className="absolute inset-0 flex items-center justify-center text-[9px] font-semibold uppercase tracking-[0.18em] text-white/90">
												Pick
											</div>
										</button>
									</div>
								</div>
							) : (
								<div className="mt-0 grid grid-cols-8 gap-1.5">
									{GRADIENTS.map((g, idx) => (
										<div
											key={g}
											className={wallpaperTileClass(gradient === g)}
											style={{ background: g }}
											aria-label={`Gradient ${idx + 1}`}
											onClick={() => {
												setGradient(g);
												onWallpaperChange(g);
											}}
											role="button"
										/>
									))}
								</div>
							)}
						</motion.div>
					</AnimatePresence>
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
				onContentChange={(content) => onAnnotationContentChange?.(selectedAnnotation.id, content)}
				onTypeChange={(type) => onAnnotationTypeChange?.(selectedAnnotation.id, type)}
				onStyleChange={(style) => onAnnotationStyleChange?.(selectedAnnotation.id, style)}
				onFigureDataChange={
					onAnnotationFigureDataChange
						? (figureData) => onAnnotationFigureDataChange(selectedAnnotation.id, figureData)
						: undefined
				}
				onBlurIntensityChange={
					onAnnotationBlurIntensityChange
						? (intensity) => onAnnotationBlurIntensityChange(selectedAnnotation.id, intensity)
						: undefined
				}
				onDelete={() => onAnnotationDelete?.(selectedAnnotation.id)}
			/>
		);
	}

	if (isBackgroundPanel) {
		return (
			<div className="flex-[2] w-[332px] min-w-[280px] max-w-[332px] bg-[#161619] border border-white/10 rounded-2xl flex flex-col shadow-xl h-full overflow-hidden">
				<div className="flex-1 overflow-y-auto custom-scrollbar p-4">
					<div className="mb-4 flex items-center gap-2">
						<Palette className="w-4 h-4 text-[#2563EB]" />
						<span className="text-sm font-medium text-slate-200">
							{tSettings("background.title")}
						</span>
					</div>
					{backgroundSettingsContent}
				</div>
			</div>
		);
	}

	const zoomSectionContent = (
		<section className="flex flex-col gap-2">
			<div className="flex items-center justify-between gap-3">
				<div className="flex items-center gap-3">
					<SectionLabel>{tSettings("sections.zoom", "Zoom")}</SectionLabel>
					<button
						type="button"
						onClick={resetZoomSection}
						className="text-[10px] text-[#2563EB] transition-opacity hover:opacity-80"
					>
						{t("common.actions.reset", "Reset")}
					</button>
				</div>
			</div>
			<SliderControl
				label={tSettings("effects.zoomMotionBlur")}
				value={zoomMotionBlur}
				defaultValue={DEFAULT_ZOOM_MOTION_BLUR}
				min={0}
				max={2}
				step={0.05}
				onChange={(v) => onZoomMotionBlurChange?.(v)}
				formatValue={(v) => `${v.toFixed(2)}×`}
				parseInput={(text) => parseFloat(text.replace(/×$/, ""))}
			/>
		</section>
	);

	const frameSectionContent = (
		<section className="flex flex-col gap-2">
			<div className="flex items-center justify-between gap-3">
				<SectionLabel>{tSettings("sections.frame", "Frame")}</SectionLabel>
				<button
					type="button"
					onClick={resetFrameSection}
					className="text-[10px] text-[#2563EB] transition-opacity hover:opacity-80"
				>
					{t("common.actions.reset", "Reset")}
				</button>
			</div>
			<div className="flex flex-col gap-1.5">
				<SliderControl
					label={tSettings("effects.shadow")}
					value={shadowIntensity}
					defaultValue={initialEditorPreferences.shadowIntensity}
					min={0}
					max={1}
					step={0.01}
					onChange={(v) => onShadowChange?.(v)}
					formatValue={(v) => `${Math.round(v * 100)}%`}
					parseInput={(text) => parseFloat(text.replace(/%$/, "")) / 100}
				/>
				<SliderControl
					label={tSettings("effects.radius", "Radius")}
					value={borderRadius}
					defaultValue={initialEditorPreferences.borderRadius}
					min={0}
					max={50}
					step={0.5}
					onChange={(v) => onBorderRadiusChange?.(v)}
					formatValue={(v) => `${v}px`}
					parseInput={(text) => parseFloat(text.replace(/px$/, ""))}
				/>
				<SliderControl
					label={tSettings("effects.padding")}
					value={padding}
					defaultValue={initialEditorPreferences.padding}
					min={0}
					max={100}
					step={1}
					onChange={(v) => onPaddingChange?.(v)}
					formatValue={(v) => `${v}%`}
					parseInput={(text) => parseFloat(text.replace(/%$/, ""))}
				/>
				<div className="flex items-center justify-between rounded-lg bg-white/[0.03] px-2.5 py-1.5">
					<span className="text-[10px] text-slate-400">
						{tSettings("effects.removeBackground")}
					</span>
					<Switch
						checked={removeBackgroundEnabled}
						onCheckedChange={handleRemoveBackgroundToggle}
						className="data-[state=checked]:bg-[#2563EB] scale-75"
					/>
				</div>
			</div>
		</section>
	);

	const cropSectionContent = (
		<section className="flex flex-col gap-2">
			<div className="flex items-center justify-between gap-3">
				<SectionLabel>{tSettings("sections.crop", "Crop")}</SectionLabel>
				{isCropped ? (
					<button
						type="button"
						onClick={resetCropSection}
						className="text-[10px] text-[#2563EB] transition-opacity hover:opacity-80"
					>
						{t("common.actions.reset", "Reset")}
					</button>
				) : null}
			</div>
			<div className="flex flex-col gap-1.5">
				<SliderControl
					label={tSettings("crop.top", "Top")}
					value={cropTop}
					defaultValue={0}
					min={0}
					max={50}
					step={1}
					onChange={(v) => setCropInset("top", v)}
					formatValue={(v) => `${Math.round(v)}%`}
					parseInput={(text) => parseFloat(text.replace(/%$/, ""))}
				/>
				<SliderControl
					label={tSettings("crop.bottom", "Bottom")}
					value={cropBottom}
					defaultValue={0}
					min={0}
					max={50}
					step={1}
					onChange={(v) => setCropInset("bottom", v)}
					formatValue={(v) => `${Math.round(v)}%`}
					parseInput={(text) => parseFloat(text.replace(/%$/, ""))}
				/>
				<SliderControl
					label={tSettings("crop.left", "Left")}
					value={cropLeft}
					defaultValue={0}
					min={0}
					max={50}
					step={1}
					onChange={(v) => setCropInset("left", v)}
					formatValue={(v) => `${Math.round(v)}%`}
					parseInput={(text) => parseFloat(text.replace(/%$/, ""))}
				/>
				<SliderControl
					label={tSettings("crop.right", "Right")}
					value={cropRight}
					defaultValue={0}
					min={0}
					max={50}
					step={1}
					onChange={(v) => setCropInset("right", v)}
					formatValue={(v) => `${Math.round(v)}%`}
					parseInput={(text) => parseFloat(text.replace(/%$/, ""))}
				/>
			</div>
		</section>
	);

	const captionsSectionContent = (
		<section className="flex flex-col gap-2">
			<div className="flex items-center justify-between gap-3">
				<div className="flex items-center gap-3">
					<SectionLabel>{tSettings("sections.captions", "Captions")}</SectionLabel>
					<button
						type="button"
						onClick={() => onAutoCaptionSettingsChange?.(DEFAULT_AUTO_CAPTION_SETTINGS)}
						className="text-[10px] text-[#2563EB] transition-opacity hover:opacity-80"
					>
						{t("common.actions.reset", "Reset")}
					</button>
				</div>
				<div className="flex items-center gap-2 text-[10px] text-slate-400">
					<span>{tSettings("captions.enabled", "Show")}</span>
					<Switch
						checked={autoCaptionSettings.enabled}
						onCheckedChange={(enabled) => updateAutoCaptionSettings({ enabled })}
						className="data-[state=checked]:bg-[#2563EB] scale-75"
					/>
				</div>
			</div>

			<div className="rounded-lg bg-white/[0.03] px-2.5 py-2 space-y-3">
				<div>
					<Button
						type="button"
						variant="outline"
						onClick={onPickWhisperModel}
						className="h-10 w-full rounded-xl border-white/10 bg-white/5 px-4 text-sm text-slate-200 hover:bg-white/10 hover:text-white"
					>
						{tSettings("captions.selectModel", "Select Model")}
					</Button>
				</div>
				<div className="flex items-center justify-between gap-3">
					<div className="text-sm font-medium text-slate-200">
						{tSettings("captions.language", "Language")}
					</div>
					<Select
						value={autoCaptionSettings.language || "auto"}
						onValueChange={(value) => updateAutoCaptionSettings({ language: value })}
					>
						<SelectTrigger className="h-10 w-[180px] rounded-xl border-white/10 bg-white/5 text-sm text-slate-200 hover:bg-white/10">
							<SelectValue />
						</SelectTrigger>
						<SelectContent className="border-white/10 bg-[#1a1a1f] text-slate-200">
							{CAPTION_LANGUAGE_OPTIONS.map((option) => (
								<SelectItem key={option.value} value={option.value}>
									{option.label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
				<div className="flex flex-wrap items-center gap-2">
					<div className="grid w-full grid-cols-2 gap-2">
						{whisperModelDownloadStatus === "downloading" ? (
							<Button
								type="button"
								disabled
								className="h-10 w-full rounded-xl bg-white/10 px-4 text-sm font-medium text-slate-200 hover:bg-white/10"
							>
								{tSettings("captions.downloading", "Downloading...")}{" "}
								{Math.round(whisperModelDownloadProgress)}%
							</Button>
						) : whisperModelPath ? (
							<Button
								type="button"
								variant="outline"
								onClick={onDeleteWhisperSmallModel}
								className="h-10 w-full rounded-xl border-white/10 bg-white/5 px-4 text-sm text-slate-200 hover:bg-white/10 hover:text-white"
							>
								{tSettings("captions.deleteModel", "Delete Model")}
							</Button>
						) : (
							<Button
								type="button"
								onClick={onDownloadWhisperSmallModel}
								className="h-10 w-full rounded-xl bg-[#2563EB] px-4 text-sm font-medium text-white hover:bg-[#2563EB]/90"
							>
								{tSettings("captions.downloadModel", "Download Model")}
							</Button>
						)}
						<Button
							type="button"
							variant="outline"
							onClick={onClearAutoCaptions}
							disabled={captionCueCount === 0}
							className="h-10 w-full rounded-xl border-white/10 bg-white/5 px-4 text-sm text-slate-200 hover:bg-white/10 hover:text-white disabled:opacity-50"
						>
							{tSettings("captions.clearFull", "Clear Captions")}
						</Button>
					</div>
				</div>
				<div className="flex flex-col gap-2">
					<Button
						type="button"
						onClick={onGenerateAutoCaptions}
						disabled={isGeneratingCaptions || !whisperModelPath}
						className="h-10 w-full rounded-xl bg-[#2563EB] px-4 text-sm font-medium text-white hover:bg-[#2563EB]/90 disabled:opacity-60"
					>
						{isGeneratingCaptions
							? tSettings("captions.generating", "Generating...")
							: captionCueCount > 0
								? tSettings("captions.regenerateFull", "Regenerate Captions")
								: tSettings("captions.generateFull", "Generate Captions")}
					</Button>
					{isGeneratingCaptions ? (
						<div className="space-y-1">
							<div className="text-xs text-slate-400">
								{tSettings(
									"captions.generatingStatus",
									"Generating captions. This can take a moment.",
								)}
							</div>
							<div className="indeterminate-progress h-2 rounded-full bg-white/5" />
						</div>
					) : null}
				</div>
				{whisperModelDownloadStatus === "downloading" ? (
					<div className="h-2 overflow-hidden rounded-full bg-white/5">
						<div
							className="h-full rounded-full bg-[#2196f3] transition-all"
							style={{ width: `${whisperModelDownloadProgress}%` }}
						/>
					</div>
				) : null}
			</div>

			<div className="flex flex-col gap-1.5">
				<div className="flex items-center justify-between gap-3 rounded-lg bg-white/[0.03] px-2.5 py-2">
					<div className="text-[10px] text-slate-400">
						{tSettings("captions.animation", "Animation")}
					</div>
					<Select
						value={autoCaptionSettings.animationStyle}
						onValueChange={(value) =>
							updateAutoCaptionSettings({ animationStyle: value as AutoCaptionAnimation })
						}
					>
						<SelectTrigger className="h-9 w-[160px] rounded-xl border-white/10 bg-white/5 text-sm text-slate-200 hover:bg-white/10">
							<SelectValue />
						</SelectTrigger>
						<SelectContent className="border-white/10 bg-[#1a1a1f] text-slate-200">
							{CAPTION_ANIMATION_OPTIONS.map((option) => (
								<SelectItem key={option.value} value={option.value}>
									{option.label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
				<label className="flex items-center justify-between rounded-lg bg-white/[0.03] px-2.5 py-2">
					<span className="text-[10px] text-slate-400">
						{tSettings("captions.textColor", "Text color")}
					</span>
					<input
						type="color"
						value={autoCaptionSettings.textColor}
						onChange={(event) => updateAutoCaptionSettings({ textColor: event.target.value })}
						className="h-7 w-10 rounded border border-white/10 bg-transparent"
					/>
				</label>
				<div className="mb-1 text-sm font-medium text-slate-200">
					{tSettings("captions.fontSettings", "Font Settings")}
				</div>
				<SliderControl
					label={tSettings("captions.fontSize", "Font size")}
					value={autoCaptionSettings.fontSize}
					defaultValue={DEFAULT_AUTO_CAPTION_SETTINGS.fontSize}
					min={16}
					max={72}
					step={1}
					onChange={(value) => updateAutoCaptionSettings({ fontSize: value })}
					formatValue={(value) => `${Math.round(value)}px`}
					parseInput={(text) => parseFloat(text.replace(/px$/, ""))}
				/>
				<SliderControl
					label={tSettings("captions.rowCount", "Rows")}
					value={autoCaptionSettings.maxRows}
					defaultValue={DEFAULT_AUTO_CAPTION_SETTINGS.maxRows}
					min={1}
					max={4}
					step={1}
					onChange={(value) => updateAutoCaptionSettings({ maxRows: Math.round(value) })}
					formatValue={(value) => `${Math.round(value)}`}
					parseInput={(text) => parseFloat(text)}
				/>
				<SliderControl
					label={tSettings("captions.bottomOffset", "Bottom offset")}
					value={autoCaptionSettings.bottomOffset}
					defaultValue={DEFAULT_AUTO_CAPTION_SETTINGS.bottomOffset}
					min={0}
					max={30}
					step={1}
					onChange={(value) => updateAutoCaptionSettings({ bottomOffset: value })}
					formatValue={(value) => `${Math.round(value)}%`}
					parseInput={(text) => parseFloat(text.replace(/%$/, ""))}
				/>
				<SliderControl
					label={tSettings("captions.maxWidth", "Max width")}
					value={autoCaptionSettings.maxWidth}
					defaultValue={DEFAULT_AUTO_CAPTION_SETTINGS.maxWidth}
					min={40}
					max={95}
					step={1}
					onChange={(value) => updateAutoCaptionSettings({ maxWidth: value })}
					formatValue={(value) => `${Math.round(value)}%`}
					parseInput={(text) => parseFloat(text.replace(/%$/, ""))}
				/>
				<SliderControl
					label={tSettings("captions.boxRadius", "Box radius")}
					value={autoCaptionSettings.boxRadius}
					defaultValue={DEFAULT_AUTO_CAPTION_SETTINGS.boxRadius}
					min={0}
					max={40}
					step={0.5}
					onChange={(value) => updateAutoCaptionSettings({ boxRadius: value })}
					formatValue={(value) =>
						`${Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1)}px`
					}
					parseInput={(text) => parseFloat(text.replace(/px$/, ""))}
				/>
				<SliderControl
					label={tSettings("captions.backgroundOpacity", "Background opacity")}
					value={autoCaptionSettings.backgroundOpacity}
					defaultValue={DEFAULT_AUTO_CAPTION_SETTINGS.backgroundOpacity}
					min={0}
					max={1}
					step={0.01}
					onChange={(value) => updateAutoCaptionSettings({ backgroundOpacity: value })}
					formatValue={(value) => `${Math.round(value * 100)}%`}
					parseInput={(text) => parseFloat(text.replace(/%$/, "")) / 100}
				/>
			</div>
		</section>
	);

	const effectSectionContent = (() => {
		const sceneSectionContent = (
			<div className="space-y-4">
				{backgroundSettingsContent}
				{zoomSectionContent}
				{frameSectionContent}
				{cropSectionContent}
			</div>
		);

		switch (activeEffectSection) {
			case "scene":
				return sceneSectionContent;
			case "zoom":
				return sceneSectionContent;
			case "frame":
				return sceneSectionContent;
			case "crop":
				return sceneSectionContent;
			case "captions":
				return captionsSectionContent;
			case "cursor":
				return (
					<section className="flex flex-col gap-2">
						<div className="flex items-center justify-between gap-3">
							<div className="flex items-center gap-3">
								<SectionLabel>{tSettings("sections.cursor", "Cursor")}</SectionLabel>
								<button
									type="button"
									onClick={resetCursorSection}
									className="text-[10px] text-[#2563EB] transition-opacity hover:opacity-80"
								>
									{t("common.actions.reset", "Reset")}
								</button>
							</div>
							<div className="flex items-center gap-3">
								<label className="flex items-center gap-1.5 text-[10px] text-slate-400">
									<span>{tSettings("effects.showCursor")}</span>
									<Switch
										checked={showCursor}
										onCheckedChange={onShowCursorChange}
										className="data-[state=checked]:bg-[#2563EB] scale-75"
									/>
								</label>
								<label className="flex items-center gap-1.5 text-[10px] text-slate-400">
									<span>{tSettings("effects.loopCursor")}</span>
									<Switch
										checked={loopCursor}
										onCheckedChange={onLoopCursorChange}
										className="data-[state=checked]:bg-[#2563EB] scale-75"
									/>
								</label>
							</div>
						</div>
						<div className="flex flex-col gap-1.5">
							<div className="space-y-1.5">
								<ToggleGroup
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
									{CURSOR_STYLE_OPTIONS.map((option) => (
										<ToggleGroupItem
											key={option.value}
											value={option.value}
											title={option.label}
											aria-label={option.label}
											className={cn(
												"group aspect-square h-auto min-w-0 rounded-[10px] border border-white/10 bg-white/[0.03] p-3 text-left text-slate-200 shadow-none transition-all hover:border-white/20 hover:bg-white/[0.06]",
												"data-[state=on]:border-[#2563EB]/70 data-[state=on]:bg-[#2563EB]/12 data-[state=on]:text-white",
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
										</ToggleGroupItem>
									))}
								</ToggleGroup>
							</div>
							<SliderControl
								label={tSettings("effects.cursorSize")}
								value={cursorSize}
								defaultValue={DEFAULT_CURSOR_SIZE}
								min={0.5}
								max={10}
								step={0.05}
								onChange={(v) => onCursorSizeChange?.(v)}
								formatValue={(v) => `${v.toFixed(2)}×`}
								parseInput={(text) => parseFloat(text.replace(/×$/, ""))}
							/>
							<SliderControl
								label={tSettings("effects.cursorSmoothing")}
								value={cursorSmoothing}
								defaultValue={DEFAULT_CURSOR_SMOOTHING}
								min={0}
								max={2}
								step={0.01}
								onChange={(v) => onCursorSmoothingChange?.(v)}
								formatValue={(v) => (v <= 0 ? tSettings("effects.off") : v.toFixed(2))}
								parseInput={(text) => parseFloat(text)}
							/>
							<SliderControl
								label={tSettings("effects.cursorMotionBlur")}
								value={cursorMotionBlur}
								defaultValue={DEFAULT_CURSOR_MOTION_BLUR}
								min={0}
								max={2}
								step={0.05}
								onChange={(v) => onCursorMotionBlurChange?.(v)}
								formatValue={(v) => `${v.toFixed(2)}×`}
								parseInput={(text) => parseFloat(text.replace(/×$/, ""))}
							/>
							<SliderControl
								label={tSettings("effects.cursorClickBounce")}
								value={cursorClickBounce}
								defaultValue={DEFAULT_CURSOR_CLICK_BOUNCE}
								min={0}
								max={5}
								step={0.05}
								onChange={(v) => onCursorClickBounceChange?.(v)}
								formatValue={(v) => `${v.toFixed(2)}×`}
								parseInput={(text) => parseFloat(text.replace(/×$/, ""))}
							/>
							<SliderControl
								label={tSettings("effects.cursorClickBounceDuration", "Bounce Speed")}
								value={cursorClickBounceDuration}
								defaultValue={DEFAULT_CURSOR_CLICK_BOUNCE_DURATION}
								min={60}
								max={500}
								step={5}
								onChange={(v) => onCursorClickBounceDurationChange?.(v)}
								formatValue={(v) => `${Math.round(v)} ms`}
								parseInput={(text) => parseFloat(text.replace(/ms$/i, "").trim())}
							/>
							<SliderControl
								label={tSettings("effects.cursorSway")}
								value={toCursorSwaySliderValue(cursorSway)}
								defaultValue={toCursorSwaySliderValue(DEFAULT_CURSOR_SWAY)}
								min={0}
								max={toCursorSwaySliderValue(2)}
								step={toCursorSwaySliderValue(0.05)}
								onChange={(v) => onCursorSwayChange?.(fromCursorSwaySliderValue(v))}
								formatValue={(v) => (v <= 0 ? tSettings("effects.off") : `${v.toFixed(2)}×`)}
								parseInput={(text) => {
									const normalized = text.trim().toLowerCase();
									if (normalized === "off") return 0;
									return parseFloat(text.replace(/×$/, ""));
								}}
							/>
						</div>
					</section>
				);
			case "webcam":
				return (
					<section className="flex flex-col gap-2">
						<div className="flex items-center justify-between gap-3">
							<SectionLabel>{tSettings("sections.webcam", "Webcam")}</SectionLabel>
							<button
								type="button"
								onClick={resetWebcamSection}
								className="text-[10px] text-[#2563EB] transition-opacity hover:opacity-80"
							>
								{t("common.actions.reset", "Reset")}
							</button>
						</div>
						<div className="flex flex-col gap-1.5">
							<div className="flex items-center justify-between rounded-lg bg-white/[0.03] px-2.5 py-1.5">
								<span className="text-[10px] text-slate-400">
									{tSettings("effects.show", "Show")}
								</span>
								<Switch
									checked={webcam?.enabled ?? false}
									onCheckedChange={(enabled) => updateWebcam({ enabled })}
									className="data-[state=checked]:bg-[#2563EB] scale-75"
								/>
							</div>
							<div className="flex items-center justify-between rounded-lg bg-white/[0.03] px-2.5 py-1.5">
								<span className="text-[10px] text-slate-400">
									{tSettings("effects.webcamReactToZoom")}
								</span>
								<Switch
									checked={webcam?.reactToZoom ?? DEFAULT_WEBCAM_REACT_TO_ZOOM}
									onCheckedChange={(reactToZoom) => updateWebcam({ reactToZoom })}
									className="data-[state=checked]:bg-[#2563EB] scale-75"
								/>
							</div>
							<SliderControl
								label={tSettings("effects.webcamSize")}
								value={webcam?.size ?? DEFAULT_WEBCAM_SIZE}
								defaultValue={DEFAULT_WEBCAM_SIZE}
								min={10}
								max={100}
								step={1}
								onChange={(v) => updateWebcam({ size: v })}
								formatValue={(v) => `${Math.round(v)}%`}
								parseInput={(text) => parseFloat(text.replace(/%$/, ""))}
							/>
							<div className="rounded-lg bg-white/[0.03] px-2.5 py-2">
								<div className="mb-2 text-[10px] text-slate-400">
									{tSettings("effects.webcamPosition", "Position")}
								</div>
								<div className="grid grid-cols-3 gap-1.5">
									{WEBCAM_POSITION_PRESETS.map((option) => {
										const isActive = webcamPositionPreset === option.preset;
										return (
											<Button
												key={option.preset}
												type="button"
												onClick={() => applyWebcamPositionPreset(option.preset)}
												className={cn(
													"h-8 rounded-lg border px-0 text-sm font-semibold transition-all",
													isActive
														? "border-[#2563EB] bg-[#2563EB] text-white"
														: "border-white/10 bg-white/5 text-slate-300 hover:border-white/20 hover:bg-white/10",
												)}
											>
												{option.label}
											</Button>
										);
									})}
								</div>
								<div className="mt-2 flex items-center justify-between rounded-lg bg-black/10 px-2.5 py-1.5">
									<span className="text-[10px] text-slate-400">
										{tSettings("effects.webcamCustomPosition", "Custom position")}
									</span>
									<Switch
										checked={webcamPositionPreset === "custom"}
										onCheckedChange={(checked) =>
											applyWebcamPositionPreset(checked ? "custom" : DEFAULT_WEBCAM_POSITION_PRESET)
										}
										className="data-[state=checked]:bg-[#2563EB] scale-75"
									/>
								</div>
							</div>
							{webcamPositionPreset === "custom" ? (
								<>
									<SliderControl
										label={tSettings("effects.webcamHorizontal", "Horizontal")}
										value={webcamPositionX * 100}
										defaultValue={DEFAULT_WEBCAM_POSITION_X * 100}
										min={0}
										max={100}
										step={1}
										onChange={(v) => updateWebcam({ positionPreset: "custom", positionX: v / 100 })}
										formatValue={(v) => `${Math.round(v)}%`}
										parseInput={(text) => parseFloat(text.replace(/%$/, ""))}
									/>
									<SliderControl
										label={tSettings("effects.webcamVertical", "Vertical")}
										value={webcamPositionY * 100}
										defaultValue={DEFAULT_WEBCAM_POSITION_Y * 100}
										min={0}
										max={100}
										step={1}
										onChange={(v) => updateWebcam({ positionPreset: "custom", positionY: v / 100 })}
										formatValue={(v) => `${Math.round(v)}%`}
										parseInput={(text) => parseFloat(text.replace(/%$/, ""))}
									/>
								</>
							) : null}
							<SliderControl
								label={tSettings("effects.webcamMargin", "Margin")}
								value={webcam?.margin ?? DEFAULT_WEBCAM_MARGIN}
								defaultValue={DEFAULT_WEBCAM_MARGIN}
								min={0}
								max={96}
								step={1}
								onChange={(v) => updateWebcam({ margin: v })}
								formatValue={(v) => `${Math.round(v)}px`}
								parseInput={(text) => parseFloat(text.replace(/px$/, ""))}
							/>
							<SliderControl
								label={tSettings("effects.webcamRoundness")}
								value={webcam?.cornerRadius ?? DEFAULT_WEBCAM_CORNER_RADIUS}
								defaultValue={DEFAULT_WEBCAM_CORNER_RADIUS}
								min={0}
								max={160}
								step={1}
								onChange={(v) => updateWebcam({ cornerRadius: v })}
								formatValue={(v) => `${Math.round(v)}px`}
								parseInput={(text) => parseFloat(text.replace(/px$/, ""))}
							/>
							<SliderControl
								label={tSettings("effects.webcamShadow")}
								value={webcam?.shadow ?? DEFAULT_WEBCAM_SHADOW}
								defaultValue={DEFAULT_WEBCAM_SHADOW}
								min={0}
								max={1}
								step={0.01}
								onChange={(v) => updateWebcam({ shadow: v })}
								formatValue={(v) => `${Math.round(v * 100)}%`}
								parseInput={(text) => parseFloat(text.replace(/%$/, "")) / 100}
							/>
							<div className="rounded-lg bg-white/[0.03] px-2.5 py-2">
								<div className="flex items-center justify-between gap-2">
									<div>
										<div className="text-[10px] text-slate-300">
											{tSettings("effects.webcamFootage")}
										</div>
										<div className="mt-0.5 text-[10px] text-slate-500">
											{webcamFileName ?? tSettings("effects.webcamFootageDescription")}
										</div>
									</div>
									<div className="flex items-center gap-1.5">
										<Button
											type="button"
											variant="outline"
											onClick={onUploadWebcam}
											className="h-7 gap-1.5 border-white/10 bg-white/5 px-2 text-[10px] text-slate-200 hover:bg-white/10 hover:text-white"
										>
											<Upload className="h-3 w-3" />
											{webcam?.sourcePath
												? tSettings("effects.replaceWebcamFootage")
												: tSettings("effects.uploadWebcamFootage")}
										</Button>
										{webcam?.sourcePath ? (
											<Button
												type="button"
												variant="outline"
												onClick={onClearWebcam}
												className="h-7 gap-1.5 border-white/10 bg-white/5 px-2 text-[10px] text-slate-200 hover:bg-white/10 hover:text-white"
											>
												<Trash2 className="h-3 w-3" />
												{tSettings("effects.removeWebcamFootage")}
											</Button>
										) : null}
									</div>
								</div>
							</div>
						</div>
					</section>
				);
		}
	})();

	return (
		<div className="flex-[2] w-[332px] min-w-[280px] max-w-[332px] bg-[#161619] border border-white/10 rounded-2xl flex flex-col shadow-xl h-full overflow-hidden">
			<div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-4 pb-0" style={{ scrollbarGutter: 'stable' }}>
				<AnimatePresence mode="wait" initial={false}>
					<motion.div
						key={activeEffectSection}
						initial={{ opacity: 0, y: 8 }}
						animate={{ opacity: 1, y: 0 }}
						exit={{ opacity: 0, y: -8 }}
						transition={{ duration: 0.18, ease: "easeOut" }}
					>
						{effectSectionContent}
					</motion.div>
				</AnimatePresence>
			</div>

			<div className={cn(
				"flex-shrink-0 border-t border-white/10 bg-[#151518] p-4 pt-3",
				!selectedZoomId && !selectedTrimId && !selectedSpeedId && !selectedClipId && "hidden"
			)}>
				{selectedZoomId && (
					<div className="mb-4">
						<div className="mb-3 flex items-center justify-between">
							<span className="text-sm font-medium text-slate-200">{tSettings("zoom.level")}</span>
							<div className="flex items-center gap-2">
								{selectedZoomDepth && (
									<span className="rounded-full bg-[#2563EB]/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-[#2563EB]">
										{ZOOM_DEPTH_OPTIONS.find((o) => o.depth === selectedZoomDepth)?.label}
									</span>
								)}
							</div>
						</div>
						<div className="grid grid-cols-6 gap-1.5">
							{ZOOM_DEPTH_OPTIONS.map((option) => {
								const isActive = selectedZoomDepth === option.depth;
								return (
									<Button
										key={option.depth}
										type="button"
										onClick={() => onZoomDepthChange?.(option.depth)}
										className={cn(
											"h-auto w-full rounded-lg border px-1 py-2 text-center shadow-sm transition-all duration-200 ease-out cursor-pointer",
											isActive
												? "border-[#2563EB] bg-[#2563EB] text-white"
												: "border-white/5 bg-white/5 text-slate-400 hover:bg-white/10 hover:border-white/10 hover:text-slate-200",
										)}
									>
										<span className="text-xs font-semibold">{option.label}</span>
									</Button>
								);
							})}
						</div>
						<Button
							onClick={handleDeleteClick}
							variant="destructive"
							size="sm"
							className="mt-2 h-8 w-full gap-2 border border-red-500/20 bg-red-500/10 text-xs text-red-400 transition-all hover:border-red-500/30 hover:bg-red-500/20"
						>
							<Trash2 className="h-3 w-3" />
							{tSettings("zoom.deleteZoom")}
						</Button>
					</div>
				)}

				{selectedTrimId && !selectedZoomId && (
					<div className="mb-4">
						<Button
							onClick={handleTrimDeleteClick}
							variant="destructive"
							size="sm"
							className="mt-2 h-8 w-full gap-2 border border-red-500/20 bg-red-500/10 text-xs text-red-400 transition-all hover:border-red-500/30 hover:bg-red-500/20"
						>
							<Trash2 className="h-3 w-3" />
							{tSettings("trim.deleteRegion")}
						</Button>
					</div>
				)}

				{selectedSpeedId && (
					<div>
						<div className="mb-3 flex items-center justify-between">
							<span className="text-sm font-medium text-slate-200">
								{tSettings("speed.playbackSpeed")}
							</span>
							{selectedSpeedValue && (
								<span className="rounded-full bg-[#d97706]/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-[#d97706]">
									{SPEED_OPTIONS.find((o) => o.speed === selectedSpeedValue)?.label ??
										`${selectedSpeedValue}×`}
								</span>
							)}
						</div>
						<div className="grid grid-cols-7 gap-1.5">
							{SPEED_OPTIONS.map((option) => {
								const isActive = selectedSpeedValue === option.speed;
								return (
									<Button
										key={option.speed}
										type="button"
										onClick={() => onSpeedChange?.(option.speed)}
										className={cn(
											"h-auto w-full rounded-lg border px-1 py-2 text-center shadow-sm transition-all duration-200 ease-out cursor-pointer",
											isActive
												? "border-[#d97706] bg-[#d97706] text-white"
												: "border-white/5 bg-white/5 text-slate-400 hover:bg-white/10 hover:border-white/10 hover:text-slate-200",
										)}
									>
										<span className="text-xs font-semibold">{option.label}</span>
									</Button>
								);
							})}
						</div>
						<Button
							onClick={() => selectedSpeedId && onSpeedDelete?.(selectedSpeedId)}
							variant="destructive"
							size="sm"
							className="mt-2 h-8 w-full gap-2 border border-red-500/20 bg-red-500/10 text-xs text-red-400 transition-all hover:border-red-500/30 hover:bg-red-500/20"
						>
							<Trash2 className="h-3 w-3" />
							{tSettings("speed.deleteRegion")}
						</Button>
					</div>
				)}

				{selectedClipId && (
					<div className="mb-4">
						<div className="mb-3 flex items-center justify-between">
							<span className="text-sm font-medium text-slate-200">Clip Speed</span>
							{selectedClipSpeed != null && selectedClipSpeed !== 1 && (
								<span className="rounded-full bg-[#06b6d4]/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-[#06b6d4]">
									{selectedClipSpeed}×
								</span>
							)}
						</div>
						<div className="grid grid-cols-8 gap-1.5">
							{[
								{ speed: 0.25, label: "0.25×" },
								{ speed: 0.5, label: "0.5×" },
								{ speed: 0.75, label: "0.75×" },
								{ speed: 1, label: "1×" },
								{ speed: 1.25, label: "1.25×" },
								{ speed: 1.5, label: "1.5×" },
								{ speed: 1.75, label: "1.75×" },
								{ speed: 2, label: "2×" },
							].map((option) => {
								const isActive = selectedClipSpeed === option.speed;
								return (
									<Button
										key={option.speed}
										type="button"
										onClick={() => onClipSpeedChange?.(option.speed)}
										className={cn(
											"h-auto w-full rounded-lg border px-0.5 py-2 text-center shadow-sm transition-all duration-200 ease-out cursor-pointer",
											isActive
												? "border-[#06b6d4] bg-[#06b6d4] text-white"
												: "border-white/5 bg-white/5 text-slate-400 hover:bg-white/10 hover:border-white/10 hover:text-slate-200",
										)}
									>
										<span className="text-[10px] font-semibold">{option.label}</span>
									</Button>
								);
							})}
						</div>
						<Button
							onClick={handleClipDeleteClick}
							variant="destructive"
							size="sm"
							className="mt-2 h-8 w-full gap-2 border border-red-500/20 bg-red-500/10 text-xs text-red-400 transition-all hover:border-red-500/30 hover:bg-red-500/20"
						>
							<Trash2 className="h-3 w-3" />
							Delete Clip
						</Button>
					</div>
				)}
			</div>
		</div>

	);
}
