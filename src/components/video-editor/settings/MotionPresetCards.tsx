import { Description, Label, Radio, RadioGroup } from "@heroui/react";
import { type CursorMotionPresetId } from "@/components/video-editor/cursorMotionPresets";

const MOTION_PRESET_ORDER: CursorMotionPresetId[] = ["focused", "smooth"];

export function MotionPresetCards({
	title,
	activePresetId,
	onApply,
	tSettings,
}: {
	title: string;
	activePresetId: CursorMotionPresetId | null;
	onApply: (presetId: CursorMotionPresetId) => void;
	tSettings: (key: string, fallback?: string) => string;
}) {
	return (
		<RadioGroup
			variant="secondary"
			className="settings-motion-presets"
			value={activePresetId ?? "custom"}
			onChange={(value) => onApply(value as CursorMotionPresetId)}
		>
			<Label className="text-[13px] font-medium">{title}</Label>
			{activePresetId === null && (
				<p role="status" className="text-xs text-muted">
					{tSettings(
						"appPreferences.customMotion",
						"Custom · Your settings differ from these presets.",
					)}
				</p>
			)}
			{MOTION_PRESET_ORDER.map((presetId) => (
				<Radio
					key={presetId}
					value={presetId}
					className="rounded-xl border border-separator p-3"
				>
					<Radio.Content>
						<div
							aria-hidden="true"
							className={`settings-motion-preview settings-motion-preview-${presetId}`}
						>
							<span />
						</div>
						<Radio.Control>
							<Radio.Indicator />
						</Radio.Control>
						<div className="flex min-w-0 flex-col gap-1">
							<Label className="text-[13px] font-medium">
								{tSettings(`effects.motionPresets.${presetId}.label`)}
							</Label>
							<Description className="text-xs leading-relaxed">
								{tSettings(`effects.motionPresets.${presetId}.description`)}
							</Description>
						</div>
					</Radio.Content>
				</Radio>
			))}
		</RadioGroup>
	);
}
