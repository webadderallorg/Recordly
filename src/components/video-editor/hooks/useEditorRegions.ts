/**
 * useEditorRegions – owns all timeline region state (zoom, clip,
 * annotation, audio) together with every handler that mutates them.
 *
 * Trim regions are derived automatically from clips (gaps between clips).
 * Speed regions are derived automatically from clip speeds.
 * Neither trims nor speeds are user-editable as standalone entities.
 */

import type { Span } from "dnd-timeline";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { extensionHost } from "@/lib/extensions";
import { deriveNextId } from "../projectPersistence";
import { useEditorAnnotationAudioRegions } from "./useEditorAnnotationAudioRegions";
import { useEditorClipRegions } from "./useEditorClipRegions";
import {
	type AnnotationRegion,
	type AudioRegion,
	type ClipRegion,
	clampFocusToDepth,
	clipsToTrims,
	DEFAULT_AUTO_ZOOM_DEPTH,
	DEFAULT_ZOOM_DEPTH,
	type EditorEffectSection,
	getClipSourceEndMs,
	getClipSourceStartMs,
	type SpeedRegion,
	type TrimRegion,
	type ZoomDepth,
	type ZoomFocus,
	type ZoomMode,
	type ZoomRegion,
} from "../types";

interface UseEditorRegionsParams {
	duration: number;
	currentTime: number;
	videoPath: string | null;
	setActiveEffectSection: (
		section: EditorEffectSection | ((prev: EditorEffectSection) => EditorEffectSection),
	) => void;
}

