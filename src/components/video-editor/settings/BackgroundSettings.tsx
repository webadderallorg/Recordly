import { useMemo, useRef, useState } from "react";
import { ChoiceGroup, ChoiceItem } from "@/components/ui/choice-group";
import { ColorBackgroundPicker } from "@/components/video-editor/ColorBackgroundPicker";
import { GradientPicker } from "@/components/video-editor/GradientPicker";
import { WallpaperGrid } from "@/components/video-editor/WallpaperGrid";
import { DESKTOP_WALLPAPER } from "@/lib/desktopWallpaper";
import { isVideoWallpaperSource } from "@/lib/wallpapers";
import { WALLPAPER_UPLOAD_ACCEPT } from "@/lib/wallpaperUpload";
import { loadEditorPreferences } from "../editorPreferences";

import { colorPalette, GRADIENTS, isHexWallpaper } from "./backgroundPresets";
import type { ResolvedSettingsPanelProps } from "./settingsPanelDefaults";
import type { useBackgroundSettings } from "./useBackgroundSettings";
import { useScrollFade } from "./useScrollFade";
import { useSettingsTranslations } from "./useSettingsTranslations";

export const backgroundSettingsKeys = ["onWallpaperChange"] as const;
type Props = Pick<ResolvedSettingsPanelProps, (typeof backgroundSettingsKeys)[number]> & {
	background: ReturnType<typeof useBackgroundSettings>;
};
export function BackgroundSettings(props: Props) {
	const { onWallpaperChange } = props;
	const [gradientOpen, setGradientOpen] = useState(false);
	const [swatchRevision, setSwatchRevision] = useState(0);
	const refreshCustomSwatches = () => setSwatchRevision((revision) => revision + 1);
	const { tSettings, t } = useSettingsTranslations();
	const {
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
	} = props.background;
	const galleryRef = useRef<HTMLDivElement>(null);
	const galleryFade = useScrollFade(galleryRef, backgroundTab);
	// Reserve the same gallery footprint for every tab without mounting hidden media.
	// biome-ignore lint/correctness/useExhaustiveDependencies: refresh saved custom swatches on tab/selection/custom list changes, not every playback tick.
	const preferences = useMemo(
		() => loadEditorPreferences(),
		[backgroundTab, selected, swatchRevision],
	);
	const colors = new Set(
		[
			...colorPalette,
			...preferences.customColors,
			...(isHexWallpaper(selected) ? [selected] : []),
		].map((color) => color.toLowerCase()),
	);
	const extraGradient =
		(selected.startsWith("linear-gradient(") || selected.startsWith("radial-gradient(")) &&
		!GRADIENTS.includes(selected) &&
		!preferences.customGradients.includes(selected)
			? 1
			: 0;
	const gallerySlots = Math.max(
		1 +
			imageWallpaperTiles.length +
			customImages.filter((url) => !isVideoWallpaperSource(url)).length,
		1 + videoWallpaperTiles.length + customImages.filter(isVideoWallpaperSource).length,
		1 + colors.size + GRADIENTS.length + preferences.customGradients.length + extraGradient,
	);
	return (
		<div className="space-y-5">
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
					className="grid w-full grid-cols-3 gap-2"
				>
					{(
						[
							{ value: "image", label: tSettings("background.image") },
							{ value: "video", label: tSettings("background.video", "Video") },
							{ value: "colors", label: t("capture.colors") },
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
					accept={WALLPAPER_UPLOAD_ACCEPT}
					className="hidden"
				/>
				<div className="grid pt-4 overflow-hidden" data-testid="background-slider">
					<div
						aria-hidden="true"
						className="invisible pointer-events-none grid max-h-64 grid-cols-5 gap-2 overflow-hidden [grid-area:1/1]"
					>
						{Array.from({ length: gallerySlots }, (_, slot) => (
							<div key={slot} className="aspect-[4/3]" />
						))}
					</div>
					<div
						key={backgroundTab}
						ref={galleryRef}
						data-background-scroller={backgroundTab}
						data-scroll-shadow-mode={galleryFade}
						className="min-w-0 max-h-64 self-start overflow-y-auto overscroll-contain [grid-area:1/1] scroll-shadow scroll-shadow--vertical scroll-shadow--fade scroll-shadow--hide-scrollbar [--scroll-shadow-size:12px]"
					>
						<div
							data-background-panel={backgroundTab}
							className="editor-section-enter min-w-0"
						>
							{backgroundTab === "image" || backgroundTab === "video" ? (
								<>
									<WallpaperGrid
										addLabel={
											backgroundTab === "image"
												? tSettings(
														"background.addWallpaper",
														"Add wallpaper",
													)
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
											...(backgroundTab === "image"
												? imageWallpaperTiles.filter(
														(tile) =>
															tile.key ===
															`builtin/${DESKTOP_WALLPAPER}`,
													)
												: []),
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
												? imageWallpaperTiles.filter(
														(tile) =>
															tile.key !==
															`builtin/${DESKTOP_WALLPAPER}`,
													)
												: videoWallpaperTiles),
										]}
									/>
								</>
							) : (
								<ColorBackgroundPicker
									value={selected}
									presets={colorPalette}
									tileClassName={wallpaperTileClass}
									onChange={onWallpaperChange}
									onCreateGradient={() => setGradientOpen(true)}
									onCustomChange={refreshCustomSwatches}
								>
									<GradientPicker
										value={selected}
										presets={GRADIENTS}
										tileClassName={wallpaperTileClass}
										onChange={onWallpaperChange}
										embedded
										onCustomChange={refreshCustomSwatches}
										open={gradientOpen}
										onOpenChange={setGradientOpen}
									/>
								</ColorBackgroundPicker>
							)}
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}
