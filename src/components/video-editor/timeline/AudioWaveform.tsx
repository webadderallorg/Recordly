import { useTimelineContext } from "dnd-timeline";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AudioPeaksData } from "./useAudioPeaks";

interface AudioWaveformProps {
	peaks: AudioPeaksData;
}

/**
 * Renders an audio waveform as a canvas that fills its parent container.
 * Automatically syncs with the timeline's visible range so the waveform
 * scrolls and zooms together with the clip items above it.
 */
export default function AudioWaveform({ peaks }: AudioWaveformProps) {
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

		ctx.beginPath();
		for (let px = 0; px < width; px++) {
			const t = visibleStartMs + (px / width) * visibleDurationMs;
			const binIndex = Math.min(
				peakData.length - 1,
				Math.max(0, Math.floor((t / durationMs) * peakData.length)),
			);
			const amplitude = peakData[binIndex];
			const barHeight = amplitude * midY * 0.85;

			ctx.moveTo(px, midY - barHeight);
			ctx.lineTo(px, midY + barHeight);
		}

		ctx.strokeStyle = "rgba(255, 255, 255, 0.55)";
		ctx.lineWidth = dpr;
		ctx.stroke();
	}, [peaks, range.start, range.end, resizeKey]);

	return (
		<canvas
			ref={setCanvasRef}
			className="absolute inset-0 w-full h-full pointer-events-none"
			style={{ display: "block" }}
		/>
	);
}
