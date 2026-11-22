import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { SliderControl } from "@/components/video-editor/SliderControl";
import { SectionLabel } from "./SettingsSectionLabel";
import type { ResolvedSettingsPanelProps } from "./settingsPanelDefaults";
import { useSettingsTranslations } from "./useSettingsTranslations";

export const audioSettingsKeys = [
	"selectedAudioVolume",
	"selectedAudioNormalize",
	"onAudioVolumeChange",
	"onAudioNormalizeChange",
] as const;
type Props = Pick<ResolvedSettingsPanelProps, (typeof audioSettingsKeys)[number]>;
export function AudioSettings(props: Props) {
	const {
		selectedAudioVolume,
		selectedAudioNormalize,
		onAudioVolumeChange,
		onAudioNormalizeChange,
	} = props;
	const { tSettings, t } = useSettingsTranslations();

	return (
		<section className="flex flex-col gap-3">
			<div className="flex items-center justify-between gap-3">
				<SectionLabel>{tSettings("audio.volumeTitle", "Audio")}</SectionLabel>
				<Button
					className="text-xs text-muted"
					size="sm"
					variant="ghost"
					type="button"
					onClick={() => {
						onAudioVolumeChange?.(1);
						onAudioNormalizeChange?.(false);
					}}
				>
					{t("common.actions.reset", "Reset")}
				</Button>
			</div>
			<SliderControl
				label={tSettings("audio.volume", "Volume")}
				value={selectedAudioVolume ?? 1}
				min={0}
				max={1}
				step={0.01}
				onChange={(v) => onAudioVolumeChange?.(v)}
				formatValue={(v) => `${Math.round(v * 100)}%`}
			/>
			<div className="flex items-center justify-between py-2">
				<span className="text-xs text-muted-foreground">
					{tSettings("audio.normalize", "Normalize")}
				</span>
				<Switch
					aria-label={tSettings("audio.normalize", "Normalize")}
					checked={Boolean(selectedAudioNormalize)}
					onCheckedChange={(v) => onAudioNormalizeChange?.(v)}
				/>
			</div>
		</section>
	);
}
