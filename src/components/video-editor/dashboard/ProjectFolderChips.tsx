import { useLayoutEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { FolderSimple } from "@/components/ui/icons";

type Folder = { id: string; name: string; color: string };
export function ProjectFolderChips({
	folders,
	name,
	onRemove,
}: {
	folders: Folder[];
	name: string;
	onRemove: (id: string) => void;
}) {
	const host = useRef<HTMLDivElement>(null);
	const measurement = useRef<HTMLDivElement>(null);
	const counter = useRef<HTMLSpanElement>(null);
	const [visible, setVisible] = useState(folders.length);
	useLayoutEffect(() => {
		let active = true;
		const measure = () => {
			if (!active || !host.current || !measurement.current) return;
			const widths = Array.from(
				measurement.current.children,
				(node) => node.getBoundingClientRect().width,
			);
			const available = host.current.clientWidth;
			let count = folders.length;
			while (count > 1) {
				const used =
					widths.slice(0, count).reduce((sum, width) => sum + width, 0) +
					Math.max(0, count - 1) * 6;
				const more =
					count < widths.length
						? (counter.current?.getBoundingClientRect().width ?? 20) + 6
						: 0;
				if (used + more <= available) break;
				count -= 1;
			}
			setVisible(count);
		};
		measure();
		const observer = new ResizeObserver(measure);
		if (host.current) observer.observe(host.current);
		void document.fonts.ready.then(measure);
		return () => {
			active = false;
			observer.disconnect();
		};
	}, [folders]);
	const chip = (folder: Folder, measuring = false) => (
		<Button
			key={folder.id}
			variant="ghost"
			size="sm"
			tabIndex={measuring ? -1 : undefined}
			aria-label={`Remove ${name} from ${folder.name}`}
			title={folder.name}
			onClick={measuring ? undefined : () => onRemove(folder.id)}
			className="h-6 min-w-0 max-w-28 shrink gap-1.5 rounded-full bg-default/40 px-2.5 text-[11px]"
		>
			<FolderSimple
				weight="fill"
				className="size-3 shrink-0"
				style={{ color: folder.color }}
			/>
			<span className="truncate">{folder.name}</span>
		</Button>
	);
	const hidden = folders.slice(visible);
	return (
		<div
			ref={host}
			aria-label={`Folders for ${name}`}
			className="relative flex min-w-0 flex-1 items-center gap-1.5"
		>
			{folders.slice(0, visible).map((folder) => chip(folder))}
			{hidden.length > 0 && (
				<span
					className="shrink-0 text-[11px] text-muted-foreground"
					aria-label={`${hidden.length} more folders: ${hidden.map((folder) => folder.name).join(", ")}`}
					title={hidden.map((folder) => folder.name).join(", ")}
				>
					+{hidden.length}
				</span>
			)}
			<div
				aria-hidden="true"
				inert
				className="pointer-events-none invisible absolute left-0 top-0 h-0 w-0 overflow-hidden"
			>
				<div ref={measurement} className="flex w-max gap-1.5">
					{folders.map((folder) => chip(folder, true))}
				</div>
				<span ref={counter} className="text-[11px]">
					+{folders.length}
				</span>
			</div>
		</div>
	);
}
