import { RecordingThumbnail } from "./RecordingThumbnail";
import { useEffect, useRef, useState } from "react";
import { Checkbox, Label, Dropdown, SearchField, Button as HeroButton } from "@heroui/react";
import {
	FilmStrip,
	Plus,
	X,
	Trash,
	ArrowCounterClockwise,
	DotsThree,
	FolderOpen,
} from "@/components/ui/icons";
import { Button } from "@/components/ui/button";
import { RECORDING_DRAG_TYPE } from "@/types/recordingLibrary";
import { cn } from "@/lib/utils";
import type { useRecordingLibrary } from "./useRecordingLibrary";

export function RecordingLibraryPanel({
	library,
}: {
	library: ReturnType<typeof useRecordingLibrary>;
}) {
	const panelRef = useRef<HTMLElement>(null);
	const [query, setQuery] = useState("");
	// biome-ignore lint/correctness/useExhaustiveDependencies: restore focus when removal unmounts the focused recording.
	useEffect(() => {
		if (library.open) panelRef.current?.focus();
	}, [library.open, library.entries.length]);
	if (!library.open) return null;
	const entries = library.entries.filter((entry) =>
		entry.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
	);
	const allSelected =
		entries.length > 0 && entries.every((entry) => library.selected.has(entry.path));
	const toggle = (path: string, selected: boolean) =>
		library.setSelected((previous) => {
			const next = new Set(previous);
			if (selected) next.add(path);
			else next.delete(path);
			return next;
		});
	return (
		<section
			ref={panelRef}
			tabIndex={-1}
			aria-label="Clips library"
			data-recording-library
			className="outline-none flex min-h-0 flex-1 flex-col"
			onKeyDown={(event) => {
				if (event.key === "Escape") {
					event.preventDefault();
					library.setOpen(false);
				}
				const isInput = event.target instanceof HTMLInputElement;
				if (
					!isInput &&
					(event.metaKey || event.ctrlKey) &&
					event.key.toLowerCase() === "z" &&
					!event.shiftKey
				) {
					event.preventDefault();
					event.stopPropagation();
					void library.undo();
				}
				if (
					!isInput &&
					(event.key === "Delete" || event.key === "Backspace") &&
					library.selected.size
				) {
					event.preventDefault();
					event.stopPropagation();
					void library.remove([...library.selected]);
				}
			}}
		>
			<header className="flex min-h-14 shrink-0 items-center gap-2 px-5 py-3">
				<h2 className="flex-1 text-[14px] font-semibold">Clips</h2>
				<Dropdown>
					<HeroButton
						isIconOnly
						variant="ghost"
						size="sm"
						aria-label="Clip library actions"
					>
						<DotsThree className="size-5" />
					</HeroButton>
					<Dropdown.Popover placement="bottom end">
						<Dropdown.Menu aria-label="Clip library actions">
							<Dropdown.Item
								id="folder"
								textValue="Open recordings folder"
								onAction={() => void window.electronAPI.openRecordingsFolder()}
							>
								<FolderOpen weight="fill" className="size-4" />
								<Label>Open recordings folder</Label>
							</Dropdown.Item>
							<Dropdown.Item
								id="trash"
								textValue="Move all to Trash"
								variant="danger"
								isDisabled={
									!library.entries.length || library.busy || library.importing
								}
								onAction={() =>
									void library.remove(library.entries.map((entry) => entry.path))
								}
							>
								<Trash className="size-4" />
								<Label>Move all to Trash</Label>
							</Dropdown.Item>
						</Dropdown.Menu>
					</Dropdown.Popover>
				</Dropdown>
				<Button
					variant="ghost"
					size="icon"
					className="size-7"
					aria-label="Close Clips"
					onClick={() => library.setOpen(false)}
				>
					<X />
				</Button>
			</header>
			<div className="px-5 pb-3">
				<SearchField aria-label="Search videos" value={query} onChange={setQuery}>
					<SearchField.Group>
						<SearchField.SearchIcon />
						<SearchField.Input placeholder="Search videos" />
						<SearchField.ClearButton />
					</SearchField.Group>
				</SearchField>
			</div>
			<div className="flex min-h-10 items-center gap-2 px-5 pb-2">
				<Checkbox
					aria-label="Select all videos"
					isSelected={allSelected}
					isIndeterminate={!allSelected && library.selected.size > 0}
					isDisabled={!entries.length || library.busy || library.importing}
					onChange={(checked) =>
						library.setSelected((previous) => {
							const next = new Set(previous);
							for (const entry of entries) {
								if (checked) next.add(entry.path);
								else next.delete(entry.path);
							}
							return next;
						})
					}
				>
					<Checkbox.Content>
						<Checkbox.Control>
							<Checkbox.Indicator />
						</Checkbox.Control>
					</Checkbox.Content>
				</Checkbox>
				<span className="flex-1 text-xs text-muted-foreground">
					{library.selected.size
						? `${library.selected.size} selected`
						: `${entries.length} ${entries.length === 1 ? "recording" : "recordings"}`}
				</span>
				{library.selected.size > 0 && (
					<Button
						variant="ghost"
						size="icon"
						className="size-7"
						aria-label="Move selected videos to Trash"
						title="Move selected to Trash"
						disabled={library.busy || library.importing}
						onClick={() => void library.remove([...library.selected])}
					>
						<Trash className="size-4" />
					</Button>
				)}
			</div>
			<div className="custom-scrollbar min-h-0 flex-1 space-y-1 overflow-y-auto overflow-x-hidden px-3 pb-3">
				{library.loading && (
					<p role="status" className="px-2 py-4 text-xs text-muted-foreground">
						Loading videos…
					</p>
				)}
				{library.error && (
					<div role="alert" className="p-2 text-xs">
						<p>{library.error}</p>
						<Button variant="ghost" size="sm" onClick={() => void library.refresh()}>
							Retry
						</Button>
					</div>
				)}
				{!library.loading && !library.error && !entries.length && (
					<div className="flex flex-col items-center gap-2 px-5 py-12 text-center text-muted-foreground">
						<FilmStrip className="size-7" />
						<p className="text-sm">
							{query ? "No matching videos" : "Your recordings appear here"}
						</p>
						<p className="text-xs">
							{query ? "Try another search." : "Record a video to get started."}
						</p>
					</div>
				)}
				{entries.map((entry) => (
					<div
						key={entry.path}
						data-recording-path={entry.path}
						draggable={!library.busy && !library.importing}
						onDragStart={(event) => {
							const paths = library.selected.has(entry.path)
								? library.entries
										.filter((item) => library.selected.has(item.path))
										.map((item) => item.path)
								: [entry.path];
							event.dataTransfer.setData(RECORDING_DRAG_TYPE, JSON.stringify(paths));
							event.dataTransfer.effectAllowed = "copy";
						}}
						className={cn(
							"group flex items-center gap-3 rounded-xl px-2 py-3 transition-colors hover:bg-default",
							library.selected.has(entry.path) && "bg-default",
						)}
					>
						<Checkbox
							aria-label={`Select ${entry.name}`}
							isDisabled={library.busy || library.importing}
							isSelected={library.selected.has(entry.path)}
							onChange={(checked) => toggle(entry.path, checked)}
						>
							<Checkbox.Content>
								<Checkbox.Control>
									<Checkbox.Indicator />
								</Checkbox.Control>
							</Checkbox.Content>
						</Checkbox>
						<button
							type="button"
							className="flex min-w-0 flex-1 items-center gap-3 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-focus"
							disabled={library.busy || library.importing}
							onClick={() => toggle(entry.path, !library.selected.has(entry.path))}
							onDoubleClick={() => void library.addToTimeline(entry.path)}
							title={entry.name}
						>
							<RecordingThumbnail entry={entry} />
							<span className="min-w-0">
								<span
									title={entry.name}
									className="block truncate text-xs font-medium"
								>
									{entry.name}
								</span>
								<span className="mt-1 block text-[11px] text-muted-foreground">
									{new Date(entry.createdAt).toLocaleDateString(undefined, {
										month: "short",
										day: "numeric",
									})}{" "}
									· {(entry.bytes / 1024 / 1024).toFixed(1)} MB
								</span>
							</span>
						</button>
						<Button
							variant="ghost"
							size="icon"
							className="size-7 shrink-0"
							aria-label={`Add ${entry.name} to timeline`}
							title="Add to timeline"
							disabled={library.busy || library.importing}
							onClick={() => void library.addToTimeline(entry.path)}
						>
							<Plus className="size-4" />
						</Button>
					</div>
				))}
			</div>
			<footer className="flex items-center gap-2 px-5 py-3 text-[11px] text-muted-foreground">
				<span className="flex-1">
					{library.canUndo ? "Moved to Trash" : "Drag to the timeline or click + to add."}
				</span>
				{library.canUndo && (
					<Button
						variant="ghost"
						size="sm"
						disabled={library.busy || library.importing}
						onClick={() => void library.undo()}
						title="Undo (⌘Z / Ctrl+Z)"
					>
						<ArrowCounterClockwise className="size-3.5" />
						Undo
					</Button>
				)}
			</footer>
		</section>
	);
}
