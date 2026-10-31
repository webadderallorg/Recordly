import type { Span } from "dnd-timeline";
import { type Dispatch, type MutableRefObject, type SetStateAction, useCallback } from "react";
import {
	clampFocusToDepth,
	DEFAULT_AUTO_ZOOM_DEPTH,
	DEFAULT_ZOOM_DEPTH,
	type EditorEffectSection,
	type ZoomDepth,
	type ZoomFocus,
	type ZoomMode,
	type ZoomRegion,
} from "../types";

interface UseZoomRegionCommandsParams {
	setSelectedClipId: Dispatch<SetStateAction<string | null>>;
	videoPath: string | null;
	setZoomRegions: Dispatch<SetStateAction<ZoomRegion[]>>;
	selectedZoomId: string | null;
	setSelectedZoomId: Dispatch<SetStateAction<string | null>>;
	setSelectedAnnotationId: Dispatch<SetStateAction<string | null>>;
	setSelectedAudioId: Dispatch<SetStateAction<string | null>>;
	setSelectedCaptionId: Dispatch<SetStateAction<string | null>>;
	setActiveEffectSection: Dispatch<SetStateAction<EditorEffectSection>>;
	nextZoomIdRef: MutableRefObject<number>;
	autoSuggestedVideoPathRef: MutableRefObject<string | null>;
	pendingFreshRecordingAutoZoomPathRef: MutableRefObject<string | null>;
}

export function useZoomRegionCommands({
	setSelectedClipId,
	videoPath,
	setZoomRegions,
	selectedZoomId,
	setSelectedZoomId,
	setSelectedAnnotationId,
	setSelectedAudioId,
	setSelectedCaptionId,
	setActiveEffectSection,
	nextZoomIdRef,
	autoSuggestedVideoPathRef,
	pendingFreshRecordingAutoZoomPathRef,
}: UseZoomRegionCommandsParams) {
	const handleSelectZoom = useCallback(
		(id: string | null) => {
			setSelectedZoomId(id);
			if (id) {
				setActiveEffectSection("zoom");
				setSelectedAnnotationId(null);
				setSelectedClipId(null);
				setSelectedAudioId(null);
				setSelectedCaptionId(null);
			} else {
				setActiveEffectSection((section) => (section === "zoom" ? "scene" : section));
			}
		},
		[
			setActiveEffectSection,
			setSelectedAnnotationId,
			setSelectedClipId,
			setSelectedAudioId,
			setSelectedCaptionId,
			setSelectedZoomId,
		],
	);

	const markFreshRecordingSuggestion = useCallback(() => {
		if (videoPath && pendingFreshRecordingAutoZoomPathRef.current === videoPath) {
			autoSuggestedVideoPathRef.current = videoPath;
			pendingFreshRecordingAutoZoomPathRef.current = null;
		}
	}, [autoSuggestedVideoPathRef, pendingFreshRecordingAutoZoomPathRef, videoPath]);

	const handleZoomAdded = useCallback(
		(span: Span) => {
			const id = `zoom-${nextZoomIdRef.current++}`;
			const depth = DEFAULT_ZOOM_DEPTH;
			const newRegion: ZoomRegion = {
				id,
				startMs: Math.round(span.start),
				endMs: Math.round(span.end),
				depth,
				focus: clampFocusToDepth({ cx: 0.5, cy: 0.5 }, depth),
				// Mode describes camera tracking behavior, not how the region was created.
				mode: "auto",
			};
			markFreshRecordingSuggestion();
			setZoomRegions((current) => [...current, newRegion]);
			setSelectedZoomId(id);
			setSelectedAnnotationId(null);
			setSelectedClipId(null);
			setSelectedCaptionId(null);
		},
		[
			markFreshRecordingSuggestion,
			nextZoomIdRef,
			setSelectedAnnotationId,
			setSelectedClipId,
			setSelectedCaptionId,
			setSelectedZoomId,
			setZoomRegions,
		],
	);

	const handleZoomSuggested = useCallback(
		(span: Span, focus: ZoomFocus) => {
			const newRegion: ZoomRegion = {
				id: `zoom-${nextZoomIdRef.current++}`,
				startMs: Math.round(span.start),
				endMs: Math.round(span.end),
				depth: DEFAULT_AUTO_ZOOM_DEPTH,
				focus: clampFocusToDepth(focus, DEFAULT_AUTO_ZOOM_DEPTH),
				mode: "auto",
			};
			markFreshRecordingSuggestion();
			setZoomRegions((current) => [...current, newRegion]);
		},
		[markFreshRecordingSuggestion, nextZoomIdRef, setZoomRegions],
	);

	const handleZoomSpanChange = useCallback(
		(id: string, span: Span) => {
			setZoomRegions((current) =>
				current.map((region) =>
					region.id === id
						? {
								...region,
								startMs: Math.round(span.start),
								endMs: Math.round(span.end),
							}
						: region,
				),
			);
		},
		[setZoomRegions],
	);
	const handleZoomFocusChange = useCallback(
		(id: string, focus: ZoomFocus) => {
			setZoomRegions((current) =>
				current.map((region) =>
					region.id === id
						? { ...region, focus: clampFocusToDepth(focus, region.depth) }
						: region,
				),
			);
		},
		[setZoomRegions],
	);
	const handleZoomDepthChange = useCallback(
		(depth: ZoomDepth) => {
			if (!selectedZoomId) return;
			setZoomRegions((current) =>
				current.map((region) =>
					region.id === selectedZoomId
						? { ...region, depth, focus: clampFocusToDepth(region.focus, depth) }
						: region,
				),
			);
		},
		[selectedZoomId, setZoomRegions],
	);
	const handleZoomModeChange = useCallback(
		(mode: ZoomMode) => {
			if (!selectedZoomId) return;
			setZoomRegions((current) =>
				current.map((region) =>
					region.id === selectedZoomId ? { ...region, mode } : region,
				),
			);
		},
		[selectedZoomId, setZoomRegions],
	);
	const handleZoomDelete = useCallback(
		(id: string) => {
			setZoomRegions((current) => current.filter((region) => region.id !== id));
			if (selectedZoomId === id) setSelectedZoomId(null);
		},
		[selectedZoomId, setSelectedZoomId, setZoomRegions],
	);

	return {
		handleSelectZoom,
		handleZoomAdded,
		handleZoomSuggested,
		handleZoomSpanChange,
		handleZoomFocusChange,
		handleZoomDepthChange,
		handleZoomModeChange,
		handleZoomDelete,
	};
}
