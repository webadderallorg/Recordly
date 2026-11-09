import { Surface } from "@heroui/react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useScopedT } from "@/contexts/I18nContext";
import { cn } from "@/lib/utils";
import type { CropRegion } from "./types";
import {
	getWebcamPreviewTargetTimeSeconds,
	isWebcamMediaSynchronized,
} from "./videoPlayback/webcamSync";
import { normalizeWebcamCropRegion } from "./webcamOverlay";

type CropHandle = "move" | "nw" | "ne" | "sw" | "se";

interface WebcamCropControlProps {
	cropRegion: CropRegion;
	mirrored?: boolean;
	previewSrc?: string | null;
	previewCurrentTime?: number;
	previewPlaying?: boolean;
	previewTimeOffsetMs?: number | null;
	onCropChange: (cropRegion: CropRegion, previewFrame?: PreviewFrame | null) => void;
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
	cornerClassName: string;
}> = [
	{
		handle: "nw",
		className: "left-0 top-0 -translate-x-1/2 -translate-y-1/2",
		cursorClassName: "cursor-nwse-resize",
		cornerClassName: "left-1/2 top-1/2 rounded-tl-[3px] border-l-2 border-t-2",
	},
	{
		handle: "ne",
		className: "right-0 top-0 translate-x-1/2 -translate-y-1/2",
		cursorClassName: "cursor-nesw-resize",
		cornerClassName: "right-1/2 top-1/2 rounded-tr-[3px] border-r-2 border-t-2",
	},
	{
		handle: "se",
		className: "bottom-0 right-0 translate-x-1/2 translate-y-1/2",
		cursorClassName: "cursor-nwse-resize",
		cornerClassName: "bottom-1/2 right-1/2 rounded-br-[3px] border-b-2 border-r-2",
	},
	{
		handle: "sw",
		className: "bottom-0 left-0 -translate-x-1/2 translate-y-1/2",
		cursorClassName: "cursor-nesw-resize",
		cornerClassName: "bottom-1/2 left-1/2 rounded-bl-[3px] border-b-2 border-l-2",
	},
];

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

function flipCropHorizontally(cropRegion: CropRegion): CropRegion {
	const crop = normalizeWebcamCropRegion(cropRegion);
	return {
		...crop,
		x: clamp(1 - crop.x - crop.width, 0, 1 - crop.width),
	};
}

