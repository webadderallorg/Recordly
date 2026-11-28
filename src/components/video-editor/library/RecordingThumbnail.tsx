import { Tooltip } from "@heroui/react";
import { useEffect, useRef, useState } from "react";
import { Check, FilmStrip } from "@/components/ui/icons";
import { useI18n, useScopedT } from "@/contexts/I18nContext";
import { cn } from "@/lib/utils";
import { RECORDING_DRAG_TYPE, type RecordingLibraryEntry } from "@/types/recordingLibrary";
import { DurationBadge, formatThumbnailDuration } from "../dashboard/DurationBadge";
import {
	loadRecordingDuration,
	loadRecordingThumbnail,
	peekRecordingDuration,
	peekRecordingThumbnail,
	recordingThumbnailKey,
} from "./recordingThumbnailCache";

function RecordingDetails({ entry }: { entry: RecordingLibraryEntry }) {
	const { locale, t } = useI18n();
	const created = new Date(entry.fileCreatedAt ?? entry.createdAt);
	const size = entry.bytes >= 1_000_000 ? 1_000_000 : 1_000;
	return (
		<>
			<p className="font-semibold wrap-anywhere">{entry.name}</p>
			<p className="text-muted-foreground">
				{entry.fileCreatedAt === undefined ? t("ui.lastEdited") : t("ui.lastCreated")}
			</p>
			<time dateTime={created.toISOString()}>
				{created.toLocaleString(locale, {
					dateStyle: "medium",
					timeStyle: "short",
				})}
			</time>
			<p>
				{(entry.bytes / size).toLocaleString(locale, {
					style: "unit",
					unit: size === 1_000_000 ? "megabyte" : "kilobyte",
					maximumFractionDigits: 1,
				})}
			</p>
		</>
	);
}

export function RecordingThumbnail({
	entry,
	selected,
	disabled,
	dragPaths,
	onSelect,
}: {
	entry: RecordingLibraryEntry;
	selected: boolean;
	disabled: boolean;
	dragPaths: string[];
	onSelect: (extend: boolean) => void;
}) {
	const { t } = useI18n();
	const te = useScopedT("editing");
	const host = useRef<HTMLSpanElement>(null);
	const key = recordingThumbnailKey(entry);
	const [src, setSrc] = useState<string | null | undefined>(() => peekRecordingThumbnail(key));
	const [seconds, setSeconds] = useState(() => peekRecordingDuration(key));
	useEffect(() => {
		let active = true;
		const observer = new IntersectionObserver(
			(entries) => {
				if (!entries.some((entry) => entry.isIntersecting)) return;
				observer.disconnect();
				void loadRecordingThumbnail(key, entry.path)
					.then((url) => {
						if (active) setSrc(url);
					})
					.catch(() => {
						if (active) setSrc(null);
					});
				void loadRecordingDuration(key, entry.path)
					.then((duration) => {
						if (active) setSeconds(duration);
					})
					.catch(() => undefined);
			},
			{ rootMargin: "400px" },
		);
		if (host.current) observer.observe(host.current);
		return () => {
			active = false;
			observer.disconnect();
		};
	}, [key, entry.path]);
	const duration = formatThumbnailDuration(seconds);
	const selectionLabel = te("selectRecording", "Select {{name}}", { name: entry.name });
	return (
		<Tooltip delay={500} closeDelay={100} shouldSkipAnimation>
			<Tooltip.Trigger<"button">
				render={(props) => <button {...props} type="button" />}
				data-recording-path={entry.path}
				aria-label={
					duration
						? `${selectionLabel}, ${t("ui.duration")}: ${duration}`
						: selectionLabel
				}
				aria-pressed={selected}
				draggable={!disabled}
				disabled={disabled}
				onClick={(event) => onSelect(event.shiftKey)}
				onDragStart={(event) => {
					event.dataTransfer.setData(RECORDING_DRAG_TYPE, JSON.stringify(dragPaths));
					event.dataTransfer.effectAllowed = "copy";
				}}
				className="group relative isolate block w-full min-w-0 cursor-pointer select-none rounded-lg outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
			>
				<span
					ref={host}
					className="flex aspect-video w-full items-center justify-center overflow-hidden rounded-[inherit] bg-default text-muted-foreground"
				>
					{src ? (
						<img
							src={src}
							alt={te("previewOf", "Preview of {{name}}", { name: entry.name })}
							className="size-full object-contain"
							decoding="async"
							draggable={false}
							onError={() => setSrc(null)}
						/>
					) : src === null ? (
						<FilmStrip
							className="size-5"
							aria-label={te("previewUnavailable", "Preview unavailable")}
						/>
					) : (
						<span aria-label={te("loadingPreviewImage", "Loading preview image")} />
					)}
				</span>
				<DurationBadge seconds={seconds} />
				<span
					aria-hidden="true"
					className={cn(
						"pointer-events-none absolute inset-0 rounded-[inherit] border",
						selected
							? "border-2 border-accent"
							: "border-white/10 group-hover:border-white/45",
					)}
				/>
				{selected && (
					<span
						aria-hidden="true"
						className="pointer-events-none absolute inset-e-1.5 top-1.5 grid size-5 place-items-center rounded-full bg-accent text-accent-foreground"
					>
						<Check className="size-3.5" />
					</span>
				)}
			</Tooltip.Trigger>
			<Tooltip.Content
				placement="right"
				offset={8}
				className="pointer-events-none max-w-64 px-3 py-2 text-xs"
			>
				<RecordingDetails entry={entry} />
			</Tooltip.Content>
		</Tooltip>
	);
}
