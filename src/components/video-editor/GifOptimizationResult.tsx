import { formatGifBytes } from "@/lib/exporter/gifSizeFormat";
import type { GifOptimizationSummary } from "@/lib/exporter/gifOptimization";
import { useScopedT } from "@/contexts/I18nContext";

export function GifOptimizationResult({ summary }: { summary: GifOptimizationSummary }) {
	const t = useScopedT("settings");
	const resized = Boolean(
		summary.originalWidth &&
			summary.originalHeight &&
			summary.outputWidth &&
			summary.outputHeight &&
			(summary.originalWidth !== summary.outputWidth ||
				summary.originalHeight !== summary.outputHeight),
	);
	return (
		<div role="status" className="mt-3 space-y-1 rounded-lg bg-foreground/5 p-3 text-xs">
			<p className="font-medium">{t("export.optimizeSize", "Optimize size")}</p>
			<p className="tabular-nums">
				{formatGifBytes(summary.originalBytes)} → {formatGifBytes(summary.optimizedBytes)}
			</p>
			{resized && (
				<p className="tabular-nums text-muted-foreground">
					{summary.originalWidth} × {summary.originalHeight} → {summary.outputWidth} ×{" "}
					{summary.outputHeight}
				</p>
			)}
			<p className="text-muted-foreground">
				{summary.status === "failed"
					? t("export.optimizeSizeFailed", "Optimization unavailable. Original GIF kept.")
					: summary.savedBytes > 0
						? t("export.optimizeSizeSaved", "Saved {{size}} ({{percent}}% smaller)", {
								size: formatGifBytes(summary.savedBytes),
								percent: summary.reductionPercent.toFixed(1),
							})
						: t(
								"export.optimizeSizeUnchanged",
								"0% smaller — original GIF was already compact.",
							)}
			</p>
			{summary.status !== "failed" && summary.targetReached === false && (
				<p className="text-muted-foreground">
					{t("export.optimizeTargetMissed", "Target not reached")}
				</p>
			)}
		</div>
	);
}
