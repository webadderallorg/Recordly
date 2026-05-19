import { CursorClick, PresentationChart } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { AppLocale } from "@/i18n/config";
import { APP_LANGUAGE_LABELS, SUPPORTED_LOCALES } from "@/i18n/config";
import { cn } from "@/lib/utils";
import {
	CURSOR_MOTION_PRESETS,
	type CursorMotionPresetId,
	getMatchingCursorMotionPresetId,
} from "../../cursorMotionPresets";
import type { EditorPreferences } from "../../editorPreferences";
import { SliderControl } from "../../SliderControl";
import { KeyboardShortcutsDialog } from "../../TutorialHelp";
import type { ZoomMotionBlurTuning } from "../../types";
import { Skeleton } from "@/components/ui/skeleton";

function SectionLabel({ children }: { children: React.ReactNode }) {
	return (
		<p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
			{children}
		</p>
	);
}

const MOTION_PRESET_ORDER: CursorMotionPresetId[] = ["focused", "smooth"];

function MotionPresetCards({
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
		<div className="flex flex-col gap-2">
			<div className="text-[10px] text-muted-foreground">{title}</div>
			<div className="grid grid-cols-2 gap-2">
				{MOTION_PRESET_ORDER.map((presetId) => {
					const Icon = presetId === "focused" ? CursorClick : PresentationChart;
					const isActive = activePresetId === presetId;

					return (
						<button
							key={presetId}
							type="button"
							onClick={() => onApply(presetId)}
							className={cn(
								"rounded-xl border px-3 py-3 text-left transition-all",
								"border-foreground/10 bg-foreground/[0.03] hover:border-foreground/20 hover:bg-foreground/[0.06]",
								isActive &&
									"border-[#2563EB]/70 bg-[#2563EB]/12 shadow-[inset_0_0_0_1px_rgba(37,99,235,0.15)]",
							)}
						>
							<div className="flex items-start gap-3">
								<div
									className={cn(
										"mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-foreground/10 bg-black/10 text-muted-foreground",
										isActive &&
											"border-[#2563EB]/30 bg-[#2563EB]/10 text-[#75A6FF]",
									)}
								>
									<Icon className="h-4 w-4" />
								</div>
								<div className="min-w-0 flex-1">
									<div className="text-[12px] font-medium text-foreground">
										{tSettings(`effects.motionPresets.${presetId}.label`)}
									</div>
								</div>
							</div>
							<div className="mt-2 text-[10px] leading-4 text-muted-foreground">
								{tSettings(`effects.motionPresets.${presetId}.description`)}
							</div>
						</button>
					);
				})}
			</div>
		</div>
	);
}

