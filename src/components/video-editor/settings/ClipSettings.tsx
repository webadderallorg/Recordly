import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { SliderControl } from "@/components/video-editor/SliderControl";
import { getPreviewPlaybackRateRange } from "@/components/video-editor/videoPlayback/playbackRate";

import type { ResolvedSettingsPanelProps } from "./settingsPanelDefaults";
import { useSettingsTranslations } from "./useSettingsTranslations";

export const clipSettingsKeys = [
	"selectedClipSpeed",
	"selectedClipMuted",
	"hasClipAudioOverrides",
	"onResetClipAudio",
	"onClipSpeedChange",
	"onClipMutedChange",
] as const;
type Props = Pick<ResolvedSettingsPanelProps, (typeof clipSettingsKeys)[number]> & {
	clipSpeedRange: ReturnType<typeof getPreviewPlaybackRateRange>;
};
export function ClipSettings(props: Props) {
	const {
		selectedClipSpeed,
		selectedClipMuted,
		hasClipAudioOverrides,
		onResetClipAudio,
		onClipSpeedChange,
		onClipMutedChange,
	} = props;
	const { tSettings, formatNumber } = useSettingsTranslations();
	const { clipSpeedRange } = props;
	return (
		<section className="flex flex-col gap-3">
			<SliderControl
				label={tSettings("speed.label", "Speed")}
				value={Math.min(
					clipSpeedRange.max,
					Math.max(clipSpeedRange.min, selectedClipSpeed ?? 1),
				)}
				min={clipSpeedRange.min}
				max={clipSpeedRange.max}
				step={0.25}
				onChange={(value) => onClipSpeedChange?.(value)}
				formatValue={(value) => `${formatNumber(value)}×`}
			/>
			{selectedClipSpeed != null &&
				(selectedClipSpeed < clipSpeedRange.min ||
					selectedClipSpeed > clipSpeedRange.max) && (
					<p className="text-xs text-muted-foreground" role="status">
						{formatNumber(selectedClipSpeed)}× —{" "}
						{tSettings("speed.unsupported", "Not supported for preview on this device")}
					</p>
				)}
			<label className="flex items-center justify-between py-2">
				<span className="text-xs text-muted-foreground">
					{tSettings("clip.mute", "Mute clip")}
				</span>
				<Switch
					checked={selectedClipMuted ?? false}
					onCheckedChange={(muted) => onClipMutedChange?.(muted)}
					aria-label={tSettings("clip.mute", "Mute clip")}
				/>
			</label>
			{hasClipAudioOverrides && onResetClipAudio && (
				<Button type="button" variant="ghost" onClick={onResetClipAudio}>
					{tSettings("clip.resetAudioSettings", "Reset audio settings")}
				</Button>
			)}
		</section>
	);
}
