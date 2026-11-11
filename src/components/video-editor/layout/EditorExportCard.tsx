import { ExportErrorReportButton } from "@/components/feedback/ExportErrorReportButton";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import type { useI18n } from "@/contexts/I18nContext";
import { copyTextToClipboard } from "@/lib/clipboard";
import type { ExportFormat } from "@/lib/exporter";
import { ExportProgressIndicator } from "../export/ExportProgressIndicator";
import { getExportFileName } from "../export/exportFileName";
import type { useExportSession } from "../export/useExportSession";
import type { useExportStatusViewModel } from "../export/useExportStatusViewModel";
import { GifOptimizationResult } from "../GifOptimizationResult";
import { ExportActivityCard } from "./ExportActivityCard";

type Props = {
	t: ReturnType<typeof useI18n>["t"];
	session: ReturnType<typeof useExportSession>;
	status: ReturnType<typeof useExportStatusViewModel>;
	format: ExportFormat;
	projectTitle: string;
	thumbnail?: string;
	onCancel: () => void;
	onDismiss: () => void;
	onRetrySave: () => void;
	onRevealFile: () => void;
};

export function EditorExportCard({
	t,
	session,
	status,
	format,
	projectTitle,
	thumbnail,
	onCancel,
	onDismiss,
	onRetrySave,
	onRevealFile,
}: Props) {
	const { isExporting, exportError, exportedFilePath, hasPendingExportSave, gifOptimization } =
		session;
	const { exportDisplayProgress, exportPhaseLabel, exportHeadlines } = status;
	const label = t("editor.exportStatus.exporting", "Exporting");
	const closeLabel = isExporting
		? t("common.actions.cancel", "Cancel")
		: t("common.actions.close", "Close");
	const fileName =
		exportedFilePath?.split(/[\\/]/).pop() ||
		session.suggestedFileName ||
		getExportFileName(projectTitle, format);
	const titleSuffix = fileName.match(/(?: \d+)?\.(?:mp4|gif)$/i)?.[0];

	return (
		<ExportActivityCard
			label={t("settings.export.title", "Export")}
			title={fileName}
			titleSuffix={titleSuffix}
			format={format}
			thumbnail={thumbnail}
			closeLabel={closeLabel}
			onClose={isExporting ? onCancel : onDismiss}
			autoDismiss={!isExporting && !exportError && Boolean(exportedFilePath)}
		>
			{isExporting ? (
				<ExportProgressIndicator
					label={label}
					phase={exportPhaseLabel}
					headlines={exportHeadlines}
					value={exportDisplayProgress}
				/>
			) : exportError ? (
				<>
					<p role="status" className="text-xs font-medium text-danger">
						{t("editor.exportStatus.issue", "Export issue")}
					</p>
					<div className="flex flex-wrap items-center gap-2">
						{hasPendingExportSave && (
							<Button type="button" size="sm" onClick={onRetrySave}>
								{t("editor.actions.saveAgain", "Save Again")}
							</Button>
						)}
						<Button
							type="button"
							variant="outline"
							size="sm"
							onClick={async () => {
								try {
									await copyTextToClipboard(exportError);
									toast.success(
										t("editor.exportStatus.errorCopied", "Error copied"),
									);
								} catch {
									toast.error(
										t(
											"editor.exportStatus.errorCopyFailed",
											"Couldn't copy. Select the error text and copy it manually.",
										),
									);
								}
							}}
						>
							{t("editor.exportStatus.copyError", "Copy error")}
						</Button>
						<ExportErrorReportButton
							key={exportError}
							error={exportError}
							format={format}
						/>
					</div>
					<p
						className="max-h-32 select-text overflow-y-auto whitespace-pre-wrap break-words text-xs text-muted-foreground"
						role="region"
						aria-label={t("ui.technicalDetails", "Technical details")}
						tabIndex={0}
						data-export-error-details
					>
						{exportError}
					</p>
				</>
			) : (
				<>
					<p role="status" className="text-xs text-muted-foreground">
						{t("editor.exportStatus.complete", "Export complete")}
					</p>
					{gifOptimization && <GifOptimizationResult summary={gifOptimization} />}
					<Button
						type="button"
						variant="link"
						size="sm"
						className="self-start p-0"
						onClick={onRevealFile}
					>
						{t("editor.actions.showInFolder", "Show In Folder")}
					</Button>
				</>
			)}
		</ExportActivityCard>
	);
}
