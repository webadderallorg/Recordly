import { DownloadSimple as Download, FilmSlate as Film, Image } from "@phosphor-icons/react";
import { LayoutGroup, motion } from "motion/react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useScopedT } from "@/contexts/I18nContext";
import type {
	ExportBitrateMode,
	ExportEncoderPreference,
	ExportEncodingMode,
	ExportFormat,
	ExportMp4FrameRate,
	ExportPipelineModel,
	ExportQuality,
	ExportVideoCodec,
	GifFrameRate,
	GifSizePreset,
} from "@/lib/exporter";
import {
	EXPORT_BITRATE_DEFAULT_CUSTOM_MBPS,
	EXPORT_BITRATE_MAX_MBPS,
	EXPORT_BITRATE_MIN_MBPS,
	GIF_FRAME_RATES,
	GIF_SIZE_PRESETS,
	MP4_FRAME_RATES,
} from "@/lib/exporter";
import { cn } from "@/lib/utils";

interface ExportSettingsMenuProps {
	exportFormat: ExportFormat;
	onExportFormatChange?: (format: ExportFormat) => void;
	exportQuality: ExportQuality;
	onExportQualityChange?: (quality: ExportQuality) => void;
	exportEncodingMode: ExportEncodingMode;
	onExportEncodingModeChange?: (encodingMode: ExportEncodingMode) => void;
	exportVideoCodec: ExportVideoCodec;
	onExportVideoCodecChange?: (codec: ExportVideoCodec) => void;
	exportEncoderPreference: ExportEncoderPreference;
	onExportEncoderPreferenceChange?: (preference: ExportEncoderPreference) => void;
	exportBitrateMode: ExportBitrateMode;
	onExportBitrateModeChange?: (mode: ExportBitrateMode) => void;
	exportBitrateMbps?: number;
	onExportBitrateMbpsChange?: (mbps: number) => void;
	mp4FrameRate: ExportMp4FrameRate;
	onMp4FrameRateChange?: (frameRate: ExportMp4FrameRate) => void;
	exportPipelineModel?: ExportPipelineModel;
	onExportPipelineModelChange?: (pipelineModel: ExportPipelineModel) => void;
	experimentalNvidiaCudaExport?: boolean;
	onExperimentalNvidiaCudaExportChange?: (enabled: boolean) => void;
	nvidiaCudaExportAvailable?: boolean;
	nvidiaCudaExportSkipReason?: string | null;
	/** True when HEVC + Hardware makes the NVIDIA CUDA compositor mandatory. The
	 *  option is shown as selected and cannot be disabled; the export hard-fails
	 *  instead of falling back when the compositor cannot run. */
	nvidiaCudaCompositorRequired?: boolean;
	showCaptionSidecarOption?: boolean;
	includeCaptionSidecar?: boolean;
	onIncludeCaptionSidecarChange?: (enabled: boolean) => void;
	mp4OutputDimensions?: Record<ExportQuality, { width: number; height: number }>;
	gifFrameRate: GifFrameRate;
	onGifFrameRateChange?: (rate: GifFrameRate) => void;
	gifLoop: boolean;
	onGifLoopChange?: (loop: boolean) => void;
	gifSizePreset: GifSizePreset;
	onGifSizePresetChange?: (preset: GifSizePreset) => void;
	gifOutputDimensions: { width: number; height: number };
	onExport?: () => void;
	className?: string;
}

