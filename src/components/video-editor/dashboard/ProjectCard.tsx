import { useI18n as useUiLocale } from "@/contexts/I18nContext";
import { Dropdown } from "@heroui/react";
import { Globe } from "@phosphor-icons/react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Check, DotsThree, FolderSimple, Plus } from "@/components/ui/icons";
import { CloudShareButton } from "../cloud/CloudShareButton";
import {
	getProjectShare,
	isProjectShareStale,
	moveProjectShareLink,
} from "../cloud/projectShareLinks";
import type { ProjectLibraryEntry } from "../ProjectBrowserDialog";
import { ProjectFolderChips } from "./ProjectFolderChips";
import { ProjectThumbnail } from "./ProjectThumbnail";
import { ProjectPreviewGlass } from "./ProjectPreviewGlass";
import { RawThumbnail } from "./RawRecordings";
import type { DashboardProps } from "./types";
import type { DashboardModel } from "./useDashboardModel";

type Props = Pick<
	DashboardProps & DashboardModel,
	| "accountLabel"
	| "accountId"
	| "busy"
	| "selecting"
	| "selected"
	| "toggleSelected"
	| "openEntry"
	| "run"
	| "onShareProject"
	| "onRenameProject"
	| "folders"
	| "save"
	| "assignFolder"
