import { ArrowsMerge, Scissors, Trash } from "@phosphor-icons/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useScopedT } from "@/contexts/I18nContext";
import type { CaptionRetimeSpan } from "./captionOps";
import type { CaptionCue } from "./types";

interface CaptionListPanelProps {
	cues: CaptionCue[];
	selectedCaptionId: string | null;
	currentTimeMs: number;
	onBeginCaptionEdit: (id: string) => void;
	onCaptionTextEdit: (id: string, text: string) => void;
	onCaptionRetime: (id: string, span: CaptionRetimeSpan) => void;
	onCaptionSplit: (id: string, atMs: number) => void;
	onCaptionMerge: (idA: string, idB: string) => void;
	onCaptionDelete: (id: string) => void;
}

function clampNumber(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

function formatTimecode(ms: number): string {
	const safeMs = Math.max(0, Math.round(ms));
	const minutes = Math.floor(safeMs / 60_000);
	const seconds = Math.floor((safeMs % 60_000) / 1_000);
	const millis = safeMs % 1_000;
	return `${minutes}:${String(seconds).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
}

function parseTimecode(value: string): number | null {
	const match = value.trim().match(/^(?:(\d+):)?(\d{1,2})(?:\.(\d{1,3}))?$/);
	if (!match) {
		return null;
	}
	const minutes = match[1] ? Number.parseInt(match[1], 10) : 0;
	const seconds = Number.parseInt(match[2], 10);
	const millis = match[3] ? Number.parseInt(match[3].padEnd(3, "0"), 10) : 0;
	return (minutes * 60 + seconds) * 1_000 + millis;
}

interface CaptionEditorProps {
	cue: CaptionCue;
	canMerge: boolean;
	currentTimeMs: number;
	onBeginEdit: (id: string) => void;
	onTextEdit: (id: string, text: string) => void;
	onRetime: (id: string, span: CaptionRetimeSpan) => void;
	onSplit: (id: string, atMs: number) => void;
	onMerge: (id: string) => void;
	onDelete: (id: string) => void;
}

function CaptionEditor({
	cue,
	canMerge,
	currentTimeMs,
	onBeginEdit,
	onTextEdit,
	onRetime,
	onSplit,
	onMerge,
	onDelete,
}: CaptionEditorProps) {
	const t = useScopedT("settings");
	const [draftText, setDraftText] = useState(cue.text);
	const [startValue, setStartValue] = useState(formatTimecode(cue.startMs));
	const [endValue, setEndValue] = useState(formatTimecode(cue.endMs));
	// Escape resets the draft and blurs, but `setDraftText` is batched so the blur-driven
	// `commitText` would still see the stale (edited) draft and save it. This flag lets the
	// cancel path tell the next blur to discard instead of commit.
	const cancelNextCommitRef = useRef(false);

	useEffect(() => {
		setDraftText(cue.text);
		setStartValue(formatTimecode(cue.startMs));
		setEndValue(formatTimecode(cue.endMs));
	}, [cue.text, cue.startMs, cue.endMs]);

	const commitText = useCallback(() => {
		if (cancelNextCommitRef.current) {
			cancelNextCommitRef.current = false;
			setDraftText(cue.text);
			return;
		}
		const normalized = draftText.trim();
		if (normalized && normalized !== cue.text) {
			onTextEdit(cue.id, normalized);
		} else {
			setDraftText(cue.text);
		}
	}, [cue.id, cue.text, draftText, onTextEdit]);

	const commitTiming = useCallback(() => {
		const parsedStart = parseTimecode(startValue);
		const parsedEnd = parseTimecode(endValue);
		if (parsedStart === null || parsedEnd === null || parsedEnd <= parsedStart) {
			setStartValue(formatTimecode(cue.startMs));
			setEndValue(formatTimecode(cue.endMs));
			return;
		}
		if (parsedStart !== cue.startMs || parsedEnd !== cue.endMs) {
			onRetime(cue.id, { startMs: parsedStart, endMs: parsedEnd });
		}
	}, [cue.endMs, cue.id, cue.startMs, endValue, onRetime, startValue]);

	return (
		<div className="flex flex-col gap-3 rounded-lg bg-foreground/[0.03] px-2.5 py-2.5">
			<label className="flex flex-col gap-1">
				<span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
					{t("captions.editor.text", "Text")}
				</span>
				<textarea
					value={draftText}
					rows={3}
					// Freshly-added captions start empty — focus the field so the
					// user can type immediately after dropping one on the timeline.
					autoFocus={cue.text === ""}
					onFocus={() => onBeginEdit(cue.id)}
					onChange={(event) => setDraftText(event.target.value)}
					onBlur={commitText}
					onKeyDown={(event) => {
						if (event.key === "Enter" && !event.shiftKey) {
							event.preventDefault();
							event.currentTarget.blur();
						}
						if (event.key === "Escape") {
							cancelNextCommitRef.current = true;
							setDraftText(cue.text);
							event.currentTarget.blur();
						}
					}}
					className="min-h-[4.5rem] w-full resize-none rounded-md border border-foreground/10 bg-background/60 px-2 py-1.5 text-sm text-foreground outline-none focus-visible:border-[#2563EB] focus-visible:ring-1 focus-visible:ring-[#2563EB]"
				/>
			</label>

			<div className="flex items-center gap-2">
				<label className="flex flex-1 flex-col gap-1">
					<span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
						{t("captions.editor.start", "Start")}
					</span>
					<input
						value={startValue}
						onChange={(event) => setStartValue(event.target.value)}
						onBlur={commitTiming}
						onKeyDown={(event) => {
							if (event.key === "Enter") {
								event.currentTarget.blur();
							}
						}}
						className="w-full rounded-md border border-foreground/10 bg-background/60 px-2 py-1 font-mono text-xs tabular-nums text-foreground outline-none focus-visible:border-[#2563EB] focus-visible:ring-1 focus-visible:ring-[#2563EB]"
					/>
				</label>
				<label className="flex flex-1 flex-col gap-1">
					<span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
						{t("captions.editor.end", "End")}
					</span>
					<input
						value={endValue}
						onChange={(event) => setEndValue(event.target.value)}
						onBlur={commitTiming}
						onKeyDown={(event) => {
							if (event.key === "Enter") {
								event.currentTarget.blur();
							}
						}}
						className="w-full rounded-md border border-foreground/10 bg-background/60 px-2 py-1 font-mono text-xs tabular-nums text-foreground outline-none focus-visible:border-[#2563EB] focus-visible:ring-1 focus-visible:ring-[#2563EB]"
					/>
				</label>
			</div>

			<div className="grid grid-cols-3 gap-2">
				<button
					type="button"
					onClick={() =>
						onSplit(cue.id, clampNumber(currentTimeMs, cue.startMs, cue.endMs))
					}
					className="flex h-9 items-center justify-center gap-1.5 rounded-lg border border-foreground/10 bg-foreground/5 text-xs font-medium text-foreground transition-colors hover:bg-foreground/10"
				>
					<Scissors className="h-4 w-4" />
					{t("captions.editor.split", "Split")}
				</button>
				<button
					type="button"
					disabled={!canMerge}
					onClick={() => onMerge(cue.id)}
					className="flex h-9 items-center justify-center gap-1.5 rounded-lg border border-foreground/10 bg-foreground/5 text-xs font-medium text-foreground transition-colors hover:bg-foreground/10 disabled:opacity-40"
				>
					<ArrowsMerge className="h-4 w-4" />
					{t("captions.editor.merge", "Merge")}
				</button>
				<Button
					type="button"
					variant="destructive"
					size="sm"
					onClick={() => onDelete(cue.id)}
					className="h-9 gap-1.5 rounded-lg border border-red-500/20 bg-red-500/10 text-xs text-red-400 transition-all hover:border-red-500/30 hover:bg-red-500/20"
				>
					<Trash className="h-3 w-3" />
					{t("captions.editor.delete", "Delete")}
				</Button>
			</div>
		</div>
	);
}

export default function CaptionListPanel({
	cues,
	selectedCaptionId,
	currentTimeMs,
	onBeginCaptionEdit,
	onCaptionTextEdit,
	onCaptionRetime,
	onCaptionSplit,
	onCaptionMerge,
	onCaptionDelete,
}: CaptionListPanelProps) {
	const index = cues.findIndex((cue) => cue.id === selectedCaptionId);
	if (index < 0) {
		return null;
	}

	const cue = cues[index];
	const canMerge = index < cues.length - 1;

	return (
		<CaptionEditor
			key={cue.id}
			cue={cue}
			canMerge={canMerge}
			currentTimeMs={currentTimeMs}
			onBeginEdit={onBeginCaptionEdit}
			onTextEdit={onCaptionTextEdit}
			onRetime={onCaptionRetime}
			onSplit={onCaptionSplit}
			onMerge={(id) => {
				if (canMerge) {
					onCaptionMerge(id, cues[index + 1].id);
				}
			}}
			onDelete={onCaptionDelete}
		/>
	);
}
