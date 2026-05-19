import { SliderControl } from "../../SliderControl";
import { Skeleton } from "@/components/ui/skeleton";
import { type CropRegion, DEFAULT_CROP_REGION } from "../../types";

export function CropSection({
	tSettings,
	t,
	cropRegion,
	onCropChange,
	isInitialLoading = false,
}: {
	tSettings: (key: string, fallback?: string) => string;
	t: (key: string, fallback?: string) => string;
	cropRegion?: CropRegion;
	onCropChange?: (region: CropRegion) => void;
	isInitialLoading?: boolean;
}) {
	const crop = cropRegion ?? DEFAULT_CROP_REGION;
	const cropTop = Math.round(crop.y * 100);
	const cropLeft = Math.round(crop.x * 100);
	const cropBottom = Math.round((1 - crop.y - crop.height) * 100);
	const cropRight = Math.round((1 - crop.x - crop.width) * 100);
	const isCropped = cropTop > 0 || cropLeft > 0 || cropBottom > 0 || cropRight > 0;

	const setCropInset = (side: "top" | "bottom" | "left" | "right", pct: number) => {
		if (!onCropChange) return;

		const MIN_DIMENSION = 0.05;
		const v = pct / 100;
		let { x, y, width, height } = crop;

		if (side === "top") {
			const bottomEdge = crop.y + crop.height;
			const maxY = bottomEdge - MIN_DIMENSION;
			const nextY = Math.min(v, maxY);
			y = nextY;
			height = bottomEdge - nextY;
		}

		if (side === "left") {
			const rightEdge = crop.x + crop.width;
			const maxX = rightEdge - MIN_DIMENSION;
			const nextX = Math.min(v, maxX);
			x = nextX;
			width = rightEdge - nextX;
		}

		if (side === "bottom") {
			height = Math.max(MIN_DIMENSION, 1 - crop.y - v);
		}

		if (side === "right") {
			width = Math.max(MIN_DIMENSION, 1 - crop.x - v);
		}

		onCropChange({ x, y, width, height });
	};

	if (isInitialLoading) {
		return (
			<section className="flex flex-col gap-2 animate-in fade-in duration-200">
				<div className="flex items-center justify-between gap-3">
					<Skeleton className="h-3 w-12" variant="subtle" />
				</div>
				<div className="flex flex-col gap-1.5">
					{[...Array(4)].map((_, i) => (
						<Skeleton key={i} className="h-8 w-full rounded-lg" variant="subtle" animation="shimmer-premium" />
					))}
				</div>
			</section>
		);
	}

	return (
		<section className="flex flex-col gap-2 animate-in fade-in duration-300">
			<div className="flex items-center justify-between gap-3">
				<p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
					{tSettings("sections.crop", "Crop")}
				</p>
				{isCropped ? (
					<button
						type="button"
						onClick={() => onCropChange?.(DEFAULT_CROP_REGION)}
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
}
