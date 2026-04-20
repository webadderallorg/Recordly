import { UploadSimple as Upload, X } from "@phosphor-icons/react";
import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { getAssetPath, getRenderableAssetUrl, getWallpaperThumbnailUrl } from "@/lib/assetPath";
import { extensionHost } from "@/lib/extensions";
import { cn } from "@/lib/utils";
import type { BuiltInWallpaper } from "@/lib/wallpapers";
import {
	BUILT_IN_WALLPAPERS,
	getAvailableWallpapers,
	isVideoWallpaperSource,
} from "@/lib/wallpapers";
import { useI18n, useScopedT } from "../../../contexts/I18nContext";
import { loadEditorPreferences, saveEditorPreferences } from "../editorPreferences";
import { SliderControl } from "../SliderControl";
import {
	type BackgroundTab,
	COLOR_PALETTE,
	GRADIENTS,
	SectionLabel,
	type WallpaperTile,
	getBackgroundTabForWallpaper,
	isHexWallpaper,
} from "../settingsPanelConstants";

interface BackgroundSectionProps {
	selected: string;
	onWallpaperChange: (path: string) => void;
	backgroundBlur: number;
	onBackgroundBlurChange?: (amount: number) => void;
}

export function BackgroundSection({
	selected,
	onWallpaperChange,
	backgroundBlur,
	onBackgroundBlurChange,
}: BackgroundSectionProps) {
	const tSettings = useScopedT("settings");
	const { t } = useI18n();
	const initialEditorPreferences = useMemo(() => loadEditorPreferences(), []);
	const [builtInWallpapers, setBuiltInWallpapers] = useState<BuiltInWallpaper[]>(BUILT_IN_WALLPAPERS);
	const [extensionWallpapers, setExtensionWallpapers] = useState<
		ReturnType<typeof extensionHost.getContributedWallpapers>
	>([]);
	const [wallpaperPreviewPaths, setWallpaperPreviewPaths] = useState<string[]>([]);
	const [extensionWallpaperPreviewUrls, setExtensionWallpaperPreviewUrls] = useState<
		Record<string, string>
	>({});
	const [customImages, setCustomImages] = useState<string[]>(
		initialEditorPreferences.customWallpapers,
	);
	const fileInputRef = useRef<HTMLInputElement>(null);
	const customColorInputRef = useRef<HTMLInputElement | null>(null);
	const builtInWallpaperPaths = useMemo(
		() => builtInWallpapers.map((w) => w.publicPath),
		[builtInWallpapers],
	);
	const extensionWallpaperPaths = useMemo(
		() => extensionWallpapers.map((w) => w.resolvedUrl),
		[extensionWallpapers],
	);
	const [selectedColor, setSelectedColor] = useState(
		isHexWallpaper(selected) ? selected : "#ADADAD",
	);
	const [gradient, setGradient] = useState<string>(
		GRADIENTS.includes(selected) ? selected : GRADIENTS[0],
	);
	const [backgroundTab, setBackgroundTab] = useState<BackgroundTab>(() =>
		getBackgroundTabForWallpaper(selected),
	);

	useEffect(() => {
		let mounted = true;
		(async () => {
			try {
				const availableWallpapers = await getAvailableWallpapers();
				const resolved = await Promise.all(
					availableWallpapers.map(async (wallpaper) => {
						const assetUrl = await getAssetPath(wallpaper.relativePath);
						if (isVideoWallpaperSource(wallpaper.publicPath)) {
							return getRenderableAssetUrl(assetUrl);
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
					setWallpaperPreviewPaths(BUILT_IN_WALLPAPERS.map((w) => w.publicPath));
				}
			}
		})();
		return () => { mounted = false; };
	}, []);

	useEffect(() => {
		let cancelled = false;
		const updateWallpaperAssets = async () => {
			const wallpapers = extensionHost.getContributedWallpapers();
			const entries = await Promise.all(
				wallpapers.map(
					async (w) =>
						[
							w.id,
							isVideoWallpaperSource(w.resolvedThumbnailUrl)
								? w.resolvedThumbnailUrl
								: await getWallpaperThumbnailUrl(w.resolvedThumbnailUrl),
						] as const,
				),
			);
			if (cancelled) return;
			setExtensionWallpapers(wallpapers);
			setExtensionWallpaperPreviewUrls(Object.fromEntries(entries));
		};
		void extensionHost.autoActivateBuiltins().then(updateWallpaperAssets);
		const unsubscribe = extensionHost.onChange(() => void updateWallpaperAssets());
		return () => { cancelled = true; unsubscribe(); };
	}, []);

	useEffect(() => {
		setBackgroundTab(getBackgroundTabForWallpaper(selected));
		if (isHexWallpaper(selected)) setSelectedColor(selected);
		if (GRADIENTS.includes(selected)) setGradient(selected);
		if (selected.startsWith("data:image") && !customImages.includes(selected)) {
			setCustomImages((prev) => [selected, ...prev]);
		}
		const isKnown =
			builtInWallpaperPaths.includes(selected) ||
			wallpaperPreviewPaths.includes(selected) ||
			extensionWallpaperPaths.includes(selected);
		if (!isKnown && isVideoWallpaperSource(selected) && !customImages.includes(selected)) {
			setCustomImages((prev) => [selected, ...prev]);
		}
	}, [builtInWallpaperPaths, customImages, extensionWallpaperPaths, selected, wallpaperPreviewPaths]);

	useEffect(() => {
		saveEditorPreferences({ customWallpapers: customImages });
	}, [customImages]);

	const imageWallpaperTiles = useMemo<WallpaperTile[]>(() => {
		const imageWallpapers = builtInWallpapers.filter(
			(w) => !isVideoWallpaperSource(w.publicPath),
		);
		const builtInTiles = (
			wallpaperPreviewPaths.length > 0 ? wallpaperPreviewPaths : builtInWallpaperPaths
		)
			.filter((path) => !isVideoWallpaperSource(path))
			.map((previewPath, index) => {
				const w = imageWallpapers[index];
				return {
					key: w ? `builtin/${w.id}` : previewPath,
					label: w?.label ?? `Wallpaper ${index + 1}`,
					value: w?.publicPath ?? previewPath,
					previewUrl: previewPath,
				};
			});
		const extTiles = extensionWallpapers
			.filter((w) => !isVideoWallpaperSource(w.resolvedUrl))
			.map((w) => ({
				key: w.id,
				label: w.wallpaper.label,
				value: w.resolvedUrl,
				previewUrl: extensionWallpaperPreviewUrls[w.id] ?? w.resolvedThumbnailUrl,
			}));
		return [...builtInTiles, ...extTiles];
	}, [builtInWallpaperPaths, builtInWallpapers, extensionWallpaperPreviewUrls, extensionWallpapers, wallpaperPreviewPaths]);

	const videoWallpaperTiles = useMemo<WallpaperTile[]>(() => {
		const builtInTiles = builtInWallpapers
			.filter((w) => isVideoWallpaperSource(w.publicPath))
			.map((w) => ({ key: `builtin/${w.id}`, label: w.label, value: w.publicPath, previewUrl: w.publicPath }));
		const extTiles = extensionWallpapers
			.filter((w) => isVideoWallpaperSource(w.resolvedUrl))
			.map((w) => ({
				key: w.id,
				label: w.wallpaper.label,
				value: w.resolvedUrl,
				previewUrl: extensionWallpaperPreviewUrls[w.id] ?? w.resolvedThumbnailUrl,
			}));
		return [...builtInTiles, ...extTiles];
	}, [builtInWallpapers, extensionWallpaperPreviewUrls, extensionWallpapers]);

	const visibleColorPalette = COLOR_PALETTE.slice(0, 15);

	const getWallpaperTileState = (candidateValue: string, previewPath?: string) => {
		if (!selected) return false;
		if (selected === candidateValue || (previewPath && selected === previewPath)) return true;
		try {
			const clean = (s: string) => s.replace(/^file:\/\//, "").replace(/^\//, "");
			if (clean(selected).endsWith(clean(candidateValue))) return true;
			if (clean(candidateValue).endsWith(clean(selected))) return true;
			if (previewPath && clean(selected).endsWith(clean(previewPath))) return true;
			if (previewPath && clean(previewPath).endsWith(clean(selected))) return true;
		} catch { return false; }
		return false;
	};

	const tileClass = (isSelected: boolean) =>
		cn(
			"group relative aspect-square w-full overflow-hidden rounded-[10px] border bg-editor-bg transition-colors duration-150",
			isSelected
				? "border-[#2563EB] bg-foreground/[0.08]"
				: "border-foreground/10 bg-foreground/[0.045] hover:border-foreground/20 hover:bg-foreground/[0.07]",
		);

	const renderTile = (
		wallpaperUrl: string,
		isSelected: boolean,
		props?: { key?: string; ariaLabel?: string; title?: string; onClick?: () => void; children?: React.ReactNode },
	) => (
		<div key={props?.key} className={tileClass(isSelected)} aria-label={props?.ariaLabel}
			title={props?.title} onClick={props?.onClick} role="button">
			<div className="absolute inset-[1px] overflow-hidden rounded-[8px] bg-editor-dialog">
				{isVideoWallpaperSource(wallpaperUrl) ? (
					<video src={wallpaperUrl} muted playsInline preload="metadata"
						className="h-full w-full select-none object-cover [transform:translateZ(0)]"
						draggable={false}
						onMouseEnter={(e) => e.currentTarget.play().catch(() => undefined)}
						onMouseLeave={(e) => { e.currentTarget.pause(); e.currentTarget.currentTime = 0; }} />
				) : (
					<img src={wallpaperUrl}
						alt={props?.title ?? props?.ariaLabel ?? tSettings("background.wallpaperPreview", "Wallpaper preview")}
						className="h-full w-full select-none object-cover [transform:translateZ(0)]" draggable={false} />
				)}
			</div>
			{props?.children}
		</div>
	);

	const handleImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
		const files = event.target.files;
		if (!files || files.length === 0) return;
		const file = files[0];
		if (!["image/jpeg", "image/jpg"].includes(file.type)) {
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
			toast.error(t("common.failedToUploadImage"), { description: t("common.errorReadingFile") });
		};
		reader.readAsDataURL(file);
		event.target.value = "";
	};

	const handleVideoUpload = async () => {
		try {
			const result = await window.electronAPI.openVideoFilePicker();
			if (!result?.success || !result.path) return;
			const filePath = result.path;
			if (!isVideoWallpaperSource(filePath)) {
				toast.error("Unsupported format", { description: "Please select a video file (mp4, webm, mov, etc.)" });
				return;
			}
			setCustomImages((prev) => [filePath, ...prev]);
			onWallpaperChange(filePath);
			toast.success("Video background added");
		} catch { toast.error("Failed to import video background"); }
	};

	const handleRemoveCustomImage = (imageUrl: string, event: React.MouseEvent) => {
		event.stopPropagation();
		setCustomImages((prev) => prev.filter((img) => img !== imageUrl));
		if (selected === imageUrl) {
			onWallpaperChange(builtInWallpaperPaths[0] ?? extensionWallpaperPaths[0] ?? BUILT_IN_WALLPAPERS[0]?.publicPath ?? "");
		}
	};

	const removeBtn = (url: string) => (
		<button onClick={(e) => handleRemoveCustomImage(url, e)}
			className="absolute top-0.5 right-0.5 w-3 h-3 bg-red-500/90 hover:bg-red-500 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-10">
			<X className="w-2 h-2 text-white" />
		</button>
	);

	return (
		<div className="space-y-4">
			<section className="flex flex-col gap-2">
				<div className="flex items-center justify-between gap-3">
					<SectionLabel>{tSettings("background.title")}</SectionLabel>
					<button type="button"
						onClick={() => onBackgroundBlurChange?.(initialEditorPreferences.backgroundBlur)}
						className="text-[10px] text-[#2563EB] transition-opacity hover:opacity-80">
						{t("common.actions.reset", "Reset")}
					</button>
				</div>
				<SliderControl label={tSettings("effects.backgroundBlur")} value={backgroundBlur}
					defaultValue={initialEditorPreferences.backgroundBlur} min={0} max={8} step={0.25}
					onChange={(v) => onBackgroundBlurChange?.(v)} formatValue={(v) => `${v.toFixed(1)}px`}
					parseInput={(text) => parseFloat(text.replace(/px$/, ""))} />
			</section>

			<div className="w-full">
				<LayoutGroup id="background-picker-switcher">
					<div className="grid h-8 w-full grid-cols-4 rounded-xl border border-foreground/10 bg-foreground/[0.04] p-1">
						{([
							{ value: "image" as const, label: tSettings("background.image") },
							{ value: "video" as const, label: tSettings("background.video", "Video") },
							{ value: "color" as const, label: tSettings("background.color") },
							{ value: "gradient" as const, label: tSettings("background.gradient") },
						]).map((option) => {
							const isActive = backgroundTab === option.value;
							return (
								<button key={option.value} type="button" onClick={() => setBackgroundTab(option.value)}
									className="relative rounded-lg text-[10px] font-semibold tracking-wide transition-colors">
									{isActive ? (
										<motion.span layoutId="background-picker-pill"
											className="absolute inset-0 rounded-lg bg-[#2563EB]"
											transition={{ type: "spring", stiffness: 420, damping: 34 }} />
									) : null}
									<span className={cn("relative z-10", isActive ? "text-white" : "text-muted-foreground hover:text-foreground")}>
										{option.label}
									</span>
								</button>
							);
						})}
					</div>
				</LayoutGroup>

				<div className="pt-2">
					<AnimatePresence mode="wait" initial={false}>
						<motion.div key={backgroundTab}
							initial={{ opacity: 0, y: 10, filter: "blur(8px)" }}
							animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
							exit={{ opacity: 0, y: -8, filter: "blur(6px)" }}
							transition={{ duration: 0.2, ease: "easeOut" }}>
							{backgroundTab === "image" ? (
								<div className="mt-0 space-y-2">
									<input type="file" ref={fileInputRef} onChange={handleImageUpload}
										accept=".jpg,.jpeg,image/jpeg" className="hidden" />
									<Button onClick={() => fileInputRef.current?.click()} variant="outline"
										className="w-full gap-2 bg-foreground/5 text-foreground border-foreground/10 hover:bg-[#2563EB] hover:text-white hover:border-[#2563EB] transition-all h-7 text-[10px]">
										<Upload className="w-3 h-3" />
										{tSettings("background.uploadCustom")}
									</Button>
									<div className="grid grid-cols-8 gap-1.5">
										{customImages.map((url, idx) => {
											const isSel = getWallpaperTileState(url);
											return renderTile(url, isSel, {
												key: `custom-${idx}`,
												ariaLabel: isVideoWallpaperSource(url) ? (url.split(/[\\/]/).pop() ?? tSettings("background.video", "Video background")) : undefined,
												title: isVideoWallpaperSource(url) ? url.split(/[\\/]/).pop() : undefined,
												onClick: () => onWallpaperChange(url),
												children: removeBtn(url),
											});
										})}
										{imageWallpaperTiles.map((tile) => renderTile(tile.previewUrl, getWallpaperTileState(tile.value, tile.previewUrl), {
											key: tile.key, ariaLabel: tile.label, title: tile.label, onClick: () => onWallpaperChange(tile.value),
										}))}
									</div>
								</div>
							) : backgroundTab === "video" ? (
								<div className="mt-0 space-y-2">
									<Button onClick={handleVideoUpload} variant="outline"
										className="w-full gap-2 bg-foreground/5 text-foreground border-foreground/10 hover:bg-[#2563EB] hover:text-white hover:border-[#2563EB] transition-all h-7 text-[10px]">
										<Upload className="w-3 h-3" />
										{tSettings("background.uploadCustomVideo", "Upload Video")}
									</Button>
									<div className="grid grid-cols-8 gap-1.5">
										{customImages.filter(isVideoWallpaperSource).map((url, idx) => renderTile(url, getWallpaperTileState(url), {
											key: `custom-video-${idx}`,
											ariaLabel: url.split(/[\\/]/).pop() ?? "Video background",
											title: url.split(/[\\/]/).pop(),
											onClick: () => onWallpaperChange(url),
											children: removeBtn(url),
										}))}
										{videoWallpaperTiles.map((w) => renderTile(w.previewUrl, getWallpaperTileState(w.value, w.previewUrl), {
											key: w.key, ariaLabel: w.label, title: w.label, onClick: () => onWallpaperChange(w.value),
										}))}
									</div>
								</div>
							) : backgroundTab === "color" ? (
								<div className="mt-0 space-y-2">
									<input ref={customColorInputRef} type="color" value={selectedColor}
										onChange={(e) => { setSelectedColor(e.target.value); onWallpaperChange(e.target.value); }}
										className="sr-only" />
									<div className="grid grid-cols-8 gap-1.5">
										{visibleColorPalette.map((color) => (
											<button key={color} type="button"
												onClick={() => { setSelectedColor(color); onWallpaperChange(color); }}
												className={tileClass(selected.toLowerCase() === color.toLowerCase())}
												style={{ background: color }} aria-label={`Color ${color}`} />
										))}
										<button type="button" onClick={() => customColorInputRef.current?.click()}
											className={tileClass(isHexWallpaper(selected) && !visibleColorPalette.some((c) => c.toLowerCase() === selected.toLowerCase()))}
											style={{ background: `linear-gradient(135deg, ${selectedColor} 0%, ${selectedColor} 58%, rgba(255,255,255,0.92) 58%, rgba(255,255,255,0.92) 100%)` }}
											aria-label="Custom color picker">
											<div className="absolute inset-0 flex items-center justify-center text-[9px] font-semibold uppercase tracking-[0.18em] text-foreground/90">
												Pick
											</div>
										</button>
									</div>
								</div>
							) : (
								<div className="mt-0 grid grid-cols-8 gap-1.5">
									{GRADIENTS.map((g, idx) => (
										<div key={g} className={tileClass(gradient === g)} style={{ background: g }}
											aria-label={`Gradient ${idx + 1}`}
											onClick={() => { setGradient(g); onWallpaperChange(g); }} role="button" />
									))}
								</div>
							)}
						</motion.div>
					</AnimatePresence>
				</div>
			</div>
		</div>
	);
}
