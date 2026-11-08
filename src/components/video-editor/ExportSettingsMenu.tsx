import { Card, Description, Input, Label } from "@heroui/react";
import { useOptionalBilling } from "@/components/billing/BillingProvider";
import { canExportCaptionFiles } from "@/components/billing/captionFileAccess";
import { PlusBadge } from "@/components/billing/PlusBadge";
import { Button } from "@/components/ui/button";
import { DownloadSimple as Download, FilmSlate as Film, Image } from "@/components/ui/icons";
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
import type { GifSizeEstimateState } from "./export/useGifSizeEstimate";
import { isValidCustomExportResolution } from "./exportDimensions";
import { GifOptimizeSizeCheckbox } from "./GifOptimizeSizeCheckbox";
import { ExportChoices } from "./settings/ExportChoices";

interface ExportSettingsMenuProps {
	advancedExportSettings?: boolean;
	onAdvancedExportSettingsChange?: (enabled: boolean) => void;
	customExportResolution?: { width: number; height: number };
	onCustomExportResolutionChange?: (resolution: { width: number; height: number }) => void;
	mp4SizeEstimate?: number | null;
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
	mp4OutputDimensions?: Record<ExportQuality, { width: number; height: number }>;
	gifFrameRate: GifFrameRate;
	onGifFrameRateChange?: (rate: GifFrameRate) => void;
	gifSizeEstimate?: GifSizeEstimateState | null;
	gifOptimizeSize?: boolean;
	onGifOptimizeSizeChange?: (enabled: boolean) => void;
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

export function ExportSettingsMenu({
	advancedExportSettings = false,
	onAdvancedExportSettingsChange,
	customExportResolution = { width: 1920, height: 1080 },
	onCustomExportResolutionChange,
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
	gifOptimizeSize = false,
	onGifOptimizeSizeChange,
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
	const tBilling = useScopedT("billing");
	const billing = useOptionalBilling();
	const captionFilesAvailable = canExportCaptionFiles(billing);
	const isLegacyModel = exportPipelineModel === "legacy";
	const invalidCustom =
		exportFormat === "mp4" &&
		exportQuality === "custom" &&
		!isValidCustomExportResolution(customExportResolution);
	const toggleAdvanced = (enabled: boolean) => {
		if (!enabled && (exportQuality === "source" || exportQuality === "custom"))
			onExportQualityChange?.("medium");
		onAdvancedExportSettingsChange?.(enabled);
	};
	const resizeCustom = (axis: "width" | "height", value: number) => {
		const source = mp4OutputDimensions?.source ?? { width: 1920, height: 1080 };
		const ratio = source.width / source.height;
		const other = axis === "width" ? value / ratio : value * ratio;
		onCustomExportResolutionChange?.({
			...customExportResolution,
			[axis]: value,
			[axis === "width" ? "height" : "width"]: Math.max(0, Math.round(other / 2) * 2),
		});
	};

	const advancedToggle = (
		<Switch checked={advancedExportSettings} onCheckedChange={toggleAdvanced} size="sm">
			<Label>{tSettings("export.advanced", "Advanced")}</Label>
		</Switch>
	);

	return (
		<Card className={className}>
			{!hideHeading && (
				<Card.Header>
					<Card.Title>{tSettings("export.title", "Export")}</Card.Title>
				</Card.Header>
			)}
			<Card.Content className="gap-4">
				{!linkMode && (
					<ExportChoices
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
						<ExportChoices
							label={tSettings("export.resolutionTitle", "Resolution")}
							headingAction={advancedToggle}
							columns={2}
							value={exportQuality}
							onChange={onExportQualityChange}
							options={(["hd", "medium", "good", "high"] as const).map((value) => {
								const label = { hd: "HD", medium: "FHD", good: "QHD", high: "4K" }[
									value
								];
								const dimensions = mp4OutputDimensions?.[value];
								const description = dimensions
									? `${dimensions.width} × ${dimensions.height}`
									: { hd: "720p", medium: "1080p", good: "1440p", high: "2160p" }[
											value
										];
								return {
									value,
									label,
									description,
									textValue: `${label}, ${description}`,
								};
							})}
						/>
						{advancedExportSettings && (
							<>
								<ExportChoices<ExportQuality>
									label={tSettings(
										"export.advancedResolution",
										"Advanced resolution",
									)}
									value={exportQuality}
									onChange={onExportQualityChange}
									options={[
										{
											value: "source",
											label: tSettings("export.quality.original", "Original"),
											description: mp4OutputDimensions?.source
												? `${mp4OutputDimensions.source.width} × ${mp4OutputDimensions.source.height}`
												: undefined,
										},
										{
											value: "custom",
											label: tSettings("export.customResolution", "Custom"),
										},
									]}
								/>
								{exportQuality === "custom" && (
									<div className="flex flex-col gap-2">
										<div className="grid grid-cols-2 gap-2">
											{(["width", "height"] as const).map((axis) => (
												<label
													key={axis}
													className="flex flex-col gap-1 text-sm"
												>
													{tSettings(
														`export.custom${axis === "width" ? "Width" : "Height"}`,
														axis === "width"
															? "Width (px)"
															: "Height (px)",
													)}
													<Input
														type="number"
														min={2}
														max={8192}
														step={2}
														aria-label={tSettings(
															`export.custom${axis === "width" ? "Width" : "Height"}`,
														)}
														value={customExportResolution[axis] || ""}
														onChange={(event) =>
															resizeCustom(
																axis,
																Number(event.target.value),
															)
														}
													/>
												</label>
											))}
										</div>
										<Description>
											{tSettings(
												"export.customResolutionHint",
												"Width and height stay linked to the canvas aspect ratio. Use even dimensions from 2 to 8192 pixels.",
											)}
										</Description>
										{invalidCustom && (
											<p role="alert" className="text-xs text-danger">
												{tSettings(
													"export.invalidCustomResolution",
													"Enter even dimensions between 2 and 8192 pixels.",
												)}
											</p>
										)}
									</div>
								)}
								<ExportChoices
									label={tSettings("export.encodingTitle", "Encoding")}
									value={exportEncodingMode}
									onChange={onExportEncodingModeChange}
									options={(["fast", "balanced", "quality"] as const).map(
										(value) => ({
											value,
											label: tSettings(
												`export.encoding.${value}`,
												{
													fast: "Fast",
													balanced: "Balanced",
													quality: "Quality",
												}[value],
											),
										}),
									)}
								/>
							</>
						)}
						{advancedExportSettings && (
							<>
								<ExportChoices
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
										disabled={!nvidiaCudaExportAvailable}
										checked={experimentalNvidiaCudaExport}
										onCheckedChange={onExperimentalNvidiaCudaExportChange}
									>
										<Label>
											{tSettings("export.nvidiaCuda.title", "NVIDIA CUDA")}
										</Label>
									</Switch>
								)}
							</>
						)}
						{showCaptionSidecarOption && (
							<div>
								<Switch
									checked={captionFilesAvailable && includeCaptionSidecar}
									onCheckedChange={(enabled) => {
										if (enabled && !captionFilesAvailable) {
											billing?.openPricing();
											return;
										}
										onIncludeCaptionSidecarChange?.(enabled);
									}}
								>
									<Label>
										{tSettings(
											"export.captionSidecar.title",
											"Export captions file",
										)}
										<PlusBadge className="ml-2" />
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
						{advancedExportSettings && (
							<ExportChoices
								label={tSettings("export.fpsTitle", "FPS")}
								value={gifFrameRate}
								onChange={onGifFrameRateChange}
								options={GIF_FRAME_RATES.map((rate) => ({
									value: rate.value,
									label: String(rate.value),
								}))}
							/>
						)}
						<ExportChoices
							label={tSettings("export.size", "Size")}
							headingAction={advancedToggle}
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
				{exportFormat === "gif" && (
					<div className="space-y-1 border-t border-foreground/10 pt-3">
						<GifOptimizeSizeCheckbox
							selected={gifOptimizeSize}
							onChange={onGifOptimizeSizeChange}
						/>
						{gifOptimizeSize && (
							<Description className="text-xs">
								<span className="block">
									{tSettings(
										"export.optimizeTargetHint",
										"Targets 90% smaller by reducing colors and resolution. Actual size may vary.",
									)}
								</span>
							</Description>
						)}
					</div>
				)}
				{billing?.status?.billing.plan !== "pro" && (
					<div className="space-y-1">
						<p className="text-xs text-muted">
							<Button
								variant="link"
								className="inline h-auto min-h-0 p-0 text-xs text-accent no-underline hover:underline"
								onClick={() => billing?.openPricing()}
							>
								{tBilling("upgradeShort", "Upgrade")}
							</Button>{" "}
							{tBilling("forCommercialUse", "for commercial use")}
						</p>
					</div>
				)}
			</Card.Content>
			{!hideAction && (
				<Card.Footer>
					<Button
						size="lg"
						disabled={invalidCustom}
						onClick={onExport}
						className="w-full"
					>
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
