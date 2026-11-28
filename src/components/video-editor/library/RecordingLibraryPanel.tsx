import { Checkbox, Dropdown, Label } from "@heroui/react";
import { FunnelSimple } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { ErrorReportButton } from "@/components/feedback/ErrorReportButton";
import { Button } from "@/components/ui/button";
import { SlidingDropdownMenu } from "@/components/ui/dropdown-menu";
import {
	ArrowCounterClockwise,
	CaretDown,
	FilmStrip,
	FolderOpen,
	Trash,
	X,
} from "@/components/ui/icons";
import { useI18n, useScopedT } from "@/contexts/I18nContext";
import { RecordingThumbnail } from "./RecordingThumbnail";
import { recordingThumbnailKey } from "./recordingThumbnailCache";
import type { useRecordingLibrary } from "./useRecordingLibrary";

type RecordingPeriod = "all" | "week" | "month";

export function RecordingLibraryPanel({
	library,
	onClose,
}: {
	library: ReturnType<typeof useRecordingLibrary>;
	onClose: () => void;
}) {
	const te = useScopedT("editing");
	const { t } = useI18n();
	const panelRef = useRef<HTMLElement>(null);
	const scrollRef = useRef<HTMLDivElement>(null);
	const rangeAnchor = useRef<string | null>(null);
	const [period, setPeriod] = useState<RecordingPeriod>("all");
	// biome-ignore lint/correctness/useExhaustiveDependencies: restore focus when removal unmounts the focused recording.
	useEffect(() => {
		if (library.open) panelRef.current?.focus();
	}, [library.open, library.entries.length]);
	if (!library.open) return null;
	const periods = {
		all: t("ui.all", "All"),
		week: t("ui.last7Days", "Last 7 days"),
		month: t("ui.last30Days", "Last 30 days"),
	};
	const timeFilters = t("ui.timeFilters", "Time filters");
	const cutoff = Date.now() - (period === "week" ? 7 : 30) * 86_400_000;
	const entries =
		period === "all"
			? library.entries
			: library.entries.filter((entry) => entry.createdAt >= cutoff);
	const selectedPaths = library.entries
		.filter((entry) => library.selected.has(entry.path))
		.map((entry) => entry.path);
	const visibleSelectedCount = entries.filter((entry) => library.selected.has(entry.path)).length;
	const allSelected = entries.length > 0 && visibleSelectedCount === entries.length;
	const disabled = library.busy || library.importing;
	const changePeriod = (next: RecordingPeriod) => {
		setPeriod(next);
		rangeAnchor.current = null;
		if (scrollRef.current) scrollRef.current.scrollTop = 0;
	};
	const selectEntries = (paths: string[], selected: boolean) => {
		library.setSelected((previous) => {
			const next = new Set(previous);
			for (const path of paths) {
				if (selected) next.add(path);
				else next.delete(path);
			}
			return next;
		});
	};
	const toggle = (path: string, extend: boolean) => {
		const anchor = extend
			? entries.findIndex((entry) => entry.path === rangeAnchor.current)
			: -1;
		if (anchor >= 0) {
			const end = entries.findIndex((entry) => entry.path === path);
			const range = entries.slice(Math.min(anchor, end), Math.max(anchor, end) + 1);
			selectEntries(
				range.map((entry) => entry.path),
				true,
			);
		} else {
			rangeAnchor.current = path;
			selectEntries([path], !library.selected.has(path));
		}
	};
	return (
		<section
			ref={panelRef}
			tabIndex={-1}
			aria-label={te("clipsLibrary", "Clips library")}
			data-recording-library
			className="outline-none flex min-h-0 flex-1 flex-col"
			onKeyDown={(event) => {
				if (event.defaultPrevented || !event.currentTarget.contains(event.target as Node))
					return;
				if (event.key === "Escape") {
					event.preventDefault();
					onClose();
				}
				if (
					(event.metaKey || event.ctrlKey) &&
					event.key.toLowerCase() === "z" &&
					!event.shiftKey
				) {
					event.preventDefault();
					event.stopPropagation();
					void library.undo();
				}
				if ((event.key === "Delete" || event.key === "Backspace") && selectedPaths.length) {
					event.preventDefault();
					event.stopPropagation();
					void library.remove(selectedPaths);
				}
			}}
		>
			<header className="flex min-h-14 shrink-0 items-center gap-2 px-5 py-3">
				<h2 className="flex-1 text-[14px] font-semibold">{te("clips", "Clips")}</h2>
				<Button
					isIconOnly
					variant="ghost"
					size="sm"
					aria-label={te("openRecordingsFolder", "Open recordings folder")}
					title={te("openRecordingsFolder", "Open recordings folder")}
					onPress={() => void window.electronAPI.openRecordingsFolder()}
				>
					<FolderOpen className="size-5" />
				</Button>
				<Button
					variant="ghost"
					size="icon"
					className="size-7"
					aria-label={te("closeClips", "Close Clips")}
					onClick={onClose}
				>
					<X />
				</Button>
			</header>
			<div className="flex min-h-10 shrink-0 items-center justify-between gap-2 px-5 pb-2">
				<Checkbox
					aria-label={te("selectAllVideos", "Select all videos")}
					isSelected={allSelected}
					isIndeterminate={!allSelected && visibleSelectedCount > 0}
					isDisabled={!entries.length || disabled}
					onChange={(checked) => {
						rangeAnchor.current = null;
						selectEntries(
							entries.map((entry) => entry.path),
							checked,
						);
					}}
				>
					<Checkbox.Content>
						<Checkbox.Control>
							<Checkbox.Indicator />
						</Checkbox.Control>
						<Label className="text-xs text-muted-foreground">
							{t("ui.selectAll", "Select all")}
						</Label>
					</Checkbox.Content>
				</Checkbox>
				<Dropdown>
					<Button
						variant="secondary"
						size="sm"
						className="h-7 gap-1.5 text-xs"
						aria-label={`${timeFilters}, ${periods[period]}`}
						disabled={disabled}
					>
						<FunnelSimple className="size-3.5" aria-hidden="true" />
						{periods[period]}
						<CaretDown className="size-3" aria-hidden="true" />
					</Button>
					<Dropdown.Popover placement="bottom end" offset={6} data-recording-library>
						<SlidingDropdownMenu
							aria-label={timeFilters}
							selectionMode="single"
							disallowEmptySelection
							selectedKeys={[period]}
							onSelectionChange={(keys) => {
								if (keys === "all") return;
								const next = (Object.keys(periods) as RecordingPeriod[]).find(
									(id) => keys.has(id),
								);
								if (next) changePeriod(next);
							}}
						>
							{(Object.keys(periods) as RecordingPeriod[]).map((id) => (
								<Dropdown.Item key={id} id={id} textValue={periods[id]}>
									<Dropdown.ItemIndicator />
									{periods[id]}
								</Dropdown.Item>
							))}
						</SlidingDropdownMenu>
					</Dropdown.Popover>
				</Dropdown>
			</div>
			<div
				ref={scrollRef}
				className="custom-scrollbar min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain px-5 pb-4"
			>
				{library.loading && (
					<p role="status" className="px-2 py-4 text-xs text-muted-foreground">
						{te("loadingVideos", "Loading videos…")}
					</p>
				)}
				{library.error && (
					<div role="alert" className="p-2 text-xs">
						<p>
							{library.error} <ErrorReportButton error={library.error} />
						</p>
						<Button variant="ghost" size="sm" onClick={() => void library.refresh()}>
							{te("retry", "Retry")}
						</Button>
					</div>
				)}
				{!library.loading && !library.error && !entries.length && (
					<div className="flex flex-col items-center gap-2 px-5 py-12 text-center text-muted-foreground">
						<FilmStrip className="size-7" />
						<p className="text-sm">
							{library.entries.length
								? te("noMatchingVideos", "No matching videos")
								: te("yourRecordingsAppearHere", "Your recordings appear here")}
						</p>
						{library.entries.length ? (
							<Button variant="ghost" size="sm" onClick={() => changePeriod("all")}>
								{t("ui.clearFilters", "Clear filters")}
							</Button>
						) : (
							<p className="text-xs">
								{te("recordAVideoToGetStarted", "Record a video to get started.")}
							</p>
						)}
					</div>
				)}
				<div className="grid grid-cols-2 gap-2 py-1">
					{entries.map((entry) => {
						const selected = library.selected.has(entry.path);
						return (
							<RecordingThumbnail
								key={recordingThumbnailKey(entry)}
								entry={entry}
								selected={selected}
								disabled={disabled}
								dragPaths={selected ? selectedPaths : [entry.path]}
								onSelect={(extend) => toggle(entry.path, extend)}
							/>
						);
					})}
				</div>
			</div>
			<footer className="shrink-0 border-t border-separator px-5 py-3">
				{library.canUndo && (
					<div className="mb-2 flex items-center justify-between gap-2 text-xs text-muted-foreground">
						<span role="status">{te("movedToTrash", "Moved to Trash")}</span>
						<Button
							variant="ghost"
							size="sm"
							disabled={disabled}
							onClick={() => void library.undo()}
							title={te("undoZCtrlZ", "Undo (⌘Z / Ctrl+Z)")}
						>
							<ArrowCounterClockwise className="size-3.5" />
							{te("undo", "Undo")}
						</Button>
					</div>
				)}
				<div className="flex items-center gap-2">
					<span role="status" className="flex-1 text-xs text-muted-foreground">
						{selectedPaths.length
							? te("selectedCount", "{{count}} selected", {
									count: selectedPaths.length,
								})
							: null}
					</span>
					{selectedPaths.length > 0 && (
						<Button
							variant="ghost"
							size="icon"
							className="size-7"
							aria-label={te(
								"moveSelectedVideosToTrash",
								"Move selected videos to Trash",
							)}
							title={te("moveSelectedToTrash", "Move selected to Trash")}
							disabled={disabled}
							onClick={() => void library.remove(selectedPaths)}
						>
							<Trash className="size-4" />
						</Button>
					)}
					<Button
						size="sm"
						disabled={disabled || !selectedPaths.length}
						onClick={() => void library.addToTimeline(selectedPaths)}
					>
						{te("import", "Import")}
					</Button>
				</div>
			</footer>
		</section>
	);
}