function resizeCrop(cropRegion: CropRegion, handle: CropHandle, deltaX: number, deltaY: number) {
	const crop = normalizeWebcamCropRegion(cropRegion);

	if (handle === "move") {
		return normalizeWebcamCropRegion({
			...crop,
			x: clamp(crop.x + deltaX, 0, 1 - crop.width),
			y: clamp(crop.y + deltaY, 0, 1 - crop.height),
		});
	}

	let left = crop.x;
	let top = crop.y;
	let right = crop.x + crop.width;
	let bottom = crop.y + crop.height;

	if (handle === "nw" || handle === "sw") {
		left = clamp(left + deltaX, 0, right - MIN_CROP_SIZE);
	}
	if (handle === "ne" || handle === "se") {
		right = clamp(right + deltaX, left + MIN_CROP_SIZE, 1);
	}
	if (handle === "nw" || handle === "ne") {
		top = clamp(top + deltaY, 0, bottom - MIN_CROP_SIZE);
	}
	if (handle === "sw" || handle === "se") {
		bottom = clamp(bottom + deltaY, top + MIN_CROP_SIZE, 1);
	}

	return normalizeWebcamCropRegion({
		x: left,
		y: top,
		width: right - left,
		height: bottom - top,
	});
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
	const te = useScopedT("editing");
	const containerRef = useRef<HTMLDivElement | null>(null);
	const previewVideoRef = useRef<HTMLVideoElement | null>(null);
	const dragStateRef = useRef<DragState | null>(null);
	const pendingCropRef = useRef<CropRegion | null>(null);
	const pendingFrameRef = useRef<number | null>(null);
	const maskId = `webcam-crop-mask-${useId().replace(/:/g, "")}`;
	const [activeHandle, setActiveHandle] = useState<CropHandle | null>(null);
	const [draftVisualCrop, setDraftVisualCrop] = useState<CropRegion | null>(null);
	const [previewFrame, setPreviewFrame] = useState<PreviewFrame | null>(null);
	const synchronizedPreviewSrcRef = useRef<string | null>(null);
	const [synchronizedPreviewSrc, setSynchronizedPreviewSrc] = useState<string | null>(null);
	const previewSynchronized = previewSrc !== null && synchronizedPreviewSrc === previewSrc;
	const hasPreviewFrame = previewSrc !== null && previewFrame?.src === previewSrc;
	const previewAspectRatio =
		hasPreviewFrame && previewFrame && previewFrame.width > 0 && previewFrame.height > 0
			? previewFrame.width / previewFrame.height
			: 1;
	const sourceCrop = normalizeWebcamCropRegion(cropRegion);
	const propVisualCrop = mirrored ? flipCropHorizontally(sourceCrop) : sourceCrop;
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
		onCropChange(nextCrop, previewFrame);
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

		if (
			synchronizedPreviewSrcRef.current !== previewSrc &&
			!isWebcamMediaSynchronized({
				currentTime: video.currentTime,
				targetTime: mediaTargetTime,
				readyState: video.readyState,
				isSeeking: video.seeking,
			})
		) {
			video.pause();
			if (
				video.readyState >= HTMLMediaElement.HAVE_METADATA &&
				!video.seeking &&
				Math.abs(video.currentTime - mediaTargetTime) > 0.01
			) {
				try {
					video.currentTime = mediaTargetTime;
				} catch {
					/* The next media-ready event retries once the source accepts seeks. */
				}
			}
			return;
		}

		if (synchronizedPreviewSrcRef.current !== previewSrc) {
			synchronizedPreviewSrcRef.current = previewSrc;
			setSynchronizedPreviewSrc(previewSrc);
		}
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

	// biome-ignore lint/correctness/useExhaustiveDependencies: The source identity intentionally resets cached synchronization state.
	useEffect(() => {
		synchronizedPreviewSrcRef.current = null;
		setSynchronizedPreviewSrc(null);
		setPreviewFrame(null);
	}, [previewSrc]);

	const commitVisualCrop = (nextVisualCrop: CropRegion, immediate = false) => {
		const nextCrop = mirrored
			? flipCropHorizontally(nextVisualCrop)
			: normalizeWebcamCropRegion(nextVisualCrop);
		if (immediate) {
			cancelPendingCommit();
			pendingCropRef.current = null;
			onCropChange(nextCrop, previewFrame);
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

	const getPointerPosition = (event: React.PointerEvent<HTMLElement>) => {
		const rect = containerRef.current?.getBoundingClientRect();
		if (!rect || rect.width <= 0 || rect.height <= 0) {
			return null;
		}

		return {
			x: clamp((event.clientX - rect.left) / rect.width, 0, 1),
			y: clamp((event.clientY - rect.top) / rect.height, 0, 1),
		};
	};

	const handlePointerDown = (event: React.PointerEvent<HTMLElement>, handle: CropHandle) => {
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
		commitVisualCrop(resizeCrop(crop, handle, delta.x, delta.y), true);
	};

	return (
		<Surface
			ref={containerRef}
			variant="secondary"
			data-webcam-crop-control
			className="relative w-full touch-none select-none overflow-clip rounded-lg border border-foreground/10"
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
						opacity: hasPreviewFrame && previewSynchronized ? 1 : 0,
						transform: mirrored ? "scaleX(-1)" : undefined,
					}}
					muted
					playsInline
					preload="auto"
					aria-hidden="true"
					onLoadedMetadata={handlePreviewFrameReady}
					onLoadedData={handlePreviewFrameReady}
					onCanPlay={handlePreviewFrameReady}
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
					"group/webcam-crop absolute border border-white/80 shadow-[0_0_0_1px_rgba(0,0,0,0.15)] focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:ring-offset-2 focus-visible:ring-offset-editor-dialog",
					activeHandle === "move" ? "cursor-grabbing" : "cursor-grab",
				)}
				style={{
					left: `${cropLeft}%`,
					top: `${cropTop}%`,
					width: `${cropWidth}%`,
					height: `${cropHeight}%`,
				}}
				tabIndex={0}
				aria-label={te("webcamCropmove")}
				onPointerDown={(event) => handlePointerDown(event, "move")}
				onFocus={() => setActiveHandle("move")}
				onBlur={() => setActiveHandle(null)}
				onKeyDown={(event) => handleKeyboardAdjust(event, "move")}
			>
				<div className="pointer-events-none absolute inset-0 opacity-0 transition-opacity group-hover/webcam-crop:opacity-100 group-focus-within/webcam-crop:opacity-100">
					<div className="absolute left-1/3 top-0 h-full w-px bg-white/30" />
					<div className="absolute left-2/3 top-0 h-full w-px bg-white/30" />
					<div className="absolute left-0 top-1/3 h-px w-full bg-white/30" />
					<div className="absolute left-0 top-2/3 h-px w-full bg-white/30" />
				</div>
				<span id={`${maskId}-dimensions`} className="sr-only">
					{Math.round(crop.width * 100)}% × {Math.round(crop.height * 100)}%
				</span>

				{RESIZE_HANDLES.map((handle) => (
					<Button
						key={handle.handle}
						type="button"
						variant="ghost"
						size="icon"
						tabIndex={0}
						aria-label={te(`webcamCrop${handle.handle}`)}
						aria-describedby={`${maskId}-dimensions`}
						className={cn(
							"absolute z-10 !size-7 !min-w-0 !scale-100 !rounded-none !border-0 !bg-transparent !p-0",
							handle.className,
							handle.cursorClassName,
						)}
						onPointerDown={(event) => handlePointerDown(event, handle.handle)}
						onFocus={() => setActiveHandle(handle.handle)}
						onBlur={() => setActiveHandle(null)}
						onKeyDown={(event) => handleKeyboardAdjust(event, handle.handle)}
					>
						<span
							aria-hidden="true"
							className={cn(
								"pointer-events-none absolute size-3.5 border-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.4)]",
								handle.cornerClassName,
							)}
						/>
					</Button>
				))}
			</div>
		</Surface>
	);
}