export function GeneralSettingsSection({
	t,
	tSettings,
	themePreference,
	setThemePreference,
	locale,
	setLocale,
	autoApplyFreshRecordingAutoZooms,
	onAutoApplyFreshRecordingAutoZoomsChange,
	connectZooms,
	onConnectZoomsChange,
	showDevMotionControls,
	nativeCaptureUnavailableSession,
	onOpenNativeCaptureUnavailableModal,
	zoomInDurationMs,
	onZoomInDurationMsChange,
	zoomOutDurationMs,
	onZoomOutDurationMsChange,
	cursorSize,
	onCursorSizeChange,
	cursorSmoothing,
	onCursorSmoothingChange,
	cursorMotionBlur,
	onCursorMotionBlurChange,
	cursorClickBounce,
	onCursorClickBounceChange,
	cursorClickBounceDuration,
	onCursorClickBounceDurationChange,
	zoomMotionBlurTuning,
	initialEditorPreferences,
	onZoomMotionBlurTuningChange,
	cameraSpringStiffnessMultiplier,
	onCameraSpringStiffnessMultiplierChange,
	cameraSpringDampingMultiplier,
	onCameraSpringDampingMultiplierChange,
	cameraSpringMassMultiplier,
	onCameraSpringMassMultiplierChange,
	cursorSpringStiffnessMultiplier,
	onCursorSpringStiffnessMultiplierChange,
	cursorSpringDampingMultiplier,
	onCursorSpringDampingMultiplierChange,
	cursorSpringMassMultiplier,
	onCursorSpringMassMultiplierChange,
	isInitialLoading = false,
}: {
	t: (key: string, fallback?: string) => string;
	tSettings: (key: string, fallback?: string) => string;
	themePreference: "light" | "dark" | "system";
	setThemePreference: (preference: "light" | "dark" | "system") => void;
	locale: AppLocale;
	setLocale: (locale: AppLocale) => void;
	autoApplyFreshRecordingAutoZooms: boolean;
	onAutoApplyFreshRecordingAutoZoomsChange?: (enabled: boolean) => void;
	connectZooms: boolean;
	onConnectZoomsChange?: (enabled: boolean) => void;
	showDevMotionControls: boolean;
	nativeCaptureUnavailableSession: boolean;
	onOpenNativeCaptureUnavailableModal?: () => void;
	zoomInDurationMs: number;
	onZoomInDurationMsChange?: (duration: number) => void;
	zoomOutDurationMs: number;
	onZoomOutDurationMsChange?: (duration: number) => void;
	cursorSize: number;
	onCursorSizeChange?: (size: number) => void;
	cursorSmoothing: number;
	onCursorSmoothingChange?: (smoothing: number) => void;
	cursorMotionBlur: number;
	onCursorMotionBlurChange?: (amount: number) => void;
	cursorClickBounce: number;
	onCursorClickBounceChange?: (amount: number) => void;
	cursorClickBounceDuration: number;
	onCursorClickBounceDurationChange?: (duration: number) => void;
	zoomMotionBlurTuning: ZoomMotionBlurTuning;
	initialEditorPreferences: EditorPreferences;
	onZoomMotionBlurTuningChange?: (tuning: ZoomMotionBlurTuning) => void;
	cameraSpringStiffnessMultiplier: number;
	onCameraSpringStiffnessMultiplierChange?: (multiplier: number) => void;
	cameraSpringDampingMultiplier: number;
	onCameraSpringDampingMultiplierChange?: (multiplier: number) => void;
	cameraSpringMassMultiplier: number;
	onCameraSpringMassMultiplierChange?: (multiplier: number) => void;
	cursorSpringStiffnessMultiplier: number;
	onCursorSpringStiffnessMultiplierChange?: (multiplier: number) => void;
	cursorSpringDampingMultiplier: number;
	onCursorSpringDampingMultiplierChange?: (multiplier: number) => void;
	cursorSpringMassMultiplier: number;
	onCursorSpringMassMultiplierChange?: (multiplier: number) => void;
	isInitialLoading?: boolean;
}) {
	const activeMotionPresetId =
		getMatchingCursorMotionPresetId({
			zoomInDurationMs,
			zoomOutDurationMs,
			cursorSize,
			cursorSmoothing,
			cursorSpringStiffnessMultiplier,
			cursorSpringDampingMultiplier,
			cursorSpringMassMultiplier,
			cursorMotionBlur,
			cursorClickBounce,
			cursorClickBounceDuration,
		}) ?? "focused";

	const applyMotionPreset = (presetId: CursorMotionPresetId) => {
		const preset = CURSOR_MOTION_PRESETS[presetId];
		onZoomInDurationMsChange?.(preset.zoomInDurationMs);
		onZoomOutDurationMsChange?.(preset.zoomOutDurationMs);
		onCursorSizeChange?.(preset.cursorSize);
		onCursorSmoothingChange?.(preset.cursorSmoothing);
		onCursorSpringStiffnessMultiplierChange?.(preset.cursorSpringStiffnessMultiplier);
		onCursorSpringDampingMultiplierChange?.(preset.cursorSpringDampingMultiplier);
		onCursorSpringMassMultiplierChange?.(preset.cursorSpringMassMultiplier);
		onCursorMotionBlurChange?.(preset.cursorMotionBlur);
		onCursorClickBounceChange?.(preset.cursorClickBounce);
		onCursorClickBounceDurationChange?.(preset.cursorClickBounceDuration);
	};

	if (isInitialLoading) {
		return (
			<div className="space-y-4 animate-in fade-in duration-200">
				<section className="flex flex-col gap-2">
					<Skeleton className="h-3 w-20" variant="subtle" />
					<Skeleton className="h-10 w-full rounded-lg" variant="subtle" animation="shimmer-premium" />
				</section>
				<section className="flex flex-col gap-2">
					<Skeleton className="h-3 w-24" variant="subtle" />
					<Skeleton className="h-10 w-full rounded-xl" variant="subtle" animation="shimmer-premium" />
				</section>
				<section className="flex flex-col gap-1.5">
					<Skeleton className="h-16 w-full rounded-lg" variant="subtle" animation="shimmer-premium" />
					<Skeleton className="h-16 w-full rounded-lg" variant="subtle" animation="shimmer-premium" />
				</section>
				<section className="flex flex-col gap-2">
					<Skeleton className="h-32 w-full rounded-xl" variant="subtle" animation="shimmer-premium" />
				</section>
			</div>
		);
	}

	return (
		<div className="space-y-4 animate-in fade-in duration-300">
			<section className="flex flex-col gap-2">
				<SectionLabel>{t("editor.theme.appearance", "Appearance")}</SectionLabel>
				<div className="flex rounded-lg border border-foreground/10 bg-foreground/5 p-0.5">
					{(
						[
							{ value: "light", label: t("editor.theme.light", "Light") },
							{ value: "dark", label: t("editor.theme.dark", "Dark") },
							{ value: "system", label: t("editor.theme.system", "System") },
						] as const
					).map((option) => (
						<button
							key={option.value}
							type="button"
							onClick={() => setThemePreference(option.value)}
							className={cn(
								"flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-all",
								themePreference === option.value
									? "bg-neutral-800 text-white shadow-sm dark:bg-white dark:text-black"
									: "text-muted-foreground hover:text-foreground",
							)}
						>
							{option.label}
						</button>
					))}
				</div>
			</section>

			<section className="flex flex-col gap-2">
				<SectionLabel>{t("common.app.language", "Language")}</SectionLabel>
				<Select value={locale} onValueChange={(value) => setLocale(value as AppLocale)}>
					<SelectTrigger className="h-10 w-full rounded-xl border-foreground/10 bg-foreground/5 text-sm text-foreground hover:bg-foreground/10">
						<SelectValue />
					</SelectTrigger>
					<SelectContent className="border-foreground/10 bg-editor-surface-alt text-foreground">
						{SUPPORTED_LOCALES.map((candidateLocale) => (
							<SelectItem key={candidateLocale} value={candidateLocale}>
								{APP_LANGUAGE_LABELS[candidateLocale]}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</section>

			<section className="flex flex-col gap-1.5">
				<div className="flex items-center justify-between gap-3 rounded-lg bg-foreground/[0.03] px-2.5 py-2">
					<div>
						<div className="text-[11px] font-medium text-foreground">
							{tSettings(
								"effects.autoApplyFreshRecordingZooms",
								"Auto-apply fresh recording zooms",
							)}
						</div>
						<div className="mt-0.5 text-[10px] text-muted-foreground/70">
							{tSettings(
								"effects.autoApplyFreshRecordingZoomsDescription",
								"Suggest cursor-follow zooms automatically when you open a new recording.",
							)}
						</div>
					</div>
					<Switch
						checked={autoApplyFreshRecordingAutoZooms}
						onCheckedChange={onAutoApplyFreshRecordingAutoZoomsChange}
						className="data-[state=checked]:bg-[#2563EB] scale-75"
					/>
				</div>
				<div className="flex items-center justify-between gap-3 rounded-lg bg-foreground/[0.03] px-2.5 py-2">
					<div>
						<div className="text-[11px] font-medium text-foreground">
							{tSettings("effects.connectZooms", "Connect neighboring zooms")}
						</div>
						<div className="mt-0.5 text-[10px] text-muted-foreground/70">
							{tSettings(
								"effects.connectZoomsDescription",
								"Smooth consecutive zoom regions into a continuous camera move.",
							)}
						</div>
					</div>
					<Switch
						checked={connectZooms}
						onCheckedChange={onConnectZoomsChange}
						className="data-[state=checked]:bg-[#2563EB] scale-75"
					/>
				</div>
			</section>

			<section className="flex flex-col gap-2">
				<MotionPresetCards
					title={tSettings("effects.motionPresetsTitle", "Motion Presets")}
					activePresetId={activeMotionPresetId}
					onApply={applyMotionPreset}
					tSettings={tSettings}
				/>
			</section>

			<section className="flex flex-col gap-2">
				<SectionLabel>{t("editor.keyboardShortcuts.title")}</SectionLabel>
				<KeyboardShortcutsDialog
					triggerLabel={t("editor.keyboardShortcuts.customize")}
					triggerClassName="h-10 w-full justify-start rounded-xl border border-foreground/10 bg-foreground/5 px-3 text-sm text-foreground hover:bg-foreground/10 hover:text-foreground"
				/>
			</section>

			{showDevMotionControls ? (
				<section className="flex flex-col gap-2 rounded-xl border border-[#2563EB]/15 bg-[#2563EB]/5 p-3">
					<div className="flex items-center justify-between gap-3">
						<div>
							<SectionLabel>{tSettings("effects.devSection", "Dev")}</SectionLabel>
							<div className="mt-0.5 text-[10px] text-muted-foreground">
								{tSettings(
									"effects.devSectionHint",
									"Temporary testing controls for native capture and motion tuning.",
								)}
							</div>
						</div>
						<span className="rounded-full bg-[#2563EB]/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-[#2563EB]">
							DEV
						</span>
					</div>

					<div className="rounded-lg border border-foreground/10 bg-background/60 px-3 py-3">
						<div className="flex items-start justify-between gap-3">
							<div>
								<div className="text-[11px] font-medium text-foreground">
									{tSettings(
										"effects.nativeCaptureWarningTester",
										"Native capture warning",
									)}
								</div>
								<div className="mt-0.5 text-[10px] text-muted-foreground">
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
								className="h-8 shrink-0 border-[#2563EB]/20 bg-[#2563EB]/10 text-[#2563EB] hover:bg-[#2563EB]/15"
							>
								{tSettings("effects.openNativeCaptureWarning", "Open warning")}
							</Button>
						</div>
					</div>

					<div className="space-y-1.5 rounded-lg border border-foreground/10 bg-background/60 px-3 py-3">
						<div>
							<div className="text-[11px] font-medium text-foreground">
								{tSettings("effects.motionBlurDebug", "Motion Blur Debug")}
							</div>
							<div className="mt-0.5 text-[10px] text-muted-foreground">
								{tSettings(
									"effects.motionBlurDebugHint",
									"Development-only tuning for the split move-vs-zoom blur path. Pan controls drive the streak filter, and zoom controls drive the focus-centered zoom filter.",
								)}
							</div>
						</div>
						<SliderControl
							label={tSettings("effects.motionBlurPanThreshold", "Pan threshold")}
							value={zoomMotionBlurTuning.panVelocityThreshold}
							defaultValue={
								initialEditorPreferences.zoomMotionBlurTuning.panVelocityThreshold
							}
							min={0}
							max={240}
							step={1}
							onChange={(value) =>
								onZoomMotionBlurTuningChange?.({
									...zoomMotionBlurTuning,
									panVelocityThreshold: value,
								})
							}
							formatValue={(value) => `${Math.round(value)} px/s`}
							parseInput={(text) => parseFloat(text.replace(/px\/s$/i, "").trim())}
						/>
						<SliderControl
							label={tSettings("effects.motionBlurPanStrength", "Pan max blur")}
							value={zoomMotionBlurTuning.maxDirectionalBlurPx}
							defaultValue={
								initialEditorPreferences.zoomMotionBlurTuning.maxDirectionalBlurPx
							}
							min={0}
							max={96}
							step={0.1}
							onChange={(value) =>
								onZoomMotionBlurTuningChange?.({
									...zoomMotionBlurTuning,
									maxDirectionalBlurPx: value,
								})
							}
							formatValue={(value) => `${value.toFixed(1)} px`}
							parseInput={(text) => parseFloat(text.replace(/px$/i, "").trim())}
						/>
						<SliderControl
							label={tSettings("effects.motionBlurZoomThreshold", "Zoom threshold")}
							value={zoomMotionBlurTuning.zoomVelocityThreshold}
							defaultValue={
								initialEditorPreferences.zoomMotionBlurTuning.zoomVelocityThreshold
							}
							min={0}
							max={0.4}
							step={0.005}
							onChange={(value) =>
								onZoomMotionBlurTuningChange?.({
									...zoomMotionBlurTuning,
									zoomVelocityThreshold: value,
								})
							}
							formatValue={(value) => value.toFixed(3)}
							parseInput={(text) => parseFloat(text)}
						/>
						<SliderControl
							label={tSettings(
								"effects.motionBlurZoomStrength",
								"Zoom blur strength",
							)}
							value={zoomMotionBlurTuning.maxRadialBlurStrength}
							defaultValue={
								initialEditorPreferences.zoomMotionBlurTuning.maxRadialBlurStrength
							}
							min={0}
							max={1.5}
							step={0.005}
							onChange={(value) =>
								onZoomMotionBlurTuningChange?.({
									...zoomMotionBlurTuning,
									maxRadialBlurStrength: value,
								})
							}
							formatValue={(value) => value.toFixed(3)}
							parseInput={(text) => parseFloat(text)}
						/>
					</div>

					<div className="space-y-1.5 rounded-lg border border-foreground/10 bg-background/60 px-3 py-3">
						<div>
							<div className="text-[11px] font-medium text-foreground">
								{tSettings("effects.cameraDebugTuning", "Camera Debug Tuning")}
							</div>
							<div className="mt-0.5 text-[10px] text-muted-foreground">
								{tSettings(
									"effects.cameraDebugTuningHint",
									"Development-only spring tuning controls for camera motion.",
								)}
							</div>
						</div>
						<SliderControl
							label={tSettings(
								"effects.cameraSpringStiffnessMultiplier",
								"Camera stiffness",
							)}
							value={cameraSpringStiffnessMultiplier}
							defaultValue={initialEditorPreferences.cameraSpringStiffnessMultiplier}
							min={0.25}
							max={3}
							step={0.01}
							onChange={(value) => onCameraSpringStiffnessMultiplierChange?.(value)}
							formatValue={(value) => `${value.toFixed(2)}×`}
							parseInput={(text) => parseFloat(text.replace(/×$/, ""))}
						/>
						<SliderControl
							label={tSettings(
								"effects.cameraSpringDampingMultiplier",
								"Camera damping",
							)}
							value={cameraSpringDampingMultiplier}
							defaultValue={initialEditorPreferences.cameraSpringDampingMultiplier}
							min={0.25}
							max={3}
							step={0.01}
							onChange={(value) => onCameraSpringDampingMultiplierChange?.(value)}
							formatValue={(value) => `${value.toFixed(2)}×`}
							parseInput={(text) => parseFloat(text.replace(/×$/, ""))}
						/>
						<SliderControl
							label={tSettings("effects.cameraSpringMassMultiplier", "Camera mass")}
							value={cameraSpringMassMultiplier}
							defaultValue={initialEditorPreferences.cameraSpringMassMultiplier}
							min={0.25}
							max={3}
							step={0.01}
							onChange={(value) => onCameraSpringMassMultiplierChange?.(value)}
							formatValue={(value) => `${value.toFixed(2)}×`}
							parseInput={(text) => parseFloat(text.replace(/×$/, ""))}
						/>
					</div>

					<div className="space-y-1.5 rounded-lg border border-foreground/10 bg-background/60 px-3 py-3">
						<div>
							<div className="text-[11px] font-medium text-foreground">
								{tSettings("effects.cursorDebugTuning", "Cursor Debug Tuning")}
							</div>
							<div className="mt-0.5 text-[10px] text-muted-foreground">
								{tSettings(
									"effects.cursorDebugTuningHint",
									"Development-only spring tuning controls.",
								)}
							</div>
						</div>
						<SliderControl
							label={tSettings(
								"effects.cursorSpringStiffnessMultiplier",
								"Spring stiffness",
							)}
							value={cursorSpringStiffnessMultiplier}
							defaultValue={initialEditorPreferences.cursorSpringStiffnessMultiplier}
							min={0.25}
							max={3}
							step={0.01}
							onChange={(value) => onCursorSpringStiffnessMultiplierChange?.(value)}
							formatValue={(value) => `${value.toFixed(2)}×`}
							parseInput={(text) => parseFloat(text.replace(/×$/, ""))}
						/>
						<SliderControl
							label={tSettings(
								"effects.cursorSpringDampingMultiplier",
								"Spring damping",
							)}
							value={cursorSpringDampingMultiplier}
							defaultValue={initialEditorPreferences.cursorSpringDampingMultiplier}
							min={0.25}
							max={3}
							step={0.01}
							onChange={(value) => onCursorSpringDampingMultiplierChange?.(value)}
							formatValue={(value) => `${value.toFixed(2)}×`}
							parseInput={(text) => parseFloat(text.replace(/×$/, ""))}
						/>
						<SliderControl
							label={tSettings("effects.cursorSpringMassMultiplier", "Spring mass")}
							value={cursorSpringMassMultiplier}
							defaultValue={initialEditorPreferences.cursorSpringMassMultiplier}
							min={0.25}
							max={3}
							step={0.01}
							onChange={(value) => onCursorSpringMassMultiplierChange?.(value)}
							formatValue={(value) => `${value.toFixed(2)}×`}
							parseInput={(text) => parseFloat(text.replace(/×$/, ""))}
						/>
					</div>
				</section>
			) : null}
		</div>
	);
}
