import type { ProjectEditorState } from "./projectPersistenceTypes";
import { clamp, isFiniteNumber } from "./projectPersistenceUtils";
import {
	type AnnotationRegion,
	type AudioRegion,
	DEFAULT_ANNOTATION_POSITION,
	DEFAULT_ANNOTATION_SIZE,
	DEFAULT_ANNOTATION_STYLE,
	DEFAULT_FIGURE_DATA,
} from "./types";

export function normalizeProjectOverlayRegions(editor: Partial<ProjectEditorState>) {
	const normalizedAnnotationRegions: AnnotationRegion[] = Array.isArray(editor.annotationRegions)
		? editor.annotationRegions
				.filter((region): region is AnnotationRegion =>
					Boolean(region && typeof region.id === "string"),
				)
				.map((region, index) => {
					const rawStart = isFiniteNumber(region.startMs)
						? Math.round(region.startMs)
						: 0;
					const rawEnd = isFiniteNumber(region.endMs)
						? Math.round(region.endMs)
						: rawStart + 1000;
					const startMs = Math.max(0, Math.min(rawStart, rawEnd));
					const endMs = Math.max(startMs + 1, rawEnd);

					return {
						id: region.id,
						startMs,
						endMs,
						type:
							region.type === "image" ||
							region.type === "figure" ||
							region.type === "blur"
								? region.type
								: "text",
						content: typeof region.content === "string" ? region.content : "",
						textContent:
							typeof region.textContent === "string" ? region.textContent : undefined,
						imageContent:
							typeof region.imageContent === "string"
								? region.imageContent
								: undefined,
						position: {
							x: isFiniteNumber(region.position?.x)
								? region.position.x
								: DEFAULT_ANNOTATION_POSITION.x,
							y: isFiniteNumber(region.position?.y)
								? region.position.y
								: DEFAULT_ANNOTATION_POSITION.y,
						},
						size: {
							width: clamp(
								isFiniteNumber(region.size?.width)
									? region.size.width
									: DEFAULT_ANNOTATION_SIZE.width,
								1,
								10000,
							),
							height: clamp(
								isFiniteNumber(region.size?.height)
									? region.size.height
									: DEFAULT_ANNOTATION_SIZE.height,
								1,
								10000,
							),
						},
						style: {
							...DEFAULT_ANNOTATION_STYLE,
							...(region.style && typeof region.style === "object"
								? region.style
								: {}),
						},
						zIndex: isFiniteNumber(region.zIndex) ? region.zIndex : index + 1,
						figureData: region.figureData
							? {
									...DEFAULT_FIGURE_DATA,
									...region.figureData,
								}
							: undefined,
						blurIntensity: isFiniteNumber(region.blurIntensity)
							? clamp(region.blurIntensity, 1, 100)
							: 20,
						blurColor:
							typeof region.blurColor === "string" ? region.blurColor : undefined,
						trackIndex: isFiniteNumber(region.trackIndex)
							? Math.max(0, Math.floor(region.trackIndex))
							: 0,
					};
				})
		: [];

	const normalizedAudioRegions: AudioRegion[] = Array.isArray(
		(editor as Partial<ProjectEditorState>).audioRegions,
	)
		? ((editor as Partial<ProjectEditorState>).audioRegions as AudioRegion[])
				.filter((region): region is AudioRegion =>
					Boolean(region && typeof region.id === "string"),
				)
				.map((region) => {
					const rawStart = isFiniteNumber(region.startMs)
						? Math.round(region.startMs)
						: 0;
					const rawEnd = isFiniteNumber(region.endMs)
						? Math.round(region.endMs)
						: rawStart + 1000;
					const startMs = Math.max(0, Math.min(rawStart, rawEnd));
					const endMs = Math.max(startMs + 1, rawEnd);

					return {
						id: region.id,
						startMs,
						endMs,
						audioPath: typeof region.audioPath === "string" ? region.audioPath : "",
						volume: isFiniteNumber(region.volume) ? clamp(region.volume, 0, 1) : 1,
						normalize: Boolean(region.normalize),
						trackIndex: isFiniteNumber(region.trackIndex)
							? Math.max(0, Math.floor(region.trackIndex))
							: 0,
					};
				})
		: [];
	return { normalizedAnnotationRegions, normalizedAudioRegions };
}
