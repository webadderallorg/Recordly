import { Description, Modal } from "@heroui/react";
import { ErrorReportButton } from "@/components/feedback/ErrorReportButton";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/contexts/I18nContext";
import { errorSourceName, projectLoadError } from "../project/projectLoadError";

export function ProjectLoadError({
	error,
	source,
	recordingSource,
	onRetry,
	onLocate,
	retrying,
	onDismiss,
}: {
	error: string;
	source?: string;
	recordingSource?: string;
	onRetry?: () => void;
	onLocate?: () => void;
	retrying: boolean;
	onDismiss: () => void;
}) {
	const { t } = useI18n();
	const message = projectLoadError(error);
	return (
		<Modal
			isOpen
			onOpenChange={(open) => {
				if (!open) onDismiss();
			}}
		>
			<Modal.Backdrop variant="transparent" className="bg-black/10" isDismissable>
				<Modal.Container size="sm" placement="center" scroll="inside">
					<Modal.Dialog className="w-full max-w-md gap-4 p-5">
						<Modal.CloseTrigger aria-label={t("common.actions.close", "Close")} />
						<Modal.Header className="gap-2 pr-7">
							<Modal.Heading className="text-base font-semibold">
								{message.title}
							</Modal.Heading>
							{source && (
								<p className="select-text break-words text-sm font-medium">
									{errorSourceName(source)}
								</p>
							)}
							{recordingSource && recordingSource !== source && (
								<p className="select-text break-words text-xs text-muted-foreground">
									{t("ui.recordingSource", "Recording: {{name}}", {
										name: errorSourceName(recordingSource),
									})}
								</p>
							)}
							<Description className="text-sm leading-relaxed text-muted-foreground">
								{message.description}
							</Description>
						</Modal.Header>
						<details className="text-xs text-muted-foreground">
							<summary className="cursor-pointer">{t("ui.technicalDetails")}</summary>
							<p className="mt-2 max-h-32 select-text overflow-y-auto break-words whitespace-pre-wrap">
								{message.details}
							</p>
						</details>
						<Modal.Footer className="flex flex-wrap items-center justify-between gap-2">
							<ErrorReportButton error={error} context="project-load" compact />
							{onLocate && (
								<Button
									onClick={onLocate}
									disabled={retrying}
									className="h-8 text-sm"
								>
									{t("notifications.locateRecording", "Locate recording")}
								</Button>
							)}
							{onRetry && (
								<Button
									onClick={onRetry}
									disabled={retrying}
									className="h-8 text-sm"
								>
									{retrying ? t("ui.retrying") : t("ui.tryAgain")}
								</Button>
							)}
						</Modal.Footer>
					</Modal.Dialog>
				</Modal.Container>
			</Modal.Backdrop>
		</Modal>
	);
}
