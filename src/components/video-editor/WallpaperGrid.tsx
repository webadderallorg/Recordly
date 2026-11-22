import { Button, ToggleButton } from "@heroui/react";
import { useEffect, useState } from "react";
import { DesktopIcon, Plus, X } from "@/components/ui/icons";
import { useScopedT } from "@/contexts/I18nContext";
import { getRenderableVideoUrl } from "@/lib/assetPath";
import { isVideoWallpaperSource } from "@/lib/wallpapers";
import { WallpaperGlassGrid } from "./WallpaperGlassGrid";

interface WallpaperTile {
	key: string;
	value: string;
	previewUrl: string;
	label: string;
	removable?: boolean;
	disabled?: boolean;
	badge?: string;
}

/** Shared image/video gallery. Removal stays separate from the selection button. */
export function WallpaperGrid({
	items,
	addLabel,
	onAdd,
	onSelect,
	onRemove,
	isSelected,
}: {
	items: WallpaperTile[];
	addLabel: string;
	onAdd: () => void;
	onSelect: (value: string) => void;
	onRemove: (value: string) => void;
	isSelected: (value: string, previewUrl?: string) => boolean;
}) {
	const te = useScopedT("editing");
	return (
		<WallpaperGlassGrid>
			<Button
				variant="secondary"
				isIconOnly
				aria-label={addLabel}
				onPress={onAdd}
				className="wallpaper-upload-tile aspect-[4/3] h-auto w-full min-w-0 overflow-hidden rounded-md p-0 text-muted"
			>
				<Plus className="relative z-10 size-4" />
			</Button>
			{items.map((item) => {
				const selected = !item.disabled && isSelected(item.value, item.previewUrl);
				return (
					<div key={item.key} className="group relative flex min-w-0">
						<ToggleButton
							isSelected={selected}
							isDisabled={item.disabled}
							aria-label={item.label}
							onChange={() => onSelect(item.value)}
							className="wallpaper-tile relative aspect-[4/3] h-auto w-full min-w-0 overflow-hidden rounded-md p-0"
						>
							{isVideoWallpaperSource(item.previewUrl) ? (
								<WallpaperVideoPreview src={item.previewUrl} />
							) : item.previewUrl ? (
								<img
									src={item.previewUrl || undefined}
									alt=""
									loading="lazy"
									decoding="async"
									draggable={false}
									className="absolute inset-0 h-full w-full select-none object-cover"
								/>
							) : item.badge ? (
								<DesktopIcon className="size-4 text-muted" aria-hidden="true" />
							) : null}
						</ToggleButton>
						{item.removable && (
							<Button
								variant="secondary"
								isIconOnly
								aria-label={te("removeGradient", "Remove {{name}}", {
									name: item.label,
								})}
								onPress={() => onRemove(item.value)}
								className="absolute right-0.5 top-0.5 z-10 size-5 min-w-0 rounded-full p-0 bg-overlay text-foreground shadow-sm opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100"
							>
								<X className="size-3" />
							</Button>
						)}
					</div>
				);
			})}
		</WallpaperGlassGrid>
	);
}

function WallpaperVideoPreview({ src }: { src: string }) {
	const [resolvedSrc, setResolvedSrc] = useState(src);

	useEffect(() => {
		let cancelled = false;
		setResolvedSrc(src);

		void (async () => {
			try {
				const nextSrc = await getRenderableVideoUrl(src);
				if (!cancelled) {
					setResolvedSrc(nextSrc);
				}
			} catch {
				if (!cancelled) {
					setResolvedSrc(src);
				}
			}
		})();

		return () => {
			cancelled = true;
		};
	}, [src]);

	return (
		<video
			src={resolvedSrc}
			muted
			playsInline
			preload="metadata"
			className="absolute inset-0 h-full w-full select-none object-cover"
			draggable={false}
			onMouseEnter={(e) => e.currentTarget.play().catch(() => undefined)}
			onMouseLeave={(e) => {
				e.currentTarget.pause();
				e.currentTarget.currentTime = 0;
			}}
		/>
	);
}
