import type { Span } from "dnd-timeline";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import {
	type AnnotationRegion,
	type AudioRegion,
	type ClipRegion,
	type EditorEffectSection,
	getClipSourceStartMs,
	type ZoomRegion,
} from "../types";

interface UseEditorClipRegionsParams {
	totalMs: number;
	setActiveEffectSection: (
		section: EditorEffectSection | ((prev: EditorEffectSection) => EditorEffectSection),
	) => void;
	setSelectedZoomId: (id: string | null) => void;
	setSelectedAnnotationId: (id: string | null) => void;
	setSelectedAudioId: (id: string | null) => void;
	setZoomRegions: Dispatch<SetStateAction<ZoomRegion[]>>;
	setAnnotationRegions: Dispatch<SetStateAction<AnnotationRegion[]>>;
	setAudioRegions: Dispatch<SetStateAction<AudioRegion[]>>;
}

export function useEditorClipRegions({
	totalMs,
	setActiveEffectSection,
	setSelectedZoomId,
	setSelectedAnnotationId,
	setSelectedAudioId,
	setZoomRegions,
	setAnnotationRegions,
	setAudioRegions,
}: UseEditorClipRegionsParams) {
	const [clipRegions, setClipRegions] = useState<ClipRegion[]>([]);
	const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
	const nextClipIdRef = useRef(1);
	const clipInitializedRef = useRef(false);

	useEffect(() => {
		if (totalMs <= 0 || clipInitializedRef.current) return;
		if (clipRegions.length === 0) {
			const id = `clip-${nextClipIdRef.current++}`;
			setClipRegions([{ id, startMs: 0, endMs: totalMs, speed: 1 }]);
		}
		clipInitializedRef.current = true;
	}, [totalMs, clipRegions.length]);

	const handleSelectClip = useCallback(
		(id: string | null) => {
			setSelectedClipId(id);
			if (id) {
				setActiveEffectSection("clip");
				setSelectedZoomId(null);
				setSelectedAnnotationId(null);
				setSelectedAudioId(null);
			} else {
				setActiveEffectSection((section) => (section === "clip" ? "scene" : section));
			}
		},
		[
			setActiveEffectSection,
			setSelectedAnnotationId,
			setSelectedAudioId,
			setSelectedZoomId,
		],
	);

	const handleClipSplit = useCallback(
		(splitMs: number) => {
			setClipRegions((prev) => {
				const target = prev.find((clip) => splitMs > clip.startMs && splitMs < clip.endMs);
				if (!target) return prev;
				const leftId = `clip-${nextClipIdRef.current++}`;
				const rightId = `clip-${nextClipIdRef.current++}`;
				const speed = Number.isFinite(target.speed) && target.speed > 0 ? target.speed : 1;
				const targetSourceStart = target.sourceStartMs ?? target.startMs;
				const splitOffset = Math.round(splitMs) - target.startMs;
				const rightSourceStart = Math.round(targetSourceStart + splitOffset * speed);
				const left: ClipRegion = {
					id: leftId,
					startMs: target.startMs,
					endMs: Math.round(splitMs),
					speed: target.speed,
					muted: target.muted,
					sourceStartMs: target.sourceStartMs,
				};
				const right: ClipRegion = {
					id: rightId,
					startMs: Math.round(splitMs),
					endMs: target.endMs,
					speed: target.speed,
					muted: target.muted,
					sourceStartMs: rightSourceStart,
				};
				if (selectedClipId === target.id) setSelectedClipId(leftId);
				return prev.flatMap((clip) => (clip.id === target.id ? [left, right] : [clip]));
			});
		},
		[selectedClipId],
	);

	const handleClipSpanChange = useCallback(
		(id: string, span: Span) => {
			const oldClip = clipRegions.find((clip) => clip.id === id);
			const newStart = Math.round(span.start);
			const newEnd = Math.round(span.end);

			if (oldClip) {
				const startDelta = newStart - oldClip.startMs;
				const endDelta = newEnd - oldClip.endMs;
				const isMove = Math.abs(startDelta - endDelta) < 1 && Math.abs(startDelta) > 0;
				if (isMove) {
					const delta = startDelta;
					const moveOverlapping = <T extends { startMs: number; endMs: number }>(
						regions: T[],
					): T[] =>
						regions.map((region) =>
							region.startMs >= oldClip.startMs && region.endMs <= oldClip.endMs
								? { ...region, startMs: region.startMs + delta, endMs: region.endMs + delta }
								: region,
						);
					setZoomRegions((prev) => moveOverlapping(prev));
					setAnnotationRegions((prev) => moveOverlapping(prev));
					setAudioRegions((prev) => moveOverlapping(prev));
				}
			}

			setClipRegions((prev) =>
				prev.map((clip) => {
					if (clip.id !== id) return clip;
					const updated: ClipRegion = { ...clip, startMs: newStart, endMs: newEnd };
					if (oldClip) {
						const startDelta = newStart - oldClip.startMs;
						const endDelta = newEnd - oldClip.endMs;
						const isMove =
							Math.abs(startDelta - endDelta) < 1 && Math.abs(startDelta) > 0;
						const sourceStart = getClipSourceStartMs(oldClip);
						const speed =
							Number.isFinite(oldClip.speed) && oldClip.speed > 0 ? oldClip.speed : 1;
						if (isMove) {
							updated.sourceStartMs = sourceStart;
						} else if (Math.abs(startDelta) > 0) {
							updated.sourceStartMs = Math.max(
								0,
								Math.round(sourceStart + startDelta * speed),
							);
						}
					}
					return updated;
				}),
			);

			const updatedClips = clipRegions.map((clip) =>
				clip.id === id ? { ...clip, startMs: newStart, endMs: newEnd } : clip,
			);
			const keepOverlapping = <T extends { startMs: number; endMs: number }>(
				regions: T[],
			): T[] =>
				regions.filter((region) =>
					updatedClips.some((clip) => region.startMs < clip.endMs && region.endMs > clip.startMs),
				);
			setZoomRegions((prev) => keepOverlapping(prev));
			setAnnotationRegions((prev) => keepOverlapping(prev));
			setAudioRegions((prev) => keepOverlapping(prev));
		},
		[clipRegions, setAnnotationRegions, setAudioRegions, setZoomRegions],
	);

	const handleClipSpeedChange = useCallback(
		(speed: number) => {
			if (!selectedClipId || !Number.isFinite(speed) || speed <= 0) return;
			const clip = clipRegions.find((region) => region.id === selectedClipId);
			if (!clip) return;
			const oldSpeed = Number.isFinite(clip.speed) && clip.speed > 0 ? clip.speed : 1;
			const sourceDurationMs = (clip.endMs - clip.startMs) * oldSpeed;
			let newEndMs = Math.round(clip.startMs + sourceDurationMs / speed);
			const nextClipStart = clipRegions
				.filter((region) => region.id !== selectedClipId && region.startMs > clip.startMs)
				.reduce((min, region) => Math.min(min, region.startMs), totalMs);
			newEndMs = Math.min(newEndMs, nextClipStart);
			const clampedSpeed =
				newEndMs > clip.startMs ? sourceDurationMs / (newEndMs - clip.startMs) : speed;
			const scaleFactor = oldSpeed / clampedSpeed;
			setClipRegions((prev) =>
				prev.map((region) =>
					region.id === selectedClipId
						? { ...region, speed: clampedSpeed, endMs: newEndMs }
						: region,
				),
			);
			const scaleInClip = <T extends { startMs: number; endMs: number }>(regions: T[]): T[] =>
				regions.map((region) => {
					if (region.startMs < clip.startMs || region.endMs > clip.endMs) return region;
					return {
						...region,
						startMs: Math.round(clip.startMs + (region.startMs - clip.startMs) * scaleFactor),
						endMs: Math.round(clip.startMs + (region.endMs - clip.startMs) * scaleFactor),
					};
				});
			setZoomRegions((prev) => scaleInClip(prev));
			setAnnotationRegions((prev) => scaleInClip(prev));
			setAudioRegions((prev) => scaleInClip(prev));
		},
		[
			clipRegions,
			selectedClipId,
			setAnnotationRegions,
			setAudioRegions,
			setZoomRegions,
			totalMs,
		],
	);

	const handleClipMutedChange = useCallback(
		(muted: boolean) => {
			if (!selectedClipId) return;
			setClipRegions((prev) =>
				prev.map((clip) => (clip.id === selectedClipId ? { ...clip, muted } : clip)),
			);
		},
		[selectedClipId],
	);

	const handleClipDelete = useCallback(
		(id: string) => {
			const deletedClip = clipRegions.find((clip) => clip.id === id);
			setClipRegions((prev) => prev.filter((clip) => clip.id !== id));
			if (deletedClip) {
				const { startMs, endMs } = deletedClip;
				setZoomRegions((prev) => prev.filter((region) => region.startMs < startMs || region.endMs > endMs));
				setAnnotationRegions((prev) => prev.filter((region) => region.startMs < startMs || region.endMs > endMs));
				setAudioRegions((prev) => prev.filter((region) => region.startMs < startMs || region.endMs > endMs));
			}
			setSelectedClipId((current) => (current === id ? null : current));
		},
		[clipRegions, setAnnotationRegions, setAudioRegions, setZoomRegions],
	);

	return {
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
	};
}