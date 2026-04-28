import { DownloadSimple as Download, FilmSlate as Film, Image } from "@phosphor-icons/react";
import { LayoutGroup, motion } from "motion/react";
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
import { cn } from "@/lib/utils";

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
	onExportPipelineModelChange?: (pipelineModel: ExportPipelineModel) => void;
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
	mp4FrameRate,
	onMp4FrameRateChange,
	exportPipelineModel = "modern",
	onExportPipelineModelChange,
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
												isActive ? "text-white/75 dark:text-black/75" : "text-muted-foreground/70",
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
