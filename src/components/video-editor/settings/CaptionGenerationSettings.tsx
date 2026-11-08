import { ProgressBar } from "@heroui/react";
import { Button } from "@/components/ui/button";
import { ColorControl } from "@/components/ui/color-picker";
import { ClosedCaptioning, Trash } from "@/components/ui/icons";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useI18n, useScopedT } from "@/contexts/I18nContext";
import {
	CAPTION_MODELS,
	type CaptionModelId,
	getCaptionModel,
	isCaptionModelId,
} from "@/shared/captionModels";
import { applyCaptionPreset } from "../captionPresets";
import { SliderControl } from "../SliderControl";
import { type AutoCaptionAnimation, type AutoCaptionSettings } from "../types";
import { CaptionStylePicker } from "./CaptionStylePicker";

interface CaptionGenerationSettingsProps {
	advanced: boolean;
	captionCueCount: number;
	autoCaptionSettings: AutoCaptionSettings;
	captionModelId?: CaptionModelId;
	captionModelLoading?: boolean;
	onCaptionModelChange?: (modelId: CaptionModelId) => void;
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
}

const CAPTION_ANIMATION_OPTIONS: Array<{ value: AutoCaptionAnimation; label: string }> = [
	{ value: "none", label: "Off" },
	{ value: "fade", label: "Fade" },
	{ value: "rise", label: "Rise" },
	{ value: "pop", label: "Pop" },
];