export function useEditorRegions({
	duration,
	currentTime,
	videoPath,
	setActiveEffectSection,
}: UseEditorRegionsParams) {
	// ─── Region state ───────────────────────────────────────────────────────
	const [zoomRegions, setZoomRegions] = useState<ZoomRegion[]>([]);

	// ─── Selection state ────────────────────────────────────────────────────
	const [selectedZoomId, setSelectedZoomId] = useState<string | null>(null);

	// ─── ID counters ────────────────────────────────────────────────────────
	const nextZoomIdRef = useRef(1);
	const autoSuggestedVideoPathRef = useRef<string | null>(null);
	const pendingFreshRecordingAutoZoomPathRef = useRef<string | null>(null);
	const {
		annotationRegions,
		setAnnotationRegions,
		audioRegions,
		setAudioRegions,
		selectedAnnotationId,
		setSelectedAnnotationId,
		selectedAudioId,
		setSelectedAudioId,
		nextAnnotationIdRef,
		nextAnnotationZIndexRef,
		nextAudioIdRef,
		handleSelectAnnotation,
		handleAnnotationAdded,
		handleAnnotationSpanChange,
		handleAnnotationDelete,
		handleAnnotationContentChange,
		handleAnnotationTypeChange,
		handleAnnotationStyleChange,
		handleAnnotationFigureDataChange,
		handleAnnotationBlurIntensityChange,
		handleAnnotationBlurColorChange,
		handleAnnotationPositionChange,
		handleAnnotationSizeChange,
		handleSelectAudio,
		handleAudioAdded,
		handleAudioSpanChange,
		handleAudioDelete,
		resetAnnotationAudioForProject,
	} = useEditorAnnotationAudioRegions({ setSelectedZoomId });

	// ─── Derived ────────────────────────────────────────────────────────────
	const totalMs = useMemo(() => Math.round(duration * 1000), [duration]);
	const {
		clipRegions,
		setClipRegions,
		selectedClipId,
		setSelectedClipId,
		nextClipIdRef,
		clipInitializedRef,
		handleSelectClip,
		handleClipSplit,
		handleClipSpanChange,
		handleClipSpeedChange,
		handleClipMutedChange,
		handleClipDelete,
	} = useEditorClipRegions({
		totalMs,
		setActiveEffectSection,
		setSelectedZoomId,
		setSelectedAnnotationId,
		setSelectedAudioId,
		setZoomRegions,
		setAnnotationRegions,
		setAudioRegions,
	});

	// Trim regions are derived from clips (gaps = sections to remove in export)
	const trimRegions = useMemo<TrimRegion[]>(() => {
		if (totalMs <= 0) return [];
		if (clipRegions.length === 0) {
			return [{ id: "trim-all", startMs: 0, endMs: totalMs }];
		}
		return clipsToTrims(clipRegions, totalMs);
	}, [clipRegions, totalMs]);

	// Clear stale selection IDs when regions are removed externally
	useEffect(() => {
		if (selectedZoomId && !zoomRegions.some((r) => r.id === selectedZoomId))
			setSelectedZoomId(null);
	}, [selectedZoomId, zoomRegions]);
	useEffect(() => {
		if (selectedAnnotationId && !annotationRegions.some((r) => r.id === selectedAnnotationId))
			setSelectedAnnotationId(null);
	}, [selectedAnnotationId, annotationRegions]);
	useEffect(() => {
		if (selectedAudioId && !audioRegions.some((r) => r.id === selectedAudioId))
			setSelectedAudioId(null);
	}, [selectedAudioId, audioRegions]);

	// ─── Time mapping ───────────────────────────────────────────────────────
	const mapTimelineTimeToSourceTime = useCallback((timeMs: number) => {
		for (const clip of clipRegions) {
			if (timeMs < clip.startMs || timeMs > clip.endMs) continue;
			const sourceStart = clip.sourceStartMs ?? clip.startMs;
			const speed = Number.isFinite(clip.speed) && clip.speed > 0 ? clip.speed : 1;
			return Math.round(sourceStart + (timeMs - clip.startMs) * speed);
		}
		return Math.round(timeMs);
	}, [clipRegions]);

	const mapSourceTimeToTimelineTime = useCallback((timeMs: number) => {
		for (const clip of clipRegions) {
			const sourceStart = clip.sourceStartMs ?? clip.startMs;
			const speed = Number.isFinite(clip.speed) && clip.speed > 0 ? clip.speed : 1;
			const sourceEndMs = Math.round(sourceStart + (clip.endMs - clip.startMs) * speed);
			if (timeMs < sourceStart || timeMs > sourceEndMs) continue;
			return Math.round(clip.startMs + (timeMs - sourceStart) / speed);
		}
		return Math.round(timeMs);
	}, [clipRegions]);

	// ─── Effective regions ──────────────────────────────────────────────────
	const effectiveZoomRegions = useMemo<ZoomRegion[]>(
		() =>
			zoomRegions.map((r) => ({
				...r,
				startMs: mapTimelineTimeToSourceTime(r.startMs),
				endMs: mapTimelineTimeToSourceTime(r.endMs),
			})),
		[zoomRegions, mapTimelineTimeToSourceTime],
	);

	// Speed regions derived purely from clip speeds (no standalone speed regions)
	const effectiveSpeedRegions = useMemo<SpeedRegion[]>(
		() =>
			clipRegions
				.filter((c) => c.speed !== 1)
				.map((c) => ({
					id: `clip-speed-${c.id}`,
					startMs: getClipSourceStartMs(c),
					endMs: getClipSourceEndMs(c),
					speed: c.speed as SpeedRegion["speed"],
				})),
		[clipRegions],
	);

	const timelinePlayheadTime = useMemo(
		() => mapSourceTimeToTimelineTime(currentTime * 1000) / 1000,
		[currentTime, mapSourceTimeToTimelineTime],
	);

	// ─── Zoom handlers ──────────────────────────────────────────────────────
	const handleZoomAdded = useCallback(
		(span: Span) => {
			const id = `zoom-${nextZoomIdRef.current++}`;
			const newRegion: ZoomRegion = {
				id,
				startMs: Math.round(span.start),
				endMs: Math.round(span.end),
				depth: DEFAULT_ZOOM_DEPTH,
				focus: { cx: 0.5, cy: 0.5 },
				mode: "manual",
			};
			if (videoPath && pendingFreshRecordingAutoZoomPathRef.current === videoPath) {
				autoSuggestedVideoPathRef.current = videoPath;
				pendingFreshRecordingAutoZoomPathRef.current = null;
			}
			setZoomRegions((prev) => [...prev, newRegion]);
			setSelectedZoomId(id);

			setSelectedAnnotationId(null);
			extensionHost.emitEvent({
				type: "timeline:region-added",
				data: { id, startMs: newRegion.startMs, endMs: newRegion.endMs },
			});
		},
		[videoPath],
	);

	const handleZoomSuggested = useCallback(
		(span: Span, focus: ZoomFocus) => {
			const id = `zoom-${nextZoomIdRef.current++}`;
			const newRegion: ZoomRegion = {
				id,
				startMs: Math.round(span.start),
				endMs: Math.round(span.end),
				depth: DEFAULT_AUTO_ZOOM_DEPTH,
				focus: clampFocusToDepth(focus, DEFAULT_AUTO_ZOOM_DEPTH),
				mode: "auto",
			};
			if (videoPath && pendingFreshRecordingAutoZoomPathRef.current === videoPath) {
				autoSuggestedVideoPathRef.current = videoPath;
				pendingFreshRecordingAutoZoomPathRef.current = null;
			}
			setZoomRegions((prev) => [...prev, newRegion]);
			extensionHost.emitEvent({
				type: "timeline:region-added",
				data: { id, startMs: newRegion.startMs, endMs: newRegion.endMs },
			});
		},
		[videoPath],
	);

	const handleZoomSpanChange = useCallback((id: string, span: Span) => {
		setZoomRegions((prev) =>
			prev.map((r) =>
				r.id === id
					? { ...r, startMs: Math.round(span.start), endMs: Math.round(span.end) }
					: r,
			),
		);
	}, []);

	const handleZoomDelete = useCallback((id: string) => {
		setZoomRegions((prev) => prev.filter((r) => r.id !== id));
		setSelectedZoomId((cur) => (cur === id ? null : cur));
		extensionHost.emitEvent({ type: "timeline:region-removed", data: { id } });
	}, []);

	const handleZoomFocusChange = useCallback((id: string, focus: ZoomFocus) => {
		setZoomRegions((prev) =>
			prev.map((r) => (r.id === id ? { ...r, focus: clampFocusToDepth(focus, r.depth) } : r)),
		);
	}, []);

	const handleZoomDepthChange = useCallback(
		(depth: ZoomDepth) => {
			setZoomRegions((prev) =>
				prev.map((r) =>
					r.id === selectedZoomId
						? { ...r, depth, focus: clampFocusToDepth(r.focus, depth) }
						: r,
				),
			);
		},
		[selectedZoomId],
	);

	const handleZoomModeChange = useCallback(
		(mode: ZoomMode) => {
			setZoomRegions((prev) =>
				prev.map((r) => (r.id === selectedZoomId ? { ...r, mode } : r)),
			);
		},
		[selectedZoomId],
	);

	const handleSelectZoom = useCallback(
		(id: string | null) => {
			setSelectedZoomId(id);
			if (id) {
				setActiveEffectSection("zoom");
				setSelectedAnnotationId(null);
				setSelectedAudioId(null);
			} else {
				setActiveEffectSection((s) => (s === "zoom" ? "scene" : s));
			}
		},
		[setActiveEffectSection],
	);

	/** Reset ALL region state from a freshly loaded project. */
	const resetForProject = useCallback(
		(editor: {
			zoomRegions: ZoomRegion[];
			clipRegions: ClipRegion[];
			annotationRegions: AnnotationRegion[];
			audioRegions: AudioRegion[];
		}) => {
			setZoomRegions(editor.zoomRegions);
			setClipRegions(editor.clipRegions);
			clipInitializedRef.current = true;
			resetAnnotationAudioForProject(editor);
			setSelectedZoomId(null);
			setSelectedClipId(null);
			nextZoomIdRef.current = deriveNextId(
				"zoom",
				editor.zoomRegions.map((r) => r.id),
			);
			nextClipIdRef.current = deriveNextId(
				"clip",
				editor.clipRegions.map((r) => r.id),
			);
		},
		[resetAnnotationAudioForProject],
	);

	return {
		// State
		zoomRegions,
		setZoomRegions,
		trimRegions,
		clipRegions,
		setClipRegions,
		annotationRegions,
		setAnnotationRegions,
		audioRegions,
		setAudioRegions,
		// Selections
		selectedZoomId,
		setSelectedZoomId,
		selectedClipId,
		setSelectedClipId,
		selectedAnnotationId,
		setSelectedAnnotationId,
		selectedAudioId,
		setSelectedAudioId,
		// Refs
		nextZoomIdRef,
		nextClipIdRef,
		nextAnnotationIdRef,
		nextAnnotationZIndexRef,
		nextAudioIdRef,
		clipInitializedRef,
		autoSuggestedVideoPathRef,
		pendingFreshRecordingAutoZoomPathRef,
		// Derived
		effectiveZoomRegions,
		effectiveSpeedRegions,
		mapTimelineTimeToSourceTime,
		mapSourceTimeToTimelineTime,
		timelinePlayheadTime,
		// Zoom
		handleZoomAdded,
		handleZoomSuggested,
		handleZoomSpanChange,
		handleZoomDelete,
		handleZoomFocusChange,
		handleZoomDepthChange,
		handleZoomModeChange,
		handleSelectZoom,
		// Clip
		handleSelectClip,
		handleClipSplit,
		handleClipSpanChange,
		handleClipSpeedChange,
		handleClipMutedChange,
		handleClipDelete,
		// Annotation
		handleSelectAnnotation,
		handleAnnotationAdded,
		handleAnnotationSpanChange,
		handleAnnotationDelete,
		handleAnnotationContentChange,
		handleAnnotationTypeChange,
		handleAnnotationStyleChange,
		handleAnnotationFigureDataChange,
		handleAnnotationBlurIntensityChange,
		handleAnnotationBlurColorChange,
		handleAnnotationPositionChange,
		handleAnnotationSizeChange,
		// Audio
		handleSelectAudio,
		handleAudioAdded,
		handleAudioSpanChange,
		handleAudioDelete,
		// Project reset
		resetForProject,
	};
}
