import { useId } from "react";
import { useI18n as useUiLocale } from "@/contexts/I18nContext";
import type { DashboardProps } from "./types";
import { Dropdown } from "@heroui/react";
import { ArrowUp, ArrowDown, Broom } from "@phosphor-icons/react";
import { CaretDown, Trash } from "@/components/ui/icons";

import { Button } from "@/components/ui/button";

import type { DashboardModel } from "./useDashboardModel";
import type { LibrarySort } from "./librarySort";

export function DashboardFilters({
	isRaw,
	period,
	setPeriod,
	selecting,
	setSelecting,
	selected,
	setSelected,
	sort,
	setSort,
	sortDirection,
	setSortDirection,
	sortMetadataLoading,
	visible,
	busy,
	deleteEntries,
	hideSelection = false,
	mediaSorts = true,
	onCleanup,
}: Pick<
	DashboardModel & DashboardProps,
	| "isRaw"
	| "period"
	| "setPeriod"
	| "selecting"
	| "setSelecting"
	| "selected"
	| "setSelected"
	| "sort"
	| "setSort"
	| "sortDirection"
	| "setSortDirection"
	| "visible"
	| "busy"
	| "deleteEntries"
> & { hideSelection?: boolean; mediaSorts?: boolean; sortMetadataLoading?: boolean; onCleanup?: () => void }) {
	const { locale, t: uiText } = useUiLocale();
	const directionDescriptionId = useId();
	const selectedSort = isRaw && sort === "recent" ? "created" : sort;
	const options: Array<{ id: LibrarySort; label: string }> = [
		...(!isRaw ? [{ id: "recent" as const, label: uiText("ui.lastEdited") }] : []),
		{ id: "created", label: uiText("ui.lastCreated") },
		{ id: "name", label: uiText("ui.name") },
		...(mediaSorts
			? [
					{
						id: "duration" as const,
						label: uiText("ui.duration", "Duration"),
					},
					{
						id: "audio" as const,
						label: uiText("ui.audio", "Audio"),
					},
				]
			: []),
	];
	const ascending = sortDirection === "asc";
	const directionAction = ascending
		? uiText("ui.sortDescending", "Sort descending")
		: uiText("ui.sortAscending", "Sort ascending");
	const currentOrder =
		sort === "name"
			? ascending
				? uiText("ui.nameAscending", "A to Z")
				: uiText("ui.nameDescending", "Z to A")
			: sort === "duration"
				? ascending
					? uiText("ui.shortestFirst", "Shortest first")
					: uiText("ui.longestFirst", "Longest first")
				: sort === "audio"
					? ascending
						? uiText("ui.silentFirst", "Silent recordings first")
						: uiText("ui.audioFirst", "Audio recordings first")
					: ascending
						? uiText("ui.oldestFirst", "Oldest first")
						: uiText("ui.newestFirst", "Newest first");

	return (
		<>
			<div className="flex flex-wrap items-center gap-3 px-7 pb-7 lg:px-10">
				<div className="flex flex-wrap gap-2" aria-label={uiText("ui.timeFilters")}>
					{[
						["all", uiText("ui.all")],
						["week", uiText("ui.last7Days")],
						["month", uiText("ui.last30Days")],
					].map(([id, label]) => (
						<Button
							key={id}
							variant="ghost"
							size="sm"
							aria-pressed={period === id}
							onClick={() => setPeriod(id)}
							className={`h-7 rounded-lg px-3 text-xs ${period === id ? "bg-default/60 text-foreground" : "text-muted-foreground"}`}
						>
							{label}
						</Button>
					))}
					{!hideSelection && (
						<Button
							variant="ghost"
							size="sm"
							disabled={busy}
							className="h-7 gap-2 px-3 text-xs"
							aria-label={
								isRaw
									? uiText("ui.selectRawFilesToDelete")
									: uiText("ui.selectProjectsToDelete")
							}
							aria-pressed={selecting}
							onClick={() => {
								setSelecting(!selecting);
								setSelected([]);
							}}
						>
							<Trash weight="fill" className="size-3.5" />
							{uiText("ui.cleanup.select", "Select")}
						</Button>
					)}
					{!hideSelection && onCleanup && (
						<Button
							variant="ghost"
							size="sm"
							className="h-7 gap-2 px-3 text-xs text-muted-foreground"
							disabled={busy}
							onClick={onCleanup}
						>
							<Broom className="size-3.5" aria-hidden="true" />
							{uiText("ui.cleanup.action", "Clean up")}
						</Button>
					)}
				</div>
				<div className="ml-auto flex flex-wrap items-center justify-end gap-2">
					{sortMetadataLoading && (
						<span role="status" className="text-xs text-muted-foreground">
							{uiText("ui.readingMediaInfo", "Reading media info…")}
						</span>
					)}
					<Dropdown>
						<Button
							variant="ghost"
							size="sm"
							aria-label={
								isRaw ? uiText("ui.sortRawFiles") : uiText("ui.sortProjects")
							}
							className="h-7 gap-2 text-xs text-muted-foreground"
						>
							{options.find((option) => option.id === selectedSort)?.label}
							<CaretDown className="size-3" />
						</Button>
						<Dropdown.Popover
							placement="bottom end"
							offset={6}
							className="w-60 min-w-0 max-w-[calc(100vw-24px)] rounded-xl p-1"
						>
							<Dropdown.Menu
								aria-label={
									isRaw ? uiText("ui.sortRawFiles") : uiText("ui.sortProjects")
								}
								selectionMode="single"
								disallowEmptySelection
								selectedKeys={[selectedSort]}
								onSelectionChange={(keys) => {
									if (keys === "all") return;
									const option = options.find((item) => keys.has(item.id));
									if (option) setSort(option.id);
								}}
							>
								{options.map((option) => (
									<Dropdown.Item
										key={option.id}
										id={option.id}
										textValue={option.label}
										className="min-h-8 gap-2 rounded-lg ps-8 pe-3 py-2 text-sm"
									>
										<Dropdown.ItemIndicator />
										<span className="flex-1">{option.label}</span>
									</Dropdown.Item>
								))}
							</Dropdown.Menu>
						</Dropdown.Popover>
					</Dropdown>
					<Button
						type="button"
						variant="ghost"
						size="icon"
						className="size-7 min-w-7 text-muted-foreground"
						aria-label={directionAction}
						aria-describedby={directionDescriptionId}
						title={`${currentOrder} · ${directionAction}`}
						data-sort-direction={sortDirection}
						onClick={() => setSortDirection(ascending ? "desc" : "asc")}
					>
						{ascending ? (
							<ArrowUp className="size-4" aria-hidden="true" />
						) : (
							<ArrowDown className="size-4" aria-hidden="true" />
						)}
					</Button>
					<span id={directionDescriptionId} className="sr-only">
						{currentOrder}
					</span>
				</div>
			</div>
			{selecting && (
				<div className="flex flex-wrap items-center gap-3 px-7 pb-5 text-xs lg:px-10">
					<Button
						variant="ghost"
						size="sm"
						disabled={busy || !visible.length}
						onClick={() => setSelected(selected.length === visible.length ? [] : visible.map((e) => e.path))}
					>
						{selected.length === visible.length && visible.length > 0 ? uiText("ui.cleanup.deselectAll", "Deselect all") : uiText("ui.cleanup.selectVisible", "Select all visible")}
					</Button>
					<span>
						{uiText("ui.selectedCount", undefined, {
							count: selected.length,
							number: new Intl.NumberFormat(locale).format(selected.length),
						})}
					</span>
					<Button
						variant="destructive"
						size="sm"
						disabled={!selected.length || busy}
						onClick={() => void deleteEntries(selected)}
					>
						{uiText("ui.cleanup.reviewDelete", "Review deletion…")}
					</Button>
					<Button
						variant="ghost"
						size="sm"
						onClick={() => {
							setSelecting(false);
							setSelected([]);
						}}
					>
						{uiText("ui.cancel")}
					</Button>
				</div>
			)}
		</>
	);
}