export function CaptionGenerationSettings({
	advanced,
	captionCueCount,
	autoCaptionSettings,
	captionModelId = "parakeet-v3",
	captionModelLoading = false,
	onCaptionModelChange,
	whisperModelPath,
	whisperModelDownloadStatus,
	whisperModelDownloadProgress,
	isGeneratingCaptions,
	onAutoCaptionSettingsChange,
	onGenerateAutoCaptions,
	onClearAutoCaptions,
	onDeleteWhisperSmallModel,
}: CaptionGenerationSettingsProps) {
	const te = useScopedT("editing");
	const tSettings = useScopedT("settings");
	const { locale } = useI18n();
	const formatNumber = (value: number, fractionDigits?: number) =>
		new Intl.NumberFormat(locale, {
			useGrouping: false,
			minimumFractionDigits: fractionDigits,
			maximumFractionDigits: fractionDigits ?? 20,
		}).format(value);
	const updateAutoCaptionSettings = (partial: Partial<AutoCaptionSettings>) => {
		onAutoCaptionSettingsChange?.({
			...autoCaptionSettings,
			...partial,
		});
	};

	const isDownloading = whisperModelDownloadStatus === "downloading";
	const modelReady = Boolean(whisperModelPath) && whisperModelDownloadStatus === "downloaded";
	const isBusy = isGeneratingCaptions || isDownloading || captionModelLoading;
	const model = getCaptionModel(captionModelId);

	return (
		<section className="flex flex-col gap-5">
			<div className="space-y-3 rounded-xl border border-border p-3">
				<div className="flex items-center justify-between gap-3">
					<div className="flex min-w-0 items-center gap-2 text-xs font-medium">
						<ClosedCaptioning
							className="size-4 shrink-0 text-accent"
							aria-hidden="true"
						/>
						<span>
							{captionCueCount === 1
								? tSettings("captions.oneCaption", "1 caption")
								: captionCueCount > 0
									? tSettings("captions.cueCount", "{{count}} captions", {
											count: captionCueCount,
										})
									: tSettings("captions.empty", "No captions yet")}
						</span>
					</div>
					<Switch
						aria-label={tSettings("captions.enabled", "Show")}
						checked={autoCaptionSettings.enabled}
						onCheckedChange={(enabled) => updateAutoCaptionSettings({ enabled })}
					/>
				</div>
				<Select
					aria-label={tSettings("captions.speechModel", "Speech model")}
					value={captionModelId}
					disabled={isBusy || !onCaptionModelChange}
					onValueChange={(id) => {
						if (isCaptionModelId(id)) onCaptionModelChange?.(id);
					}}
				>
					<SelectTrigger className="h-9 w-full min-w-0 text-xs">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{CAPTION_MODELS.map((option) => (
							<SelectItem
								key={option.id}
								value={option.id}
								textValue={option.label}
								aria-label={option.label}
								aria-description={`${option.languageDescription} · ${Math.round(option.downloadBytes / 1_000_000)} MB`}
							>
								<div className="flex flex-col gap-0.5 py-1">
									<span className="text-xs font-medium">{option.label}</span>
									<span className="text-[11px] text-muted-foreground">
										{tSettings(
											`captions.modelLanguages.${option.id}`,
											option.languageDescription,
										)}{" "}
										·{" "}
										{formatNumber(Math.round(option.downloadBytes / 1_000_000))}{" "}
										MB
									</span>
								</div>
							</SelectItem>
						))}
					</SelectContent>
				</Select>
				<p className="text-[11px] leading-relaxed text-muted-foreground">
					{tSettings(`captions.modelLanguages.${model.id}`, model.languageDescription)}
					{" · "}
					{tSettings("captions.wordTiming", "Word timing")}
					{!modelReady &&
						` · ${formatNumber(Math.round(model.downloadBytes / 1_000_000))} MB`}
				</p>
				{!modelReady && (
					<p className="text-[11px] leading-relaxed text-muted-foreground">
						{tSettings(
							"captions.firstDownload",
							"First use downloads {{size}} MB of speech files, then generates captions.",
							{ size: formatNumber(Math.round(model.downloadBytes / 1_000_000)) },
						)}
					</p>
				)}
				<div className="flex items-center gap-2">
					<Button
						type="button"
						onClick={onGenerateAutoCaptions}
						disabled={isBusy}
						className="h-9 min-w-0 flex-1 px-3 text-sm"
					>
						{isDownloading ? (
							<>
								{tSettings("captions.downloading", "Downloading...")}{" "}
								{Math.round(whisperModelDownloadProgress)}%
							</>
						) : isGeneratingCaptions ? (
							tSettings("captions.generating", "Generating...")
						) : captionCueCount > 0 ? (
							tSettings("captions.regenerateFull", "Regenerate Captions")
						) : (
							tSettings("captions.generateFull", "Generate Captions")
						)}
					</Button>
					<Button
						type="button"
						variant="ghost"
						size="icon"
						className="size-9 min-w-9 shrink-0 text-muted-foreground"
						aria-label={tSettings("captions.clearFull", "Clear Captions")}
						disabled={captionCueCount === 0 || isGeneratingCaptions}
						onClick={onClearAutoCaptions}
					>
						<Trash className="size-5" aria-hidden="true" />
					</Button>
				</div>
				{advanced && (
					<Button
						type="button"
						variant="ghost"
						disabled={!modelReady || isBusy}
						onClick={onDeleteWhisperSmallModel}
						className="h-7 self-start px-2 text-xs text-muted-foreground"
					>
						{tSettings("captions.deleteModel", "Delete Model")}
					</Button>
				)}
				{(isDownloading || isGeneratingCaptions) && (
					<ProgressBar
						aria-label={
							isDownloading
								? tSettings("captions.downloading", "Downloading...")
								: te("generatingCaptionProgress", "Generating captions")
						}
						isIndeterminate={!isDownloading}
						value={isDownloading ? whisperModelDownloadProgress : undefined}
					>
						<ProgressBar.Track>
							<ProgressBar.Fill />
						</ProgressBar.Track>
					</ProgressBar>
				)}
			</div>

			<div className="flex flex-col gap-3">
				<CaptionStylePicker
					value={autoCaptionSettings.style}
					onChange={(style) =>
						onAutoCaptionSettingsChange?.(
							applyCaptionPreset(autoCaptionSettings, style),
						)
					}
				/>
				<SliderControl
					label={tSettings("captions.fontSize", "Font size")}
					value={autoCaptionSettings.fontSize}
					min={16}
					max={72}
					step={1}
					onChange={(value) => updateAutoCaptionSettings({ fontSize: value })}
					formatValue={(value) => `${Math.round(value)}px`}
				/>
				{advanced && (
					<>
						<div className="flex items-center justify-between gap-3">
							<div className="text-xs text-muted-foreground">
								{tSettings("captions.animation", "Animation")}
							</div>
							<Select
								aria-label={tSettings("captions.animation", "Animation")}
								value={autoCaptionSettings.animationStyle}
								onValueChange={(value) =>
									updateAutoCaptionSettings({
										animationStyle: value as AutoCaptionAnimation,
									})
								}
							>
								<SelectTrigger className="h-8 w-32 min-w-0 text-xs">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{CAPTION_ANIMATION_OPTIONS.map((option) => (
										<SelectItem key={option.value} value={option.value}>
											{te(`captionAnimation${option.value}`, option.label)}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
						<div className="flex items-center justify-between py-2">
							<span className="text-xs text-muted-foreground">
								{tSettings("captions.textColor", "Text color")}
							</span>
							<ColorControl
								compact
								label={tSettings("captions.textColor", "Text color")}
								value={autoCaptionSettings.textColor}
								onChange={(color) =>
									updateAutoCaptionSettings({ textColor: color })
								}
							/>
						</div>
					</>
				)}
				{advanced && (
					<SliderControl
						label={tSettings("captions.rowCount", "Rows")}
						value={autoCaptionSettings.maxRows}
						min={1}
						max={4}
						step={1}
						onChange={(value) =>
							updateAutoCaptionSettings({ maxRows: Math.round(value) })
						}
						formatValue={(value) => `${Math.round(value)}`}
					/>
				)}
				{advanced && (
					<SliderControl
						label={tSettings("captions.bottomOffset", "Bottom offset")}
						value={autoCaptionSettings.bottomOffset}
						min={0}
						max={30}
						step={1}
						onChange={(value) => updateAutoCaptionSettings({ bottomOffset: value })}
						formatValue={(value) => `${Math.round(value)}%`}
					/>
				)}
				{advanced && (
					<SliderControl
						label={tSettings("captions.maxWidth", "Max width")}
						value={autoCaptionSettings.maxWidth}
						min={40}
						max={95}
						step={1}
						onChange={(value) => updateAutoCaptionSettings({ maxWidth: value })}
						formatValue={(value) => `${Math.round(value)}%`}
					/>
				)}
				{advanced && (
					<SliderControl
						label={tSettings("captions.boxRadius", "Box radius")}
						value={autoCaptionSettings.boxRadius}
						min={0}
						max={40}
						step={0.5}
						onChange={(value) => updateAutoCaptionSettings({ boxRadius: value })}
						formatValue={(value) =>
							`${formatNumber(value, Number.isInteger(value) ? 0 : 1)}px`
						}
					/>
				)}
				{advanced && (
					<SliderControl
						label={tSettings("captions.backgroundOpacity", "Background opacity")}
						value={autoCaptionSettings.backgroundOpacity}
						min={0}
						max={1}
						step={0.01}
						onChange={(value) =>
							updateAutoCaptionSettings({ backgroundOpacity: value })
						}
						formatValue={(value) => `${Math.round(value * 100)}%`}
					/>
				)}
				{advanced && (
					<div className="flex items-center justify-between gap-3 border-t border-border/60 pt-3">
						<span className="text-xs text-muted-foreground">
							{tSettings("captions.timelineQuickAdd", "Hover to add on timeline")}
						</span>
						<Switch
							aria-label={tSettings(
								"captions.timelineQuickAdd",
								"Hover to add on timeline",
							)}
							checked={autoCaptionSettings.timelineQuickAdd}
							onCheckedChange={(timelineQuickAdd) =>
								updateAutoCaptionSettings({ timelineQuickAdd })
							}
						/>
					</div>
				)}
			</div>
		</section>
	);
}
