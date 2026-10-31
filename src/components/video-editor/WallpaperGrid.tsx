import { Button, ToggleButton } from "@heroui/react";
import { Check, Plus, X } from "@/components/ui/icons";
import { useEffect, useState } from "react";
import { getRenderableVideoUrl } from "@/lib/assetPath";
import { isVideoWallpaperSource } from "@/lib/wallpapers";

interface WallpaperTile {
	key: string;
	value: string;
	previewUrl: string;
	label: string;
	removable?: boolean;
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
	return (
		<div className="grid grid-cols-5 gap-2">
			<Button
				variant="secondary"
				isIconOnly
				aria-label={addLabel}
				onPress={onAdd}
				className="aspect-[4/3] h-auto w-full min-w-0 rounded-md p-0 text-muted"
			>
				<Plus className="size-4" />
			</Button>
			{items.map((item) => {
				const selected = isSelected(item.value, item.previewUrl);
				return (
					<div key={item.key} className="group relative flex min-w-0">
						<ToggleButton
							isSelected={selected}
							aria-label={item.label}
							onChange={() => onSelect(item.value)}
							className="relative aspect-[4/3] h-auto w-full min-w-0 overflow-hidden rounded-md p-0"
						>
							{isVideoWallpaperSource(item.previewUrl) ? (
								<WallpaperVideoPreview src={item.previewUrl} />
							) : (
								<img
									src={item.previewUrl || undefined}
									alt=""
									loading="lazy"
									decoding="async"
									draggable={false}
									className="absolute inset-0 h-full w-full select-none object-cover"
								/>
							)}
							{selected && (
								<span className="absolute bottom-1 left-1 flex size-4 items-center justify-center rounded-full bg-black/65 text-white">
									<Check className="size-3" />
								</span>
							)}
						</ToggleButton>
						{item.removable && (
							<Button
								variant="secondary"
								isIconOnly
								aria-label={`Remove ${item.label}`}
								onPress={() => onRemove(item.value)}
								className="absolute right-0.5 top-0.5 z-10 size-5 min-w-0 rounded-full p-0 bg-overlay text-foreground shadow-sm opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100"
							>
								<X className="size-3" />
							</Button>
						)}
					</div>
				);
			})}
		</div>
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
