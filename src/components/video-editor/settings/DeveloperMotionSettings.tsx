import { Button } from "@/components/ui/button";
import { SettingsRow } from "@/components/video-editor/SettingsRow";
import { SliderControl } from "@/components/video-editor/SliderControl";
import { SectionLabel } from "./SettingsSectionLabel";
import type { ResolvedSettingsPanelProps } from "./settingsPanelDefaults";
import { useSettingsTranslations } from "./useSettingsTranslations";

export const developerMotionSettingsKeys = [
	"onShowOnboarding",
	"advanced",
	"cursorSpringStiffnessMultiplier",
	"onCursorSpringStiffnessMultiplierChange",
	"cursorSpringDampingMultiplier",
	"onCursorSpringDampingMultiplierChange",
	"cursorSpringMassMultiplier",
	"onCursorSpringMassMultiplierChange",
	"cameraSpringStiffnessMultiplier",
	"onCameraSpringStiffnessMultiplierChange",
	"cameraSpringDampingMultiplier",
	"onCameraSpringDampingMultiplierChange",
	"cameraSpringMassMultiplier",
	"onCameraSpringMassMultiplierChange",
	"nativeCaptureUnavailableSession",
	"onOpenNativeCaptureUnavailableModal",
] as const;
type Props = Pick<ResolvedSettingsPanelProps, (typeof developerMotionSettingsKeys)[number]>;
export function DeveloperMotionSettings(props: Props) {
	const {
		onShowOnboarding,
		advanced,
		cursorSpringStiffnessMultiplier,
		onCursorSpringStiffnessMultiplierChange,
		cursorSpringDampingMultiplier,
		onCursorSpringDampingMultiplierChange,
		cursorSpringMassMultiplier,
		onCursorSpringMassMultiplierChange,
		cameraSpringStiffnessMultiplier,
		onCameraSpringStiffnessMultiplierChange,
		cameraSpringDampingMultiplier,
		onCameraSpringDampingMultiplierChange,
		cameraSpringMassMultiplier,
		onCameraSpringMassMultiplierChange,
		nativeCaptureUnavailableSession,
		onOpenNativeCaptureUnavailableModal,
	} = props;
	const { te, tSettings, formatNumber } = useSettingsTranslations();
	const showDevMotionControls = import.meta.env.DEV;
	return (
		<>
			{import.meta.env.DEV && onShowOnboarding && (
				<div className="settings-group">
					<SettingsRow
						title={te("onboarding", "Onboarding")}
						description={te(
							"reviewSigninAndRecordingPermissions",
							"Review sign-in and recording permissions.",
						)}
					>
						<Button
							variant="secondary"
							size="sm"
							onClick={() => onShowOnboarding()}
						>
							{te("showOnboarding", "Show onboarding")}
						</Button>
					</SettingsRow>
				</div>
			)}
			{advanced && showDevMotionControls ? (
				<section className="settings-dev-tools flex flex-col gap-4 rounded-xl border border-separator bg-surface-secondary p-3">
					<div className="settings-dev-tools-header flex items-center justify-between gap-3">
						<div>
							<SectionLabel>{tSettings("effects.devSection", "Dev")}</SectionLabel>
						</div>
						<span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs font-medium uppercase tracking-wider text-accent">
							DEV
						</span>
					</div>

					<div className="rounded-lg border border-foreground/10 bg-background/60 px-3 py-3">
						<div className="settings-dev-action flex items-start justify-between gap-3">
							<div>
								<div className="text-sm font-medium text-foreground">
									{tSettings(
										"effects.nativeCaptureWarningTester",
										"Native capture warning",
									)}
								</div>
								<div className="mt-0.5 text-xs text-muted-foreground">
									{nativeCaptureUnavailableSession
										? tSettings(
												"effects.nativeCaptureWarningTesterUnavailable",
												"This project is currently marked as native capture unavailable.",
											)
										: tSettings(
												"effects.nativeCaptureWarningTesterAvailable",
												"This project is not marked as unsupported, but you can still open the modal for UI testing.",
											)}
								</div>
							</div>
							<Button
								type="button"
								variant="outline"
								size="sm"
								onClick={() => onOpenNativeCaptureUnavailableModal?.()}
								className="h-8 shrink-0"
							>
								{tSettings("effects.openNativeCaptureWarning", "Open warning")}
							</Button>
						</div>
					</div>

					<div className="settings-dev-tuning space-y-1.5 rounded-lg border border-foreground/10 bg-background/60 px-3 py-3">
						<div>
							<div className="text-sm font-medium text-foreground">
								{tSettings("effects.cameraDebugTuning", "Camera Debug Tuning")}
							</div>
						</div>
						<SliderControl
							label={tSettings(
								"effects.cameraSpringStiffnessMultiplier",
								"Camera stiffness",
							)}
							value={cameraSpringStiffnessMultiplier}
							min={0.25}
							max={3}
							step={0.01}
							onChange={(value) => onCameraSpringStiffnessMultiplierChange?.(value)}
							formatValue={(value) => `${formatNumber(value, 2)}×`}
						/>
						<SliderControl
							label={tSettings(
								"effects.cameraSpringDampingMultiplier",
								"Camera damping",
							)}
							value={cameraSpringDampingMultiplier}
							min={0.25}
							max={3}
							step={0.01}
							onChange={(value) => onCameraSpringDampingMultiplierChange?.(value)}
							formatValue={(value) => `${formatNumber(value, 2)}×`}
						/>
						<SliderControl
							label={tSettings("effects.cameraSpringMassMultiplier", "Camera mass")}
							value={cameraSpringMassMultiplier}
							min={0.25}
							max={3}
							step={0.01}
							onChange={(value) => onCameraSpringMassMultiplierChange?.(value)}
							formatValue={(value) => `${formatNumber(value, 2)}×`}
						/>
					</div>

					<div className="settings-dev-tuning space-y-1.5 rounded-lg border border-foreground/10 bg-background/60 px-3 py-3">
						<div>
							<div className="text-sm font-medium text-foreground">
								{tSettings("effects.cursorDebugTuning", "Cursor Debug Tuning")}
							</div>
						</div>
						<SliderControl
							label={tSettings(
								"effects.cursorSpringStiffnessMultiplier",
								"Spring stiffness",
							)}
							value={cursorSpringStiffnessMultiplier}
							min={0.25}
							max={3}
							step={0.01}
							onChange={(value) => onCursorSpringStiffnessMultiplierChange?.(value)}
							formatValue={(value) => `${formatNumber(value, 2)}×`}
						/>
						<SliderControl
							label={tSettings(
								"effects.cursorSpringDampingMultiplier",
								"Spring damping",
							)}
							value={cursorSpringDampingMultiplier}
							min={0.25}
							max={3}
							step={0.01}
							onChange={(value) => onCursorSpringDampingMultiplierChange?.(value)}
							formatValue={(value) => `${formatNumber(value, 2)}×`}
						/>
						<SliderControl
							label={tSettings("effects.cursorSpringMassMultiplier", "Spring mass")}
							value={cursorSpringMassMultiplier}
							min={0.25}
							max={3}
							step={0.01}
							onChange={(value) => onCursorSpringMassMultiplierChange?.(value)}
							formatValue={(value) => `${formatNumber(value, 2)}×`}
						/>
					</div>
				</section>
			) : null}
		</>
	);
}
