import type { Span } from "dnd-timeline";
import { type Dispatch, type RefObject, type SetStateAction, useCallback } from "react";
import {
	type CaptionEditTarget,
	normalizeCaptionEditText,
	normalizeCaptionWords,
	updateCaptionCuesForEditedTarget,
} from "../captionEditing";
import {
	addCue,
	type CaptionRetimeSpan,
	createCaptionCue,
	deleteCue,
	mergeCues,
	retimeCue,
	splitCue,
	toggleCaptionWordEmphasis,
} from "../captionOps";
import type { AutoCaptionSettings, CaptionCue, EditorEffectSection } from "../types";
import type { VideoPlaybackRef } from "../VideoPlayback";

interface UseCaptionCommandsParams {
	autoCaptions: CaptionCue[];
	setAutoCaptions: Dispatch<SetStateAction<CaptionCue[]>>;
	setAutoCaptionSettings: Dispatch<SetStateAction<AutoCaptionSettings>>;
	setSelectedCaptionId: Dispatch<SetStateAction<string | null>>;
	setSelectedZoomId: Dispatch<SetStateAction<string | null>>;
	setSelectedClipId: Dispatch<SetStateAction<string | null>>;
	setSelectedAnnotationId: Dispatch<SetStateAction<string | null>>;
	setSelectedAudioId: Dispatch<SetStateAction<string | null>>;
	setActiveEffectSection: Dispatch<SetStateAction<EditorEffectSection>>;
	videoPlaybackRef: RefObject<VideoPlaybackRef>;
	mapSourceTimeToTimelineTime: (timeMs: number) => number;
	mapTimelineTimeToSourceTime: (timeMs: number) => number;
	handleSeek: (time: number, options?: { pause?: boolean }) => void;
}

export function useCaptionCommands({
	autoCaptions,
	setAutoCaptions,
	setAutoCaptionSettings,
	setSelectedCaptionId,
	setSelectedZoomId,
	setSelectedClipId,
	setSelectedAnnotationId,
	setSelectedAudioId,
	setActiveEffectSection,
	videoPlaybackRef,
	mapSourceTimeToTimelineTime,
	mapTimelineTimeToSourceTime,
	handleSeek,
}: UseCaptionCommandsParams) {
	const handleSelectCaption = useCallback(
		(id: string | null) => {
			setSelectedCaptionId(id);
			if (!id) {
				setActiveEffectSection((section) => (section === "caption" ? "scene" : section));
				return;
			}
			setActiveEffectSection("caption");
			setSelectedZoomId(null);
			setSelectedClipId(null);
			setSelectedAnnotationId(null);
			setSelectedAudioId(null);
			const cue = autoCaptions.find((value) => value.id === id);
			if (cue) {
				handleSeek(mapSourceTimeToTimelineTime(cue.startMs) / 1000, { pause: true });
			}
		},
		[
			autoCaptions,
			handleSeek,
			mapSourceTimeToTimelineTime,
			setActiveEffectSection,
			setSelectedAnnotationId,
			setSelectedAudioId,
			setSelectedCaptionId,
			setSelectedClipId,
			setSelectedZoomId,
		],
	);

	const handleBeginCaptionEdit = useCallback(
		(id: string) => {
			videoPlaybackRef.current?.cancelCaptionEdit();
			setSelectedCaptionId(id);
		},
		[setSelectedCaptionId, videoPlaybackRef],
	);

	const handleCaptionTextEdit = useCallback(
		(id: string, text: string) => {
			setAutoCaptions((captions) => {
				const cue = captions.find((value) => value.id === id);
				if (!cue) return captions;

				const words = normalizeCaptionWords(cue);
				if (words.length === 0) {
					const normalized = normalizeCaptionEditText(text);
					return captions.map((value) =>
						value.id === id ? { ...value, text: normalized } : value,
					);
				}

				const target: CaptionEditTarget = {
					id: cue.id,
					startMs: cue.startMs,
					endMs: cue.endMs,
					text: cue.text,
					words: words.map((word, index) => ({
						cueId: cue.id,
						cueWordIndex: index,
						startMs: word.startMs,
						endMs: word.endMs,
						text: word.text,
						leadingSpace: Boolean(word.leadingSpace),
					})),
				};
				return updateCaptionCuesForEditedTarget(captions, target, text);
			});
		},
		[setAutoCaptions],
	);

	const cancelEdit = useCallback(
		() => videoPlaybackRef.current?.cancelCaptionEdit(),
		[videoPlaybackRef],
	);
	const handleCaptionRetime = useCallback(
		(id: string, span: CaptionRetimeSpan) => {
			cancelEdit();
			setAutoCaptions((captions) => retimeCue(captions, id, span));
		},
		[cancelEdit, setAutoCaptions],
	);
	const handleCaptionSplit = useCallback(
		(id: string, atMs: number) => {
			cancelEdit();
			setAutoCaptions((captions) => splitCue(captions, id, atMs));
		},
		[cancelEdit, setAutoCaptions],
	);
	const handleCaptionMerge = useCallback(
		(idA: string, idB: string) => {
			cancelEdit();
			setAutoCaptions((captions) => mergeCues(captions, idA, idB));
		},
		[cancelEdit, setAutoCaptions],
	);
	const handleCaptionWordEmphasisToggle = useCallback(
		(id: string, wordIndex: number) => {
			setAutoCaptions((captions) => toggleCaptionWordEmphasis(captions, id, wordIndex));
		},
		[setAutoCaptions],
	);
	const handleCaptionDelete = useCallback(
		(id: string) => {
			cancelEdit();
			setSelectedCaptionId((current) => (current === id ? null : current));
			setAutoCaptions((captions) => deleteCue(captions, id));
		},
		[cancelEdit, setAutoCaptions, setSelectedCaptionId],
	);

	const handleCaptionAdded = useCallback(
		(span: Span) => {
			cancelEdit();
			const newCue = createCaptionCue({
				startMs: mapTimelineTimeToSourceTime(span.start),
				endMs: mapTimelineTimeToSourceTime(span.end),
			});
			setAutoCaptions((captions) => addCue(captions, newCue));
			setSelectedCaptionId(newCue.id);
			setActiveEffectSection("caption");
			setSelectedZoomId(null);
			setSelectedClipId(null);
			setSelectedAnnotationId(null);
			setSelectedAudioId(null);
			handleSeek(span.start / 1000, { pause: true });
		},
		[
			cancelEdit,
			handleSeek,
			mapTimelineTimeToSourceTime,
			setActiveEffectSection,
			setAutoCaptions,
			setSelectedAnnotationId,
			setSelectedAudioId,
			setSelectedCaptionId,
			setSelectedClipId,
			setSelectedZoomId,
		],
	);

	const handleClearAutoCaptions = useCallback(() => {
		setAutoCaptions([]);
		setAutoCaptionSettings((current) => ({ ...current, enabled: false }));
	}, [setAutoCaptionSettings, setAutoCaptions]);

	return {
		handleSelectCaption,
		handleBeginCaptionEdit,
		handleCaptionTextEdit,
		handleCaptionRetime,
		handleCaptionSplit,
		handleCaptionMerge,
		handleCaptionDelete,
		handleCaptionWordEmphasisToggle,
		handleCaptionAdded,
		handleClearAutoCaptions,
	};
}
