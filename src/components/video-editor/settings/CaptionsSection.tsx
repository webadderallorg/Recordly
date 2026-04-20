import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useI18n, useScopedT } from "../../../contexts/I18nContext";
import { SliderControl } from "../SliderControl";
import { CAPTION_ANIMATION_OPTIONS, CAPTION_LANGUAGE_OPTIONS, SectionLabel } from "../settingsPanelConstants";
import type { AutoCaptionAnimation, AutoCaptionSettings } from "../types";
import { DEFAULT_AUTO_CAPTION_SETTINGS } from "../types";

interface CaptionsSectionProps {
	autoCaptionSettings: AutoCaptionSettings;
	captionCueCount: number;
	whisperModelPath?: string | null;
	whisperModelDownloadStatus: "idle" | "downloading" | "downloaded" | "error";
	whisperModelDownloadProgress: number;
	isGeneratingCaptions: boolean;
	onAutoCaptionSettingsChange?: (settings: AutoCaptionSettings) => void;
	onPickWhisperModel?: () => void;
	onGenerateAutoCaptions?: () => void;
	onClearAutoCaptions?: () => void;
	onDownloadWhisperSmallModel?: () => void;
	onDeleteWhisperSmallModel?: () => void;
	extensionContent?: ReactNode;
}

export function CaptionsSection({
	autoCaptionSettings,
	captionCueCount,
	whisperModelPath,
	whisperModelDownloadStatus,
	whisperModelDownloadProgress,
	isGeneratingCaptions,
	onAutoCaptionSettingsChange,
	onPickWhisperModel,
	onGenerateAutoCaptions,
	onClearAutoCaptions,
	onDownloadWhisperSmallModel,
	onDeleteWhisperSmallModel,
	extensionContent,
}: CaptionsSectionProps) {
	const tSettings = useScopedT("settings");
	const { t } = useI18n();

	const updateSettings = (partial: Partial<AutoCaptionSettings>) => {
		onAutoCaptionSettingsChange?.({ ...autoCaptionSettings, ...partial });
	};

	return (
		<section className="flex flex-col gap-2">
			<div className="flex items-center justify-between gap-3">
				<div className="flex items-center gap-3">
					<SectionLabel>{tSettings("sections.captions", "Captions")}</SectionLabel>
					<button type="button"
						onClick={() => onAutoCaptionSettingsChange?.(DEFAULT_AUTO_CAPTION_SETTINGS)}
						className="text-[10px] text-[#2563EB] transition-opacity hover:opacity-80">
						{t("common.actions.reset", "Reset")}
					</button>
				</div>
				<div className="flex items-center gap-2 text-[10px] text-muted-foreground">
					<span>{tSettings("captions.enabled", "Show")}</span>
					<Switch checked={autoCaptionSettings.enabled}
						onCheckedChange={(enabled) => updateSettings({ enabled })}
						className="data-[state=checked]:bg-[#2563EB] scale-75" />
				</div>
			</div>

			<div className="rounded-lg bg-foreground/[0.03] px-2.5 py-2 space-y-3">
				<div>
					<Button type="button" variant="outline" onClick={onPickWhisperModel}
						className="h-10 w-full rounded-xl border-foreground/10 bg-foreground/5 px-4 text-sm text-foreground hover:bg-foreground/10 hover:text-foreground">
						{tSettings("captions.selectModel", "Select Model")}
					</Button>
				</div>
				<div className="flex items-center justify-between gap-3">
					<div className="text-sm font-medium text-foreground">
						{tSettings("captions.language", "Language")}
					</div>
					<Select value={autoCaptionSettings.language || "auto"}
						onValueChange={(value) => updateSettings({ language: value })}>
						<SelectTrigger className="h-10 w-[180px] rounded-xl border-foreground/10 bg-foreground/5 text-sm text-foreground hover:bg-foreground/10">
							<SelectValue />
						</SelectTrigger>
						<SelectContent className="border-foreground/10 bg-editor-surface-alt text-foreground">
							{CAPTION_LANGUAGE_OPTIONS.map((option) => (
								<SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
				<div className="flex flex-wrap items-center gap-2">
					<div className="grid w-full grid-cols-2 gap-2">
						{whisperModelDownloadStatus === "downloading" ? (
							<Button type="button" disabled
								className="h-10 w-full rounded-xl bg-foreground/10 px-4 text-sm font-medium text-foreground hover:bg-foreground/10">
								{tSettings("captions.downloading", "Downloading...")} {Math.round(whisperModelDownloadProgress)}%
							</Button>
						) : whisperModelPath ? (
							<Button type="button" variant="outline" onClick={onDeleteWhisperSmallModel}
								className="h-10 w-full rounded-xl border-foreground/10 bg-foreground/5 px-4 text-sm text-foreground hover:bg-foreground/10 hover:text-foreground">
								{tSettings("captions.deleteModel", "Delete Model")}
							</Button>
						) : (
							<Button type="button" onClick={onDownloadWhisperSmallModel}
								className="h-10 w-full rounded-xl bg-[#2563EB] px-4 text-sm font-medium text-white hover:bg-[#2563EB]/90">
								{tSettings("captions.downloadModel", "Download Model")}
							</Button>
						)}
						<Button type="button" variant="outline" onClick={onClearAutoCaptions}
							disabled={captionCueCount === 0}
							className="h-10 w-full rounded-xl border-foreground/10 bg-foreground/5 px-4 text-sm text-foreground hover:bg-foreground/10 hover:text-foreground disabled:opacity-50">
							{tSettings("captions.clearFull", "Clear Captions")}
						</Button>
					</div>
				</div>
				<div className="flex flex-col gap-2">
					<Button type="button" onClick={onGenerateAutoCaptions}
						disabled={isGeneratingCaptions || !whisperModelPath}
						className="h-10 w-full rounded-xl bg-[#2563EB] px-4 text-sm font-medium text-white hover:bg-[#2563EB]/90 disabled:opacity-60">
						{isGeneratingCaptions
							? tSettings("captions.generating", "Generating...")
							: captionCueCount > 0
								? tSettings("captions.regenerateFull", "Regenerate Captions")
								: tSettings("captions.generateFull", "Generate Captions")}
					</Button>
					{isGeneratingCaptions ? (
						<div className="space-y-1">
							<div className="text-xs text-muted-foreground">
								{tSettings("captions.generatingStatus", "Generating captions. This can take a moment.")}
							</div>
							<div className="indeterminate-progress h-2 rounded-full bg-foreground/5" />
						</div>
					) : null}
				</div>
				{whisperModelDownloadStatus === "downloading" ? (
					<div className="h-2 overflow-hidden rounded-full bg-foreground/5">
						<div className="h-full rounded-full bg-[#2196f3] transition-all"
							style={{ width: `${whisperModelDownloadProgress}%` }} />
					</div>
				) : null}
			</div>

			<div className="flex flex-col gap-1.5">
				<div className="flex items-center justify-between gap-3 rounded-lg bg-foreground/[0.03] px-2.5 py-2">
					<div className="text-[10px] text-muted-foreground">
						{tSettings("captions.animation", "Animation")}
					</div>
					<Select value={autoCaptionSettings.animationStyle}
						onValueChange={(value) => updateSettings({ animationStyle: value as AutoCaptionAnimation })}>
						<SelectTrigger className="h-9 w-[160px] rounded-xl border-foreground/10 bg-foreground/5 text-sm text-foreground hover:bg-foreground/10">
							<SelectValue />
						</SelectTrigger>
						<SelectContent className="border-foreground/10 bg-editor-surface-alt text-foreground">
							{CAPTION_ANIMATION_OPTIONS.map((option) => (
								<SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
				<label className="flex items-center justify-between rounded-lg bg-foreground/[0.03] px-2.5 py-2">
					<span className="text-[10px] text-muted-foreground">
						{tSettings("captions.textColor", "Text color")}
					</span>
					<input type="color" value={autoCaptionSettings.textColor}
						onChange={(e) => updateSettings({ textColor: e.target.value })}
						className="h-7 w-10 rounded border border-foreground/10 bg-transparent" />
				</label>
				<div className="mb-1 text-sm font-medium text-foreground">
					{tSettings("captions.fontSettings", "Font Settings")}
				</div>
				<SliderControl label={tSettings("captions.fontSize", "Font size")}
					value={autoCaptionSettings.fontSize} defaultValue={DEFAULT_AUTO_CAPTION_SETTINGS.fontSize}
					min={16} max={72} step={1}
					onChange={(v) => updateSettings({ fontSize: v })}
					formatValue={(v) => `${Math.round(v)}px`}
					parseInput={(text) => parseFloat(text.replace(/px$/, ""))} />
				<SliderControl label={tSettings("captions.rowCount", "Rows")}
					value={autoCaptionSettings.maxRows} defaultValue={DEFAULT_AUTO_CAPTION_SETTINGS.maxRows}
					min={1} max={4} step={1}
					onChange={(v) => updateSettings({ maxRows: Math.round(v) })}
					formatValue={(v) => `${Math.round(v)}`}
					parseInput={(text) => parseFloat(text)} />
				<SliderControl label={tSettings("captions.bottomOffset", "Bottom offset")}
					value={autoCaptionSettings.bottomOffset} defaultValue={DEFAULT_AUTO_CAPTION_SETTINGS.bottomOffset}
					min={0} max={30} step={1}
					onChange={(v) => updateSettings({ bottomOffset: v })}
					formatValue={(v) => `${Math.round(v)}%`}
					parseInput={(text) => parseFloat(text.replace(/%$/, ""))} />
				<SliderControl label={tSettings("captions.maxWidth", "Max width")}
					value={autoCaptionSettings.maxWidth} defaultValue={DEFAULT_AUTO_CAPTION_SETTINGS.maxWidth}
					min={40} max={95} step={1}
					onChange={(v) => updateSettings({ maxWidth: v })}
					formatValue={(v) => `${Math.round(v)}%`}
					parseInput={(text) => parseFloat(text.replace(/%$/, ""))} />
				<SliderControl label={tSettings("captions.boxRadius", "Box radius")}
					value={autoCaptionSettings.boxRadius} defaultValue={DEFAULT_AUTO_CAPTION_SETTINGS.boxRadius}
					min={0} max={40} step={0.5}
					onChange={(v) => updateSettings({ boxRadius: v })}
					formatValue={(v) => `${Number.isInteger(v) ? v.toFixed(0) : v.toFixed(1)}px`}
					parseInput={(text) => parseFloat(text.replace(/px$/, ""))} />
				<SliderControl label={tSettings("captions.backgroundOpacity", "Background opacity")}
					value={autoCaptionSettings.backgroundOpacity}
					defaultValue={DEFAULT_AUTO_CAPTION_SETTINGS.backgroundOpacity}
					min={0} max={1} step={0.01}
					onChange={(v) => updateSettings({ backgroundOpacity: v })}
					formatValue={(v) => `${Math.round(v * 100)}%`}
					parseInput={(text) => parseFloat(text.replace(/%$/, "")) / 100} />
				{extensionContent}
			</div>
		</section>
	);
}
