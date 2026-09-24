import type { useAppearanceState } from "../state/useAppearanceState";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "@/components/ui/toast";
import type { RecordingLibraryEntry } from "@/types/recordingLibrary";
import { packClipSequence, rippleRegionAnchors, rippleRegions } from "../clipSequence";
import {
	type ZoomRegion,
	sortClipRegions,
	DEFAULT_AUTO_ZOOM_DEPTH,
	clampFocusToDepth,
} from "../types";
import { buildInteractionZoomSuggestions } from "../timeline/zoomSuggestionUtils";
import type { useProjectState } from "../state/useProjectState";
import type { useTimelineState } from "../state/useTimelineState";
import type { useEditorUiState } from "../state/useEditorUiState";
import { isAutoMotionAllowed } from "../videoPlayback/motionAnimation";

export function useRecordingLibrary(
	project: ReturnType<typeof useProjectState>,
	timeline: ReturnType<typeof useTimelineState>,
	ui: ReturnType<typeof useEditorUiState>,
	appearance: ReturnType<typeof useAppearanceState>,
) {
	const [open, setOpen] = useState(false);
	const [entries, setEntries] = useState<RecordingLibraryEntry[]>([]);
	const [selected, setSelected] = useState<Set<string>>(new Set());
	const [loading, setLoading] = useState(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [removed, setRemoved] = useState<string[][]>([]);
	const lock = useRef(false);
	const current = useRef({ project, timeline, ui, appearance });
	current.current = { project, timeline, ui, appearance };
	const refresh = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const result = await window.electronAPI.listRecordings();
			if (!result.success) throw new Error(result.error);
			setEntries(result.value);
			setSelected(
				(previous) =>
					new Set(
						[...previous].filter((path) =>
							result.value.some((entry) => entry.path === path),
						),
					),
			);
		} catch (error) {
			setError(String(error));
		} finally {
			setLoading(false);
		}
	}, []);
	// biome-ignore lint/correctness/useExhaustiveDependencies: opening another project resets the media-server access list.
	useEffect(() => {
		if (open) void refresh();
	}, [open, refresh, project.videoSourcePath]);
	const remove = async (paths: string[]) => {
		if (lock.current || !paths.length) return;
		lock.current = true;
		setBusy(true);
		try {
			const result = await window.electronAPI.setRecordingsRemoved(paths, true);
			if (!result.success) throw new Error(result.error);
			setRemoved([paths]);
			setEntries((previous) => previous.filter((entry) => !paths.includes(entry.path)));
			setSelected(new Set());
		} catch (error) {
			toast.error(`Could not remove videos: ${String(error)}`);
		} finally {
			lock.current = false;
			setBusy(false);
		}
	};
	const undo = async () => {
		const paths = removed[removed.length - 1];
		if (lock.current || !paths) return;
		lock.current = true;
		setBusy(true);
		try {
			const result = await window.electronAPI.setRecordingsRemoved(paths, false);
			if (!result.success) throw new Error(result.error);
			setRemoved((previous) => previous.slice(0, -1));
			await refresh();
		} catch (error) {
			toast.error(`Could not restore videos: ${String(error)}`);
		} finally {
			lock.current = false;
			setBusy(false);
		}
	};
	const [importing, setImporting] = useState(false);
	const cancelled = useRef(false);
	const [cancelling, setCancelling] = useState(false);
	const cancelImport = async () => {
		cancelled.current = true;
		setCancelling(true);
		try {
			await window.electronAPI.cancelRecordingImport();
		} catch (error) {
			toast.error(`Could not stop import processing: ${String(error)}`);
		}
	};
	const addToTimeline = async (paths: string | string[], index?: number) => {
		const source = current.current.project.videoSourcePath;
		let retainedSource = source;
		if (lock.current || !source) return;
		lock.current = true;
		cancelled.current = false;
		setCancelling(false);
		setImporting(true);
		current.current.ui.videoPlaybackRef.current?.pause();
		current.current.ui.setIsPlaying(false);
		try {
			const initial = current.current;
			const before = sortClipRegions(initial.timeline.clipRegions);
			let sequence = before;
			let media;
			let webcam = initial.appearance.webcam;
			let sourcePath = source;
			let insertAt = Math.min(before.length, Math.max(0, index ?? before.length));
			const addedZooms: ZoomRegion[] = [];
			let id = "";
			let completed = 0;
			for (const path of [...new Set(typeof paths === "string" ? [paths] : paths)]) {
				if (cancelled.current) break;
				const result = await window.electronAPI.importRecording(sourcePath, path, webcam);
				if (!result.success) {
					if (cancelled.current) break;
					throw new Error(result.error);
				}
				completed++;
				if (current.current.project.videoSourcePath !== source)
					throw new Error(
						"The project changed while importing. Add the recordings again.",
					);
				media = result.value;
				sourcePath = media.path;
				if (media.webcam) webcam = { ...webcam, ...media.webcam, enabled: true };
				id = `clip-${initial.ui.nextClipIdRef.current++}`;
				const next = sequence.map((clip) => ({
					...clip,
					sourceMinMs: clip.sourceMinMs ?? 0,
					sourceMaxMs: clip.sourceMaxMs ?? media!.sourceStartMs,
				}));
				next.splice(insertAt++, 0, {
					id,
					startMs: 0,
					endMs: media.durationMs,
					sourceStartMs: media.sourceStartMs,
					sourceMinMs: media.sourceStartMs,
					sourceMaxMs: media.sourceStartMs + media.durationMs,
					speed: 1,
				});
				sequence = packClipSequence(next);
				if (isAutoMotionAllowed(current.current.appearance.motionAnimationEnabled, current.current.appearance.autoApplyFreshRecordingAutoZooms)) {
					const telemetry = await window.electronAPI.getCursorTelemetry(media.path);
					const start = media.sourceStartMs;
					const duration = media.durationMs;
					const offset = sequence.find((clip) => clip.id === id)!.startMs;
					const suggestions = buildInteractionZoomSuggestions({
						cursorTelemetry: (telemetry.success ? telemetry.samples : [])
							.filter(
								(point) => point.timeMs >= start && point.timeMs < start + duration,
							)
							.map((point) => ({ ...point, timeMs: point.timeMs - start })),
						totalMs: duration,
						defaultDurationMs: Math.min(1000, duration),
						reservedSpans: [],
					}).suggestions;
					addedZooms.push(
						...suggestions.map((zoom) => ({
							id: `zoom-${initial.ui.nextZoomIdRef.current++}`,
							startMs: offset + zoom.start,
							endMs: offset + zoom.end,
							depth: DEFAULT_AUTO_ZOOM_DEPTH,
							focus: clampFocusToDepth(zoom.focus, DEFAULT_AUTO_ZOOM_DEPTH),
							mode: "auto" as const,
						})),
					);
				}
			}
			if (!media) return;
			const { project, timeline, ui, appearance } = current.current;
			if (project.videoSourcePath !== source)
				throw new Error("The project changed while importing. Add the recordings again.");
			// Prepare cleanup while retaining rollback ownership until the project check passes.
			const prepared = await window.electronAPI.finishRecordingImport(media.path);
			if (!prepared.success)
				throw new Error(prepared.error || "Could not finalize imported media");
			if (current.current.project.videoSourcePath !== source)
				throw new Error("The project changed while importing. Add the recordings again.");
			// Send acceptance before synchronous project state updates; no await can switch projects here.
			void window.electronAPI
				.finishRecordingImport(media.path, true)
				.catch((error) => console.warn("Could not accept imported media", error));
			ui.clipInitializedRef.current = true;
			ui.autoFullTrackClipIdRef.current = null;
			ui.autoFullTrackClipEndMsRef.current = null;
			ui.setCurrentTime((sequence.find((clip) => clip.id === id)?.startMs ?? 0) / 1000);
			ui.setDuration(media.totalDurationMs / 1000);
			timeline.setClipRegions(sequence);
			timeline.setZoomRegions((current) => [
				...rippleRegions(current, before, sequence),
				...addedZooms,
			]);
			timeline.setAnnotationRegions((current) => rippleRegions(current, before, sequence));
			timeline.setAudioRegions((current) => rippleRegionAnchors(current, before, sequence));
			timeline.setSelectedClipId(id);
			if (media.webcam)
				appearance.setWebcam((previous) => ({
					...previous,
					...webcam,
					enabled: true,
				}));
			project.setVideoSourcePath(media.path);
			retainedSource = media.path;
			project.setVideoPath(media.url);
			ui.setIsPreviewReady(false);
			ui.setPreviewVersion((version) => version + 1);
			toast.success(
				completed === 1
					? "Video added to timeline"
					: `${completed} videos added to timeline`,
			);
		} catch (error) {
			if (!cancelled.current) toast.error(`Could not add video: ${String(error)}`);
		} finally {
			try {
				const cleanup = await window.electronAPI.finishRecordingImport(
					retainedSource!,
					true,
				);
				if (!cleanup.success)
					console.warn("Could not clean up temporary imports", cleanup.error);
			} catch (error) {
				console.warn("Could not clean up temporary imports", error);
			}
			lock.current = false;
			setImporting(false);
			setCancelling(false);
		}
	};
	return {
		open,
		setOpen,
		entries,
		selected,
		setSelected,
		loading,
		busy,
		error,
		refresh,
		remove,
		undo,
		canUndo: removed.length > 0,
		importing,
		cancelling,
		cancelImport,
		addToTimeline,
	};
}
