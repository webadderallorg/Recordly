import { ChoiceGroup, ChoiceItem } from "@/components/ui/choice-group";
import { ColorControl, ColorPalette } from "@/components/ui/color-picker";
import { Cursor } from "@/components/ui/icons";
import { Switch } from "@/components/ui/switch";
import { SliderControl } from "@/components/video-editor/SliderControl";
import {
	CursorClickEffectCards,
	CursorStylePreview,
} from "@/components/video-editor/settings/CursorAppearancePreviews";
import {
	type CursorStyle,
	DEFAULT_CURSOR_CLICK_EFFECT_COLOR,
} from "@/components/video-editor/types";
import {
	fromCursorSwaySliderValue,
	toCursorSwaySliderValue,
} from "@/components/video-editor/videoPlayback/cursorSway";
import { cn } from "@/lib/utils";
import type { ResolvedSettingsPanelProps } from "./settingsPanelDefaults";
import type { useCursorSettings } from "./useCursorSettings";
import { useSettingsTranslations } from "./useSettingsTranslations";

const CLICK_EFFECT_COLOR_OPTIONS = [
	DEFAULT_CURSOR_CLICK_EFFECT_COLOR,
	"#FFFFFF",
	"#2563EB",
	"#EF4444",
	"#F59E0B",
	"#22C55E",
	"#A855F7",
	"#EC4899",
	"#14B8A6",
	"#F97316",
] as const;

