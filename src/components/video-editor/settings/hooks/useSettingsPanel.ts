import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
	getAssetPath,
	getRenderableAssetUrl,
	getRenderableVideoUrl,
	getWallpaperThumbnailUrl,
} from "@/lib/assetPath";
import { extensionHost, type FrameInstance } from "@/lib/extensions";
import type { BuiltInWallpaper } from "@/lib/wallpapers";
import {
	BUILT_IN_WALLPAPERS,
	getAvailableWallpapers,
	isVideoWallpaperSource,
} from "@/lib/wallpapers";
import { loadEditorPreferences as loadEditorPreferencesFn, saveEditorPreferences as saveEditorPreferencesFn } from "../../editorPreferences";
import type { CursorStyle } from "../../types";

export type BackgroundTab = "image" | "video" | "color" | "gradient";
export type CursorStyleOption = { value: CursorStyle; label: string };
export type WallpaperTile = { key: string; label: string; value: string; previewUrl: string };

function isHexWallpaper(value: string): boolean {
	return /^#(?:[0-9a-f]{3}){1,2}$/i.test(value);
}

function getBackgroundTabForWallpaper(value: string, gradients: readonly string[]): BackgroundTab {
	if (gradients.some((gradient) => gradient === value)) return "gradient";
	if (isHexWallpaper(value)) return "color";
	if (isVideoWallpaperSource(value)) return "video";
	return "image";
}

type UseSettingsPanelArgs = {
	selected: string;
	onWallpaperChange: (path: string) => void;
	loadEditorPreferences: typeof loadEditorPreferencesFn;
	saveEditorPreferences: typeof saveEditorPreferencesFn;
	tSettings: (key: string, fallback?: string) => string;
	t: (key: string, fallback?: string) => string;
	gradients: readonly string[];
	builtInCursorStyleOptions: CursorStyleOption[];
	createTrimmedSvgPreview: (url: string, sampleSize: number) => Promise<string>;
	createInvertedPreview: (url: string) => Promise<string>;
	minimalCursorUrl: string;
	tahoeCursorUrl: string;
};

