import { UploadSimple as Upload, X } from "@phosphor-icons/react";
import { LayoutGroup, motion } from "motion/react";
import { memo, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { getRenderableVideoUrl } from "@/lib/assetPath";
import { cn } from "@/lib/utils";
import { BUILT_IN_WALLPAPERS, isVideoWallpaperSource } from "@/lib/wallpapers";
import type { EditorPreferences } from "../../editorPreferences";
import { SliderControl } from "../../SliderControl";
import { GRADIENTS } from "../constants";
import type { BackgroundTab, WallpaperTile as WallpaperTileData } from "../hooks/useSettingsPanel";

const ITEMS_PER_PAGE = 24;

const COLOR_PALETTE = [
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
];

function isHexWallpaper(value: string): boolean {
	return /^#(?:[0-9a-f]{3}){1,2}$/i.test(value);
}

const WallpaperVideoPreview = memo(({ src }: { src: string }) => {
	const [resolvedSrc, setResolvedSrc] = useState<string | null>(null);
	const [isLoading, setIsLoading] = useState(true);

	useEffect(() => {
		let cancelled = false;
		setIsLoading(true);

		void (async () => {
			try {
				const nextSrc = await getRenderableVideoUrl(src);
				if (!cancelled) {
					setResolvedSrc(nextSrc);
					setIsLoading(false);
				}
			} catch {
				if (!cancelled) {
					setResolvedSrc(src);
					setIsLoading(false);
				}
			}
		})();

		return () => {
			cancelled = true;
		};
	}, [src]);

	if (isLoading || !resolvedSrc) {
		return <Skeleton className="h-full w-full" variant="glass" animation="shimmer-premium" />;
	}

	return (
		<video
			src={resolvedSrc}
			muted
			playsInline
			preload="metadata"
			className="h-full w-full select-none object-cover [transform:translateZ(0)]"
			draggable={false}
			onMouseEnter={(event) => event.currentTarget.play().catch(() => undefined)}
			onMouseLeave={(event) => {
				event.currentTarget.pause();
				event.currentTarget.currentTime = 0;
			}}
		/>
	);
});

WallpaperVideoPreview.displayName = "WallpaperVideoPreview";

type WallpaperTileProps = {
	wallpaperUrl: string;
	isSelected: boolean;
	ariaLabel?: string;
	title?: string;
	onClick?: () => void;
	children?: React.ReactNode;
	tSettings: (key: string, fallback?: string) => string;
};

function wallpaperTileClass(isSelected: boolean) {
	return cn(
		"group relative aspect-square w-full overflow-hidden rounded-[10px] border bg-editor-bg transition-colors duration-150",
		isSelected
			? "border-[#2563EB] bg-foreground/[0.08]"
			: "border-foreground/10 bg-foreground/[0.045] hover:border-foreground/20 hover:bg-foreground/[0.07]",
	);
}

// Singleton Observer Manager to share one IntersectionObserver instance across all tiles
const observerManager = {
	observer: null as IntersectionObserver | null,
	callbacks: new WeakMap<Element, (isInView: boolean) => void>(),

	getObserver() {
		if (typeof window === "undefined") return null;
		if (!this.observer) {
			this.observer = new IntersectionObserver(
				(entries) => {
					entries.forEach((entry) => {
						const callback = this.callbacks.get(entry.target);
						if (callback) callback(entry.isIntersecting);
					});
				},
				{ rootMargin: "100px" },
			);
		}
		return this.observer;
	},

	observe(element: Element, callback: (isInView: boolean) => void) {
		const obs = this.getObserver();
		if (!obs) return;
		this.callbacks.set(element, callback);
		obs.observe(element);
	},

	unobserve(element: Element) {
		const obs = this.getObserver();
		if (!obs) return;
		this.callbacks.delete(element);
		obs.unobserve(element);
	},
};

function isKeyboardActivationKey(key: string): boolean {
	return key === "Enter" || key === " ";
}

const WallpaperTile = memo(({
	wallpaperUrl,
	isSelected,
	ariaLabel,
	title,
	onClick,
	children,
	tSettings,
}: WallpaperTileProps) => {
	const [isImageLoaded, setIsImageLoaded] = useState(false);
	const [isInView, setIsInView] = useState(false);
	const containerRef = useRef<HTMLDivElement>(null);
	const isVideo = isVideoWallpaperSource(wallpaperUrl);

	useEffect(() => {
		const el = containerRef.current;
		if (!el) return;

		observerManager.observe(el, (inView) => {
			if (inView) {
				setIsInView(true);
				// Once in view, we stop observing this specific element
				observerManager.unobserve(el);
			}
		});

		return () => {
			if (el) observerManager.unobserve(el);
		};
	}, []);

	return (
		<div
			ref={containerRef}
			className={wallpaperTileClass(isSelected)}
			aria-label={ariaLabel}
			title={title}
			onClick={onClick}
			role="button"
			tabIndex={0}
			onKeyDown={(event) => {
				if (isKeyboardActivationKey(event.key)) {
					event.preventDefault();
					onClick?.();
				}
			}}
		>
			<div className="absolute inset-[1px] overflow-hidden rounded-[8px] bg-editor-dialog">
				{!isInView ? (
					<Skeleton className="h-full w-full" variant="glass" animation="none" />
				) : isVideo ? (
					<WallpaperVideoPreview src={wallpaperUrl} />
				) : (
					<>
						{!isImageLoaded && (
							<Skeleton className="absolute inset-0 z-10" variant="glass" animation="shimmer-premium" />
						)}
						<img
							src={wallpaperUrl}
							loading="lazy"
							decoding="async"
							onLoad={() => setIsImageLoaded(true)}
							alt={
								title ??
								ariaLabel ??
								tSettings("background.wallpaperPreview", "Wallpaper preview")
							}
							className={cn(
								"h-full w-full select-none object-cover [transform:translateZ(0)] transition-opacity duration-300",
								isImageLoaded ? "opacity-100" : "opacity-0"
							)}
							draggable={false}
						/>
					</>
				)}
			</div>
			{children}
		</div>
	);
});

WallpaperTile.displayName = "WallpaperTile";

function cleanPath(value: string): string {
	try {
		return value.replace(/^file:\/\//, "").replace(/^\//, "");
	} catch {
		return value;
	}
}

export const BackgroundSection = memo(({
	tSettings,
	t,
	selected,
	onWallpaperChange,
	backgroundBlur,
	onBackgroundBlurChange,
	backgroundTab,
	setBackgroundTab,
	fileInputRef,
	handleImageUpload,
	customImages,
	imageWallpaperTiles,
	videoWallpaperTiles,
	handleVideoUpload,
	handleRemoveCustomImage,
	customColorInputRef,
	selectedColor,
	setSelectedColor,
	gradient,
	setGradient,
	initialEditorPreferences,
	builtInWallpaperPaths,
	extensionWallpaperPaths,
	isInitialLoading = false,
}: {
	tSettings: (key: string, fallback?: string) => string;
	t: (key: string, fallback?: string) => string;
	selected: string;
	onWallpaperChange: (path: string) => void;
	backgroundBlur: number;
	onBackgroundBlurChange?: (amount: number) => void;
	backgroundTab: BackgroundTab;
	setBackgroundTab: (tab: BackgroundTab) => void;
	fileInputRef: React.MutableRefObject<HTMLInputElement | null>;
	handleImageUpload: (event: React.ChangeEvent<HTMLInputElement>) => void;
	customImages: string[];
	imageWallpaperTiles: WallpaperTileData[];
	videoWallpaperTiles: WallpaperTileData[];
	handleVideoUpload: () => Promise<void>;
	handleRemoveCustomImage: (imageUrl: string, event: React.MouseEvent) => void;
	customColorInputRef: React.MutableRefObject<HTMLInputElement | null>;
	selectedColor: string;
	setSelectedColor: (color: string) => void;
	gradient: string;
	setGradient: (gradient: string) => void;
	initialEditorPreferences: EditorPreferences;
	builtInWallpaperPaths: string[];
	extensionWallpaperPaths: string[];
	isInitialLoading?: boolean;
}) => {
	const visibleColorPalette = COLOR_PALETTE.slice(0, 15);
	const INITIAL_BATCH = 4; // Even smaller start
	const FULL_BATCH = 24;
	const [visibleCount, setVisibleCount] = useState(INITIAL_BATCH);
	const [isPending, startTransition] = useTransition();

	// Global cache for cleaned paths to avoid repeated work across all tiles
	const cleanPathCache = useRef<Record<string, string>>({});
	const getCleaned = (path: string) => {
		if (!cleanPathCache.current[path]) {
			cleanPathCache.current[path] = cleanPath(path);
		}
		return cleanPathCache.current[path];
	};

	// Frame-staggered loading: Gradually reveal tiles to avoid UI freeze
	useEffect(() => {
		let frameId: number;
		const step = () => {
			setVisibleCount(prev => {
				if (prev < FULL_BATCH) {
					frameId = requestAnimationFrame(step);
					return Math.min(prev + 4, FULL_BATCH); // Add 4 per frame
				}
				return prev;
			});
		};
		
		setVisibleCount(INITIAL_BATCH);
		frameId = requestAnimationFrame(step);
		
		return () => cancelAnimationFrame(frameId);
	}, [backgroundTab]);

	const handleTabChange = (tab: BackgroundTab) => {
		startTransition(() => {
			setBackgroundTab(tab);
			setVisibleCount(INITIAL_BATCH);
		});
	};

	const resetBackgroundSection = () => {
		onBackgroundBlurChange?.(initialEditorPreferences.backgroundBlur);

		const preferredWallpaper = initialEditorPreferences.wallpaper;
		const hasPreferredWallpaper =
			(preferredWallpaper && builtInWallpaperPaths.includes(preferredWallpaper)) ||
			(preferredWallpaper && extensionWallpaperPaths.includes(preferredWallpaper)) ||
			(preferredWallpaper && customImages.includes(preferredWallpaper)) ||
			(preferredWallpaper && isHexWallpaper(preferredWallpaper)) ||
			(preferredWallpaper && GRADIENTS.some((candidate) => candidate === preferredWallpaper));

		onWallpaperChange(
			(hasPreferredWallpaper ? preferredWallpaper : "") ||
				builtInWallpaperPaths[0] ||
				extensionWallpaperPaths[0] ||
				BUILT_IN_WALLPAPERS[0]?.publicPath ||
				"",
		);
	};

	const cleanedSelected = useMemo(() => cleanPath(selected), [selected]);


	const getWallpaperTileState = (candidateValue: string, previewPath?: string) => {
		if (!selected) return false;
		if (selected === candidateValue || (previewPath && selected === previewPath)) return true;
		
		const cleanedCandidate = getCleaned(candidateValue);
		
		// Direct equality check first
		if (cleanedSelected === cleanedCandidate) return true;
		
		// Fallback to containment
		if (cleanedSelected.endsWith(cleanedCandidate) || cleanedCandidate.endsWith(cleanedSelected)) return true;
		
		if (previewPath) {
			const cleanedPreview = getCleaned(previewPath);
			if (cleanedSelected === cleanedPreview) return true;
			if (cleanedSelected.endsWith(cleanedPreview) || cleanedPreview.endsWith(cleanedSelected)) return true;
		}

		return false;
	};

	const handleLoadMore = () => {
		setVisibleCount(prev => prev + ITEMS_PER_PAGE);
	};

	const imageTiles = useMemo(() => [
		...customImages
			.filter((imageUrl) => !isVideoWallpaperSource(imageUrl))
			.map((imageUrl, index) => ({
				type: "custom" as const,
				url: imageUrl,
				id: `custom-${index}`
			})),
		...imageWallpaperTiles.map(tile => ({
			type: "builtin" as const,
			tile,
			id: tile.key
		}))
	], [customImages, imageWallpaperTiles]);

	const renderImageTiles = () => {
		const visible = imageTiles.slice(0, visibleCount);
		const hasMore = imageTiles.length > visibleCount;

		return (
			<div className="space-y-4">
				<div className="grid grid-cols-8 gap-1.5">
					{visible.map((item) => (
						item.type === "custom" ? (
							<WallpaperTile
								key={item.id}
								wallpaperUrl={item.url}
								isSelected={getWallpaperTileState(item.url)}
								ariaLabel={
									isVideoWallpaperSource(item.url)
										? (item.url.split(/[\\/]/).pop() ??
											tSettings(
												"background.video",
												"Video background",
											))
										: undefined
								}
								title={
									isVideoWallpaperSource(item.url)
										? item.url.split(/[\\/]/).pop()
										: undefined
								}
								onClick={() => onWallpaperChange(item.url)}
								tSettings={tSettings}
							>
								<button
									onClick={(event) =>
										handleRemoveCustomImage(item.url, event)
									}
									className="absolute top-0.5 right-0.5 w-3 h-3 bg-red-500/90 hover:bg-red-500 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-10"
								>
									<X className="w-2 h-2 text-white" />
								</button>
							</WallpaperTile>
						) : (
							<WallpaperTile
								key={item.id}
								wallpaperUrl={item.tile.previewUrl}
								isSelected={getWallpaperTileState(
									item.tile.value,
									item.tile.previewUrl,
								)}
								ariaLabel={item.tile.label}
								title={item.tile.label}
								onClick={() => onWallpaperChange(item.tile.value)}
								tSettings={tSettings}
							/>
						)
					))}
				</div>
				{hasMore && (
					<Button
						variant="ghost"
						onClick={handleLoadMore}
						className="w-full h-8 text-[10px] text-muted-foreground hover:text-foreground"
					>
						{t("common.actions.loadMore", "Load more...")}
					</Button>
				)}
			</div>
		);
	};

	const videoTiles = useMemo(() => [
		...customImages.filter(isVideoWallpaperSource).map((videoUrl, index) => ({
			type: "custom" as const,
			url: videoUrl,
			id: `custom-video-${index}`
		})),
		...videoWallpaperTiles.map(tile => ({
			type: "builtin" as const,
			tile,
			id: tile.key
		}))
	], [customImages, videoWallpaperTiles]);

	const renderVideoTiles = () => {
		const visible = videoTiles.slice(0, visibleCount);
		const hasMore = videoTiles.length > visibleCount;

		return (
			<div className="space-y-4">
				<div className="grid grid-cols-8 gap-1.5">
					{visible.map((item) => (
						item.type === "custom" ? (
							<WallpaperTile
								key={item.id}
								wallpaperUrl={item.url}
								isSelected={getWallpaperTileState(item.url)}
								ariaLabel={
									item.url.split(/[\\/]/).pop() ??
									"Video background"
								}
								title={item.url.split(/[\\/]/).pop()}
								onClick={() => onWallpaperChange(item.url)}
								tSettings={tSettings}
							>
								<button
									onClick={(event) =>
										handleRemoveCustomImage(item.url, event)
									}
									className="absolute top-0.5 right-0.5 w-3 h-3 bg-red-500/90 hover:bg-red-500 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-10"
								>
									<X className="w-2 h-2 text-white" />
								</button>
							</WallpaperTile>
						) : (
							<WallpaperTile
								key={item.id}
								wallpaperUrl={item.tile.previewUrl}
								isSelected={getWallpaperTileState(
									item.tile.value,
									item.tile.previewUrl,
								)}
								ariaLabel={item.tile.label}
								title={item.tile.label}
								onClick={() => onWallpaperChange(item.tile.value)}
								tSettings={tSettings}
							/>
						)
					))}
				</div>
				{hasMore && (
					<div className="flex justify-center pt-2">
						<Button
							variant="outline"
							size="sm"
							onClick={handleLoadMore}
							className="h-7 w-full text-[10px] bg-foreground/[0.02] border-foreground/5 hover:bg-foreground/[0.05] text-muted-foreground hover:text-foreground transition-all"
						>
							{t("common.actions.loadMore", "Load more...")}
						</Button>
					</div>
				)}
			</div>
		);
	};

	return (
		<div className="space-y-4">
			<section className="flex flex-col gap-2">
				<div className="flex items-center justify-between gap-3">
					<p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
						{tSettings("background.title")}
					</p>
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
					onChange={(value) => onBackgroundBlurChange?.(value)}
					formatValue={(value) => `${value.toFixed(1)}px`}
					parseInput={(text) => parseFloat(text.replace(/px$/, ""))}
				/>
			</section>

			<div className="w-full">
				<LayoutGroup id="background-picker-switcher">
					<div className="grid h-8 w-full grid-cols-4 rounded-xl border border-foreground/10 bg-foreground/[0.04] p-1">
						{[
							{ value: "image", label: tSettings("background.image") },
							{ value: "video", label: tSettings("background.video", "Video") },
							{ value: "color", label: tSettings("background.color") },
							{ value: "gradient", label: tSettings("background.gradient") },
						].map((option) => {
							const isActive = backgroundTab === option.value;
							return (
								<button
									key={option.value}
									type="button"
									onClick={() => handleTabChange(option.value as BackgroundTab)}
									className="relative rounded-lg text-[10px] font-semibold tracking-wide transition-colors"
								>
									{isActive ? (
										<motion.span
											layoutId="background-picker-pill"
											className="absolute inset-0 rounded-lg bg-[#2563EB]"
											transition={{
												type: "spring",
												stiffness: 420,
												damping: 34,
											}}
										/>
									) : null}
									<span
										className={cn(
											"relative z-10",
											isActive
												? "text-white"
												: "text-muted-foreground hover:text-foreground",
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
					<motion.div
						key={backgroundTab}
						initial={{ opacity: 0, y: 4, filter: "blur(2px)" }}
						animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
						transition={{ duration: 0.12, ease: "easeOut" }}
					>
						{isInitialLoading || isPending ? (
							<div className="grid grid-cols-8 gap-1.5">
								{Array.from({ length: 16 }).map((_, i) => (
									<Skeleton key={i} className="aspect-square w-full rounded-[10px]" variant="subtle" animation="shimmer-premium" />
								))}
							</div>
						) : backgroundTab === "image" ? (
							<div className="mt-0 space-y-2">
								<input
									type="file"
									ref={(node) => {
										fileInputRef.current = node;
									}}
									onChange={handleImageUpload}
									accept=".jpg,.jpeg,image/jpeg"
									className="hidden"
								/>
								<Button
									onClick={() => fileInputRef.current?.click()}
									variant="outline"
									className="w-full gap-2 bg-foreground/5 text-foreground border-foreground/10 hover:bg-[#2563EB] hover:text-white hover:border-[#2563EB] transition-all h-7 text-[10px]"
								>
									<Upload className="w-3 h-3" />
									{tSettings("background.uploadCustom")}
								</Button>
								{renderImageTiles()}
							</div>
						) : backgroundTab === "video" ? (
							<div className="mt-0 space-y-2">
								<Button
									onClick={handleVideoUpload}
									variant="outline"
									className="w-full gap-2 bg-foreground/5 text-foreground border-foreground/10 hover:bg-[#2563EB] hover:text-white hover:border-[#2563EB] transition-all h-7 text-[10px]"
								>
									<Upload className="w-3 h-3" />
									{tSettings("background.uploadCustomVideo", "Upload Video")}
								</Button>
								{renderVideoTiles()}
							</div>
						) : backgroundTab === "color" ? (
							<div className="mt-0 space-y-2">
								<input
									ref={(node) => {
										customColorInputRef.current = node;
									}}
									type="color"
									value={selectedColor}
									onChange={(event) => {
										setSelectedColor(event.target.value);
										onWallpaperChange(event.target.value);
									}}
									className="sr-only"
								/>
								<div className="grid grid-cols-8 gap-1.5">
									{visibleColorPalette.map((color) => (
										<button
											key={color}
											type="button"
											onClick={() => {
												setSelectedColor(color);
												onWallpaperChange(color);
											}}
											className={wallpaperTileClass(
												selected.toLowerCase() === color.toLowerCase(),
											)}
											style={{ background: color }}
											aria-label={`Color ${color}`}
										/>
									))}
									<button
										type="button"
										onClick={() => customColorInputRef.current?.click()}
										className={wallpaperTileClass(
											isHexWallpaper(selected) &&
												!visibleColorPalette.some(
													(color) =>
														color.toLowerCase() ===
														selected.toLowerCase(),
												),
										)}
										style={{
											background: `linear-gradient(135deg, ${selectedColor} 0%, ${selectedColor} 58%, rgba(255,255,255,0.92) 58%, rgba(255,255,255,0.92) 100%)`,
										}}
										aria-label="Custom color picker"
									>
										<div className="absolute inset-0 flex items-center justify-center text-[9px] font-semibold uppercase tracking-[0.18em] text-foreground/90">
											Pick
										</div>
									</button>
								</div>
							</div>
						) : (
							<div className="mt-0 grid grid-cols-8 gap-1.5">
								{GRADIENTS.map((candidate, index) => (
									<div
										key={candidate}
										className={wallpaperTileClass(gradient === candidate)}
										aria-label={`Gradient ${index + 1}`}
										onClick={() => {
											setGradient(candidate);
											onWallpaperChange(candidate);
										}}
										role="button"
										tabIndex={0}
										onKeyDown={(event) => {
											if (isKeyboardActivationKey(event.key)) {
												event.preventDefault();
												setGradient(candidate);
												onWallpaperChange(candidate);
											}
										}}
									>
										<div
											className="absolute inset-[1px] overflow-hidden rounded-[8px]"
											style={{ background: candidate }}
										/>
									</div>
								))}
							</div>
						)}
					</motion.div>
				</div>
			</div>
		</div>
	);
});

BackgroundSection.displayName = "BackgroundSection";
