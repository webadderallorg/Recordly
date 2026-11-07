import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "@/components/ui/toast";
import {
	DEFAULT_EDITOR_PREFERENCES,
	loadEditorPreferences,
	saveEditorPreferences,
} from "@/components/video-editor/editorPreferences";
import { useWallpaperPreviews } from "@/components/video-editor/useWallpaperPreviews";
import { peekWallpaperThumbnailUrl } from "@/lib/assetPath";
import { cn } from "@/lib/utils";
import { DESKTOP_WALLPAPER } from "@/lib/desktopWallpaper";
import {
	BUILT_IN_WALLPAPERS,
	DEFAULT_WALLPAPER_PATH,
	isVideoWallpaperSource,
} from "@/lib/wallpapers";
import { prepareWallpaperImage, wallpaperUploadKind } from "@/lib/wallpaperUpload";

import {
	type BackgroundTab,
	GRADIENTS,
	getBackgroundTabForWallpaper,
	isHexWallpaper,
	type WallpaperTile,
} from "./backgroundPresets";
import type { ResolvedSettingsPanelProps } from "./settingsPanelDefaults";
import { useSettingsTranslations } from "./useSettingsTranslations";

export const backgroundSettingsKeys = [
	"selected",
	"onWallpaperChange",
	"onBackgroundBlurChange",
] as const;
export function useBackgroundSettings(
	props: Pick<ResolvedSettingsPanelProps, (typeof backgroundSettingsKeys)[number]>,
	initialEditorPreferences: ReturnType<typeof loadEditorPreferences>,
	enabled: boolean,
) {
	const { selected, onWallpaperChange, onBackgroundBlurChange } = props;
	const { te, tSettings } = useSettingsTranslations();
	const { wallpapers: builtInWallpapers, previews: wallpaperPreviewPaths } =
		useWallpaperPreviews(enabled);
	const [customImages, setCustomImages] = useState<string[]>(
		initialEditorPreferences.customWallpapers,
	);
	const fileInputRef = useRef<HTMLInputElement>(null);
	const builtInWallpaperPaths = useMemo(
		() => builtInWallpapers.map((wallpaper) => wallpaper.publicPath),
		[builtInWallpapers],
	);
	const [backgroundTab, setBackgroundTab] = useState<BackgroundTab>(() =>
		getBackgroundTabForWallpaper(selected),
	);
	useEffect(() => {
		setBackgroundTab(getBackgroundTabForWallpaper(selected));
	}, [selected]);

	useEffect(() => {
		if (selected.startsWith("data:image")) {
			setCustomImages((prev) => (prev.includes(selected) ? prev : [selected, ...prev]));
			return;
		}

		const isKnownWallpaper =
			builtInWallpaperPaths.includes(selected) ||
			Object.values(wallpaperPreviewPaths).includes(selected);

		if (!isKnownWallpaper && isVideoWallpaperSource(selected)) {
			setCustomImages((prev) => (prev.includes(selected) ? prev : [selected, ...prev]));
		}
	}, [builtInWallpaperPaths, selected, wallpaperPreviewPaths]);

	const imageWallpaperTiles = useMemo<WallpaperTile[]>(() => {
		const images = builtInWallpapers
			.filter((wallpaper) => !isVideoWallpaperSource(wallpaper.publicPath))
			.map((wallpaper) => ({
				key: `builtin/${wallpaper.id}`,
				label: wallpaper.label,
				value: wallpaper.publicPath,
				previewUrl:
					wallpaperPreviewPaths[wallpaper.publicPath] ??
					peekWallpaperThumbnailUrl(wallpaper.publicPath) ??
					"",
			}));
		const desktopKey = `builtin/${DESKTOP_WALLPAPER}`;
		const desktop = images.find((wallpaper) => wallpaper.key === desktopKey);
		return [
			{
				...(desktop ?? {
					key: desktopKey,
					label: te("desktopWallpaper", "Desktop wallpaper"),
					value: DESKTOP_WALLPAPER,
					previewUrl: "",
					disabled: true,
				}),
				badge: te("desktop", "Desktop"),
			},
			...images.filter((wallpaper) => wallpaper.key !== desktopKey),
		];
	}, [builtInWallpapers, wallpaperPreviewPaths, te]);

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
	const resetBackgroundSection = () => {
		onBackgroundBlurChange?.(DEFAULT_EDITOR_PREFERENCES.backgroundBlur);

		const preferredWallpaper = DEFAULT_EDITOR_PREFERENCES.wallpaper;
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
	const handleImageUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
		const file = event.target.files?.[0];
		event.target.value = "";
		if (!file) return;
		try {
			const kind = wallpaperUploadKind(file);
			if (!kind) throw new Error("Unsupported wallpaper");
			if (kind === "video") {
				const result = await window.electronAPI.importWallpaperVideo(file);
				if (!result.success || !result.path) throw new Error("Unreadable video");
				const filePath = result.path;
				setCustomImages((prev) => (prev.includes(filePath) ? prev : [filePath, ...prev]));
				onWallpaperChange(filePath);
				toast.success(te("videoBackgroundAdded", "Video background added"));
				return;
			}
			const dataUrl = await prepareWallpaperImage(file);
			setCustomImages((prev) => (prev.includes(dataUrl) ? prev : [...prev, dataUrl]));
			onWallpaperChange(dataUrl);
			toast.success(tSettings("background.uploadSuccess"));
		} catch {
			toast.error(tSettings("background.wallpaperImportError", "Could not add wallpaper"), {
				description: tSettings(
					"background.unsupportedWallpaper",
					"Could not open this wallpaper. Try JPEG, PNG, WebP, AVIF, GIF, SVG, BMP, HEIC/HEIF, or a supported video such as MP4 or WebM.",
				),
			});
		}
	};

	const handleVideoUpload = async () => {
		try {
			const result = await window.electronAPI.openVideoFilePicker();
			if (!result?.success || !result.path) return;
			const filePath = result.path;
			if (!isVideoWallpaperSource(filePath)) {
				toast.error(te("unsupportedFormat", "Unsupported format"), {
					description: te(
						"selectVideoFile",
						"Please select a video file (mp4, webm, mov, etc.)",
					),
				});
				return;
			}
			setCustomImages((prev) => (prev.includes(filePath) ? prev : [filePath, ...prev]));
			onWallpaperChange(filePath);
			toast.success(te("videoBackgroundAdded", "Video background added"));
		} catch {
			toast.error(te("videoBackgroundImportFailed", "Failed to import video background"));
		}
	};

	const handleRemoveCustomImage = (imageUrl: string) => {
		setCustomImages((prev) => prev.filter((img) => img !== imageUrl));
		// If the removed image was selected, clear selection
		if (selected === imageUrl) {
			onWallpaperChange(
				builtInWallpapers.find((wallpaper) => wallpaper.id === DESKTOP_WALLPAPER)
					?.publicPath ?? DEFAULT_WALLPAPER_PATH,
			);
		}
	};

	return {
		backgroundTab,
		setBackgroundTab,
		fileInputRef,
		handleImageUpload,
		handleVideoUpload,
		handleRemoveCustomImage,
		getWallpaperTileState,
		customImages,
		imageWallpaperTiles,
		videoWallpaperTiles,
		selected,
		wallpaperTileClass,
		resetBackgroundSection,
	};
}
