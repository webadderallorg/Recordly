import CaptionListPanel from "@/components/video-editor/CaptionListPanel";

import type { ResolvedSettingsPanelProps } from "./settingsPanelDefaults";
import { useSettingsTranslations } from "./useSettingsTranslations";

export const captionItemSettingsKeys = [
	"autoCaptions",
	"captionCurrentTimeMs",
	"selectedCaptionId",
	"onBeginCaptionEdit",
	"onCaptionTextEdit",
	"onCaptionRetime",
	"onCaptionSplit",
	"onCaptionMerge",
	"onCaptionDelete",
] as const;
type Props = Pick<ResolvedSettingsPanelProps, (typeof captionItemSettingsKeys)[number]>;
export function CaptionItemSettings(props: Props) {
	const {
		autoCaptions,
		captionCurrentTimeMs,
		selectedCaptionId,
		onBeginCaptionEdit,
		onCaptionTextEdit,
		onCaptionRetime,
		onCaptionSplit,
		onCaptionMerge,
		onCaptionDelete,
	} = props;
	const { tSettings } = useSettingsTranslations();

	return (
		<section className="flex flex-col gap-4">
			{selectedCaptionId !== null ? (
				<CaptionListPanel
					cues={autoCaptions}
					selectedCaptionId={selectedCaptionId}
					currentTimeMs={captionCurrentTimeMs}
					onBeginCaptionEdit={(id) => onBeginCaptionEdit?.(id)}
					onCaptionTextEdit={(id, text) => onCaptionTextEdit?.(id, text)}
					onCaptionRetime={(id, span) => onCaptionRetime?.(id, span)}
					onCaptionSplit={(id, atMs) => onCaptionSplit?.(id, atMs)}
					onCaptionMerge={(idA, idB) => onCaptionMerge?.(idA, idB)}
					onCaptionDelete={(id) => onCaptionDelete?.(id)}
				/>
			) : (
				<div className="rounded-lg bg-foreground/[0.03] px-2.5 py-6 text-center">
					<p className="text-xs text-muted-foreground">
						{tSettings(
							"captions.selectOnTimeline",
							"Select a caption on the timeline to edit it.",
						)}
					</p>
				</div>
			)}
		</section>
	);
}
