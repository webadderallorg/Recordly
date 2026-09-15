import type { Span } from "dnd-timeline";
import { type Dispatch, type MutableRefObject, type SetStateAction, useCallback } from "react";
import { placeSpanAfter } from "../timeline/hooks/utils/timelineDuplicateUtils";
import type { AudioRegion, EditorEffectSection } from "../types";

interface UseAudioRegionCommandsParams {
	setAudioRegions: Dispatch<SetStateAction<AudioRegion[]>>;
	selectedAudioId: string | null;
	setSelectedAudioId: Dispatch<SetStateAction<string | null>>;
	setSelectedZoomId: Dispatch<SetStateAction<string | null>>;
	setSelectedAnnotationId: Dispatch<SetStateAction<string | null>>;
	setSelectedCaptionId: Dispatch<SetStateAction<string | null>>;
	setActiveEffectSection: Dispatch<SetStateAction<EditorEffectSection>>;
	nextAudioIdRef: MutableRefObject<number>;
}

export function useAudioRegionCommands({
	setAudioRegions,
	selectedAudioId,
	setSelectedAudioId,
	setSelectedZoomId,
	setSelectedAnnotationId,
	setSelectedCaptionId,
	setActiveEffectSection,
	nextAudioIdRef,
}: UseAudioRegionCommandsParams) {
	const handleSelectAudio = useCallback(
		(id: string | null) => {
			setSelectedAudioId(id);
			if (id) {
				setSelectedZoomId(null);
				setSelectedAnnotationId(null);
				setSelectedCaptionId(null);
				setActiveEffectSection("audio");
			}
		},
		[
			setActiveEffectSection,
			setSelectedAnnotationId,
			setSelectedAudioId,
			setSelectedCaptionId,
			setSelectedZoomId,
		],
	);

	const handleAudioAdded = useCallback(
		(span: Span, audioPath: string, trackIndex?: number) => {
			const id = `audio-${nextAudioIdRef.current++}`;
			const newRegion: AudioRegion = {
				id,
				startMs: Math.round(span.start),
				endMs: Math.round(span.end),
				audioPath,
				volume: 1,
				normalize: false,
				trackIndex,
			};
			setAudioRegions((current) => [...current, newRegion]);
			setSelectedAudioId(id);
			setSelectedZoomId(null);
			setSelectedAnnotationId(null);
			setSelectedCaptionId(null);
			setActiveEffectSection("audio");
		},
		[
			nextAudioIdRef,
			setActiveEffectSection,
			setAudioRegions,
			setSelectedAnnotationId,
			setSelectedAudioId,
			setSelectedCaptionId,
			setSelectedZoomId,
		],
	);

	const handleAudioSpanChange = useCallback(
		(id: string, span: Span, trackIndex?: number) => {
			const normalizedTrackIndex =
				typeof trackIndex === "number" && Number.isFinite(trackIndex)
					? Math.max(0, Math.floor(trackIndex))
					: undefined;
			setAudioRegions((current) =>
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
		[setAudioRegions],
	);

	const handleAudioVolumeChange = useCallback(
		(volume: number) => {
			if (!selectedAudioId || !Number.isFinite(volume)) return;
			const nextVolume = Math.max(0, Math.min(1, volume));
			setAudioRegions((current) =>
				current.map((region) =>
					region.id === selectedAudioId ? { ...region, volume: nextVolume } : region,
				),
			);
		},
		[selectedAudioId, setAudioRegions],
	);

	const handleAudioDelete = useCallback(
		(id: string) => {
			setAudioRegions((current) => current.filter((region) => region.id !== id));
			if (selectedAudioId === id) setSelectedAudioId(null);
		},
		[selectedAudioId, setAudioRegions, setSelectedAudioId],
	);

	const handleAudioDuplicate = useCallback(
		(id: string, totalMs: number): boolean => {
			let createdId: string | null = null;
			setAudioRegions((current) => {
				const source = current.find((region) => region.id === id);
				if (!source) return current;

				const placed = placeSpanAfter(source, totalMs);
				if (!placed) return current;

				createdId = `audio-${nextAudioIdRef.current++}`;
				return [
					...current,
					{
						...source,
						id: createdId,
						startMs: placed.startMs,
						endMs: placed.endMs,
					},
				];
			});

			if (!createdId) return false;
			setSelectedAudioId(createdId);
			setSelectedZoomId(null);
			setSelectedAnnotationId(null);
			setSelectedCaptionId(null);
			setActiveEffectSection("audio");
			return true;
		},
		[
			nextAudioIdRef,
			setActiveEffectSection,
			setAudioRegions,
			setSelectedAnnotationId,
			setSelectedAudioId,
			setSelectedCaptionId,
			setSelectedZoomId,
		],
	);

	const handleAudioNormalizeChange = useCallback(
		(normalize: boolean) => {
			if (!selectedAudioId) return;
			setAudioRegions((current) =>
				current.map((region) =>
					region.id === selectedAudioId ? { ...region, normalize } : region,
				),
			);
		},
		[selectedAudioId, setAudioRegions],
	);

	return {
		handleSelectAudio,
		handleAudioAdded,
		handleAudioSpanChange,
		handleAudioVolumeChange,
		handleAudioDelete,
		handleAudioDuplicate,
		handleAudioNormalizeChange,
	};
}
