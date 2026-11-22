import type { ReactNode } from "react";
import { useScopedT } from "@/contexts/I18nContext";
import { formatGifBytes } from "@/lib/exporter/gifSizeFormat";

export function ExportFileSizeEstimate({
	bytes,
	originalBytes,
	pending = false,
	control,
}: {
	control?: ReactNode;
	bytes?: number | null;
	originalBytes?: number | null;
	pending?: boolean;
}) {
	const t = useScopedT("settings");
	return (
		<div
			role="status"
			aria-label={t("export.estimatedFileSize", "Estimated file size")}
			className="flex items-center justify-between gap-3 py-1 text-xs"
		>
			{control ?? (
				<span className="text-muted-foreground">
					{t("export.estimatedFileSize", "Estimated file size")}
				</span>
			)}
			<span className="flex shrink-0 items-center gap-2 whitespace-nowrap font-medium tabular-nums">
				{typeof bytes === "number" &&
					Number.isFinite(bytes) &&
					typeof originalBytes === "number" &&
					Number.isFinite(originalBytes) && (
						<s className="font-normal text-muted-foreground">
							≈ {formatGifBytes(originalBytes)}
						</s>
					)}
				{typeof bytes === "number" && Number.isFinite(bytes)
					? `≈ ${formatGifBytes(bytes)}`
					: pending
						? t("export.estimating", "Calculating…")
						: t("export.estimateUnavailable", "Unavailable")}
			</span>
		</div>
	);
}
