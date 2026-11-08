import { useEffect, useSyncExternalStore } from "react";
import { AnnotationOverlay } from "../AnnotationOverlay";
import { isAnnotationActiveAtTime } from "./annotationVisibility";
import type { PlaybackViewInput } from "./PlaybackView";

type Props = Pick<
	PlaybackViewInput,
	| "annotationFrameStore"
	| "clipPlaybackRef"
	| "annotationRegions"
	| "overlayRef"
	| "annotationRecordingRect"
	| "onSelectAnnotation"
	| "selectedAnnotationId"
	| "onAnnotationPositionChange"
	| "onAnnotationSizeChange"
	| "onAnnotationContentChange"
	| "onAnnotationDelete"
>;

export function PlaybackAnnotations({
	annotationFrameStore,
	clipPlaybackRef,
	annotationRegions,
	overlayRef,
	annotationRecordingRect,
	onSelectAnnotation,
	selectedAnnotationId,
	onAnnotationPositionChange,
	onAnnotationSizeChange,
	onAnnotationContentChange,
	onAnnotationDelete,
}: Props) {
	const annotationFrame = useSyncExternalStore(
		annotationFrameStore.subscribe,
		annotationFrameStore.getSnapshot,
	);
	const timeMs = annotationFrame.timeMs;
	const filtered = (annotationRegions || []).filter((annotation) =>
		isAnnotationActiveAtTime(annotation, timeMs),
	);

	const sorted = [...filtered].sort((a, b) => a.zIndex - b.zIndex);

	const selected = filtered.find((annotation) => annotation.id === selectedAnnotationId);
	useEffect(() => {
		if (!selected) return;
		const handleKeyDown = (event: KeyboardEvent) => {
			const target = event.target as HTMLElement | null;
			if (
				event.defaultPrevented ||
				target?.isContentEditable ||
				event.isComposing ||
				event.altKey ||
				event.ctrlKey ||
				event.metaKey ||
				target?.closest(
					"input, textarea, select, [contenteditable='true'], [role='slider'], [role='combobox'], [role='menu'], [role='dialog']",
				)
			)
				return;
			if (event.key === "Escape") {
				event.preventDefault();
				onSelectAnnotation?.(null);
				return;
			}
			if ((event.key === "Delete" || event.key === "Backspace") && onAnnotationDelete) {
				event.preventDefault();
				onAnnotationDelete(selected.id);
				return;
			}
			const step = event.shiftKey ? 5 : 1;
			const dx = event.key === "ArrowRight" ? step : event.key === "ArrowLeft" ? -step : 0;
			const dy = event.key === "ArrowDown" ? step : event.key === "ArrowUp" ? -step : 0;
			if (!dx && !dy) return;
			event.preventDefault();
			onAnnotationPositionChange?.(selected.id, {
				x: Math.max(
					-selected.size.width / 2,
					Math.min(100 - selected.size.width / 2, selected.position.x + dx),
				),
				y: Math.max(
					-selected.size.height / 2,
					Math.min(100 - selected.size.height / 2, selected.position.y + dy),
				),
			});
		};
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [selected, onSelectAnnotation, onAnnotationPositionChange, onAnnotationDelete]);

	const handleAnnotationClick = (clickedId: string) => {
		if (!onSelectAnnotation) return;

		onSelectAnnotation(clickedId);
	};

	return sorted.map((annotation) => (
		<AnnotationOverlay
			key={annotation.id}
			annotation={annotation}
			isSelected={annotation.id === selectedAnnotationId}
			containerWidth={annotationRecordingRect.width || overlayRef.current?.clientWidth || 800}
			containerHeight={
				annotationRecordingRect.height || overlayRef.current?.clientHeight || 600
			}
			recordingRect={{
				x: annotationRecordingRect.x,
				y: annotationRecordingRect.y,
				width: annotationRecordingRect.width || overlayRef.current?.clientWidth || 800,
				height: annotationRecordingRect.height || overlayRef.current?.clientHeight || 600,
			}}
			sceneTransform={annotationFrame.transform}
			onPositionChange={(id, position) => onAnnotationPositionChange?.(id, position)}
			onSizeChange={(id, size) => onAnnotationSizeChange?.(id, size)}
			onClick={handleAnnotationClick}
			onContentChange={onAnnotationContentChange}
			onDelete={onAnnotationDelete}
			onTextEditStart={() => clipPlaybackRef.current?.pause()}
			zIndex={annotation.zIndex}
			isSelectedBoost={annotation.id === selectedAnnotationId}
		/>
	));
}