export const cursorSettingsKeys = [
	"advanced",
	"showCursor",
	"onShowCursorChange",
	"loopCursor",
	"onLoopCursorChange",
	"cursorStyle",
	"onCursorStyleChange",
	"cursorSize",
	"onCursorSizeChange",
	"cursorClickEffect",
	"onCursorClickEffectChange",
	"cursorClickEffectColor",
	"onCursorClickEffectColorChange",
	"cursorClickEffectScale",
	"onCursorClickEffectScaleChange",
	"cursorClickEffectOpacity",
	"onCursorClickEffectOpacityChange",
	"cursorClickEffectDurationMs",
	"onCursorClickEffectDurationMsChange",
	"cursorClickBounce",
	"onCursorClickBounceChange",
	"cursorClickBounceDuration",
	"onCursorClickBounceDurationChange",
	"cursorSway",
	"cursorIdleHide",
	"onCursorIdleHideChange",
	"onCursorSwayChange",
] as const;
type Props = Pick<ResolvedSettingsPanelProps, (typeof cursorSettingsKeys)[number]> & {
	cursor: ReturnType<typeof useCursorSettings>;
};
export function CursorSettings(props: Props) {
	const {
		advanced,
		showCursor,
		onShowCursorChange,
		loopCursor,
		onLoopCursorChange,
		cursorStyle,
		onCursorStyleChange,
		cursorSize,
		onCursorSizeChange,
		cursorClickEffect,
		onCursorClickEffectChange,
		cursorClickEffectColor,
		onCursorClickEffectColorChange,
		cursorClickEffectScale,
		onCursorClickEffectScaleChange,
		cursorClickEffectOpacity,
		onCursorClickEffectOpacityChange,
		cursorClickEffectDurationMs,
		onCursorClickEffectDurationMsChange,
		cursorClickBounce,
		onCursorClickBounceChange,
		cursorClickBounceDuration,
		onCursorClickBounceDurationChange,
		cursorSway,
		cursorIdleHide,
		onCursorIdleHideChange,
		onCursorSwayChange,
	} = props;
	const { te, tSettings, formatNumber } = useSettingsTranslations();
	const { lastCursorBounceStrength, cursorPreviewUrls, cursorStyleOptions } = props.cursor;
	return (
		<section className="flex flex-col gap-4">
			{advanced && (
				<div className="flex flex-col gap-3">
					<label className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
						<span>{tSettings("effects.showCursor")}</span>
						<Switch
							aria-label={tSettings("effects.showCursor")}
							checked={showCursor}
							onCheckedChange={onShowCursorChange}
						/>
					</label>
					<label className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
						<span>{tSettings("effects.loopCursor")}</span>
						<Switch
							aria-label={tSettings("effects.loopCursor")}
							checked={loopCursor}
							onCheckedChange={onLoopCursorChange}
						/>
					</label>
				</div>
			)}
			<div className="flex flex-col gap-3">
				<label className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
					<span>{tSettings("effects.cursorIdleHide", "Hide cursor when idle")}</span>
					<Switch
						aria-label={tSettings("effects.cursorIdleHide", "Hide cursor when idle")}
						checked={cursorIdleHide.enabled}
						onCheckedChange={(enabled) =>
							onCursorIdleHideChange?.({ ...cursorIdleHide, enabled })
						}
					/>
				</label>
				{advanced && cursorIdleHide.enabled && (
					<div className="grid gap-3">
						<p className="text-xs text-muted-foreground">
							{tSettings(
								"effects.cursorIdleHideDescription",
								"After a short delay, the cursor fades during long pauses. Movement or clicks show it again.",
							)}
						</p>
						<SliderControl
							label={tSettings("effects.cursorIdleDuration", "Idle detection")}
							value={cursorIdleHide.idleThresholdMs}
							min={500}
							max={10000}
							step={100}
							onChange={(idleThresholdMs) =>
								onCursorIdleHideChange?.({ ...cursorIdleHide, idleThresholdMs })
							}
							formatValue={(v) => `${formatNumber(v / 1000, 1)} s`}
						/>
						<SliderControl
							label={tSettings("effects.cursorIdleFadeDelay", "Fade delay")}
							value={cursorIdleHide.fadeDelayMs}
							min={0}
							max={2000}
							step={50}
							onChange={(fadeDelayMs) =>
								onCursorIdleHideChange?.({ ...cursorIdleHide, fadeDelayMs })
							}
							formatValue={(v) => `${formatNumber(v / 1000, 2)} s`}
						/>
						<SliderControl
							label={tSettings("effects.cursorIdleFadeDuration", "Fade duration")}
							value={cursorIdleHide.fadeDurationMs}
							min={100}
							max={1000}
							step={25}
							onChange={(fadeDurationMs) =>
								onCursorIdleHideChange?.({ ...cursorIdleHide, fadeDurationMs })
							}
							formatValue={(v) => `${formatNumber(v)} ms`}
						/>
						<SliderControl
							label={tSettings(
								"effects.cursorIdleMovementTolerance",
								"Movement tolerance",
							)}
							value={cursorIdleHide.movementTolerancePx}
							min={0}
							max={10}
							step={0.5}
							onChange={(movementTolerancePx) =>
								onCursorIdleHideChange?.({ ...cursorIdleHide, movementTolerancePx })
							}
							formatValue={(v) => `${formatNumber(v, 1)} px`}
						/>
					</div>
				)}
			</div>
			<div className="flex flex-col gap-3">
				<div className="space-y-1.5">
					<ChoiceGroup
						type="single"
						value={cursorStyle}
						onValueChange={(value) => {
							if (value) {
								onCursorStyleChange?.(value as CursorStyle);
							}
						}}
						className="grid grid-cols-4 gap-2"
						aria-label={tSettings("effects.cursorStyle", "Cursor Style")}
					>
						{cursorStyleOptions.map((option) => (
							<ChoiceItem
								key={option.value}
								value={option.value}
								title={te(`cursorStyle${option.value}`, option.label)}
								aria-label={te(`cursorStyle${option.value}`, option.label)}
								className={cn("group aspect-square h-auto min-w-0 p-3 text-left")}
							>
								<div className="flex h-full flex-col items-center justify-between gap-3">
									<div className="flex min-h-0 flex-1 items-center justify-center rounded-lg px-2 py-1.5">
										<CursorStylePreview
											style={option.value}
											previewUrls={cursorPreviewUrls}
										/>
									</div>
								</div>
							</ChoiceItem>
						))}
					</ChoiceGroup>
				</div>
				<SliderControl
					label={tSettings("effects.cursorSize")}
					startContent={<Cursor size={14} weight="fill" />}
					endContent={<Cursor size={26} weight="fill" />}
					value={cursorSize}
					min={0.5}
					max={10}
					step={0.05}
					onChange={(v) => onCursorSizeChange?.(v)}
					formatValue={(v) => `${formatNumber(v, 2)}×`}
				/>
				<CursorClickEffectCards
					title={tSettings("effects.cursorClickEffects.title", "Click Effects")}
					activeEffectId={cursorClickEffect}
					onApply={(effectId) => {
						if (effectId !== "none" && effectId !== cursorClickEffect) {
							onCursorClickEffectColorChange?.(DEFAULT_CURSOR_CLICK_EFFECT_COLOR);
						}
						onCursorClickEffectChange?.(effectId);
					}}
					tSettings={tSettings}
				/>
				{advanced ? (
					<div className="grid gap-3">
						<div className="grid gap-1">
							<div className="text-xs text-muted-foreground">
								{tSettings("effects.cursorClickEffects.color", "Effect Color")}
							</div>
							<div className="flex flex-col gap-3">
								<ColorPalette
									color={cursorClickEffectColor}
									colors={CLICK_EFFECT_COLOR_OPTIONS}
									onChange={({ hex }) => onCursorClickEffectColorChange?.(hex)}
								/>
								<ColorControl
									label={te("customEffectColor", "Custom effect color")}
									value={cursorClickEffectColor}
									onChange={(color) => onCursorClickEffectColorChange?.(color)}
								/>
							</div>
						</div>
						<SliderControl
							label={tSettings("effects.cursorClickEffects.size", "Effect Size")}
							value={cursorClickEffectScale}
							min={0.5}
							max={2}
							step={0.05}
							onChange={(v) => onCursorClickEffectScaleChange?.(v)}
							formatValue={(v) => `${formatNumber(v, 2)}×`}
						/>
						<SliderControl
							label={tSettings(
								"effects.cursorClickEffects.opacity",
								"Effect Opacity",
							)}
							value={cursorClickEffectOpacity}
							min={0}
							max={1}
							step={0.01}
							onChange={(v) => onCursorClickEffectOpacityChange?.(v)}
							formatValue={(v) => `${Math.round(v * 100)}%`}
						/>
						<SliderControl
							label={tSettings(
								"effects.cursorClickEffects.duration",
								"Effect Duration",
							)}
							value={cursorClickEffectDurationMs}
							min={120}
							max={1200}
							step={10}
							onChange={(v) => onCursorClickEffectDurationMsChange?.(v)}
							formatValue={(v) => `${Math.round(v)} ms`}
						/>
					</div>
				) : null}
				<div className="flex items-center justify-between py-2">
					<span className="text-xs text-muted-foreground">
						{tSettings("effects.cursorClickBounce")}
					</span>
					<Switch
						aria-label={tSettings("effects.cursorClickBounce")}
						checked={cursorClickBounce > 0}
						onCheckedChange={(enabled) =>
							onCursorClickBounceChange?.(
								enabled ? lastCursorBounceStrength.current : 0,
							)
						}
					/>
				</div>
				{advanced && (
					<SliderControl
						label={tSettings("effects.cursorClickBounce")}
						value={cursorClickBounce}
						min={0}
						max={5}
						step={0.05}
						onChange={(v) => onCursorClickBounceChange?.(v)}
						formatValue={(v) => `${formatNumber(v, 2)}×`}
					/>
				)}
				{advanced && (
					<SliderControl
						label={tSettings("effects.cursorClickBounceDuration", "Bounce Speed")}
						value={cursorClickBounceDuration}
						min={60}
						max={500}
						step={5}
						onChange={(v) => onCursorClickBounceDurationChange?.(v)}
						formatValue={(v) => `${Math.round(v)} ms`}
					/>
				)}
				{advanced && (
					<SliderControl
						label={tSettings("effects.cursorSway")}
						value={toCursorSwaySliderValue(cursorSway)}
						min={0}
						max={toCursorSwaySliderValue(2)}
						step={toCursorSwaySliderValue(0.05)}
						onChange={(v) => onCursorSwayChange?.(fromCursorSwaySliderValue(v))}
						formatValue={(v) =>
							v <= 0 ? tSettings("effects.off") : `${formatNumber(v, 2)}×`
						}
					/>
				)}
			</div>
		</section>
	);
}
