import { useTimelineContext } from "dnd-timeline";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { useTheme } from "@/contexts/ThemeContext";
import type { AudioPeaksData } from "../../core/timelineTypes";

interface AudioWaveformProps {
	peaks: AudioPeaksData;
	segmentStartMs: number;
	segmentEndMs: number;
	timelineStartMs: number;
	timelineEndMs: number;
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
	timelineStartMs,
	timelineEndMs,
	gain = 1,
	normalize = false,
	className,
}: AudioWaveformProps) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const { theme } = useTheme();
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

	// biome-ignore lint/correctness/useExhaustiveDependencies: resizeKey intentionally redraws the canvas after ResizeObserver notifications.
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

			// The timeline clips the canvas to the intersection of the item and the viewport.
			const visibleStart = Math.max(timelineStartMs, range.start);
			const visibleEnd = Math.min(timelineEndMs, range.end);
			const sourceDurationMs = segmentEndMs - segmentStartMs;
			if (visibleEnd <= visibleStart || sourceDurationMs <= 0) return;
			const sourcePerTimelineMs = sourceDurationMs / (timelineEndMs - timelineStartMs);
			const visibleSourceStart =
				segmentStartMs + (visibleStart - timelineStartMs) * sourcePerTimelineMs;
			const sourceMsPerPixel = ((visibleEnd - visibleStart) * sourcePerTimelineMs) / width;
			const peaksPerMs = peakData.length / durationMs;
			const samplePixelRange = sourceMsPerPixel * peaksPerMs > 1;

			const midY = height / 2;
			ctx.beginPath();

			for (let px = 0; px < width; px++) {
				const t = visibleSourceStart + px * sourceMsPerPixel;
				if (t >= durationMs || t + sourceMsPerPixel <= 0) continue;

				let amplitude = 0;
				if (samplePixelRange) {
					// Keep short peaks visible when several buckets share a pixel.
					const first = Math.max(0, Math.floor(t * peaksPerMs));
					const end = Math.min(
						peakData.length,
						Math.ceil((t + sourceMsPerPixel) * peaksPerMs),
					);
					for (let i = first; i < end; i++) amplitude = Math.max(amplitude, peakData[i]);
				} else {
					const exactIndex = (Math.max(0, t) / durationMs) * (peakData.length - 1);
					const left = Math.floor(exactIndex);
					const right = Math.min(peakData.length - 1, left + 1);
					const mix = exactIndex - left;
					amplitude = peakData[left] * (1 - mix) + peakData[right] * mix;
				}

				if (normalize) amplitude = Math.sqrt(Math.max(0, amplitude));
				amplitude = Math.max(0, Math.min(1, amplitude * gain));

				const barHeight = amplitude * midY * 0.85;

				ctx.moveTo(px, midY - barHeight);
				ctx.lineTo(px, midY + barHeight);
			}

			ctx.strokeStyle = theme === "dark" ? "rgba(255, 255, 255, 0.65)" : "rgba(0, 0, 0, 0.6)";
			ctx.lineWidth = dpr;
			ctx.stroke();
		};
		rafId = requestAnimationFrame(draw);
		return () => cancelAnimationFrame(rafId);
	}, [
		gain,
		normalize,
		peaks,
		range.start,
		range.end,
		resizeKey,
		segmentStartMs,
		segmentEndMs,
		timelineStartMs,
		timelineEndMs,
		theme,
	]);

	return (
		<canvas
			ref={setCanvasRef}
			className={className ?? "absolute inset-0 w-full h-full pointer-events-none"}
			style={{ display: "block" }}
		/>
	);
}

export default memo(AudioWaveformComponent);