export function ExportSettingsMenu({
	exportFormat,
	onExportFormatChange,
	exportQuality,
	onExportQualityChange,
	exportEncodingMode,
	onExportEncodingModeChange,
	exportVideoCodec,
	onExportVideoCodecChange,
	exportEncoderPreference,
	onExportEncoderPreferenceChange,
	exportBitrateMode,
	onExportBitrateModeChange,
	exportBitrateMbps = EXPORT_BITRATE_DEFAULT_CUSTOM_MBPS,
	onExportBitrateMbpsChange,
	mp4FrameRate,
	onMp4FrameRateChange,
	exportPipelineModel = "modern",
	onExportPipelineModelChange,
	experimentalNvidiaCudaExport = false,
	onExperimentalNvidiaCudaExportChange,
	nvidiaCudaExportAvailable = false,
	nvidiaCudaExportSkipReason = null,
	nvidiaCudaCompositorRequired = false,
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
}: ExportSettingsMenuProps) {
	const tSettings = useScopedT("settings");
	const isLegacyModel = exportPipelineModel === "legacy";
	const [bitrateDraft, setBitrateDraft] = useState<string>(String(exportBitrateMbps));

	useEffect(() => {
		setBitrateDraft(String(exportBitrateMbps));
	}, [exportBitrateMbps]);

	const commitBitrateDraft = () => {
		const parsed = Number(bitrateDraft);
		const clamped = Number.isFinite(parsed)
			? Math.min(EXPORT_BITRATE_MAX_MBPS, Math.max(EXPORT_BITRATE_MIN_MBPS, parsed))
			: EXPORT_BITRATE_DEFAULT_CUSTOM_MBPS;
		setBitrateDraft(String(clamped));
		onExportBitrateMbpsChange?.(clamped);
	};

	return (
		<div
			className={cn(
				"w-full rounded-2xl border border-foreground/10 bg-editor-surface p-3 text-foreground",
				className,
			)}
		>
			<div className="mb-2 flex items-center justify-between">
				<span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
					{tSettings("export.title", "Export")}
				</span>
			</div>

			<div className="mb-3 flex items-center gap-2">
				<LayoutGroup id="header-export-format-toggle">
					{(
						[
							{ value: "mp4", label: tSettings("export.mp4"), icon: Film },
							{ value: "gif", label: tSettings("export.gif"), icon: Image },
						] as const
					).map((option) => {
						const Icon = option.icon;
						const isActive = exportFormat === option.value;
						return (
							<button
								key={option.value}
								type="button"
								onClick={() => onExportFormatChange?.(option.value)}
								aria-pressed={isActive}
								className={cn(
									"relative flex-1 overflow-hidden rounded-xl border py-2 text-xs font-medium transition-colors",
									isActive
										? "border-[#2563EB]/50 text-[#2563EB] dark:text-white"
										: "border-foreground/10 bg-foreground/5 text-muted-foreground hover:bg-foreground/10 hover:text-foreground",
								)}
							>
								{isActive ? (
									<motion.span
										layoutId="header-export-format-pill"
										className="absolute inset-0 rounded-xl bg-[#2563EB]/10"
										transition={{ type: "spring", stiffness: 380, damping: 32 }}
									/>
								) : null}
								<span className="relative z-10 flex items-center justify-center gap-1.5">
									<Icon className="h-3.5 w-3.5" />
									{option.label}
								</span>
							</button>
						);
					})}
				</LayoutGroup>
			</div>

			{exportFormat === "mp4" ? (
				<LayoutGroup id="header-export-quality-toggle">
					<div className="mb-3 grid min-h-12 w-full grid-cols-4 rounded-xl border border-foreground/5 bg-foreground/5 p-0.5">
						{(
							[
								{ value: "medium", label: tSettings("export.quality.low") },
								{ value: "good", label: tSettings("export.quality.medium") },
								{ value: "high", label: tSettings("export.quality.high") },
								{ value: "source", label: tSettings("export.quality.original") },
							] as const
						).map((option) => {
							const isActive = exportQuality === option.value;
							return (
								<button
									key={option.value}
									type="button"
									onClick={() => onExportQualityChange?.(option.value)}
									aria-pressed={isActive}
									className="relative rounded-lg px-1 py-1 text-[11px] font-medium transition-colors"
								>
									{isActive ? (
										<motion.span
											layoutId="header-export-quality-pill"
											className="absolute inset-0 rounded-lg bg-neutral-800 dark:bg-white"
											transition={{
												type: "spring",
												stiffness: 420,
												damping: 34,
											}}
										/>
									) : null}
									<span className="relative z-10 flex h-full flex-col items-center justify-center leading-tight">
										<span
											className={cn(
												isActive
													? "text-white dark:text-black"
													: "text-muted-foreground hover:text-foreground",
											)}
										>
											{option.label}
										</span>
										{mp4OutputDimensions ? (
											<span
												className={cn(
													"mt-0.5 text-[9px]",
													isActive
														? "text-white/75 dark:text-black/75"
														: "text-muted-foreground/70",
												)}
											>
												{mp4OutputDimensions[option.value].width} x{" "}
												{mp4OutputDimensions[option.value].height}
											</span>
										) : null}
									</span>
								</button>
							);
						})}
					</div>
					<div className="mb-1 flex items-center justify-between px-1">
						<span className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground/70">
							{tSettings("export.encodingTitle", "Encoding")}
						</span>
					</div>
					<div className="mb-3 grid min-h-10 w-full grid-cols-3 rounded-xl border border-foreground/5 bg-foreground/5 p-0.5">
						{(
							[
								{ value: "fast", label: tSettings("export.encoding.fast", "Fast") },
								{
									value: "balanced",
									label: tSettings("export.encoding.balanced", "Balanced"),
								},
								{
									value: "quality",
									label: tSettings("export.encoding.quality", "Quality"),
								},
							] as const
						).map((option) => {
							const isActive = exportEncodingMode === option.value;
							return (
								<button
									key={option.value}
									type="button"
									onClick={() => onExportEncodingModeChange?.(option.value)}
									aria-pressed={isActive}
									className="relative rounded-lg px-1 py-1 text-[11px] font-medium transition-colors"
								>
									{isActive ? (
										<motion.span
											layoutId="header-export-encoding-pill"
											className="absolute inset-0 rounded-lg bg-neutral-800 dark:bg-white"
											transition={{
												type: "spring",
												stiffness: 420,
												damping: 34,
											}}
										/>
									) : null}
									<span
										className={cn(
											"relative z-10",
											isActive
												? "text-white dark:text-black"
												: "text-muted-foreground hover:text-foreground",
										)}
									>
										{option.label}
									</span>
								</button>
							);
						})}
					</div>
					<div className="mb-1 flex items-center justify-between px-1">
						<span className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground/70">
							{tSettings("export.codecTitle", "Video codec")}
						</span>
					</div>
					<div className="mb-3 grid min-h-10 w-full grid-cols-2 rounded-xl border border-foreground/5 bg-foreground/5 p-0.5">
						{(
							[
								{ value: "h264", label: tSettings("export.codec.h264", "H.264") },
								{ value: "hevc", label: tSettings("export.codec.hevc", "H.265") },
							] as const
						).map((option) => {
							const isActive = exportVideoCodec === option.value;
							return (
								<button
									key={option.value}
									type="button"
									onClick={() => onExportVideoCodecChange?.(option.value)}
									aria-pressed={isActive}
									className="relative rounded-lg px-1 py-1 text-[11px] font-medium transition-colors"
								>
									{isActive ? (
										<motion.span
											layoutId="header-export-codec-pill"
											className="absolute inset-0 rounded-lg bg-neutral-800 dark:bg-white"
											transition={{
												type: "spring",
												stiffness: 420,
												damping: 34,
											}}
										/>
									) : null}
									<span
										className={cn(
											"relative z-10",
											isActive
												? "text-white dark:text-black"
												: "text-muted-foreground hover:text-foreground",
										)}
									>
										{option.label}
									</span>
								</button>
							);
						})}
					</div>
					<div className="mb-1 flex items-center justify-between px-1">
						<span className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground/70">
							{tSettings("export.encoderTitle", "Encoder")}
						</span>
					</div>
					<div className="mb-3 grid min-h-10 w-full grid-cols-3 rounded-xl border border-foreground/5 bg-foreground/5 p-0.5">
						{(
							[
								{ value: "auto", label: tSettings("export.encoder.auto", "Auto") },
								{
									value: "hardware",
									label: tSettings("export.encoder.hardware", "Hardware"),
								},
								{ value: "cpu", label: tSettings("export.encoder.cpu", "CPU") },
							] as const
						).map((option) => {
							const isActive = exportEncoderPreference === option.value;
							return (
								<button
									key={option.value}
									type="button"
									onClick={() => onExportEncoderPreferenceChange?.(option.value)}
									aria-pressed={isActive}
									className="relative rounded-lg px-1 py-1 text-[11px] font-medium transition-colors"
								>
									{isActive ? (
										<motion.span
											layoutId="header-export-encoder-pill"
											className="absolute inset-0 rounded-lg bg-neutral-800 dark:bg-white"
											transition={{
												type: "spring",
												stiffness: 420,
												damping: 34,
											}}
										/>
									) : null}
									<span
										className={cn(
											"relative z-10",
											isActive
												? "text-white dark:text-black"
												: "text-muted-foreground hover:text-foreground",
										)}
									>
										{option.label}
									</span>
								</button>
							);
						})}
					</div>
					<div className="mb-1 flex items-center justify-between px-1">
						<span className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground/70">
							{tSettings("export.bitrateTitle", "Bitrate")}
						</span>
					</div>
					<div className="mb-2 grid min-h-10 w-full grid-cols-2 rounded-xl border border-foreground/5 bg-foreground/5 p-0.5">
						{(
							[
								{
									value: "auto",
									label: tSettings("export.bitrate.auto", "Auto"),
								},
								{
									value: "custom",
									label: tSettings("export.bitrate.custom", "Custom"),
								},
							] as const
						).map((option) => {
							const isActive = exportBitrateMode === option.value;
							return (
								<button
									key={option.value}
									type="button"
									onClick={() => onExportBitrateModeChange?.(option.value)}
									aria-pressed={isActive}
									className="relative rounded-lg px-1 py-1 text-[11px] font-medium transition-colors"
								>
									{isActive ? (
										<motion.span
											layoutId="header-export-bitrate-pill"
											className="absolute inset-0 rounded-lg bg-neutral-800 dark:bg-white"
											transition={{
												type: "spring",
												stiffness: 420,
												damping: 34,
											}}
										/>
									) : null}
									<span
										className={cn(
											"relative z-10",
											isActive
												? "text-white dark:text-black"
												: "text-muted-foreground hover:text-foreground",
										)}
									>
										{option.label}
									</span>
								</button>
							);
						})}
					</div>
					{exportBitrateMode === "custom" ? (
						<div className="mb-2 flex items-center gap-2 px-1">
							<Input
								type="number"
								min={EXPORT_BITRATE_MIN_MBPS}
								max={EXPORT_BITRATE_MAX_MBPS}
								step="0.5"
								value={bitrateDraft}
								onChange={(event) => {
									setBitrateDraft(event.target.value);
									const parsed = Number(event.target.value);
									if (Number.isFinite(parsed)) {
										onExportBitrateMbpsChange?.(parsed);
									}
								}}
								onBlur={commitBitrateDraft}
								className="h-8 w-24"
								aria-label={tSettings(
									"export.bitrate.mbpsInput",
									"Custom bitrate in Mbps",
								)}
							/>
							<span className="text-[10px] text-muted-foreground/70">Mbps</span>
							<span className="text-[9px] text-muted-foreground/50">
								{tSettings("export.bitrate.range", "1\u2013200 Mbps")}
							</span>
						</div>
					) : null}
					{exportVideoCodec === "hevc" ? (
						<p className="mb-3 px-1 text-[10px] text-muted-foreground/70">
							{tSettings(
								"export.hevcHint",
								"HEVC (H.265) makes smaller files but may not play on older or web players. Recordly preview playback is unchanged.",
							)}
						</p>
					) : null}
					<div className="mb-1 flex items-center justify-between px-1">
						<span className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground/70">
							{tSettings("export.fpsTitle", "FPS")}
						</span>
					</div>
					<div className="mb-3 grid min-h-10 w-full grid-cols-3 rounded-xl border border-foreground/5 bg-foreground/5 p-0.5">
						{MP4_FRAME_RATES.map((rate) => {
							const isActive = mp4FrameRate === rate;
							return (
								<button
									key={rate}
									type="button"
									onClick={() => onMp4FrameRateChange?.(rate)}
									aria-pressed={isActive}
									className="relative rounded-lg px-1 py-1 text-[11px] font-medium transition-colors"
								>
									{isActive ? (
										<motion.span
											layoutId="header-export-fps-pill"
											className="absolute inset-0 rounded-lg bg-neutral-800 dark:bg-white"
											transition={{
												type: "spring",
												stiffness: 420,
												damping: 34,
											}}
										/>
									) : null}
									<span
										className={cn(
											"relative z-10",
											isActive
												? "text-white dark:text-black"
												: "text-muted-foreground hover:text-foreground",
										)}
									>
										{rate}
									</span>
								</button>
							);
						})}
					</div>
					<div className="mb-1 flex items-center justify-between px-1">
						<span className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground/70">
							{tSettings("export.pipelineTitle", "Pipeline")}
						</span>
					</div>
					<div className="mb-3 grid min-h-10 w-full grid-cols-2 rounded-xl border border-foreground/5 bg-foreground/5 p-0.5">
						{(
							[
								{
									value: "legacy",
									label: tSettings("export.pipeline.legacy", "Legacy"),
								},
								{
									value: "modern",
									label: tSettings("export.pipeline.modern", "Lightning (Beta)"),
								},
							] as const
						).map((option) => {
							const isActive = exportPipelineModel === option.value;
							return (
								<button
									key={option.value}
									type="button"
									onClick={() => onExportPipelineModelChange?.(option.value)}
									aria-pressed={isActive}
									className="relative rounded-lg px-1 py-1 text-[11px] font-medium transition-colors"
								>
									{isActive ? (
										<motion.span
											layoutId="header-export-pipeline-pill"
											className="absolute inset-0 rounded-lg bg-neutral-800 dark:bg-white"
											transition={{
												type: "spring",
												stiffness: 420,
												damping: 34,
											}}
										/>
									) : null}
									<span
										className={cn(
											"relative z-10",
											isActive
												? "text-white dark:text-black"
												: "text-muted-foreground hover:text-foreground",
										)}
									>
										{option.label}
									</span>
								</button>
							);
						})}
					</div>
					<p className="mb-3 px-1 text-[10px] text-muted-foreground/70">
						{isLegacyModel
							? tSettings(
									"export.pipeline.legacyHint",
									"Legacy uses the current stable WebCodecs export path.",
								)
							: tSettings(
									"export.pipeline.lightningHint",
									"Lightning (Beta) automatically uses the fastest compatible backend and falls back when needed.",
								)}
					</p>
					{!isLegacyModel ? (
						<div className="mb-3 overflow-hidden rounded-lg border border-[#2563EB]/20 bg-[#2563EB]/5">
							<div className="flex items-center justify-between gap-3 px-3 py-2">
								<div className="min-w-0">
									<div className="flex items-center gap-1.5">
										<span className="text-[11px] font-semibold text-foreground">
											{tSettings(
												"export.nvidiaCuda.compositorTitle",
												"NVIDIA CUDA compositor",
											)}
										</span>
										{nvidiaCudaCompositorRequired ? (
											<span className="rounded bg-[#2563EB]/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-[#2563EB]">
												{tSettings(
													"export.nvidiaCuda.requiredBadge",
													"Required",
												)}
											</span>
										) : experimentalNvidiaCudaExport ? (
											<span className="rounded bg-[#2563EB]/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-[#2563EB]">
												{tSettings(
													"export.nvidiaCuda.selectedBadge",
													"Selected",
												)}
											</span>
										) : nvidiaCudaExportAvailable ? (
											<span className="rounded bg-[#2563EB]/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-[#2563EB]">
												{tSettings(
													"export.nvidiaCuda.availableBadge",
													"Available",
												)}
											</span>
										) : (
											<span className="rounded bg-foreground/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-muted-foreground">
												{tSettings(
													"export.nvidiaCuda.unavailableBadge",
													"Unavailable",
												)}
											</span>
										)}
									</div>
									<p className="mt-0.5 truncate text-[10px] text-muted-foreground/75">
										{tSettings("export.nvidiaCuda.backendLabel", "Backend")}
										{": "}
										{nvidiaCudaCompositorRequired ||
										experimentalNvidiaCudaExport
											? tSettings(
													"export.nvidiaCuda.backendSelected",
													"NVIDIA CUDA compositor",
												)
											: tSettings("export.backend.auto", "Auto")}
									</p>
									<p className="mt-0.5 text-[10px] text-muted-foreground/75">
										{nvidiaCudaCompositorRequired
											? tSettings(
													"export.nvidiaCuda.hintRequired",
													"H.265 Hardware exports use the NVIDIA CUDA compositor and never fall back to renderer frames.",
												)
											: experimentalNvidiaCudaExport
												? tSettings(
														"export.nvidiaCuda.hintSelected",
														"Exports will use the NVIDIA CUDA compositor on this device.",
													)
												: nvidiaCudaExportAvailable
													? tSettings(
															"export.nvidiaCuda.hint",
															"Compose and encode on the NVIDIA GPU for fast exports.",
														)
													: nvidiaCudaExportSkipReason
														? tSettings(
																"export.nvidiaCuda.unavailableReason",
																`CUDA compositor is unavailable (${nvidiaCudaExportSkipReason}).`,
																{
																	reason: nvidiaCudaExportSkipReason,
																},
															)
														: tSettings(
																"export.nvidiaCuda.unavailableGeneric",
																"CUDA compositor is unavailable on this device.",
															)}
									</p>
									{nvidiaCudaCompositorRequired && !nvidiaCudaExportAvailable ? (
										<p className="mt-1 text-[10px] font-medium text-red-400">
											{tSettings(
												"export.nvidiaCuda.unavailableRequired",
												"H.265 + Hardware exports will fail until the CUDA compositor is available. Install or update NVIDIA drivers, or switch Encoder to Auto.",
											)}
										</p>
									) : null}
								</div>
								{nvidiaCudaCompositorRequired ? (
									<Switch
										checked
										disabled
										aria-label={tSettings(
											"export.nvidiaCuda.requiredToggle",
											"NVIDIA CUDA compositor is required for H.265 Hardware exports",
										)}
										className="shrink-0 scale-75 data-[state=checked]:bg-[#2563EB]"
									/>
								) : nvidiaCudaExportAvailable ? (
									<Switch
										checked={experimentalNvidiaCudaExport}
										onCheckedChange={onExperimentalNvidiaCudaExportChange}
										aria-label={tSettings(
											"export.nvidiaCuda.toggle",
											"Use the NVIDIA CUDA compositor for GPU-accelerated exports",
										)}
										className="shrink-0 scale-75 data-[state=checked]:bg-[#2563EB]"
									/>
								) : null}
							</div>
						</div>
					) : null}
					{showCaptionSidecarOption ? (
						<div className="mb-3 flex min-h-12 items-center justify-between gap-3 rounded-lg border border-foreground/10 bg-foreground/5 px-3 py-2">
							<div className="min-w-0">
								<p className="text-[11px] font-semibold text-foreground">
									{tSettings(
										"export.captionSidecar.title",
										"Export captions file",
									)}
								</p>
								<p className="mt-0.5 truncate text-[10px] text-muted-foreground/75">
									{tSettings(
										"export.captionSidecar.hint",
										"Save .srt and .vtt files next to your exported video.",
									)}
								</p>
							</div>
							<Switch
								checked={includeCaptionSidecar}
								onCheckedChange={onIncludeCaptionSidecarChange}
								aria-label={tSettings(
									"export.captionSidecar.toggle",
									"Export captions sidecar files",
								)}
								className="shrink-0 scale-75 data-[state=checked]:bg-[#2563EB]"
							/>
						</div>
					) : null}
				</LayoutGroup>
			) : (
				<div className="mb-3 space-y-2">
					<div className="flex items-center gap-2">
						<LayoutGroup id="header-gif-frame-rate-toggle">
							<div className="grid h-8 flex-1 grid-cols-4 rounded-xl border border-foreground/5 bg-foreground/5 p-0.5">
								{GIF_FRAME_RATES.map((rate) => {
									const isActive = gifFrameRate === rate.value;
									return (
										<button
											key={rate.value}
											type="button"
											onClick={() => onGifFrameRateChange?.(rate.value)}
											aria-pressed={isActive}
											className="relative rounded-lg text-[11px] font-medium transition-colors"
										>
											{isActive ? (
												<motion.span
													layoutId="header-gif-frame-rate-pill"
													className="absolute inset-0 rounded-lg bg-neutral-800 dark:bg-white"
													transition={{
														type: "spring",
														stiffness: 420,
														damping: 34,
													}}
												/>
											) : null}
											<span
												className={cn(
													"relative z-10",
													isActive
														? "text-white dark:text-black"
														: "text-muted-foreground hover:text-foreground",
												)}
											>
												{rate.value}
											</span>
										</button>
									);
								})}
							</div>
						</LayoutGroup>
						<LayoutGroup id="header-gif-size-toggle">
							<div className="grid h-8 flex-1 grid-cols-3 rounded-xl border border-foreground/5 bg-foreground/5 p-0.5">
								{Object.entries(GIF_SIZE_PRESETS).map(([key]) => {
									const isActive = gifSizePreset === key;
									return (
										<button
											key={key}
											type="button"
											onClick={() =>
												onGifSizePresetChange?.(key as GifSizePreset)
											}
											aria-pressed={isActive}
											className="relative rounded-lg text-[11px] font-medium transition-colors"
										>
											{isActive ? (
												<motion.span
													layoutId="header-gif-size-pill"
													className="absolute inset-0 rounded-lg bg-neutral-800 dark:bg-white"
													transition={{
														type: "spring",
														stiffness: 420,
														damping: 34,
													}}
												/>
											) : null}
											<span
												className={cn(
													"relative z-10",
													isActive
														? "text-white dark:text-black"
														: "text-muted-foreground hover:text-foreground",
												)}
											>
												{key === "original"
													? tSettings(
															"export.sizePresetOriginalShort",
															"Orig",
														)
													: key === "medium"
														? tSettings(
																"export.sizePresetMediumShort",
																"Med",
															)
														: tSettings(
																"export.sizePresetLargeShort",
																"Lar",
															)}
											</span>
										</button>
									);
								})}
							</div>
						</LayoutGroup>
					</div>
					<div className="flex items-center justify-between px-1">
						<span className="text-[10px] text-muted-foreground/70">
							{gifOutputDimensions.width} × {gifOutputDimensions.height}px
						</span>
						<div className="flex items-center gap-2">
							<span className="text-[10px] text-muted-foreground">
								{tSettings("export.loop")}
							</span>
							<Switch
								checked={gifLoop}
								onCheckedChange={onGifLoopChange}
								className="scale-75 data-[state=checked]:bg-[#2563EB]"
							/>
						</div>
					</div>
				</div>
			)}

			<Button
				type="button"
				size="lg"
				onClick={onExport}
				className="h-11 w-full gap-2 rounded-lg bg-[#2563EB] text-sm font-semibold text-white transition-colors duration-200 hover:bg-[#2563EB]/90"
			>
				<Download className="h-4 w-4" />
				{tSettings("export.exportVideo", undefined, {
					format: exportFormat === "gif" ? "GIF" : "Video",
				})}
			</Button>
		</div>
	);
}
