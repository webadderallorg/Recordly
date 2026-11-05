import { Modal } from "@heroui/react";
import { useI18n } from "@/contexts/I18nContext";
import type { SettingsSection } from "../SettingsSections";
import { DashboardSettings } from "../dashboard/DashboardSettings";

/** Reuse the Home settings content without leaving or remounting the editor. */
export function AppSettingsDialog({
	open,
	onOpenChange,
	onImportFile,
	initialCategory = "general",
}: {
	open: boolean;
	initialCategory?: SettingsSection;
	onOpenChange: (open: boolean) => void;
	onImportFile: () => Promise<void>;
}) {
	const { t } = useI18n();
	return (
		<Modal isOpen={open} onOpenChange={onOpenChange}>
			<Modal.Backdrop variant="blur" isDismissable>
				<Modal.Container placement="center" scroll="inside" size="lg">
					<Modal.Dialog
						aria-label={t("settings.sections.settings", "Settings")}
						className="app-settings-dialog"
					>
						<Modal.CloseTrigger aria-label={t("common.actions.close", "Close")} />
						<Modal.Body className="app-settings-body">
							<DashboardSettings
								key={initialCategory}
								initialCategory={initialCategory}
								onImportFile={onImportFile}
							/>
						</Modal.Body>
					</Modal.Dialog>
				</Modal.Container>
			</Modal.Backdrop>
		</Modal>
	);
}
