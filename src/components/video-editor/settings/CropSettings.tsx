import { Button } from "@/components/ui/button";
import { SliderControl } from "@/components/video-editor/SliderControl";
import { DEFAULT_CROP_REGION } from "@/components/video-editor/types";
import { SectionLabel } from "./SettingsSectionLabel";
import type { ResolvedSettingsPanelProps } from "./settingsPanelDefaults";
import { useSettingsTranslations } from "./useSettingsTranslations";

export const cropSettingsKeys = ["cropRegion", "onCropChange"] as const;
type Props = Pick<ResolvedSettingsPanelProps, (typeof cropSettingsKeys)[number]>;
const CROP_STEP_PERCENT = 0.1;

function insetPercent(inset: number) {
	return Number((Math.max(0, inset) * 100).toFixed(1));
}

export function CropSettings(props: Props) {
	const { cropRegion, onCropChange } = props;
	const { tSettings, t, locale } = useSettingsTranslations();
	const crop = cropRegion ?? {
		x: 0,
		y: 0,
		width: 1,
		height: 1,
	};
	const cropTop = insetPercent(crop.y);
	const cropLeft = insetPercent(crop.x);
	const cropBottom = insetPercent(1 - crop.y - crop.height);
	const cropRight = insetPercent(1 - crop.x - crop.width);
	const isCropped = cropTop > 0 || cropLeft > 0 || cropBottom > 0 || cropRight > 0;
	const percentFormatter = new Intl.NumberFormat(locale, {
		style: "percent",
		minimumFractionDigits: 1,
		maximumFractionDigits: 1,
	});
	const formatPercent = (value: number) => percentFormatter.format(value / 100);

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
	const resetCropSection = () => {
		onCropChange?.(DEFAULT_CROP_REGION);
	};

	return (
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
					step={CROP_STEP_PERCENT}
					onChange={(v) => setCropInset("top", v)}
					formatValue={formatPercent}
				/>
				<SliderControl
					label={tSettings("crop.bottom", "Bottom")}
					value={cropBottom}
					min={0}
					max={50}
					step={CROP_STEP_PERCENT}
					onChange={(v) => setCropInset("bottom", v)}
					formatValue={formatPercent}
				/>
				<SliderControl
					label={tSettings("crop.left", "Left")}
					value={cropLeft}
					min={0}
					max={50}
					step={CROP_STEP_PERCENT}
					onChange={(v) => setCropInset("left", v)}
					formatValue={formatPercent}
				/>
				<SliderControl
					label={tSettings("crop.right", "Right")}
					value={cropRight}
					min={0}
					max={50}
					step={CROP_STEP_PERCENT}
					onChange={(v) => setCropInset("right", v)}
					formatValue={formatPercent}
				/>
			</div>
		</section>
	);
}
