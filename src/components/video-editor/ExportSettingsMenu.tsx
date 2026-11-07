import { DownloadSimple as Download, FilmSlate as Film, Image } from "@/components/ui/icons";
import { Card, Label, Description, TagGroup, Tag } from "@heroui/react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useScopedT } from "@/contexts/I18nContext";
import type {
	ExportEncodingMode,
	ExportFormat,
	ExportMp4FrameRate,
	ExportPipelineModel,
	ExportQuality,
	GifFrameRate,
	GifSizePreset,
} from "@/lib/exporter";
import { GIF_FRAME_RATES, GIF_SIZE_PRESETS, MP4_FRAME_RATES } from "@/lib/exporter";

interface ExportSettingsMenuProps {
	exportFormat: ExportFormat;
	onExportFormatChange?: (format: ExportFormat) => void;
	exportQuality: ExportQuality;
	onExportQualityChange?: (quality: ExportQuality) => void;
	exportEncodingMode: ExportEncodingMode;
	onExportEncodingModeChange?: (encodingMode: ExportEncodingMode) => void;
	mp4FrameRate: ExportMp4FrameRate;
	onMp4FrameRateChange?: (frameRate: ExportMp4FrameRate) => void;
	exportPipelineModel?: ExportPipelineModel;
	experimentalNvidiaCudaExport?: boolean;
	onExperimentalNvidiaCudaExportChange?: (enabled: boolean) => void;
	nvidiaCudaExportAvailable?: boolean;
	showCaptionSidecarOption?: boolean;
	includeCaptionSidecar?: boolean;
	onIncludeCaptionSidecarChange?: (enabled: boolean) => void;
	mp4OutputDimensions?: Record<
		"medium" | "good" | "high" | "source",
		{ width: number; height: number }
	>;
	gifFrameRate: GifFrameRate;
	onGifFrameRateChange?: (rate: GifFrameRate) => void;
	gifLoop: boolean;
	onGifLoopChange?: (loop: boolean) => void;
	gifSizePreset: GifSizePreset;
	onGifSizePresetChange?: (preset: GifSizePreset) => void;
	gifOutputDimensions: { width: number; height: number };
	onExport?: () => void;
	className?: string;
	hideHeading?: boolean;
	hideAction?: boolean;
	linkMode?: boolean;
}

