import { useTimelineContext } from "dnd-timeline";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ClipRegion } from "../types";
import type { AudioPeaksData } from "./useAudioPeaks";

interface AudioWaveformProps {
	peaks: AudioPeaksData;
	clipRegions?: ClipRegion[];
}

/**
 * Renders an audio waveform as a canvas that fills its parent container.
 * Automatically syncs with the timeline's visible range so the waveform
 * scrolls and zooms together with the clip items above it.
 */
export default function AudioWaveform({ peaks, clipRegions = [] }: AudioWaveformProps) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const { range } = useTimelineContext();
	const [resizeKey, setResizeKey] = useState(0);

	// Bump resizeKey when the canvas element changes size.
	const observerRef = useRef<ResizeObserver | null>(null);
	const setCanvasRef = useCallback((node: HTMLCanvasElement | null) => {
		if (observerRef.current) {
			observerRef.current.disconnect();
			observerRef.current = null;
		}
		(canvasRef as React.MutableRefObject<HTMLCanvasElement | null>).current = node;
		if (node) {
			const ro = new ResizeObserver(() => setResizeKey((k) => k + 1));
			ro.observe(node);
			observerRef.current = ro;
		}
	}, []);

	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;

		const ctx = canvas.getContext("2d");
		if (!ctx) return;

		const rect = canvas.getBoundingClientRect();
		const dpr = window.devicePixelRatio || 1;
		const width = Math.round(rect.width * dpr);
		const height = Math.round(rect.height * dpr);

		if (width === 0 || height === 0) return;

		canvas.width = width;
		canvas.height = height;

		ctx.clearRect(0, 0, width, height);

		const { peaks: peakData, durationMs } = peaks;
		if (durationMs <= 0 || peakData.length === 0) return;

		const visibleStartMs = range.start;
		const visibleEndMs = range.end;
		const visibleDurationMs = visibleEndMs - visibleStartMs;
		if (visibleDurationMs <= 0) return;

		const midY = height / 2;
		const maxIndex = peakData.length - 1;
		const timePerPixel = visibleDurationMs / width;
		const scale = peakData.length / durationMs;
		const sortedClips =
			clipRegions.length > 1
				? [...clipRegions].sort((left, right) => left.startMs - right.startMs)
				: clipRegions;
		const hasClipRegions = sortedClips.length > 0;
		let clipIndex = 0;

		ctx.fillStyle = "rgba(255, 255, 255, 0.55)";
		for (let px = 0; px < width; px++) {
			const timelineTimeMs = visibleStartMs + px * timePerPixel;
			let sourceTimeMs = timelineTimeMs;

			if (hasClipRegions) {
				while (
					clipIndex < sortedClips.length &&
					timelineTimeMs > sortedClips[clipIndex].endMs
				) {
					clipIndex += 1;
				}

				const activeClip =
					clipIndex < sortedClips.length ? sortedClips[clipIndex] : null;
				if (
					!activeClip ||
					timelineTimeMs < activeClip.startMs ||
					timelineTimeMs > activeClip.endMs
				) {
					continue;
				}

				const speed =
					Number.isFinite(activeClip.speed) && activeClip.speed > 0
						? activeClip.speed
						: 1;
				sourceTimeMs = activeClip.startMs + (timelineTimeMs - activeClip.startMs) * speed;
			}

			const binIndex = Math.min(maxIndex, Math.max(0, Math.floor(sourceTimeMs * scale)));
			const amplitude = peakData[binIndex];
			const barHeight = amplitude * midY * 0.85;

			const y = midY - barHeight;
			const h = barHeight * 2;
			ctx.fillRect(px, y, 1, h);
		}
	}, [peaks, clipRegions, range.start, range.end, resizeKey]);

	return (
		<canvas
			ref={setCanvasRef}
			className="absolute inset-0 w-full h-full pointer-events-none"
			style={{ display: "block" }}
		/>
	);
}
