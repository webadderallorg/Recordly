import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { detectKeyColorFromPixels } from "@/lib/webcamProcessing/detectKeyColor";
import { getWebcamPreviewTargetTimeSeconds } from "./videoPlayback/webcamSync";

interface WebcamKeyColorPickerProps {
	mirrored?: boolean;
	previewSrc?: string | null;
	previewCurrentTime?: number;
	previewPlaying?: boolean;
	previewTimeOffsetMs?: number | null;
	onPickColor: (hex: string) => void;
}

/**
 * Eyedropper for the greenscreen key color: shows the webcam frame at the
 * playhead; clicking samples a 3×3 pixel average at that spot and reports it
 * as "#rrggbb". Real screens shift far from pure green under lighting, so
 * sampling the actual footage is the reliable way to set the key.
 */
export function WebcamKeyColorPicker({
	mirrored = false,
	previewSrc = null,
	previewCurrentTime = 0,
	previewPlaying = false,
	previewTimeOffsetMs = 0,
	onPickColor,
}: WebcamKeyColorPickerProps) {
	const previewVideoRef = useRef<HTMLVideoElement | null>(null);
	const sampleCanvasRef = useRef<HTMLCanvasElement | null>(null);
	const [previewReady, setPreviewReady] = useState(false);

	const syncPreviewMedia = useCallback(() => {
		const video = previewVideoRef.current;
		if (!video || !previewSrc) {
			return;
		}

		const webcamDuration = Number.isFinite(video.duration) ? video.duration : null;
		const targetTime = getWebcamPreviewTargetTimeSeconds({
			currentTime: previewCurrentTime,
			webcamDuration,
			timeOffsetMs: previewTimeOffsetMs,
		});
		const mediaTargetTime =
			targetTime <= 0 && webcamDuration !== null && webcamDuration > 0
				? Math.min(1 / 60, webcamDuration)
				: targetTime;
		const driftThreshold = previewPlaying ? 0.35 : 0.01;

		if (Math.abs(video.currentTime - mediaTargetTime) > driftThreshold) {
			try {
				video.currentTime = mediaTargetTime;
			} catch {
				/* Ignore browsers that reject seeks while metadata is settling. */
			}
		}

		if (previewPlaying) {
			video.play()?.catch(() => undefined);
		} else {
			video.pause();
		}
	}, [previewCurrentTime, previewPlaying, previewSrc, previewTimeOffsetMs]);

	useEffect(() => {
		syncPreviewMedia();
	}, [syncPreviewMedia]);

	const handleFrameReady = useCallback(() => {
		const video = previewVideoRef.current;
		if (video && video.videoWidth > 0 && video.videoHeight > 0 && video.readyState >= 2) {
			setPreviewReady(true);
		}
		syncPreviewMedia();
	}, [syncPreviewMedia]);

	const handleClick = useCallback(
		(event: React.MouseEvent<HTMLDivElement>) => {
			const video = previewVideoRef.current;
			if (!video || video.videoWidth <= 0 || video.videoHeight <= 0) {
				return;
			}
			const rect = event.currentTarget.getBoundingClientRect();
			let nx = (event.clientX - rect.left) / rect.width;
			const ny = (event.clientY - rect.top) / rect.height;
			if (mirrored) {
				nx = 1 - nx;
			}

			const canvas = (sampleCanvasRef.current ??= document.createElement("canvas"));
			canvas.width = video.videoWidth;
			canvas.height = video.videoHeight;
			const ctx = canvas.getContext("2d", { willReadFrequently: true });
			if (!ctx) {
				return;
			}
			ctx.drawImage(video, 0, 0);
			const px = Math.min(
				video.videoWidth - 2,
				Math.max(1, Math.round(nx * video.videoWidth)),
			);
			const py = Math.min(
				video.videoHeight - 2,
				Math.max(1, Math.round(ny * video.videoHeight)),
			);
			const data = ctx.getImageData(px - 1, py - 1, 3, 3).data;
			let r = 0;
			let g = 0;
			let b = 0;
			for (let i = 0; i < data.length; i += 4) {
				r += data[i];
				g += data[i + 1];
				b += data[i + 2];
			}
			const count = data.length / 4;
			const toHex = (v: number) =>
				Math.round(v / count)
					.toString(16)
					.padStart(2, "0");
			onPickColor(`#${toHex(r)}${toHex(g)}${toHex(b)}`);
		},
		[mirrored, onPickColor],
	);

	const handleAutoDetect = useCallback(() => {
		const video = previewVideoRef.current;
		if (!video || video.videoWidth <= 0 || video.videoHeight <= 0) {
			return;
		}
		const canvas = (sampleCanvasRef.current ??= document.createElement("canvas"));
		canvas.width = video.videoWidth;
		canvas.height = video.videoHeight;
		const ctx = canvas.getContext("2d", { willReadFrequently: true });
		if (!ctx) {
			return;
		}
		ctx.drawImage(video, 0, 0);
		const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
		const detected = detectKeyColorFromPixels(pixels, canvas.width, canvas.height);
		if (detected) {
			onPickColor(detected);
		} else {
			toast.info("No green or blue screen detected in this frame", {
				description: "Click your screen color in the preview instead",
			});
		}
	}, [onPickColor]);

	if (!previewSrc) {
		return null;
	}

	return (
		// biome-ignore lint/a11y/useKeyWithClickEvents: pixel sampling is inherently pointer-driven
		<div
			className="relative w-full cursor-crosshair overflow-hidden rounded-md bg-black/20"
			onClick={handleClick}
			role="button"
			tabIndex={-1}
			aria-label="Pick key color from camera"
		>
			<button
				type="button"
				onClick={(event) => {
					event.stopPropagation();
					handleAutoDetect();
				}}
				className="absolute right-1.5 top-1.5 z-10 rounded-md bg-black/60 px-2 py-0.5 text-[10px] text-white/90 ring-1 ring-white/20 transition-colors hover:bg-black/80"
			>
				Auto
			</button>
			<video
				ref={previewVideoRef}
				src={previewSrc}
				className={cn("block w-full", mirrored && "-scale-x-100")}
				muted
				playsInline
				preload="auto"
				aria-hidden="true"
				onLoadedMetadata={handleFrameReady}
				onLoadedData={handleFrameReady}
				onSeeked={syncPreviewMedia}
			/>
			{!previewReady && (
				<div className="absolute inset-0 flex items-center justify-center text-[10px] text-muted-foreground/70">
					Loading camera frame…
				</div>
			)}
		</div>
	);
}
