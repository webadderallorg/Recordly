import { CheckCircle, WarningCircle } from "@phosphor-icons/react";
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
	const { isExporting, exportError, exportedFilePath, hasPendingExportSave } = session;
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
					<p role="status" className="editor-export-card-status" data-tone="danger">
						<WarningCircle size={14} weight="fill" aria-hidden />
						{t("editor.exportStatus.issue", "Export issue")}
					</p>
					<p
						className="editor-export-card-details"
						role="region"
						aria-label={t("ui.technicalDetails", "Technical details")}
						tabIndex={0}
						data-export-error-details
					>
						{exportError}
					</p>
					<div className="editor-export-card-actions">
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
				</>
			) : (
				<>
					<p role="status" className="editor-export-card-status" data-tone="success">
						<CheckCircle size={14} weight="fill" aria-hidden />
						{t("editor.exportStatus.complete", "Export complete")}
					</p>
					<div className="editor-export-card-actions">
						<Button type="button" variant="outline" size="sm" onClick={onRevealFile}>
							{t("editor.actions.showInFolder", "Show In Folder")}
						</Button>
					</div>
				</>
			)}
		</ExportActivityCard>
	);
}