function Choices<T extends string | number>({
	label,
	value,
	options,
	onChange,
}: {
	label: string;
	value: T;
	options: { value: T; label: ReactNode; textValue?: string; description?: string }[];
	onChange?: (value: T) => void;
}) {
	return (
		<div className="flex flex-col gap-2">
			<Label>{label}</Label>
			<TagGroup
				aria-label={label}
				selectionMode="single"
				disallowEmptySelection
				selectedKeys={[String(value)]}
				onSelectionChange={(keys) => {
					if (keys === "all") return;
					const selected = options.find((option) => keys.has(String(option.value)));
					if (selected) onChange?.(selected.value);
				}}
				size="lg"
			>
				<TagGroup.List className="flex gap-2">
					{options.map((option) => (
						<Tag
							key={option.value}
							id={String(option.value)}
							textValue={
								option.textValue ??
								(typeof option.label === "string"
									? option.label
									: String(option.value))
							}
							className="h-auto min-h-10 flex-1 justify-center flex-col gap-0.5 py-2"
						>
							{option.label}
							{option.description && (
								<span className="text-[10px] opacity-70">{option.description}</span>
							)}
						</Tag>
					))}
				</TagGroup.List>
			</TagGroup>
		</div>
	);
}
export function ExportSettingsMenu({
	exportFormat,
	onExportFormatChange,
	exportQuality,
	onExportQualityChange,
	exportEncodingMode,
	onExportEncodingModeChange,
	mp4FrameRate,
	onMp4FrameRateChange,
	exportPipelineModel = "modern",
	experimentalNvidiaCudaExport = false,
	onExperimentalNvidiaCudaExportChange,
	nvidiaCudaExportAvailable = false,
	showCaptionSidecarOption = false,
	includeCaptionSidecar = false,
	onIncludeCaptionSidecarChange,
	mp4OutputDimensions,
	gifFrameRate,
	onGifFrameRateChange,
	gifLoop,
	onGifLoopChange,
	gifSizePreset,
	onGifSizePresetChange,
	gifOutputDimensions,
	onExport,
	className,
	hideHeading = false,
	hideAction = false,
	linkMode = false,
}: ExportSettingsMenuProps) {
	const tSettings = useScopedT("settings");
	const isLegacyModel = exportPipelineModel === "legacy";

	return (
		<Card className={className}>
			{!hideHeading && (
				<Card.Header>
					<Card.Title>{tSettings("export.title", "Export")}</Card.Title>
				</Card.Header>
			)}
			<Card.Content className="gap-4">
				{!linkMode && (
					<Choices
						label={tSettings("export.format", "Format")}
						value={exportFormat}
						onChange={onExportFormatChange}
						options={[
							{
								value: "mp4",
								textValue: tSettings("export.mp4"),
								label: (
									<span className="flex items-center gap-2">
										<Film />
										{tSettings("export.mp4")}
									</span>
								),
							},
							{
								value: "gif",
								textValue: tSettings("export.gif"),
								label: (
									<span className="flex items-center gap-2">
										<Image />
										{tSettings("export.gif")}
									</span>
								),
							},
						]}
					/>
				)}
				{exportFormat === "mp4" ? (
					<>
						<Choices
							label={tSettings("export.qualityTitle", "Quality")}
							value={exportQuality}
							onChange={onExportQualityChange}
							options={(["medium", "good", "high", "source"] as const).map(
								(value, index) => ({
									value,
									label: tSettings(
										`export.quality.${["low", "medium", "high", "original"][index]}`,
									),
									description: mp4OutputDimensions
										? `${mp4OutputDimensions[value].width} × ${mp4OutputDimensions[value].height}`
										: undefined,
								}),
							)}
						/>
						<Choices
							label={tSettings("export.encodingTitle", "Encoding")}
							value={exportEncodingMode}
							onChange={onExportEncodingModeChange}
							options={(["fast", "balanced", "quality"] as const).map((value) => ({
								value,
								label: tSettings(
									`export.encoding.${value}`,
									{ fast: "Fast", balanced: "Balanced", quality: "Quality" }[
										value
									],
								),
							}))}
						/>
						<Choices
							label={tSettings("export.fpsTitle", "FPS")}
							value={mp4FrameRate}
							onChange={onMp4FrameRateChange}
							options={MP4_FRAME_RATES.map((value) => ({
								value,
								label: String(value),
							}))}
						/>
						{!isLegacyModel && nvidiaCudaExportAvailable && (
							<Switch
								checked={experimentalNvidiaCudaExport}
								onCheckedChange={onExperimentalNvidiaCudaExportChange}
							>
								<Label>{tSettings("export.nvidiaCuda.title", "NVIDIA CUDA")}</Label>
							</Switch>
						)}
						{showCaptionSidecarOption && (
							<div>
								<Switch
									checked={includeCaptionSidecar}
									onCheckedChange={onIncludeCaptionSidecarChange}
								>
									<Label>
										{tSettings(
											"export.captionSidecar.title",
											"Export captions file",
										)}
									</Label>
								</Switch>
								<Description>
									{tSettings(
										"export.captionSidecar.hint",
										"Save .srt and .vtt files next to your exported video.",
									)}
								</Description>
							</div>
						)}
					</>
				) : (
					<>
						<Choices
							label={tSettings("export.fpsTitle", "FPS")}
							value={gifFrameRate}
							onChange={onGifFrameRateChange}
							options={GIF_FRAME_RATES.map((rate) => ({
								value: rate.value,
								label: String(rate.value),
							}))}
						/>
						<Choices
							label={tSettings("export.size", "Size")}
							value={gifSizePreset}
							onChange={onGifSizePresetChange}
							options={Object.entries(GIF_SIZE_PRESETS).map(([key, preset]) => ({
								value: key as GifSizePreset,
								label: preset.label,
							}))}
						/>
						<Description>
							{gifOutputDimensions.width} × {gifOutputDimensions.height}px
						</Description>
						<Switch checked={gifLoop} onCheckedChange={onGifLoopChange}>
							<Label>{tSettings("export.loop")}</Label>
						</Switch>
					</>
				)}
			</Card.Content>
			{!hideAction && (
				<Card.Footer>
					<Button size="lg" onClick={onExport} className="w-full">
						<Download />
						{tSettings("export.exportVideo", undefined, {
							format: exportFormat === "gif" ? "GIF" : "Video",
						})}
					</Button>
				</Card.Footer>
			)}
		</Card>
	);
}
