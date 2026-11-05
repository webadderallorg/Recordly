import { Button } from "@/components/ui/button";
import { ChoiceGroup, ChoiceItem } from "@/components/ui/choice-group";
import { Switch } from "@/components/ui/switch";
import { CURSOR_MOTION_PRESETS } from "@/components/video-editor/cursorMotionPresets";
import { DEFAULT_EDITOR_PREFERENCES } from "@/components/video-editor/editorPreferences";
import type { ZoomDepth, ZoomMode } from "@/components/video-editor/types";
import { SectionLabel } from "./SettingsSectionLabel";
import type { ResolvedSettingsPanelProps } from "./settingsPanelDefaults";
import { useSettingsTranslations } from "./useSettingsTranslations";

const ZOOM_DEPTH_OPTIONS: Array<{ depth: ZoomDepth; factor: number }> = [
	{ depth: 1, factor: 1.25 },
	{ depth: 2, factor: 1.5 },
	{ depth: 3, factor: 1.8 },
	{ depth: 4, factor: 2.2 },
	{ depth: 5, factor: 3.5 },
	{ depth: 6, factor: 5 },
];

export const zoomSettingsKeys = [
	"advanced",
	"selectedZoomDepth",
	"onZoomDepthChange",
	"selectedZoomId",
	"selectedZoomMode",
	"onZoomModeChange",
	"zoomInDurationMs",
	"onZoomInDurationMsChange",
	"zoomOutDurationMs",
	"onZoomOutDurationMsChange",
	"onCameraSpringStiffnessMultiplierChange",
	"onCameraSpringDampingMultiplierChange",
	"onCameraSpringMassMultiplierChange",
	"zoomClassicMode",
	"onZoomClassicModeChange",
] as const;
type Props = Pick<ResolvedSettingsPanelProps, (typeof zoomSettingsKeys)[number]>;
export function ZoomSettings(props: Props) {
	const {
		advanced,
		selectedZoomDepth,
		onZoomDepthChange,
		selectedZoomId,
		selectedZoomMode,
		onZoomModeChange,
		zoomInDurationMs,
		onZoomInDurationMsChange,
		zoomOutDurationMs,
		onZoomOutDurationMsChange,
		onCameraSpringStiffnessMultiplierChange,
		onCameraSpringDampingMultiplierChange,
		onCameraSpringMassMultiplierChange,
		zoomClassicMode,
		onZoomClassicModeChange,
	} = props;
	const { te, tSettings, t, formatNumber } = useSettingsTranslations();
	const activePreset = Object.values(CURSOR_MOTION_PRESETS).find(
		(preset) =>
			!zoomClassicMode &&
			preset.zoomInDurationMs === zoomInDurationMs &&
			preset.zoomOutDurationMs === zoomOutDurationMs,
	);
	const resetZoomSection = () => {
		onCameraSpringStiffnessMultiplierChange?.(
			DEFAULT_EDITOR_PREFERENCES.cameraSpringStiffnessMultiplier,
		);
		onCameraSpringDampingMultiplierChange?.(
			DEFAULT_EDITOR_PREFERENCES.cameraSpringDampingMultiplier,
		);
		onCameraSpringMassMultiplierChange?.(DEFAULT_EDITOR_PREFERENCES.cameraSpringMassMultiplier);
		onZoomInDurationMsChange?.(DEFAULT_EDITOR_PREFERENCES.zoomInDurationMs);
		onZoomOutDurationMsChange?.(DEFAULT_EDITOR_PREFERENCES.zoomOutDurationMs);
		onZoomClassicModeChange?.(false);
	};

	return (
		<section className="flex flex-col gap-4">
			{selectedZoomId && (
				<>
					<SectionLabel>{tSettings("zoom.mode", "Mode")}</SectionLabel>
					<div className="mb-1">
						<ChoiceGroup
							aria-label={te("zoomMode", "Zoom mode")}
							value={selectedZoomMode ?? "auto"}
							onValueChange={(value) => onZoomModeChange?.(value as ZoomMode)}
							className="grid grid-cols-2 gap-2"
						>
							<ChoiceItem value="auto">
								{tSettings("zoom.modeAuto", "Auto")}
							</ChoiceItem>
							<ChoiceItem value="manual">
								{tSettings("zoom.modeManual", "Manual")}
							</ChoiceItem>
						</ChoiceGroup>
						{selectedZoomMode === "manual" && (
							<p className="mt-1.5 text-xs text-muted-foreground/70">
								{tSettings(
									"zoom.modeManualDescription",
									"Set a fixed focus point for this zoom",
								)}
							</p>
						)}
					</div>
					<SectionLabel>{tSettings("zoom.amount", "Amount")}</SectionLabel>
					<ChoiceGroup
						aria-label={te("zoomLevel", "Zoom level")}
						value={String(selectedZoomDepth)}
						onValueChange={(value) => onZoomDepthChange?.(Number(value) as ZoomDepth)}
						className="grid grid-cols-3 gap-2"
					>
						{ZOOM_DEPTH_OPTIONS.map((option) => (
							<ChoiceItem key={option.depth} value={String(option.depth)}>
								{formatNumber(option.factor)}×
							</ChoiceItem>
						))}
					</ChoiceGroup>
				</>
			)}
			<div className="flex flex-col gap-3">
				<SectionLabel>{tSettings("effects.motionPresetsTitle", "Presets")}</SectionLabel>
				<ChoiceGroup
					aria-label={tSettings("effects.motionPresetsTitle", "Presets")}
					value={activePreset?.id ?? ""}
					onValueChange={(value) => {
						const preset = Object.values(CURSOR_MOTION_PRESETS).find((item) => item.id === value);
						if (!preset) return;
						onZoomInDurationMsChange?.(preset.zoomInDurationMs);
						onZoomOutDurationMsChange?.(preset.zoomOutDurationMs);
						onZoomClassicModeChange?.(false);
					}}
					className="grid grid-cols-2 gap-2"
				>
					{Object.values(CURSOR_MOTION_PRESETS).map((preset) => (
						<ChoiceItem key={preset.id} value={preset.id}>
							{tSettings(`effects.motionPresets.${preset.id}.label`, preset.label)}
						</ChoiceItem>
					))}
				</ChoiceGroup>
			</div>
			{advanced && (
				<>
					<div className="flex items-center justify-between gap-3">
						<SectionLabel>{tSettings("zoom.globalSettings", "Animation")}</SectionLabel>
						<Button
							variant="ghost"
							size="sm"
							className="text-xs text-muted"
							type="button"
							onClick={resetZoomSection}
						>
							{t("common.actions.reset", "Reset")}
						</Button>
					</div>
					<div className="flex items-center justify-between py-2">
						<span className="text-xs text-muted-foreground">
							{tSettings("effects.classicZoom", "Classic Animation")}
						</span>
						<Switch
							aria-label={tSettings("effects.classicZoom", "Classic Animation")}
							checked={zoomClassicMode}
							onCheckedChange={(v) => onZoomClassicModeChange?.(v)}
						/>
					</div>
				</>
			)}
		</section>
	);
}