> & { entry: ProjectLibraryEntry; webUrl?: string; webReady?: boolean; onDelete?: () => void };
export function ProjectCard({
	accountId,
	webUrl,
	webReady = true,
	onDelete,
	entry,
	busy,
	selecting,
	selected,
	toggleSelected,
	openEntry,
	run,
	onShareProject,
	onRenameProject,
	folders,
	save,
	assignFolder,
}: Props) {
	const { locale, t: uiText } = useUiLocale();
	const [hovering, setHovering] = useState(false);
	const [editing, setEditing] = useState(false);
	const renaming = useRef(false);
	const [name, setName] = useState(entry.name);
	const assignedFolders = folders.filter((folder) => folder.paths.includes(entry.path));
	const folder = assignedFolders[0];
	const share = webUrl ? undefined : getProjectShare(entry.path, accountId);
	const shareUrl = share?.url;
	const staleShare = isProjectShareStale(share, undefined, entry.updatedAt);
	const [showShareLink, setShowShareLink] = useState(false);
	const rename = () => {
		if (renaming.current) return;
		renaming.current = true;
		void run(async () => {
			if (!name.trim() || name.trim() === entry.name) {
				setEditing(false);
				return;
			}
			const target = await onRenameProject(entry.path, name.trim());
			save(
				folders.map((folder) => ({
					...folder,
					paths: folder.paths.map((path) => (path === entry.path ? target : path)),
				})),
			);
			moveProjectShareLink(entry.path, target);
			setEditing(false);
		}).finally(() => {
			renaming.current = false;
		});
	};
	return (
		<li className="group min-w-0">
			<Button
				variant="ghost"
				disabled={busy || (Boolean(webUrl) && !webReady)}
				aria-label={entry.name}
				aria-current={!webUrl && !entry.rawSource && entry.isCurrent ? "true" : undefined}
				onPointerEnter={(event) => {
					if (event.pointerType === "mouse") setHovering(true);
				}}
				onPointerLeave={() => setHovering(false)}
				onFocus={() => setHovering(true)}
				onBlur={() => setHovering(false)}
				onClick={() => (selecting ? toggleSelected(entry.path) : openEntry(entry))}
				aria-pressed={selecting ? selected.includes(entry.path) : undefined}
				className={`project-preview-glass relative block h-auto w-full min-w-0 rounded-xl p-0 transition-shadow duration-200 ease-out motion-reduce:transition-none ${hovering ? "ring-2 ring-accent/40 shadow-sm" : ""}`}
			>
				{entry.rawSource ? (
					<RawThumbnail
						entry={entry.rawSource}
						active={hovering && !selecting && !busy}
					/>
				) : (
					<ProjectThumbnail
						key={`${entry.thumbnailPath}-${entry.updatedAt}`}
						revision={entry.updatedAt}
						path={entry.thumbnailPath}
						videoSource={
							webUrl && webReady
								? new URL(`/v/${entry.path}`, webUrl).href
								: undefined
						}
						projectPath={webUrl ? undefined : entry.path}
						previewActive={!webUrl && hovering && !selecting && !busy}
					/>
				)}
				<ProjectPreviewGlass />
				{selecting && (
					<span
						className={`absolute right-2 top-2 z-10 flex size-5 items-center justify-center rounded-md ${selected.includes(entry.path) ? "bg-accent text-white" : "bg-background/90"}`}
					>
						{selected.includes(entry.path) && <Check className="size-3.5" />}
					</span>
				)}
			</Button>
			<div className="relative flex items-start justify-between gap-3 pt-3">
				<div data-project-caption className="min-w-0 flex-1">
					{editing ? (
						<form
							onSubmit={(event) => {
								event.preventDefault();
								rename();
							}}
						>
							<input
								autoFocus
								onFocus={(event) => event.currentTarget.select()}
								aria-label={
									entry.rawSource
										? uiText("ui.rawFileName")
										: uiText("ui.projectName")
								}
								className="inline-project-name h-6 w-full pr-9 text-sm font-medium"
								value={name}
								disabled={busy}
								maxLength={120}
								onChange={(event) => setName(event.target.value)}
								onBlur={rename}
								onKeyDown={(event) => {
									if (event.key === "Escape") {
										event.preventDefault();
										setEditing(false);
									}
								}}
							/>
						</form>
					) : (
						<button
							type="button"
							disabled={busy || (Boolean(webUrl) && !webReady)}
							aria-label={
								selecting
									? uiText("ui.selectNamed", undefined, { name: entry.name })
									: uiText("ui.openNamed", undefined, { name: entry.name })
							}
							aria-pressed={selecting ? selected.includes(entry.path) : undefined}
							onClick={() =>
								selecting ? toggleSelected(entry.path) : openEntry(entry)
							}
							title={entry.name}
							className="block w-full rounded-sm pr-9 text-left text-sm font-medium leading-5 text-foreground disabled:opacity-50"
						>
							<span className="line-clamp-2 break-words">{entry.name}</span>
						</button>
					)}
					<div className="mt-1.5 flex min-h-6 min-w-0 flex-wrap items-center gap-2">
						{!webUrl && !entry.rawSource && entry.isCurrent && (
							<span className="rounded-full bg-accent/10 px-2 py-1 text-xs text-foreground">
								{uiText("ui.currentlyEditing")}
							</span>
						)}
						<p className="shrink-0 text-xs text-muted-foreground">
							{new Date(entry.updatedAt).toLocaleDateString(locale, {
								month: "short",
								day: "numeric",
							})}
						</p>
						{webUrl && (
							<Globe
								aria-label={uiText("ui.webProject")}
								className="size-3.5 text-muted-foreground"
							/>
						)}
						{!webUrl && shareUrl && (
							<button
								type="button"
								aria-label={uiText("ui.viewShareLinkFor", undefined, {
									name: entry.name,
								})}
								onClick={() => setShowShareLink(true)}
								className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs focus-visible:outline-2 focus-visible:outline-accent ${staleShare ? "bg-warning/10 text-foreground" : "bg-default/50 text-foreground"}`}
								title={
									staleShare
										? uiText("ui.theSharedLinkContainsAnOlderVersionPublish")
										: uiText("ui.viewTheSharedVersion")
								}
							>
								<Globe className="size-3.5" />
								{staleShare ? uiText("ui.changesUnpublished") : uiText("ui.shared")}
							</button>
						)}
						{!webUrl && !shareUrl && !entry.rawSource && (
							<span className="rounded-full bg-default/50 px-2 py-1 text-xs text-muted-foreground">
								{uiText("ui.localOnly")}
							</span>
						)}
						{webUrl && !webReady && (
							<span className="text-xs text-muted-foreground">
								{uiText("ui.incompleteUpload")}
							</span>
						)}
						{!webUrl && (
							<>
								<ProjectFolderChips
									folders={assignedFolders}
									name={entry.name}
									onRemove={(id) => assignFolder(entry.path, id)}
								/>
								<Dropdown>
									<Button
										variant="ghost"
										size="sm"
										aria-label={uiText("ui.addFolderTo", undefined, {
											name: entry.name,
										})}
										className="h-6 min-w-0 shrink-0 gap-1.5 rounded-full px-2.5 text-[11px] text-muted-foreground opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus:opacity-100"
									>
										<Plus className="size-3" />
										{uiText("ui.addFolder")}
									</Button>
									<Dropdown.Popover>
										<Dropdown.Menu
											aria-label={uiText("ui.assignProjectFolder")}
										>
											{folders.map((item) => (
												<Dropdown.Item
													key={item.id}
													id={item.id}
													textValue={item.name}
													onAction={() =>
														assignFolder(entry.path, item.id)
													}
												>
													<FolderSimple
														weight="fill"
														style={{ color: item.color }}
													/>
													{item.name}
													{item.paths.includes(entry.path) && (
														<Check className="size-3" />
													)}
												</Dropdown.Item>
											))}
											{folder && (
												<Dropdown.Item
													id="remove"
													onAction={() =>
														assignFolder(entry.path, "none")
													}
												>
													{uiText("ui.removeFromAllFolders")}
												</Dropdown.Item>
											)}
											{!folders.length && (
												<Dropdown.Item id="empty" isDisabled>
													{uiText("ui.createAFolderInTheSidebar")}
												</Dropdown.Item>
											)}
										</Dropdown.Menu>
									</Dropdown.Popover>
								</Dropdown>
							</>
						)}
					</div>
				</div>
				<Dropdown>
					<Button
						variant="ghost"
						size="icon"
						aria-label={uiText("ui.optionsFor", undefined, { name: entry.name })}
						className="absolute right-0 top-3 size-8 min-w-8 text-muted-foreground"
					>
						<DotsThree weight="bold" className="size-5" />
					</Button>
					<Dropdown.Popover>
						<Dropdown.Menu aria-label={uiText("ui.projectOptions")}>
							<Dropdown.Item
								id="open"
								isDisabled={Boolean(webUrl) && !webReady}
								onAction={() => openEntry(entry)}
							>
								{webUrl
									? uiText("ui.openLink")
									: entry.rawSource
										? uiText("ui.previewFile")
										: uiText("ui.openProject")}
							</Dropdown.Item>
							{!webUrl && (
								<>
									<Dropdown.Item
										id="rename"
										onAction={() => {
											setName(entry.name);
											requestAnimationFrame(() =>
												requestAnimationFrame(() => setEditing(true)),
											);
										}}
									>
										{uiText("ui.rename")}
									</Dropdown.Item>
									{!entry.rawSource && (
										<Dropdown.Item
											id="share"
											onAction={() =>
												void run(async () => {
													if (shareUrl && !staleShare)
														setShowShareLink(true);
													else await onShareProject(entry.path);
												})
											}
										>
											{shareUrl
												? staleShare
													? uiText("ui.regenerate")
													: uiText("ui.viewLink")
												: uiText("ui.share")}
										</Dropdown.Item>
									)}
									<Dropdown.Item
										aria-label={
											entry.rawSource
												? uiText("ui.showNamedInFolder", undefined, {
														name: entry.name,
													})
												: undefined
										}
										id="reveal"
										onAction={() =>
											void run(async () => {
												await window.electronAPI.revealInFolder(entry.path);
											})
										}
									>
										{uiText("ui.showInFolder")}
									</Dropdown.Item>
								</>
							)}
							{onDelete && (
								<Dropdown.Item
									id="delete"
									variant="danger"
									className="text-danger"
									isDisabled={busy}
									onAction={onDelete}
								>
									{webUrl
										? uiText("ui.deleteRecording")
										: entry.rawSource
											? uiText("ui.deleteSourceFilesAction")
											: uiText("ui.deleteProject")}
								</Dropdown.Item>
							)}
						</Dropdown.Menu>
					</Dropdown.Popover>
				</Dropdown>
			</div>
			{showShareLink && shareUrl && (
				<CloudShareButton
					hideTrigger
					projectPath={entry.path}
					projectTitle={entry.name}
					existingShareUrl={shareUrl}
					linkIsStale={staleShare}
					open={showShareLink}
					onOpenChange={setShowShareLink}
					onRegenerate={() => {
						setShowShareLink(false);
						void run(() => onShareProject(entry.path));
					}}
				/>
			)}
		</li>
	);
}
