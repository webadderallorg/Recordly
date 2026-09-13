import type { ReactNode } from "react";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useScopedT } from "@/contexts/I18nContext";
import {
	CAPTION_FONT_IDS,
	CAPTION_FONTS,
	resolveCaptionFontWeight,
} from "@/lib/captions/captionFonts";
import { SliderControl } from "../SliderControl";
import {
	type AutoCaptionSettings,
	type CaptionAccentRule,
	type CaptionHighlightMode,
	type CaptionHorizontalAlign,
	type CaptionVerticalPosition,
	DEFAULT_AUTO_CAPTION_SETTINGS,
} from "../types";
import { CaptionPresetGallery } from "./CaptionPresetGallery";

type Translate = ReturnType<typeof useScopedT>;

interface CaptionStyleControlsProps {
	settings: AutoCaptionSettings;
	onChange: (partial: Partial<AutoCaptionSettings>) => void;
}

const ROW_CLASS =
	"flex items-center justify-between gap-3 rounded-lg bg-foreground/[0.03] px-2.5 py-2";
const LABEL_CLASS = "text-[10px] text-muted-foreground";
const SECTION_TITLE_CLASS = "mb-1 mt-2 text-sm font-medium text-foreground";

const WEIGHT_LABELS: Record<number, string> = {
	400: "Regular",
	500: "Medium",
	600: "Semibold",
	700: "Bold",
	800: "Extra bold",
	900: "Black",
};

function Row({ label, children }: { label: string; children: ReactNode }) {
	return (
		<div className={ROW_CLASS}>
			<span className={LABEL_CLASS}>{label}</span>
			{children}
		</div>
	);
}

