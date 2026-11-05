import { SliderControl } from "@/components/video-editor/SliderControl";

import type { ResolvedSettingsPanelProps } from "./settingsPanelDefaults";
import { useSettingsTranslations } from "./useSettingsTranslations";

export const backgroundDetailsKeys = ["backgroundBlur", "onBackgroundBlurChange"] as const;
type Props = Pick<ResolvedSettingsPanelProps, (typeof backgroundDetailsKeys)[number]>;
export function BackgroundDetails(props: Props) {
	const { backgroundBlur, onBackgroundBlurChange } = props;
	const { tSettings, formatNumber } = useSettingsTranslations();

	return (
		<SliderControl
			label={tSettings("effects.backgroundBlur")}
			value={backgroundBlur}
			min={0}
			max={8}
			step={0.25}
			onChange={(value) => onBackgroundBlurChange?.(value)}
			formatValue={(value) => `${formatNumber(value, 1)}px`}
		/>
	);
}
