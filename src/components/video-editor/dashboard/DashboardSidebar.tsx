import { useState } from "react";
import { FeedbackDialog } from "@/components/feedback/FeedbackDialog";
import { Button } from "@/components/ui/button";
import { ChatWarning, Cloud, GearSix, House, Plus } from "@/components/ui/icons";
import { useI18n as useUiLocale } from "@/contexts/I18nContext";
import { FolderRow } from "./FolderRow";
import { RecordNewButton } from "./RecordNewButton";
import { SidebarCards } from "./SidebarCards";

import type { DashboardProps } from "./types";

import type { DashboardModel } from "./useDashboardModel";
import { FOLDER_COLORS } from "./useProjectFolders";

export function DashboardSidebar({
	busy,
	run,
	folders,
	save,
	addToFolder,
	section,
	setSection,
	openSettings,
	metadata,
	update,
	navClass,
	onSignIn,
}: Pick<
	DashboardProps & DashboardModel,
	| "busy"
	| "run"
	| "folders"
	| "save"
	| "addToFolder"
	| "section"
	| "setSection"
	| "openSettings"
	| "metadata"
	| "update"
	| "navClass"
	| "onSignIn"
	| "authToken"
>) {
	const { t: uiText } = useUiLocale();
	const [feedbackOpen, setFeedbackOpen] = useState(false);
	return (
		<>
			<aside
				aria-label={uiText("ui.libraryNavigation")}
				className="flex min-h-0 w-48 shrink-0 flex-col bg-transparent px-4 pb-5 pt-3 lg:w-56"
			>
				<RecordNewButton busy={busy} run={run} className="mb-5 w-full" />
				<nav className="space-y-1">
					<Button
						variant="ghost"
						className={navClass(section === "projects")}
						aria-current={section === "projects" ? "page" : undefined}
						onClick={() => setSection("projects")}
					>
						<House weight="fill" className="size-[18px]" />
						{uiText("ui.home")}
					</Button>
					<Button
						variant="ghost"
						className={navClass(section === "shared")}
						aria-current={section === "shared" ? "page" : undefined}
						onClick={() => setSection("shared")}
					>
						<Cloud
							weight={section === "shared" ? "fill" : "regular"}
							className="size-[18px]"
						/>
						{uiText("ui.sharedLinks")}
					</Button>
				</nav>
				<div className="mb-2 mt-9 flex items-center justify-between pl-3">
					<h2 className="text-[13px] font-semibold tracking-tight text-foreground/80">
						{uiText("ui.folders")}
					</h2>
					<Button
						variant="ghost"
						size="icon"
						className="size-7 min-w-7"
						aria-label={uiText("ui.newFolder")}
						onClick={() => {
							let name = uiText("ui.untitledFolder"),
								index = 1;
							while (folders.some((folder) => folder.name === name))
								name = uiText("ui.untitledFolderNumber", undefined, {
									number: index++,
								});
							save([
								...folders,
								{
									id: crypto.randomUUID(),
									name,
									color: FOLDER_COLORS[0],
									paths: [],
								},
							]);
						}}
					>
						<Plus className="size-3.5" />
					</Button>
				</div>
				<div className="min-h-0 flex-1 overflow-y-auto space-y-1">
					{folders.map((folder) => (
						<FolderRow
							key={folder.id}
							folder={folder}
							active={section === folder.id}
							onDropProject={(path) => addToFolder(path, folder.id)}
							onSelect={() => setSection(folder.id)}
							onChange={(next) =>
								save(folders.map((item) => (item.id === next.id ? next : item)))
							}
							onRemove={() => {
								save(folders.filter((item) => item.id !== folder.id));
								if (section === folder.id) setSection("projects");
							}}
							colors={metadata.colors}
							onColors={(colors) => update({ ...metadata, colors })}
						/>
					))}
				</div>
				<div className="flex min-h-0 flex-col gap-1 pt-6">
					<div className="min-h-0 overflow-y-auto">
						<SidebarCards onSignIn={onSignIn} />
					</div>
					<Button
						variant="ghost"
						className={navClass(false)}
						onClick={() => setFeedbackOpen(true)}
					>
						<ChatWarning weight="fill" className="size-[18px]" aria-hidden="true" />
						{uiText("common.feedback.trigger", "Feedback")}
					</Button>
					<Button
						variant="ghost"
						className={navClass(section === "settings")}
						aria-current={section === "settings" ? "page" : undefined}
						onClick={() => openSettings()}
					>
						<GearSix weight="fill" className="size-[18px]" aria-hidden="true" />
						{uiText("ui.settings")}
					</Button>
				</div>
			</aside>
			<FeedbackDialog
				hideTrigger
				open={feedbackOpen}
				onOpenChange={setFeedbackOpen}
				onSignIn={onSignIn}
			/>
		</>
	);
}