function SelectRow<T extends string>(props: {
	label: string;
	value: T;
	options: ReadonlyArray<{ value: T; label: string }>;
	onChange: (value: T) => void;
}) {
	return (
		<Row label={props.label}>
			<Select value={props.value} onValueChange={(value) => props.onChange(value as T)}>
				<SelectTrigger className="h-9 w-[160px] rounded-xl border-foreground/10 bg-foreground/5 text-sm text-foreground hover:bg-foreground/10">
					<SelectValue />
				</SelectTrigger>
				<SelectContent className="border-foreground/10 bg-editor-surface-alt text-foreground">
					{props.options.map((option) => (
						<SelectItem key={option.value} value={option.value}>
							{option.label}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
		</Row>
	);
}

function SegmentedRow<T extends string>(props: {
	label: string;
	value: T;
	options: ReadonlyArray<{ value: T; label: string }>;
	onChange: (value: T) => void;
}) {
	return (
		<Row label={props.label}>
			<ToggleGroup
				type="single"
				value={props.value}
				onValueChange={(value) => value && props.onChange(value as T)}
				className="flex gap-1"
				aria-label={props.label}
			>
				{props.options.map((option) => (
					<ToggleGroupItem
						key={option.value}
						value={option.value}
						className="h-7 rounded-lg border border-foreground/10 px-2 text-[11px] data-[state=on]:border-[#2563EB]/70 data-[state=on]:bg-[#2563EB]/12"
					>
						{option.label}
					</ToggleGroupItem>
				))}
			</ToggleGroup>
		</Row>
	);
}

function ColorRow(props: { label: string; value: string; onChange: (value: string) => void }) {
	return (
		<Row label={props.label}>
			<input
				type="color"
				value={props.value}
				onChange={(event) => props.onChange(event.target.value)}
				aria-label={props.label}
				className="h-7 w-10 rounded border border-foreground/10 bg-transparent"
			/>
		</Row>
	);
}

function TypographyControls({
	settings,
	onChange,
	t,
}: CaptionStyleControlsProps & { t: Translate }) {
	const fontOptions = CAPTION_FONT_IDS.map((id) => ({
		value: id,
		label: CAPTION_FONTS[id].label,
	}));
	const weightOptions = CAPTION_FONTS[settings.fontId].weights.map((weight) => ({
		value: String(weight),
		label: t(`captions.weight${weight}`, WEIGHT_LABELS[weight] ?? String(weight)),
	}));

	return (
		<>
			<div className={SECTION_TITLE_CLASS}>{t("captions.fontSettings", "Font Settings")}</div>
			<SelectRow
				label={t("captions.fontFamily", "Font")}
				value={settings.fontId}
				options={fontOptions}
				onChange={(fontId) =>
					onChange({
						fontId,
						fontWeight: resolveCaptionFontWeight(fontId, settings.fontWeight),
					})
				}
			/>
			<SelectRow
				label={t("captions.fontWeight", "Weight")}
				value={String(resolveCaptionFontWeight(settings.fontId, settings.fontWeight))}
				options={weightOptions}
				onChange={(weight) => onChange({ fontWeight: Number(weight) })}
			/>
			<SliderControl
				label={t("captions.fontSize", "Font size")}
				value={settings.fontSize}
				defaultValue={DEFAULT_AUTO_CAPTION_SETTINGS.fontSize}
				min={16}
				max={72}
				step={1}
				onChange={(fontSize) => onChange({ fontSize })}
				formatValue={(value) => `${Math.round(value)}px`}
				parseInput={(text) => parseFloat(text.replace(/px$/, ""))}
			/>
			<Row label={t("captions.uppercase", "Uppercase")}>
				<Switch
					checked={settings.uppercase}
					onCheckedChange={(uppercase) => onChange({ uppercase })}
					aria-label={t("captions.uppercase", "Uppercase")}
					className="scale-75 data-[state=checked]:bg-[#2563EB]"
				/>
			</Row>
			<ColorRow
				label={t("captions.textColor", "Text color")}
				value={settings.textColor}
				onChange={(textColor) => onChange({ textColor })}
			/>
		</>
	);
}

function LegibilityControls({
	settings,
	onChange,
	t,
}: CaptionStyleControlsProps & { t: Translate }) {
	return (
		<>
			<SliderControl
				label={t("captions.outlineWidth", "Outline")}
				value={settings.outlineWidth}
				defaultValue={DEFAULT_AUTO_CAPTION_SETTINGS.outlineWidth}
				min={0}
				max={12}
				step={0.5}
				onChange={(outlineWidth) => onChange({ outlineWidth })}
				formatValue={(value) => `${value.toFixed(1)}px`}
				parseInput={(text) => parseFloat(text.replace(/px$/, ""))}
			/>
			{settings.outlineWidth > 0 ? (
				<ColorRow
					label={t("captions.outlineColor", "Outline color")}
					value={settings.outlineColor}
					onChange={(outlineColor) => onChange({ outlineColor })}
				/>
			) : null}
			<SliderControl
				label={t("captions.shadowOpacity", "Text shadow")}
				value={settings.shadowOpacity}
				defaultValue={DEFAULT_AUTO_CAPTION_SETTINGS.shadowOpacity}
				min={0}
				max={1}
				step={0.01}
				onChange={(shadowOpacity) => onChange({ shadowOpacity })}
				formatValue={(value) => `${Math.round(value * 100)}%`}
				parseInput={(text) => parseFloat(text.replace(/%$/, "")) / 100}
			/>
		</>
	);
}

function PlacementControls({
	settings,
	onChange,
	t,
}: CaptionStyleControlsProps & { t: Translate }) {
	const verticalOptions: Array<{ value: CaptionVerticalPosition; label: string }> = [
		{ value: "top", label: t("captions.positionTop", "Top") },
		{ value: "middle", label: t("captions.positionMiddle", "Middle") },
		{ value: "bottom", label: t("captions.positionBottom", "Bottom") },
	];
	const horizontalOptions: Array<{ value: CaptionHorizontalAlign; label: string }> = [
		{ value: "left", label: t("captions.alignLeft", "Left") },
		{ value: "center", label: t("captions.alignCenter", "Center") },
		{ value: "right", label: t("captions.alignRight", "Right") },
	];

	return (
		<>
			<div className={SECTION_TITLE_CLASS}>{t("captions.positionSettings", "Position")}</div>
			<SegmentedRow
				label={t("captions.verticalPosition", "Vertical")}
				value={settings.verticalPosition}
				options={verticalOptions}
				onChange={(verticalPosition) => onChange({ verticalPosition })}
			/>
			<SegmentedRow
				label={t("captions.horizontalAlign", "Alignment")}
				value={settings.horizontalAlign}
				options={horizontalOptions}
				onChange={(horizontalAlign) => onChange({ horizontalAlign })}
			/>
			{settings.verticalPosition !== "middle" ? (
				<SliderControl
					label={t("captions.bottomOffset", "Edge offset")}
					value={settings.bottomOffset}
					defaultValue={DEFAULT_AUTO_CAPTION_SETTINGS.bottomOffset}
					min={0}
					max={30}
					step={1}
					onChange={(bottomOffset) => onChange({ bottomOffset })}
					formatValue={(value) => `${Math.round(value)}%`}
					parseInput={(text) => parseFloat(text.replace(/%$/, ""))}
				/>
			) : null}
		</>
	);
}

function HighlightControls({
	settings,
	onChange,
	t,
}: CaptionStyleControlsProps & { t: Translate }) {
	const modeOptions: Array<{ value: CaptionHighlightMode; label: string }> = [
		{ value: "none", label: t("captions.highlightNone", "Off") },
		{ value: "color", label: t("captions.highlightColor", "Color") },
		{ value: "pill", label: t("captions.highlightPill", "Pill") },
		{ value: "pop", label: t("captions.highlightPop", "Pop") },
	];

	return (
		<>
			<div className={SECTION_TITLE_CLASS}>
				{t("captions.highlightSettings", "Spoken word highlight")}
			</div>
			<SegmentedRow
				label={t("captions.highlightMode", "Style")}
				value={settings.highlightMode}
				options={modeOptions}
				onChange={(highlightMode) => onChange({ highlightMode })}
			/>
			{settings.highlightMode !== "none" ? (
				<ColorRow
					label={t("captions.highlightColorLabel", "Highlight color")}
					value={settings.highlightColor}
					onChange={(highlightColor) => onChange({ highlightColor })}
				/>
			) : null}
		</>
	);
}

function EmphasisControls({ settings, onChange, t }: CaptionStyleControlsProps & { t: Translate }) {
	const accentOptions: Array<{ value: CaptionAccentRule; label: string }> = [
		{ value: "none", label: t("captions.accentNone", "Manual") },
		{ value: "first-word", label: t("captions.accentFirstWord", "First word") },
		{ value: "longest-word", label: t("captions.accentLongestWord", "Longest") },
	];

	return (
		<>
			<div className={SECTION_TITLE_CLASS}>{t("captions.emphasisSettings", "Emphasis")}</div>
			<SegmentedRow
				label={t("captions.accentRule", "Auto")}
				value={settings.accentRule}
				options={accentOptions}
				onChange={(accentRule) => onChange({ accentRule })}
			/>
			<ColorRow
				label={t("captions.emphasisColor", "Emphasis color")}
				value={settings.emphasisColor}
				onChange={(emphasisColor) => onChange({ emphasisColor })}
			/>
		</>
	);
}

/** Presets plus typography, legibility, placement, highlight and emphasis controls. */
export function CaptionStyleControls(props: CaptionStyleControlsProps) {
	const t = useScopedT("settings");
	return (
		<>
			<CaptionPresetGallery settings={props.settings} onChange={props.onChange} />
			<TypographyControls {...props} t={t} />
			<LegibilityControls {...props} t={t} />
			<PlacementControls {...props} t={t} />
			<HighlightControls {...props} t={t} />
			<EmphasisControls {...props} t={t} />
		</>
	);
}
