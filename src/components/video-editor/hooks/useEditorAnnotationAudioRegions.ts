import type { Span } from "dnd-timeline";
import { useCallback, useRef, useState } from "react";
import { deriveNextId } from "../projectPersistence";
import {
	type AnnotationRegion,
	type AudioRegion,
	DEFAULT_ANNOTATION_POSITION,
	DEFAULT_ANNOTATION_SIZE,
	DEFAULT_ANNOTATION_STYLE,
	DEFAULT_FIGURE_DATA,
	type FigureData,
} from "../types";

interface UseEditorAnnotationAudioRegionsParams {
	setSelectedZoomId: (id: string | null) => void;
}

interface RegionProjectState {
	annotationRegions: AnnotationRegion[];
	audioRegions: AudioRegion[];
}

export function useEditorAnnotationAudioRegions({
	setSelectedZoomId,
}: UseEditorAnnotationAudioRegionsParams) {
	const [annotationRegions, setAnnotationRegions] = useState<AnnotationRegion[]>([]);
	const [audioRegions, setAudioRegions] = useState<AudioRegion[]>([]);
	const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);
	const [selectedAudioId, setSelectedAudioId] = useState<string | null>(null);

	const nextAnnotationIdRef = useRef(1);
	const nextAnnotationZIndexRef = useRef(1);
	const nextAudioIdRef = useRef(1);

	const handleSelectAnnotation = useCallback(
		(id: string | null) => {
			setSelectedAnnotationId(id);
			if (id) {
				setSelectedZoomId(null);
				setSelectedAudioId(null);
			}
		},
		[setSelectedZoomId],
	);

	const handleAnnotationAdded = useCallback((span: Span, trackIndex = 0) => {
		const id = `annotation-${nextAnnotationIdRef.current++}`;
		const zIndex = nextAnnotationZIndexRef.current++;
		const newRegion: AnnotationRegion = {
			id,
			startMs: Math.round(span.start),
			endMs: Math.round(span.end),
			type: "text",
			content: "Enter text...",
			position: { ...DEFAULT_ANNOTATION_POSITION },
			size: { ...DEFAULT_ANNOTATION_SIZE },
			style: { ...DEFAULT_ANNOTATION_STYLE },
			zIndex,
			trackIndex,
		};
		setAnnotationRegions((prev) => [...prev, newRegion]);
		setSelectedAnnotationId(id);
		setSelectedZoomId(null);
	}, [setSelectedZoomId]);

	const handleAnnotationSpanChange = useCallback((id: string, span: Span) => {
		setAnnotationRegions((prev) =>
			prev.map((region) =>
				region.id === id
					? { ...region, startMs: Math.round(span.start), endMs: Math.round(span.end) }
					: region,
			),
		);
	}, []);

	const handleAnnotationDelete = useCallback((id: string) => {
		setAnnotationRegions((prev) => prev.filter((region) => region.id !== id));
		setSelectedAnnotationId((current) => (current === id ? null : current));
	}, []);

	const handleAnnotationContentChange = useCallback((id: string, content: string) => {
		setAnnotationRegions((prev) =>
			prev.map((region) => {
				if (region.id !== id) return region;
				if (region.type === "text") return { ...region, content, textContent: content };
				if (region.type === "image") return { ...region, content, imageContent: content };
				return { ...region, content };
			}),
		);
	}, []);

	const handleAnnotationTypeChange = useCallback(
		(id: string, type: AnnotationRegion["type"]) => {
			setAnnotationRegions((prev) =>
				prev.map((region) => {
					if (region.id !== id) return region;
					const updated = { ...region, type };
					if (type === "text") updated.content = region.textContent || "Enter text...";
					else if (type === "image") updated.content = region.imageContent || "";
					else if (type === "figure") {
						updated.content = "";
						if (!region.figureData) {
							(updated as AnnotationRegion).figureData = { ...DEFAULT_FIGURE_DATA };
						}
					} else if (type === "blur") {
						updated.content = "";
						if (region.blurIntensity === undefined) {
							(updated as AnnotationRegion).blurIntensity = 20;
						}
					}
					return updated;
				}),
			);
		},
		[],
	);

	const handleAnnotationStyleChange = useCallback(
		(id: string, style: Partial<AnnotationRegion["style"]>) => {
			setAnnotationRegions((prev) =>
				prev.map((region) =>
					region.id === id ? { ...region, style: { ...region.style, ...style } } : region,
				),
			);
		},
		[],
	);

	const handleAnnotationFigureDataChange = useCallback((id: string, figureData: FigureData) => {
		setAnnotationRegions((prev) =>
			prev.map((region) => (region.id === id ? { ...region, figureData } : region)),
		);
	}, []);

	const handleAnnotationBlurIntensityChange = useCallback((id: string, blurIntensity: number) => {
		setAnnotationRegions((prev) =>
			prev.map((region) => (region.id === id ? { ...region, blurIntensity } : region)),
		);
	}, []);

	const handleAnnotationBlurColorChange = useCallback((id: string, blurColor: string) => {
		setAnnotationRegions((prev) =>
			prev.map((region) => (region.id === id ? { ...region, blurColor } : region)),
		);
	}, []);

	const handleAnnotationPositionChange = useCallback(
		(id: string, position: { x: number; y: number }) => {
			setAnnotationRegions((prev) =>
				prev.map((region) => (region.id === id ? { ...region, position } : region)),
			);
		},
		[],
	);

	const handleAnnotationSizeChange = useCallback(
		(id: string, size: { width: number; height: number }) => {
			setAnnotationRegions((prev) =>
				prev.map((region) => (region.id === id ? { ...region, size } : region)),
			);
		},
		[],
	);

	const handleSelectAudio = useCallback(
		(id: string | null) => {
			setSelectedAudioId(id);
			if (id) {
				setSelectedZoomId(null);
				setSelectedAnnotationId(null);
			}
		},
		[setSelectedZoomId],
	);

	const handleAudioAdded = useCallback(
		(span: Span, audioPath: string, trackIndex?: number) => {
			const id = `audio-${nextAudioIdRef.current++}`;
			setAudioRegions((prev) => [
				...prev,
				{
					id,
					startMs: Math.round(span.start),
					endMs: Math.round(span.end),
					audioPath,
					volume: 1,
					trackIndex,
				},
			]);
			setSelectedAudioId(id);
			setSelectedZoomId(null);
			setSelectedAnnotationId(null);
		},
		[setSelectedZoomId],
	);

	const handleAudioSpanChange = useCallback((id: string, span: Span) => {
		setAudioRegions((prev) =>
			prev.map((region) =>
				region.id === id
					? { ...region, startMs: Math.round(span.start), endMs: Math.round(span.end) }
					: region,
			),
		);
	}, []);

	const handleAudioDelete = useCallback((id: string) => {
		setAudioRegions((prev) => prev.filter((region) => region.id !== id));
		setSelectedAudioId((current) => (current === id ? null : current));
	}, []);

	const resetAnnotationAudioForProject = useCallback((editor: RegionProjectState) => {
		setAnnotationRegions(editor.annotationRegions);
		setAudioRegions(editor.audioRegions);
		setSelectedAnnotationId(null);
		setSelectedAudioId(null);
		nextAnnotationIdRef.current = deriveNextId(
			"annotation",
			editor.annotationRegions.map((region) => region.id),
		);
		nextAudioIdRef.current = deriveNextId(
			"audio",
			editor.audioRegions.map((region) => region.id),
		);
		nextAnnotationZIndexRef.current =
			editor.annotationRegions.reduce((max, region) => Math.max(max, region.zIndex), 0) + 1;
	}, []);

	return {
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
	};
}