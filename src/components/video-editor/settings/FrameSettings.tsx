import { Label } from "@heroui/react";
import { Switch } from "@/components/ui/switch";
import { SliderControl } from "@/components/video-editor/SliderControl";
import { ADVANCED_VERTICAL_PADDING_MAX } from "@/components/video-editor/types";
import { BackgroundDetails, backgroundDetailsKeys } from "./BackgroundDetails";
import type { ResolvedSettingsPanelProps } from "./settingsPanelDefaults";
import type { useFrameSettings } from "./useFrameSettings";
import { useSettingsTranslations } from "./useSettingsTranslations";

export const frameSettingsKeys = [
	"advanced",
	...backgroundDetailsKeys,
	"shadowIntensity",
	"onShadowChange",
	"borderRadius",
	"onBorderRadiusChange",
	"padding",
] as const;
type Props = Pick<ResolvedSettingsPanelProps, (typeof frameSettingsKeys)[number]> & {
	frame: ReturnType<typeof useFrameSettings>;
};
export function FrameSettings(props: Props) {
	const {
		advanced,
		shadowIntensity,
		onShadowChange,
		borderRadius,
		onBorderRadiusChange,
		padding,
	} = props;
	const { te, tSettings } = useSettingsTranslations();
	const {
		removeBackgroundEnabled,
		handleRemoveBackgroundToggle,
		togglePaddingLink,
		handlePaddingSideChange,
	} = props.frame;
	return (
		<section className="flex flex-col gap-4">
			<div className="flex flex-col gap-3">
				<div className="flex flex-col gap-3 pt-0.5">
					{advanced && (
						<div className="flex items-center justify-between gap-3">
							<Label>{te("linkPaddingSides", "Link padding sides")}</Label>
							<Switch
								aria-label={te("linkPaddingSides", "Link padding sides")}
								checked={padding.linked !== false}
								onCheckedChange={togglePaddingLink}
							/>
						</div>
					)}

					{padding.linked !== false ? (
						<SliderControl
							label={tSettings("effects.padding")}
							value={padding.top}
							min={0}
							max={100}
							step={1}
							onChange={(v) => handlePaddingSideChange("top", v)}
							formatValue={(v) => `${v}%`}
						/>
					) : (
						<div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
							<SliderControl
								label={tSettings("effects.paddingTop", "Top")}
								value={padding.top}
								min={0}
								max={ADVANCED_VERTICAL_PADDING_MAX}
								step={1}
								onChange={(v) => handlePaddingSideChange("top", v)}
								formatValue={(v) => `${v}%`}
							/>
							<SliderControl
								label={tSettings("effects.paddingBottom", "Bottom")}
								value={padding.bottom}
								min={0}
								max={ADVANCED_VERTICAL_PADDING_MAX}
								step={1}
								onChange={(v) => handlePaddingSideChange("bottom", v)}
								formatValue={(v) => `${v}%`}
							/>
							<SliderControl
								label={tSettings("effects.paddingLeft", "Left")}
								value={padding.left}
								min={0}
								max={100}
								step={1}
								onChange={(v) => handlePaddingSideChange("left", v)}
								formatValue={(v) => `${v}%`}
							/>
							<SliderControl
								label={tSettings("effects.paddingRight", "Right")}
								value={padding.right}
								min={0}
								max={100}
								step={1}
								onChange={(v) => handlePaddingSideChange("right", v)}
								formatValue={(v) => `${v}%`}
							/>
						</div>
					)}
				</div>
				<BackgroundDetails
					backgroundBlur={props.backgroundBlur}
					onBackgroundBlurChange={props.onBackgroundBlurChange}
				/>
				<SliderControl
					label={tSettings("effects.shadow")}
					value={shadowIntensity}
					min={0}
					max={1}
					step={0.01}
					onChange={(v) => onShadowChange?.(v)}
					formatValue={(v) => `${Math.round(v * 100)}%`}
				/>
				<SliderControl
					label={tSettings("effects.radius", "Radius")}
					value={borderRadius}
					min={0}
					max={50}
					step={0.1}
					onChange={(v) => onBorderRadiusChange?.(v)}
					formatValue={(v) => `${v}%`}
				/>
				<div className="flex items-center justify-between py-2">
					<span className="text-xs text-muted-foreground">
						{tSettings("effects.removeBackground")}
					</span>
					<Switch
						aria-label={tSettings("effects.removeBackground")}
						checked={removeBackgroundEnabled}
						onCheckedChange={handleRemoveBackgroundToggle}
					/>
				</div>
			</div>
		</section>
	);
}
