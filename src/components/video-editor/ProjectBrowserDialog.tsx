import { Card, Popover } from "@heroui/react";
import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { toFileUrl } from "./projectPersistence";

export type ProjectLibraryEntry = {
	rawSource?: import("@/types/recordingLibrary").RecordingLibraryEntry;
	path: string;
	name: string;
	createdAt?: number;
	updatedAt: number;
	thumbnailPath: string | null;
	isCurrent: boolean;
	isInProjectsDirectory: boolean;
};
type ProjectBrowserDialogProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	entries: ProjectLibraryEntry[];
	onOpenProject: (path: string) => void;
	onImportFile?: () => void;
	anchorRef?: React.RefObject<HTMLElement | null>;
	preferredDirection?: "up" | "down" | "auto";
	onPanelHeightChange?: (height: number) => void;
	renderMode?: "floating" | "inline";
};
export default function ProjectBrowserDialog({
	open,
	onOpenChange,
	entries,
	onOpenProject,
	onImportFile,
	anchorRef,
	preferredDirection = "auto",
	onPanelHeightChange,
	renderMode = "floating",
}: ProjectBrowserDialogProps) {
	const panelRef = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (!open) {
			onPanelHeightChange?.(0);
			return;
		}
		const panel = panelRef.current;
		if (!panel || !onPanelHeightChange) return;
		const measure = () => onPanelHeightChange(panel.getBoundingClientRect().height);
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(panel);
		return () => {
			observer.disconnect();
			onPanelHeightChange(0);
		};
	}, [open, onPanelHeightChange]);
	if (!open) return null;
	const content = (
		<Card
			ref={panelRef}
			className={`${renderMode === "inline" ? "w-full" : "w-[340px]"} min-w-0 max-w-[calc(100vw-24px)] rounded-none bg-transparent p-3 shadow-none`}
		>
			<Card.Header className="flex-row items-center justify-between gap-3">
				<Card.Title>Projects</Card.Title>
				{onImportFile && (
					<Button size="sm" variant="secondary" onClick={onImportFile}>
						Import
					</Button>
				)}
			</Card.Header>
			<Card.Content className="custom-scrollbar max-h-80 overflow-y-auto overflow-x-hidden min-w-0">
				{entries.length ? (
					<div className="space-y-1">
						{entries.map((entry) => (
							<Button
								key={entry.path}
								variant="ghost"
								onClick={() => {
									onOpenProject(entry.path);
									onOpenChange(false);
								}}
								aria-label={entry.name}
								aria-current={entry.isCurrent ? "true" : undefined}
								title={entry.name}
								className="h-auto w-full min-w-0 justify-start gap-3 rounded-lg p-2"
							>
								<div className="relative aspect-video w-18 shrink-0 overflow-hidden rounded-md bg-default">
									{entry.thumbnailPath ? (
										<img
											src={toFileUrl(entry.thumbnailPath)}
											alt=""
											draggable={false}
											className="h-full w-full object-cover"
										/>
									) : (
										<span className="flex h-full items-center justify-center text-[10px] text-muted">
											No preview
										</span>
									)}
								</div>
								<span className="flex min-w-0 flex-1 flex-col gap-1 text-left">
									<span className="truncate text-[13px]">{entry.name}</span>
									<span className="text-[11px] text-muted">
										{entry.isCurrent
											? "Current project"
											: new Date(entry.updatedAt).toLocaleDateString()}
									</span>
								</span>
							</Button>
						))}
					</div>
				) : (
					<p className="py-8 text-center text-sm text-muted">No saved projects yet</p>
				)}
			</Card.Content>
		</Card>
	);
	// Inline mode lives inside the recorder's existing HeroUI popover.
	if (renderMode === "inline") return content;
	return (
		<Popover isOpen={open} onOpenChange={onOpenChange}>
			<Popover.Content
				triggerRef={anchorRef}
				placement={preferredDirection === "up" ? "top end" : "bottom start"}
			>
				<Popover.Dialog aria-label="Projects" className="p-0">
					{content}
				</Popover.Dialog>
			</Popover.Content>
		</Popover>
	);
}
