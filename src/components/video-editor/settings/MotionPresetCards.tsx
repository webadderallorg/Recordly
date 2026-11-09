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
							<svg viewBox="0 0 84 50" fill="none">
								<g className="settings-motion-scene">
									<rect
										x="9"
										y="7"
										width="66"
										height="36"
										rx="4"
										fill="var(--surface)"
										stroke="var(--separator)"
									/>
									<path d="M9 15H75M27 15V43" stroke="var(--separator)" />
									<rect
										x="14"
										y="20"
										width="8"
										height="3"
										rx="1.5"
										fill="var(--muted)"
										opacity=".4"
									/>
									<rect
										x="14"
										y="27"
										width="8"
										height="3"
										rx="1.5"
										fill="var(--muted)"
										opacity=".4"
									/>
									<rect
										x="34"
										y="21"
										width="32"
										height="15"
										rx="3"
										fill="var(--accent)"
										opacity=".15"
									/>
								</g>
								<path
									className="settings-motion-cursor"
									d="M28 27V39L32 35L35 40L38 38L35 33H41L28 27Z"
								/>
							</svg>
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
