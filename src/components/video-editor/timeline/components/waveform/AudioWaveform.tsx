import { useTimelineContext } from "dnd-timeline";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import type { AudioPeaksData } from "../../core/timelineTypes";

interface AudioWaveformProps {
	peaks: AudioPeaksData;
	segmentStartMs?: number;
	segmentEndMs?: number;
	gain?: number;
	normalize?: boolean;
	className?: string;
}

/**
 * Renders an audio waveform as a canvas that fills its parent container.
 * Automatically syncs with the timeline's visible range so the waveform
 * scrolls and zooms together with the clip items above it.
 */
function AudioWaveformComponent({
	peaks,
	segmentStartMs,
	segmentEndMs,
	gain = 1,
	normalize = false,
	className,
}: AudioWaveformProps) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const { range } = useTimelineContext();
	const [resizeKey, setResizeKey] = useState(0);
	const lastDrawAtRef = useRef(0);

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
		let rafId = 0;

		const draw = () => {
			const now = performance.now();
			if (now - lastDrawAtRef.current < 33) {
				rafId = requestAnimationFrame(draw);
				return;
			}
			lastDrawAtRef.current = now;

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

			// Use raw values for smooth zooming/panning (no snapping)
			const visibleStartMs = segmentStartMs ?? range.start;
			const visibleEndMs = segmentEndMs ?? range.end;
			const visibleDurationMs = visibleEndMs - visibleStartMs;
			
			if (visibleDurationMs <= 0) return;

			const midY = height / 2;
			ctx.beginPath();
			
			for (let px = 0; px < width; px++) {
				const t = visibleStartMs + (px / width) * visibleDurationMs;
				
				// If the timeline time is beyond the actual audio duration, we draw nothing (flat line)
				if (t < 0 || t > durationMs) continue;

				const exactIndex = (t / durationMs) * (peakData.length - 1);
				const leftIndex = Math.floor(exactIndex);
				const rightIndex = Math.min(peakData.length - 1, leftIndex + 1);
				const mix = exactIndex - leftIndex;
				
				let amplitude = peakData[leftIndex] * (1 - mix) + peakData[rightIndex] * mix;
				
				if (normalize) amplitude = Math.sqrt(Math.max(0, amplitude));
				amplitude = Math.max(0, Math.min(1, amplitude * gain));
				
				const barHeight = amplitude * midY * 0.85;

				ctx.moveTo(px, midY - barHeight);
				ctx.lineTo(px, midY + barHeight);
			}

			ctx.strokeStyle = "rgba(255, 255, 255, 0.55)";
			ctx.lineWidth = dpr;
			ctx.stroke();
		};
		rafId = requestAnimationFrame(draw);
		return () => cancelAnimationFrame(rafId);
	}, [gain, normalize, peaks, range.start, range.end, resizeKey, segmentStartMs, segmentEndMs]);

	return (
		<canvas
			ref={setCanvasRef}
			className={className ?? "absolute inset-0 w-full h-full pointer-events-none"}
			style={{ display: "block" }}
		/>
	);
}

export default memo(AudioWaveformComponent);
