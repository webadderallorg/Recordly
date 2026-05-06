import { useCallback, useEffect, useId, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { CropRegion } from "./types";
import { getWebcamPreviewTargetTimeSeconds } from "./videoPlayback/webcamSync";
import { normalizeWebcamCropRegion } from "./webcamOverlay";

type CropHandle = "move" | "nw" | "ne" | "sw" | "se";

const HANDLE_LABELS: Record<CropHandle, string> = {
	move: "Move webcam crop",
	nw: "Resize webcam crop from top left",
	ne: "Resize webcam crop from top right",
	sw: "Resize webcam crop from bottom left",
	se: "Resize webcam crop from bottom right",
};

interface WebcamCropControlProps {
	cropRegion: CropRegion;
	mirrored?: boolean;
	previewSrc?: string | null;
	previewCurrentTime?: number;
	previewPlaying?: boolean;
	previewTimeOffsetMs?: number | null;
	onCropChange: (cropRegion: CropRegion) => void;
}

interface DragState {
	handle: CropHandle;
	startX: number;
	startY: number;
	initialCrop: CropRegion;
}

interface PreviewFrame {
	src: string | null;
	width: number;
	height: number;
}

const MIN_CROP_SIZE = 0.08;
const KEYBOARD_STEP = 0.01;
const KEYBOARD_FAST_STEP = 0.05;

const RESIZE_HANDLES: Array<{
	handle: Exclude<CropHandle, "move">;
	className: string;
	cursorClassName: string;
}> = [
	{
		handle: "nw",
		className: "left-0 top-0 -translate-x-1/2 -translate-y-1/2",
		cursorClassName: "cursor-nwse-resize",
	},
	{
		handle: "ne",
		className: "right-0 top-0 translate-x-1/2 -translate-y-1/2",
		cursorClassName: "cursor-nesw-resize",
	},
	{
		handle: "se",
		className: "bottom-0 right-0 translate-x-1/2 translate-y-1/2",
		cursorClassName: "cursor-nwse-resize",
	},
	{
		handle: "sw",
		className: "bottom-0 left-0 -translate-x-1/2 translate-y-1/2",
		cursorClassName: "cursor-nesw-resize",
	},
];

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

function normalizeAspectCropRegion(cropRegion: CropRegion, displayAspectRatio: number): CropRegion {
	const crop = normalizeWebcamCropRegion(cropRegion);
	const aspectRatio =
		Number.isFinite(displayAspectRatio) && displayAspectRatio > 0 ? displayAspectRatio : 1;
	const maxWidth = Math.min(1, 1 / aspectRatio);
	const minWidth = Math.min(MIN_CROP_SIZE, maxWidth);
	const width = clamp(Math.min(crop.width, crop.height / aspectRatio), minWidth, maxWidth);
	const height = width * aspectRatio;
	const centerX = crop.x + crop.width / 2;
	const centerY = crop.y + crop.height / 2;
	const x = clamp(centerX - width / 2, 0, 1 - width);
	const y = clamp(centerY - height / 2, 0, 1 - height);

	return { x, y, width, height };
}

function flipCropHorizontally(cropRegion: CropRegion, displayAspectRatio: number): CropRegion {
	const crop = normalizeAspectCropRegion(cropRegion, displayAspectRatio);
	return {
		...crop,
		x: clamp(1 - crop.x - crop.width, 0, 1 - crop.width),
	};
}

function resizeCrop(
	cropRegion: CropRegion,
	handle: CropHandle,
	deltaX: number,
	deltaY: number,
	displayAspectRatio: number,
) {
	const aspectRatio =
		Number.isFinite(displayAspectRatio) && displayAspectRatio > 0 ? displayAspectRatio : 1;
	const crop = normalizeAspectCropRegion(cropRegion, aspectRatio);
	const minWidth = Math.min(MIN_CROP_SIZE, Math.min(1, 1 / aspectRatio));

	if (handle === "move") {
		return normalizeAspectCropRegion(
			{
				...crop,
				x: clamp(crop.x + deltaX, 0, 1 - crop.width),
				y: clamp(crop.y + deltaY, 0, 1 - crop.height),
			},
			aspectRatio,
		);
	}

	let left = crop.x;
	let top = crop.y;
	let right = crop.x + crop.width;
	let bottom = crop.y + crop.height;

	if (handle === "nw") {
		const delta = Math.max(deltaX, deltaY / aspectRatio);
		const nextWidth = clamp(
			crop.width - delta,
			minWidth,
			Math.min(right, bottom / aspectRatio),
		);
		left = right - nextWidth;
		top = bottom - nextWidth * aspectRatio;
	}

	if (handle === "ne") {
		const delta = Math.max(deltaX, -deltaY / aspectRatio);
		const nextWidth = clamp(
			crop.width + delta,
			minWidth,
			Math.min(1 - left, bottom / aspectRatio),
		);
		right = left + nextWidth;
		top = bottom - nextWidth * aspectRatio;
	}

	if (handle === "sw") {
		const delta = Math.max(-deltaX, deltaY / aspectRatio);
		const nextWidth = clamp(
			crop.width + delta,
			minWidth,
			Math.min(right, (1 - top) / aspectRatio),
		);
		left = right - nextWidth;
		bottom = top + nextWidth * aspectRatio;
	}

	if (handle === "se") {
		const delta = Math.max(deltaX, deltaY / aspectRatio);
		const nextWidth = clamp(
			crop.width + delta,
			minWidth,
			Math.min(1 - left, (1 - top) / aspectRatio),
		);
		right = left + nextWidth;
		bottom = top + nextWidth * aspectRatio;
	}

	return normalizeAspectCropRegion(
		{
			x: left,
			y: top,
			width: right - left,
			height: bottom - top,
		},
		aspectRatio,
	);
}

export function WebcamCropControl({
	cropRegion,
	mirrored = false,
	previewSrc = null,
	previewCurrentTime = 0,
	previewPlaying = false,
	previewTimeOffsetMs = 0,
	onCropChange,
}: WebcamCropControlProps) {
	const containerRef = useRef<HTMLDivElement | null>(null);
	const previewVideoRef = useRef<HTMLVideoElement | null>(null);
	const dragStateRef = useRef<DragState | null>(null);
	const pendingCropRef = useRef<CropRegion | null>(null);
	const pendingFrameRef = useRef<number | null>(null);
	const maskId = `webcam-crop-mask-${useId().replace(/:/g, "")}`;
	const [activeHandle, setActiveHandle] = useState<CropHandle | null>(null);
	const [draftVisualCrop, setDraftVisualCrop] = useState<CropRegion | null>(null);
	const [previewFrame, setPreviewFrame] = useState<PreviewFrame | null>(null);
	const hasPreviewFrame = previewSrc !== null && previewFrame?.src === previewSrc;
	const previewAspectRatio =
		hasPreviewFrame && previewFrame && previewFrame.width > 0 && previewFrame.height > 0
			? previewFrame.width / previewFrame.height
			: 1;
	const sourceCrop = normalizeAspectCropRegion(cropRegion, previewAspectRatio);
	const propVisualCrop = mirrored
		? flipCropHorizontally(sourceCrop, previewAspectRatio)
		: sourceCrop;
	const crop = draftVisualCrop ?? propVisualCrop;
	const cropLeft = crop.x * 100;
	const cropTop = crop.y * 100;
	const cropWidth = crop.width * 100;
	const cropHeight = crop.height * 100;
	const cancelPendingCommit = () => {
		if (pendingFrameRef.current !== null) {
			cancelAnimationFrame(pendingFrameRef.current);
			pendingFrameRef.current = null;
		}
	};
	const flushPendingCommit = () => {
		const nextCrop = pendingCropRef.current;
		if (!nextCrop) {
			return;
		}
		cancelPendingCommit();
		pendingCropRef.current = null;
		onCropChange(nextCrop);
	};
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
			const playPromise = video.play();
			if (playPromise) {
				playPromise.catch(() => undefined);
			}
		} else {
			video.pause();
		}
	}, [previewCurrentTime, previewPlaying, previewSrc, previewTimeOffsetMs]);

	const handlePreviewFrameReady = useCallback(() => {
		const video = previewVideoRef.current;
		if (video && video.videoWidth > 0 && video.videoHeight > 0 && video.readyState >= 2) {
			setPreviewFrame({
				src: previewSrc,
				width: video.videoWidth,
				height: video.videoHeight,
			});
		}
		syncPreviewMedia();
	}, [previewSrc, syncPreviewMedia]);

	useEffect(() => {
		syncPreviewMedia();
	}, [syncPreviewMedia]);

	const commitVisualCrop = (nextVisualCrop: CropRegion, immediate = false) => {
		const nextCrop = mirrored
			? flipCropHorizontally(nextVisualCrop, previewAspectRatio)
			: nextVisualCrop;
		if (immediate) {
			cancelPendingCommit();
			pendingCropRef.current = null;
			onCropChange(nextCrop);
			return;
		}

		pendingCropRef.current = nextCrop;
		if (pendingFrameRef.current !== null) {
			return;
		}
		pendingFrameRef.current = requestAnimationFrame(() => {
			pendingFrameRef.current = null;
			flushPendingCommit();
		});
	};

	useEffect(() => {
		return () => {
			if (pendingFrameRef.current !== null) {
				cancelAnimationFrame(pendingFrameRef.current);
			}
		};
	}, []);

	const getPointerPosition = (event: React.PointerEvent<HTMLDivElement>) => {
		const rect = containerRef.current?.getBoundingClientRect();
		if (!rect || rect.width <= 0 || rect.height <= 0) {
			return null;
		}

		return {
			x: clamp((event.clientX - rect.left) / rect.width, 0, 1),
			y: clamp((event.clientY - rect.top) / rect.height, 0, 1),
		};
	};

	const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>, handle: CropHandle) => {
		const pointer = getPointerPosition(event);
		if (!pointer) {
			return;
		}

		event.preventDefault();
		event.stopPropagation();
		dragStateRef.current = {
			handle,
			startX: pointer.x,
			startY: pointer.y,
			initialCrop: crop,
		};
		setActiveHandle(handle);

		try {
			containerRef.current?.setPointerCapture(event.pointerId);
		} catch {
			/* Pointer capture can fail if the drag started outside the control. */
		}
	};

	const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
		const dragState = dragStateRef.current;
		if (!dragState) {
			return;
		}

		const pointer = getPointerPosition(event);
		if (!pointer) {
			return;
		}

		const nextVisualCrop = resizeCrop(
			dragState.initialCrop,
			dragState.handle,
			pointer.x - dragState.startX,
			pointer.y - dragState.startY,
			previewAspectRatio,
		);
		setDraftVisualCrop(nextVisualCrop);
		commitVisualCrop(nextVisualCrop);
	};

	const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
		if (dragStateRef.current) {
			try {
				containerRef.current?.releasePointerCapture(event.pointerId);
			} catch {
				/* Pointer capture may already be released while ending the drag. */
			}
		}
		flushPendingCommit();
		dragStateRef.current = null;
		setDraftVisualCrop(null);
		setActiveHandle(null);
	};

	const getKeyboardDelta = (event: React.KeyboardEvent<HTMLElement>) => {
		const step = event.shiftKey ? KEYBOARD_FAST_STEP : KEYBOARD_STEP;
		if (event.key === "ArrowLeft") {
			return { x: -step, y: 0 };
		}
		if (event.key === "ArrowRight") {
			return { x: step, y: 0 };
		}
		if (event.key === "ArrowUp") {
			return { x: 0, y: -step };
		}
		if (event.key === "ArrowDown") {
			return { x: 0, y: step };
		}
		return null;
	};

	const handleKeyboardAdjust = (event: React.KeyboardEvent<HTMLElement>, handle: CropHandle) => {
		const delta = getKeyboardDelta(event);
		if (!delta) {
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		commitVisualCrop(resizeCrop(crop, handle, delta.x, delta.y, previewAspectRatio), true);
	};

	return (
		<div
			ref={containerRef}
			className="relative w-full touch-none select-none overflow-hidden rounded-lg border border-foreground/10 bg-editor-dialog-alt"
			style={{ aspectRatio: previewAspectRatio }}
			onPointerMove={handlePointerMove}
			onPointerUp={endDrag}
			onPointerCancel={endDrag}
		>
			{previewSrc ? (
				<video
					ref={previewVideoRef}
					src={previewSrc}
					className="pointer-events-none absolute inset-0 block h-full w-full object-fill"
					style={{
						opacity: hasPreviewFrame ? 1 : 0,
						transform: mirrored ? "scaleX(-1)" : undefined,
					}}
					muted
					playsInline
					preload="auto"
					aria-hidden="true"
					onLoadedMetadata={handlePreviewFrameReady}
					onLoadedData={handlePreviewFrameReady}
					onSeeked={handlePreviewFrameReady}
				/>
			) : null}
			<div
				className={cn(
					"absolute inset-0 bg-editor-dialog-alt transition-opacity",
					previewSrc && hasPreviewFrame ? "opacity-0" : "opacity-100",
				)}
			/>

			<svg className="pointer-events-none absolute inset-0 h-full w-full">
				<defs>
					<mask id={maskId}>
						<rect width="100%" height="100%" fill="white" />
						<rect
							x={`${cropLeft}%`}
							y={`${cropTop}%`}
							width={`${cropWidth}%`}
							height={`${cropHeight}%`}
							fill="black"
						/>
					</mask>
				</defs>
				<rect
					width="100%"
					height="100%"
					fill="black"
					fillOpacity="0.58"
					mask={`url(#${maskId})`}
				/>
			</svg>

			<div
				className={cn(
					"absolute border border-white shadow-[0_0_0_1px_rgba(37,99,235,0.9),0_8px_24px_rgba(0,0,0,0.25)] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/60 focus:ring-offset-2 focus:ring-offset-editor-dialog",
					activeHandle === "move" ? "cursor-grabbing" : "cursor-move",
				)}
				style={{
					left: `${cropLeft}%`,
					top: `${cropTop}%`,
					width: `${cropWidth}%`,
					height: `${cropHeight}%`,
				}}
				tabIndex={0}
				aria-label={HANDLE_LABELS.move}
				onPointerDown={(event) => handlePointerDown(event, "move")}
				onFocus={() => setActiveHandle("move")}
				onBlur={() => setActiveHandle(null)}
				onKeyDown={(event) => handleKeyboardAdjust(event, "move")}
			>
				<div className="pointer-events-none absolute left-1/3 top-0 h-full w-px bg-white/45" />
				<div className="pointer-events-none absolute left-2/3 top-0 h-full w-px bg-white/45" />
				<div className="pointer-events-none absolute left-0 top-1/3 h-px w-full bg-white/45" />
				<div className="pointer-events-none absolute left-0 top-2/3 h-px w-full bg-white/45" />

				{RESIZE_HANDLES.map((handle) => (
					<div
						key={handle.handle}
						role="slider"
						tabIndex={0}
						aria-label={HANDLE_LABELS[handle.handle]}
						aria-valuemin={Math.round(MIN_CROP_SIZE * 100)}
						aria-valuemax={100}
						aria-valuenow={Math.round(crop.width * 100)}
						aria-valuetext={`${Math.round(crop.width * 100)}%`}
						className={cn(
							"absolute z-10 h-3.5 w-3.5 rounded-[3px] border-2 border-white bg-[#2563EB] shadow-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]/60 focus:ring-offset-2 focus:ring-offset-editor-dialog",
							handle.className,
							handle.cursorClassName,
							activeHandle === handle.handle && "scale-110",
						)}
						onPointerDown={(event) => handlePointerDown(event, handle.handle)}
						onFocus={() => setActiveHandle(handle.handle)}
						onBlur={() => setActiveHandle(null)}
						onKeyDown={(event) => handleKeyboardAdjust(event, handle.handle)}
					/>
				))}
			</div>
		</div>
	);
}
