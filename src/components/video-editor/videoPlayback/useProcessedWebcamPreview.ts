import { type RefObject, useEffect, useMemo, useRef } from "react";
import {
	isProcessingActive,
	resolveProcessingSettings,
	WebcamProcessor,
} from "@/lib/webcamProcessing/webcamProcessor";
import type { WebcamOverlaySettings } from "../types";

/**
 * Drives the processed (greenscreen/mask/color) webcam preview canvas in the
 * editor. The hidden <video> element stays the time/sync driver; whenever it
 * presents a frame (or a processing setting changes while paused), the frame
 * runs through the shared WebcamProcessor and lands on the visible canvas.
 *
 * Returns whether processing is active so the caller can swap video/canvas
 * visibility. Inactive → zero overhead (no GL context until first use).
 */
export function useProcessedWebcamPreview({
	webcam,
	videoRef,
	canvasRef,
	elementsReady = true,
	videoPath = null,
}: {
	webcam: WebcamOverlaySettings | undefined;
	videoRef: RefObject<HTMLVideoElement | null>;
	canvasRef: RefObject<HTMLCanvasElement | null>;
	/**
	 * The video/canvas elements may mount later than this hook's first run
	 * (e.g. the editor bubble renders only once the player is ready). The
	 * frame loop re-arms when this flips true; without it the loop would
	 * grab null refs once and never recover until a settings change.
	 */
	elementsReady?: boolean;
	/** Re-arms the loop when the async-resolved webcam media URL arrives. */
	videoPath?: string | null;
}): boolean {
	const processingActive = isProcessingActive(webcam);
	const resolved = useMemo(() => resolveProcessingSettings(webcam), [webcam]);
	const resolvedRef = useRef(resolved);
	resolvedRef.current = resolved;
	const mirrored = webcam?.mirror ?? false;
	const mirroredRef = useRef(mirrored);
	mirroredRef.current = mirrored;
	const processorRef = useRef<WebcamProcessor | null>(null);
	const warnedRef = useRef(false);
	// Set by the frame-loop effect; lets the async background-image load force
	// a repaint once the image arrives (paused video presents no new frames).
	const renderOnceRef = useRef<(() => void) | null>(null);

	useEffect(() => {
		return () => {
			processorRef.current?.destroy();
			processorRef.current = null;
		};
	}, []);

	const backgroundImagePath = processingActive
		? (resolved.greenscreen.backgroundImagePath ?? null)
		: null;

	useEffect(() => {
		if (!processingActive) {
			return;
		}
		if (!processorRef.current) {
			processorRef.current = new WebcamProcessor();
		}
		const processor = processorRef.current;
		if (!backgroundImagePath) {
			processor.setBackgroundImage(null);
			return;
		}
		let cancelled = false;
		const image = new Image();
		image.onload = () => {
			if (!cancelled) {
				processor.setBackgroundImage(image);
				// The image arrived after the last draw; repaint so a paused
				// preview shows the new background immediately.
				renderOnceRef.current?.();
			}
		};
		image.onerror = () => {
			if (!cancelled) {
				console.warn("[webcam-preview] failed to load greenscreen background image");
				processor.setBackgroundImage(null);
				renderOnceRef.current?.();
			}
		};
		image.src = backgroundImagePath;
		return () => {
			cancelled = true;
		};
	}, [backgroundImagePath, processingActive]);

	// `resolved` is intentionally a dependency below: the loop reads settings
	// via resolvedRef, so the re-run is what repaints the frame when a slider
	// changes while playback is paused (no new video frame is presented).
	// biome-ignore lint/correctness/useExhaustiveDependencies: intentional extra dep, see above
	useEffect(() => {
		if (!processingActive || !elementsReady) {
			return;
		}
		const video = videoRef.current;
		const canvas = canvasRef.current;
		if (!video || !canvas) {
			return;
		}
		if (!processorRef.current) {
			processorRef.current = new WebcamProcessor();
		}
		const processor = processorRef.current;
		let disposed = false;
		let rvfcHandle: number | null = null;
		let rafHandle: number | null = null;

		const renderFrame = () => {
			const width = video.videoWidth;
			const height = video.videoHeight;
			if (width <= 0 || height <= 0 || video.readyState < 2) {
				return;
			}
			const processed = processor.processFrame(video, width, height, resolvedRef.current, {
				mirrored: mirroredRef.current,
			});
			if (!processed) {
				if (!warnedRef.current) {
					warnedRef.current = true;
					console.warn(
						"[webcam-preview] WebGL unavailable; showing unprocessed webcam preview",
					);
				}
				return;
			}
			if (canvas.width !== width || canvas.height !== height) {
				canvas.width = width;
				canvas.height = height;
			}
			const ctx = canvas.getContext("2d");
			ctx?.drawImage(processed, 0, 0);
		};
		renderOnceRef.current = renderFrame;

		// The first draw can race the video's readiness (blank camera until the
		// next settings change); repaint whenever the element becomes drawable.
		const readinessEvents = ["loadeddata", "canplay", "seeked"] as const;
		for (const eventName of readinessEvents) {
			video.addEventListener(eventName, renderFrame);
		}

		const scheduleNext = () => {
			if (disposed) {
				return;
			}
			if (typeof video.requestVideoFrameCallback === "function") {
				rvfcHandle = video.requestVideoFrameCallback(() => {
					renderFrame();
					scheduleNext();
				});
			} else {
				rafHandle = requestAnimationFrame(() => {
					renderFrame();
					scheduleNext();
				});
			}
		};

		// Render immediately (covers paused-state setting changes), then follow
		// the video's presented frames.
		renderFrame();
		scheduleNext();

		return () => {
			disposed = true;
			if (renderOnceRef.current === renderFrame) {
				renderOnceRef.current = null;
			}
			for (const eventName of readinessEvents) {
				video.removeEventListener(eventName, renderFrame);
			}
			if (rvfcHandle !== null && typeof video.cancelVideoFrameCallback === "function") {
				video.cancelVideoFrameCallback(rvfcHandle);
			}
			if (rafHandle !== null) {
				cancelAnimationFrame(rafHandle);
			}
		};
	}, [processingActive, elementsReady, videoPath, resolved, mirrored, videoRef, canvasRef]);

	return processingActive;
}
