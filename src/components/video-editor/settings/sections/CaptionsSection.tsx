import { Button } from "@/components/ui/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { SliderControl } from "../../SliderControl";
import type { AutoCaptionAnimation, AutoCaptionSettings } from "../../types";
import { CAPTION_ANIMATION_OPTIONS, CAPTION_LANGUAGE_OPTIONS } from "../constants";
import { SettingsExtensionPanels, type SettingsPanelExtension } from "./ExtensionSettingsSection";

export function CaptionsSection({
	tSettings,
	t,
	autoCaptionSettings,
	defaultAutoCaptionSettings,
	onAutoCaptionSettingsChange,
	onPickWhisperModel,
	onGenerateAutoCaptions,
	onClearAutoCaptions,
	onDownloadWhisperSmallModel,
	onDeleteWhisperSmallModel,
	whisperModelPath,
	whisperModelDownloadStatus,
	whisperModelDownloadProgress,
	isGeneratingCaptions,
	captionCueCount,
	extensionPanels,
	isInitialLoading = false,
}: {
	tSettings: (key: string, fallback?: string) => string;
	t: (key: string, fallback?: string) => string;
	autoCaptionSettings: AutoCaptionSettings;
	defaultAutoCaptionSettings: AutoCaptionSettings;
	onAutoCaptionSettingsChange?: (settings: AutoCaptionSettings) => void;
	onPickWhisperModel?: () => void;
	onGenerateAutoCaptions?: () => void;
	onClearAutoCaptions?: () => void;
	onDownloadWhisperSmallModel?: () => void;
	onDeleteWhisperSmallModel?: () => void;
	whisperModelPath?: string | null;
	whisperModelDownloadStatus: "idle" | "downloading" | "downloaded" | "error";
	whisperModelDownloadProgress: number;
	isGeneratingCaptions: boolean;
	captionCueCount: number;
	extensionPanels: SettingsPanelExtension[];
	isInitialLoading?: boolean;
}) {
	const update = (partial: Partial<AutoCaptionSettings>) =>
		onAutoCaptionSettingsChange?.({ ...autoCaptionSettings, ...partial });

	if (isInitialLoading) {
		return (
			<section className="flex flex-col gap-2 animate-in fade-in duration-200">
				<div className="flex items-center justify-between gap-3">
					<Skeleton className="h-3 w-16" variant="subtle" />
					<Skeleton className="h-4 w-10 rounded-full" variant="subtle" />
				</div>
				<div className="rounded-lg bg-foreground/[0.03] px-2.5 py-3 space-y-3">
					<Skeleton className="h-10 w-full rounded-xl" variant="subtle" animation="shimmer-premium" />
					<div className="flex items-center justify-between">
						<Skeleton className="h-3 w-14" variant="subtle" />
						<Skeleton className="h-10 w-32 rounded-xl" variant="subtle" animation="shimmer-premium" />
					</div>
					<Skeleton className="h-10 w-full rounded-xl" variant="subtle" animation="shimmer-premium" />
				</div>
				<SettingsExtensionPanels
					panels={extensionPanels}
					sections={["captions"]}
					isInitialLoading={true}
				/>
			</section>
		);
	}

	return (
		<section className="flex flex-col gap-2 animate-in fade-in duration-300">
			<div className="flex items-center justify-between gap-3">
				<div className="flex items-center gap-3">
					<p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
						{tSettings("sections.captions", "Captions")}
					</p>
					<button
						type="button"
						onClick={() => onAutoCaptionSettingsChange?.(defaultAutoCaptionSettings)}
						className="text-[10px] text-[#2563EB] transition-opacity hover:opacity-80"
					>
						{t("common.actions.reset", "Reset")}
					</button>
				</div>
				<div className="flex items-center gap-2 text-[10px] text-muted-foreground">
					<span>{tSettings("captions.enabled", "Show")}</span>
					<Switch
						checked={autoCaptionSettings.enabled}
						onCheckedChange={(enabled) => update({ enabled })}
						className="data-[state=checked]:bg-[#2563EB] scale-75"
					/>
				</div>
			</div>
			<div className="rounded-lg bg-foreground/[0.03] px-2.5 py-2 space-y-3">
				<div>
					<Button
						type="button"
						variant="outline"
						onClick={onPickWhisperModel}
						className="h-10 w-full rounded-xl border-foreground/10 bg-foreground/5 px-4 text-sm text-foreground hover:bg-foreground/10 hover:text-foreground"
					>
						{tSettings("captions.selectModel", "Select Model")}
					</Button>
				</div>
				<div className="flex items-center justify-between gap-3">
					<div className="text-sm font-medium text-foreground">
						{tSettings("captions.language", "Language")}
					</div>
					<Select
						value={autoCaptionSettings.language || "auto"}
						onValueChange={(value) => update({ language: value })}
					>
						<SelectTrigger className="h-10 w-[180px] rounded-xl border-foreground/10 bg-foreground/5 text-sm text-foreground hover:bg-foreground/10">
							<SelectValue />
						</SelectTrigger>
						<SelectContent className="border-foreground/10 bg-editor-surface-alt text-foreground">
							{CAPTION_LANGUAGE_OPTIONS.map((option) => (
								<SelectItem key={option.value} value={option.value}>
									{option.label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
				<div className="grid w-full grid-cols-2 gap-2">
					{whisperModelDownloadStatus === "downloading" ? (
						<Button
							type="button"
							disabled
							className="h-10 w-full rounded-xl bg-foreground/10 px-4 text-sm font-medium text-foreground hover:bg-foreground/10"
						>
							{tSettings("captions.downloading", "Downloading...")}{" "}
							{Math.round(whisperModelDownloadProgress)}%
						</Button>
					) : whisperModelPath ? (
						<Button
							type="button"
							variant="outline"
							onClick={onDeleteWhisperSmallModel}
							className="h-10 w-full rounded-xl border-foreground/10 bg-foreground/5 px-4 text-sm text-foreground hover:bg-foreground/10 hover:text-foreground"
						>
							{tSettings("captions.deleteModel", "Delete Model")}
						</Button>
					) : (
						<Button
							type="button"
							onClick={onDownloadWhisperSmallModel}
							className="h-10 w-full rounded-xl bg-[#2563EB] px-4 text-sm font-medium text-white hover:bg-[#2563EB]/90"
						>
							{tSettings("captions.downloadModel", "Download Model")}
						</Button>
					)}
					<Button
						type="button"
						variant="outline"
						onClick={onClearAutoCaptions}
						disabled={captionCueCount === 0}
						className="h-10 w-full rounded-xl border-foreground/10 bg-foreground/5 px-4 text-sm text-foreground hover:bg-foreground/10 hover:text-foreground disabled:opacity-50"
					>
						{tSettings("captions.clearFull", "Clear Captions")}
					</Button>
				</div>
				<Button
					type="button"
					onClick={onGenerateAutoCaptions}
					disabled={isGeneratingCaptions || !whisperModelPath}
					className="h-10 w-full rounded-xl bg-[#2563EB] px-4 text-sm font-medium text-white hover:bg-[#2563EB]/90 disabled:opacity-60"
				>
					{isGeneratingCaptions
						? tSettings("captions.generating", "Generating...")
						: captionCueCount > 0
							? tSettings("captions.regenerateFull", "Regenerate Captions")
							: tSettings("captions.generateFull", "Generate Captions")}
				</Button>
			</div>
			<div className="flex flex-col gap-1.5">
				<div className="flex items-center justify-between gap-3 rounded-lg bg-foreground/[0.03] px-2.5 py-2">
					<div className="text-[10px] text-muted-foreground">
						{tSettings("captions.animation", "Animation")}
					</div>
					<Select
						value={autoCaptionSettings.animationStyle}
						onValueChange={(value) =>
							update({ animationStyle: value as AutoCaptionAnimation })
						}
					>
						<SelectTrigger className="h-9 w-[160px] rounded-xl border-foreground/10 bg-foreground/5 text-sm text-foreground hover:bg-foreground/10">
							<SelectValue />
						</SelectTrigger>
						<SelectContent className="border-foreground/10 bg-editor-surface-alt text-foreground">
							{CAPTION_ANIMATION_OPTIONS.map((option) => (
								<SelectItem key={option.value} value={option.value}>
									{option.label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
				<label className="flex items-center justify-between rounded-lg bg-foreground/[0.03] px-2.5 py-2">
					<span className="text-[10px] text-muted-foreground">
						{tSettings("captions.textColor", "Text color")}
					</span>
					<input
						type="color"
						value={autoCaptionSettings.textColor}
						onChange={(event) => update({ textColor: event.target.value })}
						className="h-7 w-10 rounded border border-foreground/10 bg-transparent"
					/>
				</label>
				<SliderControl
					label={tSettings("captions.fontSize", "Font size")}
					value={autoCaptionSettings.fontSize}
					defaultValue={defaultAutoCaptionSettings.fontSize}
					min={16}
					max={72}
					step={1}
					onChange={(value) => update({ fontSize: value })}
					formatValue={(value) => `${Math.round(value)}px`}
					parseInput={(text) => parseFloat(text.replace(/px$/, ""))}
				/>
				<SliderControl
					label={tSettings("captions.rowCount", "Rows")}
					value={autoCaptionSettings.maxRows}
					defaultValue={defaultAutoCaptionSettings.maxRows}
					min={1}
					max={4}
					step={1}
					onChange={(value) => update({ maxRows: Math.round(value) })}
					formatValue={(value) => `${Math.round(value)}`}
					parseInput={(text) => parseFloat(text)}
				/>
				<SliderControl
					label={tSettings("captions.bottomOffset", "Bottom offset")}
					value={autoCaptionSettings.bottomOffset}
					defaultValue={defaultAutoCaptionSettings.bottomOffset}
					min={0}
					max={30}
					step={1}
					onChange={(value) => update({ bottomOffset: value })}
					formatValue={(value) => `${Math.round(value)}%`}
					parseInput={(text) => parseFloat(text.replace(/%$/, ""))}
				/>
				<SliderControl
					label={tSettings("captions.maxWidth", "Max width")}
					value={autoCaptionSettings.maxWidth}
					defaultValue={defaultAutoCaptionSettings.maxWidth}
					min={40}
					max={95}
					step={1}
					onChange={(value) => update({ maxWidth: value })}
					formatValue={(value) => `${Math.round(value)}%`}
					parseInput={(text) => parseFloat(text.replace(/%$/, ""))}
				/>
			</div>
			<SettingsExtensionPanels panels={extensionPanels} sections={["captions"]} />
		</section>
	);
}
