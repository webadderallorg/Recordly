import { useScopedT } from "@/contexts/I18nContext";
import type { Span } from "dnd-timeline";
import { type Dispatch, type MutableRefObject, type SetStateAction, useCallback } from "react";
import {
	type AnnotationRegion,
	DEFAULT_ANNOTATION_POSITION,
	DEFAULT_ANNOTATION_SIZE,
	DEFAULT_ANNOTATION_STYLE,
	DEFAULT_FIGURE_DATA,
	type FigureData,
} from "../types";

interface UseAnnotationRegionCommandsParams {
	onSelectAnnotation: (id: string | null) => void;
	setAnnotationRegions: Dispatch<SetStateAction<AnnotationRegion[]>>;
	selectedAnnotationId: string | null;
	setSelectedAnnotationId: Dispatch<SetStateAction<string | null>>;
	setSelectedZoomId: Dispatch<SetStateAction<string | null>>;
	nextAnnotationIdRef: MutableRefObject<number>;
	nextAnnotationZIndexRef: MutableRefObject<number>;
}

export function useAnnotationRegionCommands({
	onSelectAnnotation,
	setAnnotationRegions,
	selectedAnnotationId,
	setSelectedAnnotationId,
	setSelectedZoomId,
	nextAnnotationIdRef,
	nextAnnotationZIndexRef,
}: UseAnnotationRegionCommandsParams) {
	const te = useScopedT("editing");
	const handleAnnotationAdded = useCallback(
		(
			span: Span,
			trackIndex = 0,
			type: AnnotationRegion["type"] = "text",
			placement?: Pick<AnnotationRegion, "position" | "size">,
		) => {
			const id = `annotation-${nextAnnotationIdRef.current++}`;
			const newRegion: AnnotationRegion = {
				id,
				startMs: Math.round(span.start),
				endMs: Math.round(span.end),
				type,
				content: type === "text" ? te("enterText", "Enter text...") : "",
				position: { ...(placement?.position ?? DEFAULT_ANNOTATION_POSITION) },
				size: { ...(placement?.size ?? DEFAULT_ANNOTATION_SIZE) },
				style: { ...DEFAULT_ANNOTATION_STYLE },
				zIndex: nextAnnotationZIndexRef.current++,
				trackIndex,
				...(type === "figure" ? { figureData: { ...DEFAULT_FIGURE_DATA } } : {}),
				...(type === "blur" ? { blurIntensity: 20 } : {}),
			};
			setAnnotationRegions((current) => [...current, newRegion]);
			onSelectAnnotation(id);
			setSelectedZoomId(null);
		},
		[
			te,
			onSelectAnnotation,
			nextAnnotationIdRef,
			nextAnnotationZIndexRef,
			setAnnotationRegions,
			setSelectedZoomId,
		],
	);

	const handleAnnotationSpanChange = useCallback(
		(id: string, span: Span, trackIndex?: number) => {
			const normalizedTrackIndex =
				typeof trackIndex === "number" && Number.isFinite(trackIndex)
					? Math.max(0, Math.floor(trackIndex))
					: undefined;
			setAnnotationRegions((current) =>
				current.map((region) =>
					region.id === id
						? {
								...region,
								startMs: Math.round(span.start),
								endMs: Math.round(span.end),
								...(normalizedTrackIndex === undefined
									? {}
									: { trackIndex: normalizedTrackIndex }),
							}
						: region,
				),
			);
		},
		[setAnnotationRegions],
	);

	const handleAnnotationDelete = useCallback(
		(id: string) => {
			setAnnotationRegions((current) => current.filter((region) => region.id !== id));
			if (selectedAnnotationId === id) setSelectedAnnotationId(null);
		},
		[selectedAnnotationId, setAnnotationRegions, setSelectedAnnotationId],
	);

	const handleAnnotationContentChange = useCallback(
		(id: string, content: string) => {
			setAnnotationRegions((current) =>
				current.map((region) => {
					if (region.id !== id) return region;
					if (region.type === "text") return { ...region, content, textContent: content };
					if (region.type === "image")
						return { ...region, content, imageContent: content };
					return { ...region, content };
				}),
			);
		},
		[setAnnotationRegions],
	);

	const handleAnnotationTypeChange = useCallback(
		(id: string, type: AnnotationRegion["type"]) => {
			setAnnotationRegions((current) =>
				current.map((region) => {
					if (region.id !== id) return region;
					const updated = { ...region, type };
					if (type === "text")
						updated.content = region.textContent || te("enterText", "Enter text...");
					else if (type === "image") updated.content = region.imageContent || "";
					else if (type === "figure") {
						updated.content = "";
						if (!region.figureData) updated.figureData = { ...DEFAULT_FIGURE_DATA };
					} else if (type === "blur") {
						updated.content = "";
						if (region.blurIntensity === undefined) updated.blurIntensity = 20;
					}
					return updated;
				}),
			);
		},
		[setAnnotationRegions, te],
	);

	const updateRegion = useCallback(
		(id: string, patch: Partial<AnnotationRegion>) => {
			setAnnotationRegions((current) =>
				current.map((region) => (region.id === id ? { ...region, ...patch } : region)),
			);
		},
		[setAnnotationRegions],
	);

	const handleAnnotationStyleChange = useCallback(
		(id: string, style: Partial<AnnotationRegion["style"]>) => {
			setAnnotationRegions((current) =>
				current.map((region) => {
					if (region.id !== id) return region;
					const fontScale =
						region.type === "text" &&
						style.fontSize !== undefined &&
						Number.isFinite(style.fontSize) &&
						style.fontSize > 0 &&
						region.style.fontSize > 0
							? style.fontSize / region.style.fontSize
							: 1;
					return {
						...region,
						style: { ...region.style, ...style },
						...(fontScale !== 1
							? {
									size: {
										width: region.size.width * fontScale,
										height: region.size.height * fontScale,
									},
									position: {
										x:
											region.position.x +
											(region.size.width * (1 - fontScale)) / 2,
										y: region.position.y,
									},
								}
							: {}),
					};
				}),
			);
		},
		[setAnnotationRegions],
	);
	const handleAnnotationFigureDataChange = useCallback(
		(id: string, figureData: FigureData) => updateRegion(id, { figureData }),
		[updateRegion],
	);
	const handleAnnotationBlurIntensityChange = useCallback(
		(id: string, blurIntensity: number) => updateRegion(id, { blurIntensity }),
		[updateRegion],
	);
	const handleAnnotationBlurColorChange = useCallback(
		(id: string, blurColor: string) => updateRegion(id, { blurColor }),
		[updateRegion],
	);
	const handleAnnotationPositionChange = useCallback(
		(id: string, position: { x: number; y: number }) => updateRegion(id, { position }),
		[updateRegion],
	);
	const handleAnnotationSizeChange = useCallback(
		(id: string, size: { width: number; height: number }) => updateRegion(id, { size }),
		[updateRegion],
	);

	return {
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
	};
}
