import { useI18n as useUiLocale } from "@/contexts/I18nContext";
import { Card, Modal } from "@heroui/react";
import { RecordlyAccountMenu } from "@/components/auth/RecordlyAccountMenu";
import { UpgradeButton } from "@/components/billing/UpgradeButton";
import { Button } from "@/components/ui/button";
import { House } from "@/components/ui/icons";
import { AppFrameHeader } from "../layout/AppFrameHeader";
import { AppUpdateButton } from "../layout/AppUpdateButton";
import { DashboardAnnouncements } from "./DashboardAnnouncements";
import { DashboardLibraryActions } from "./DashboardLibraryActions";
import { DashboardFilters } from "./DashboardFilters";
import { DashboardGrid } from "./DashboardGrid";
import { DashboardSidebar } from "./DashboardSidebar";
import { DashboardToolbar } from "./DashboardToolbar";
import type { DashboardProps } from "./types";
import { useDashboardModel } from "./useDashboardModel";
export function Dashboard(props: DashboardProps) {
	const { t: uiText } = useUiLocale();
	const model = useDashboardModel(props);
	const view = { ...props, ...model };
	return (
		<>
			<Modal isOpen={props.open} onOpenChange={props.onOpenChange}>
				<Modal.Backdrop variant="transparent" className="app-frame-overlay dashboard-page-overlay">
					<Modal.Container size="full" className="app-frame-container dashboard-page-container">
						<Modal.Dialog
							aria-label={uiText("ui.projectsDashboard")}
							className="dashboard-surface dashboard-shell flex h-full flex-col gap-0 rounded-none bg-background p-0 text-foreground"
						>
							<AppFrameHeader className="loading-content-enter">
								<div
									className={`flex min-w-0 items-center gap-2 ${props.headerLeftControlsPaddingClass ?? ""}`}
								>
									<Button
										variant="ghost"
										size="sm"
										className="h-9 gap-2 px-3"
										onClick={() => model.setSection("projects")}
										aria-label={uiText("ui.libraryHome")}
									>
										<House weight="fill" className="size-4" />
										{uiText("ui.home")}
									</Button>
									<span
										aria-hidden="true"
										className="mx-2 text-xl font-light text-muted-foreground/60"
									>
										/
									</span>
									<span className="truncate text-sm font-semibold">
										{model.section === "settings"
											? uiText("ui.settings")
											: model.section === "shared"
												? uiText("ui.sharedLinks")
												: uiText("ui.library")}
									</span>
								</div>
								<div className="flex items-center gap-3">
									<UpgradeButton
										label={uiText("billing.getCloud", "Get Recordly Cloud")}
										variant="secondary"
										size="sm"
										className="h-9 gap-1.5"
									/>
									{props.editorTitle && (
										<Button
											variant="ghost"
											size="sm"
											className="h-9 min-w-0 max-w-48 gap-1 text-muted-foreground"
											title={uiText("ui.resumeProject", undefined, {
												name: props.editorTitle,
											})}
											aria-label={uiText("ui.resumeProject", undefined, {
												name: props.editorTitle,
											})}
											onClick={() => props.onOpenChange(false)}
										>
											<span className="shrink-0">{uiText("ui.resume")}</span>
											<span className="min-w-0 truncate">
												{props.editorTitle}
											</span>
										</Button>
									)}
									<RecordlyAccountMenu
										compact
										placement="header"
										triggerLabel={uiText("ui.recordlyAccount")}
										className="size-9 rounded-full"
										onSignIn={props.onSignIn}
										onSettings={model.openSettings}
									/>
									<AppUpdateButton />
								</div>
							</AppFrameHeader>
							<div className="loading-content-enter flex min-h-0 flex-1">
								<DashboardSidebar {...view} />
								<Card className="app-frame-surface my-3 mr-3 flex min-h-0 min-w-0 flex-1 flex-col gap-0 overflow-hidden rounded-3xl bg-surface p-0 shadow-sm">
									{model.section !== "settings" && model.section !== "shared" && (
										<>
											<DashboardAnnouncements
												config={props.announcementConfig}
											/>
											<DashboardToolbar
												{...view}
												title={model.activeFolder?.name}
												count={model.visible.length}
											/>
											<DashboardFilters {...view} onCleanup={() => model.setCleanupOpen(true)} />
										</>
									)}
									<DashboardGrid {...view} />
								</Card>
							</div>
						</Modal.Dialog>
					</Modal.Container>
				</Modal.Backdrop>
			</Modal>
			{props.open && <DashboardLibraryActions model={model} projects={props.entries} />}
		</>
	);
}
