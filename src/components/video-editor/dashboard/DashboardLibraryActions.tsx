import { Modal } from "@heroui/react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/contexts/I18nContext";
import type { DashboardModel } from "./useDashboardModel";
import type { ProjectLibraryEntry } from "../ProjectBrowserDialog";
import { LibraryCleanupDialog } from "./LibraryCleanupDialog";

export function DashboardLibraryActions({
	model,
	projects,
}: {
	model: DashboardModel;
	projects: ProjectLibraryEntry[];
}) {
	const { t, locale } = useI18n();
	const { pendingDelete, isRaw, busy } = model;
	return (
		<>
			{model.cleanupOpen && (
				<LibraryCleanupDialog
					entries={model.libraryEntries}
					projects={projects}
					scope={model.visible}
					isRaw={isRaw}
					onClose={() => model.setCleanupOpen(false)}
					onSelect={(paths) => {
						model.setSelected(paths);
						model.setSelecting(true);
						model.setCleanupOpen(false);
						void model.deleteEntries(paths);
					}}
				/>
			)}
			<Modal
				isOpen={pendingDelete.length > 0}
				onOpenChange={(open) => {
					if (!open && !busy) model.setPendingDelete([]);
				}}
			>
				<Modal.Backdrop variant="blur" isDismissable={!busy}>
					<Modal.Container size="md">
						<Modal.Dialog aria-label={t("ui.cleanup.reviewTitle", "Review deletion")}>
							{!busy && <Modal.CloseTrigger />}
							<Modal.Header>
								<Modal.Heading>
									{t("ui.cleanup.reviewTitle", "Review deletion")}
								</Modal.Heading>
							</Modal.Header>
							<Modal.Body className="space-y-3">
								<p className="text-sm">
									{t(
										"ui.cleanup.deleteCount",
										"Move {{count}} selected items to Trash?",
										{
											count: new Intl.NumberFormat(locale).format(
												pendingDelete.length,
											),
										},
									)}
								</p>
								<p className="text-sm text-muted-foreground">
									{isRaw
										? t("ui.confirmDeleteSourceFiles")
										: t(
												"ui.cleanup.deleteMediaHelp",
												"Selected projects and unused managed source recordings move to Trash. Associated cloud videos are deleted permanently unless another saved project uses the same link.",
											)}
								</p>
								{!isRaw && (
									<>
										<p className="text-sm text-muted-foreground">
											{t("ui.cleanup.sharedMediaHelp")}
										</p>
										<p className="text-sm text-muted-foreground">
											{model.checkingDeletion
												? t("ui.cleanup.checkingDeletion")
												: t("ui.cleanup.reviewSources", undefined, {
														count: model.deletionReview.sourceCount,
														kept: model.deletionReview
															.preservedSourceCount,
													})}
										</p>
									</>
								)}
								<ul
									className="custom-scrollbar max-h-52 space-y-2 overflow-y-auto rounded-xl bg-default/40 p-3 text-sm"
									aria-label={t("ui.cleanup.deleteList", "Items to delete")}
								>
									{pendingDelete.map((entry) => (
										<li className="break-all" key={entry.path}>
											{entry.name}
										</li>
									))}
								</ul>
							</Modal.Body>
							<Modal.Footer>
								<Button
									variant="ghost"
									disabled={busy}
									onClick={() => model.setPendingDelete([])}
								>
									{t("ui.cancel")}
								</Button>
								<Button
									variant="destructive"
									disabled={busy || !pendingDelete.length}
									onClick={() => void model.confirmDelete()}
								>
									{busy
										? t("ui.cleanup.deleting", "Moving to Trash…")
										: t("ui.cleanup.trash", "Move to Trash")}
								</Button>
							</Modal.Footer>
						</Modal.Dialog>
					</Modal.Container>
				</Modal.Backdrop>
			</Modal>
		</>
	);
}
