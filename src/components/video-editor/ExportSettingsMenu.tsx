import { Download, Film, Image } from "lucide-react";
import { LayoutGroup, motion } from "motion/react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useScopedT } from "@/contexts/I18nContext";
import type {
	ExportFormat,
	ExportQuality,
	GifFrameRate,
	GifSizePreset,
} from "@/lib/exporter";
import { GIF_FRAME_RATES, GIF_SIZE_PRESETS } from "@/lib/exporter";
import { cn } from "@/lib/utils";

interface ExportSettingsMenuProps {
	exportFormat: ExportFormat;
	onExportFormatChange?: (format: ExportFormat) => void;
	exportQuality: ExportQuality;
	onExportQualityChange?: (quality: ExportQuality) => void;
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

	return (
		<div className={cn("w-full rounded-2xl border border-white/10 bg-[#17171a] p-3 text-slate-200", className)}>
			<div className="mb-2 flex items-center justify-between">
				<span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
					{tSettings("export.title", "Export")}
				</span>
			</div>

			<div className="mb-3 flex items-center gap-2">
				<LayoutGroup id="header-export-format-toggle">
					{([
						{ value: "mp4", label: tSettings("export.mp4"), icon: Film },
						{ value: "gif", label: tSettings("export.gif"), icon: Image },
					] as const).map((option) => {
						const Icon = option.icon;
						const isActive = exportFormat === option.value;
						return (
							<button
								key={option.value}
								type="button"
								onClick={() => onExportFormatChange?.(option.value)}
								className={cn(
									"relative flex-1 overflow-hidden rounded-xl border py-2 text-xs font-medium transition-colors",
									isActive
										? "border-[#2563EB]/50 text-white"
										: "border-white/10 bg-white/5 text-slate-400 hover:bg-white/10 hover:text-slate-200",
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
					<div className="mb-3 grid h-8 w-full grid-cols-4 rounded-xl border border-white/5 bg-white/5 p-0.5">
						{([
							{ value: "medium", label: tSettings("export.quality.low") },
							{ value: "good", label: tSettings("export.quality.medium") },
							{ value: "high", label: tSettings("export.quality.high") },
							{ value: "source", label: tSettings("export.quality.original") },
						] as const).map((option) => {
							const isActive = exportQuality === option.value;
							return (
								<button
									key={option.value}
									type="button"
									onClick={() => onExportQualityChange?.(option.value)}
									className="relative rounded-lg text-[11px] font-medium transition-colors"
								>
									{isActive ? (
										<motion.span
											layoutId="header-export-quality-pill"
											className="absolute inset-0 rounded-lg bg-white"
											transition={{ type: "spring", stiffness: 420, damping: 34 }}
										/>
									) : null}
									<span className={cn("relative z-10", isActive ? "text-black" : "text-slate-400 hover:text-slate-200")}>
										{option.label}
									</span>
								</button>
							);
						})}
					</div>
				</LayoutGroup>
			) : (
				<div className="mb-3 space-y-2">
					<div className="flex items-center gap-2">
						<LayoutGroup id="header-gif-frame-rate-toggle">
							<div className="grid h-8 flex-1 grid-cols-4 rounded-xl border border-white/5 bg-white/5 p-0.5">
								{GIF_FRAME_RATES.map((rate) => {
									const isActive = gifFrameRate === rate.value;
									return (
										<button
											key={rate.value}
											type="button"
											onClick={() => onGifFrameRateChange?.(rate.value)}
											className="relative rounded-lg text-[11px] font-medium transition-colors"
										>
											{isActive ? (
												<motion.span layoutId="header-gif-frame-rate-pill" className="absolute inset-0 rounded-lg bg-white" transition={{ type: "spring", stiffness: 420, damping: 34 }} />
											) : null}
											<span className={cn("relative z-10", isActive ? "text-black" : "text-slate-400 hover:text-slate-200")}>
												{rate.value}
											</span>
										</button>
									);
								})}
							</div>
						</LayoutGroup>
						<LayoutGroup id="header-gif-size-toggle">
							<div className="grid h-8 flex-1 grid-cols-3 rounded-xl border border-white/5 bg-white/5 p-0.5">
								{Object.entries(GIF_SIZE_PRESETS).map(([key]) => {
									const isActive = gifSizePreset === key;
									return (
										<button
											key={key}
											type="button"
											onClick={() => onGifSizePresetChange?.(key as GifSizePreset)}
											className="relative rounded-lg text-[11px] font-medium transition-colors"
										>
											{isActive ? (
												<motion.span layoutId="header-gif-size-pill" className="absolute inset-0 rounded-lg bg-white" transition={{ type: "spring", stiffness: 420, damping: 34 }} />
											) : null}
											<span className={cn("relative z-10", isActive ? "text-black" : "text-slate-400 hover:text-slate-200")}>
												{key === "original"
													? tSettings("export.sizePresetOriginalShort", "Orig")
													: key === "medium"
														? tSettings("export.sizePresetMediumShort", "Med")
														: tSettings("export.sizePresetLargeShort", "Lar")}
											</span>
										</button>
									);
								})}
							</div>
						</LayoutGroup>
					</div>
					<div className="flex items-center justify-between px-1">
						<span className="text-[10px] text-slate-500">
							{gifOutputDimensions.width} × {gifOutputDimensions.height}px
						</span>
						<div className="flex items-center gap-2">
							<span className="text-[10px] text-slate-400">{tSettings("export.loop")}</span>
							<Switch checked={gifLoop} onCheckedChange={onGifLoopChange} className="scale-75 data-[state=checked]:bg-[#2563EB]" />
						</div>
					</div>
				</div>
			)}

			<Button type="button" size="lg" onClick={onExport} className="h-11 w-full gap-2 rounded-lg bg-[#2563EB] text-sm font-semibold text-white transition-colors duration-200 hover:bg-[#2563EB]/90">
				<Download className="h-4 w-4" />
				{tSettings("export.exportVideo", undefined, {
					format: exportFormat === "gif" ? "GIF" : "Video",
				})}
			</Button>
		</div>
	);
}