export function useSettingsPanel({
	selected,
	onWallpaperChange,
	loadEditorPreferences,
	saveEditorPreferences,
	tSettings,
	t,
	gradients,
	builtInCursorStyleOptions,
	createTrimmedSvgPreview,
	createInvertedPreview,
	minimalCursorUrl,
	tahoeCursorUrl,
}: UseSettingsPanelArgs) {
	const initialEditorPreferences = useMemo(() => loadEditorPreferences(), [loadEditorPreferences]);
	const [assets, setAssets] = useState<{
		builtInWallpapers: BuiltInWallpaper[];
		extensionWallpapers: ReturnType<typeof extensionHost.getContributedWallpapers>;
		wallpaperPreviewPaths: string[];
		extensionWallpaperPreviewUrls: Record<string, string>;
		availableFrames: FrameInstance[];
		extensionPanels: ReturnType<typeof extensionHost.getSettingsPanels>;
		extensionCursorStyles: ReturnType<typeof extensionHost.getContributedCursorStyles>;
		builtInCursorPreviewUrls: Partial<Record<string, string>>;
		extensionCursorPreviewUrls: Partial<Record<string, string>>;
		isInitialLoading: boolean;
	}>({
		builtInWallpapers: BUILT_IN_WALLPAPERS,
		extensionWallpapers: [],
		wallpaperPreviewPaths: [],
		extensionWallpaperPreviewUrls: {},
		availableFrames: [],
		extensionPanels: [],
		extensionCursorStyles: [],
		builtInCursorPreviewUrls: {},
		extensionCursorPreviewUrls: {},
		isInitialLoading: true,
	});

	const {
		builtInWallpapers,
		extensionWallpapers,
		wallpaperPreviewPaths,
		extensionWallpaperPreviewUrls,
		availableFrames,
		extensionPanels,
		extensionCursorStyles,
		builtInCursorPreviewUrls,
		extensionCursorPreviewUrls,
		isInitialLoading,
	} = assets;

	const [customImages, setCustomImages] = useState<string[]>(initialEditorPreferences.customWallpapers);
	const fileInputRef = useRef<HTMLInputElement>(null);
	const customColorInputRef = useRef<HTMLInputElement | null>(null);
	const [backgroundTab, setBackgroundTab] = useState<BackgroundTab>(() => getBackgroundTabForWallpaper(selected, gradients));
	const [selectedColor, setSelectedColor] = useState(isHexWallpaper(selected) ? selected : "#ADADAD");
	const [gradient, setGradient] = useState<string>(
		gradients.some((gradientValue) => gradientValue === selected) ? selected : gradients[0],
	);

	const builtInWallpaperPaths = useMemo(
		() => builtInWallpapers.map((wallpaper) => wallpaper.publicPath),
		[builtInWallpapers],
	);
	const extensionWallpaperPaths = useMemo(
		() => extensionWallpapers.map((wallpaper) => wallpaper.resolvedUrl),
		[extensionWallpapers],
	);
	const cursorPreviewUrls = useMemo(
		() => ({ ...builtInCursorPreviewUrls, ...extensionCursorPreviewUrls }),
		[builtInCursorPreviewUrls, extensionCursorPreviewUrls],
	);
	const cursorStyleOptions = useMemo<CursorStyleOption[]>(
		() => [
			...builtInCursorStyleOptions,
			...extensionCursorStyles.map((cursorStyle) => ({
				value: cursorStyle.id as CursorStyle,
				label: cursorStyle.cursorStyle.label,
			})),
		],
		[builtInCursorStyleOptions, extensionCursorStyles],
	);

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
					previewUrl: previewPath,
				};
			});

		const extensionTiles = extensionWallpapers
			.filter((wallpaper) => !isVideoWallpaperSource(wallpaper.resolvedUrl))
			.map((wallpaper) => ({
				key: wallpaper.id,
				label: wallpaper.wallpaper.label,
				value: wallpaper.resolvedUrl,
				previewUrl:
					extensionWallpaperPreviewUrls[wallpaper.id] ?? wallpaper.resolvedThumbnailUrl,
			}));

		return [...builtInTiles, ...extensionTiles];
	}, [
		builtInWallpaperPaths,
		builtInWallpapers,
		extensionWallpaperPreviewUrls,
		extensionWallpapers,
		wallpaperPreviewPaths,
	]);

	const videoWallpaperTiles = useMemo<WallpaperTile[]>(() => {
		const builtInTiles = builtInWallpapers
			.filter((wallpaper) => isVideoWallpaperSource(wallpaper.publicPath))
			.map((wallpaper) => ({
				key: `builtin/${wallpaper.id}`,
				label: wallpaper.label,
				value: wallpaper.publicPath,
				previewUrl: wallpaper.publicPath,
			}));

		const extensionTiles = extensionWallpapers
			.filter((wallpaper) => isVideoWallpaperSource(wallpaper.resolvedUrl))
			.map((wallpaper) => ({
				key: wallpaper.id,
				label: wallpaper.wallpaper.label,
				value: wallpaper.resolvedUrl,
				previewUrl:
					extensionWallpaperPreviewUrls[wallpaper.id] ?? wallpaper.resolvedThumbnailUrl,
			}));

		return [...builtInTiles, ...extensionTiles];
	}, [builtInWallpapers, extensionWallpaperPreviewUrls, extensionWallpapers]);

	useEffect(() => {
		let mounted = true;
		(async () => {
			try {
				const availableWallpapers = await getAvailableWallpapers();
				const resolved = await Promise.all(
					availableWallpapers.map(async (wallpaper) => {
						const assetUrl = await getAssetPath(wallpaper.relativePath);
						if (isVideoWallpaperSource(wallpaper.publicPath)) {
							return getRenderableVideoUrl(assetUrl);
						}
						return getWallpaperThumbnailUrl(assetUrl);
					}),
				);
				if (mounted) {
					setAssets(prev => ({
						...prev,
						builtInWallpapers: availableWallpapers,
						wallpaperPreviewPaths: resolved,
						isInitialLoading: false,
					}));
				}
			} catch {
				if (mounted) {
					setAssets(prev => ({
						...prev,
						builtInWallpapers: BUILT_IN_WALLPAPERS,
						wallpaperPreviewPaths: BUILT_IN_WALLPAPERS.map((wallpaper) => wallpaper.publicPath),
						isInitialLoading: false,
					}));
				}
			}
		})();
		return () => {
			mounted = false;
		};
	}, []);

	useEffect(() => {
		let cancelled = false;

		const updateExtensionAssets = async () => {
			const wallpapers = extensionHost.getContributedWallpapers();
			const cursorStyles = extensionHost.getContributedCursorStyles();
			const [wallpaperPreviewEntries, cursorPreviewEntries] = await Promise.all([
				Promise.all(
					wallpapers.map(
						async (wallpaper) =>
							[
								wallpaper.id,
								isVideoWallpaperSource(wallpaper.resolvedThumbnailUrl)
									? wallpaper.resolvedThumbnailUrl
									: await getWallpaperThumbnailUrl(wallpaper.resolvedThumbnailUrl),
							] as const,
					),
				),
				Promise.all(
					cursorStyles.map(
						async (cursorStyle) =>
							[
								cursorStyle.id,
								await getRenderableAssetUrl(cursorStyle.resolvedDefaultUrl),
							] as const,
					),
				),
			]);

			if (cancelled) {
				return;
			}

			setAssets(prev => ({
				...prev,
				extensionWallpapers: wallpapers,
				extensionWallpaperPreviewUrls: Object.fromEntries(wallpaperPreviewEntries),
				extensionCursorStyles: cursorStyles,
				extensionCursorPreviewUrls: Object.fromEntries(cursorPreviewEntries),
				availableFrames: extensionHost.getFrames(),
				extensionPanels: extensionHost.getSettingsPanels(),
			}));
		};

		void extensionHost.autoActivateBuiltins().then(updateExtensionAssets);
		const unsubscribe = extensionHost.onChange(() => {
			void updateExtensionAssets();
		});

		return () => {
			cancelled = true;
			unsubscribe();
		};
	}, []);

	useEffect(() => {
		let cancelled = false;

		void (async () => {
			try {
				const previewAssets = await import("../../videoPlayback/uploadedCursorAssets");
				const macosPreview = previewAssets.cursorSetAssets.macos.arrow.url;
				const tahoePreview = previewAssets.cursorSetAssets.tahoe.arrow.url;
				const minimalPreview = await createTrimmedSvgPreview(minimalCursorUrl, 512);
				const invertedPreview = await createInvertedPreview(tahoePreview);

				if (!cancelled) {
					setAssets(prev => ({
						...prev,
						builtInCursorPreviewUrls: {
							macos: macosPreview,
							tahoe: tahoePreview,
							figma: minimalPreview,
							"tahoe-inverted": invertedPreview,
						}
					}));
				}
			} catch {
				if (!cancelled) {
					setAssets(prev => ({
						...prev,
						builtInCursorPreviewUrls: {
							macos: tahoeCursorUrl,
							tahoe: tahoeCursorUrl,
							figma: minimalCursorUrl,
							"tahoe-inverted": tahoeCursorUrl,
						}
					}));
				}
			}
		})();

		return () => {
			cancelled = true;
		};
	}, [createInvertedPreview, createTrimmedSvgPreview, minimalCursorUrl, tahoeCursorUrl]);

	useEffect(() => {
		setBackgroundTab(getBackgroundTabForWallpaper(selected, gradients));

		if (isHexWallpaper(selected)) {
			setSelectedColor(selected);
		}

		if (gradients.some((gradientValue) => gradientValue === selected)) {
			setGradient(selected);
		}
	}, [selected, gradients]);

	useEffect(() => {
		if (selected.startsWith("data:image")) {
			setCustomImages((prev) => (prev.includes(selected) ? prev : [selected, ...prev]));
			return;
		}

		const isKnownWallpaper =
			builtInWallpaperPaths.includes(selected) ||
			wallpaperPreviewPaths.includes(selected) ||
			extensionWallpaperPaths.includes(selected);

		if (!isKnownWallpaper && isVideoWallpaperSource(selected)) {
			setCustomImages((prev) => (prev.includes(selected) ? prev : [selected, ...prev]));
		}
	}, [
		builtInWallpaperPaths,
		extensionWallpaperPaths,
		selected,
		wallpaperPreviewPaths,
	]);

	useEffect(() => {
		saveEditorPreferences({ customWallpapers: customImages });
	}, [customImages, saveEditorPreferences]);

	const handleImageUpload = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
		const files = event.target.files;
		if (!files || files.length === 0) return;

		const file = files[0];
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
		event.target.value = "";
	}, [onWallpaperChange, t, tSettings]);

	const handleVideoUpload = useCallback(async () => {
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
	}, [onWallpaperChange]);

	const handleRemoveCustomImage = useCallback((imageUrl: string, event: React.MouseEvent) => {
		event.stopPropagation();
		setCustomImages((prev) => prev.filter((img) => img !== imageUrl));
		if (selected === imageUrl) {
			onWallpaperChange(
				builtInWallpaperPaths[0] ??
					extensionWallpaperPaths[0] ??
					BUILT_IN_WALLPAPERS[0]?.publicPath ??
					"",
			);
		}
	}, [builtInWallpaperPaths, extensionWallpaperPaths, onWallpaperChange, selected]);

	return {
		isInitialLoading,
		initialEditorPreferences,
		customImages,
		fileInputRef,
		customColorInputRef,
		builtInWallpaperPaths,
		extensionWallpaperPaths,
		backgroundTab,
		setBackgroundTab,
		selectedColor,
		setSelectedColor,
		gradient,
		setGradient,
		availableFrames,
		extensionPanels,
		cursorPreviewUrls,
		cursorStyleOptions,
		imageWallpaperTiles,
		videoWallpaperTiles,
		handleImageUpload,
		handleVideoUpload,
		handleRemoveCustomImage,
	};
}
