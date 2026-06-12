import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import {
	findClosestPointOnPath,
	insertPointIntoSegment,
	makeCornerPoint,
	makeSmoothPoint,
	segmentControls,
} from "@/lib/webcamProcessing/maskPath";
import type { WebcamMaskPoint } from "./types";
import { getWebcamPreviewTargetTimeSeconds } from "./videoPlayback/webcamSync";

interface WebcamMaskPenEditorProps {
	points: WebcamMaskPoint[];
	mirrored?: boolean;
	previewSrc?: string | null;
	previewCurrentTime?: number;
	previewPlaying?: boolean;
	previewTimeOffsetMs?: number | null;
	onPointsChange: (points: WebcamMaskPoint[]) => void;
}

const MIN_PATH_POINTS = 3;
/** Max pixel distance from the path for a click to insert a point on it. */
const PATH_INSERT_THRESHOLD_PX = 8;

type DragKind = "anchor" | "in" | "out";

interface DragState {
	kind: DragKind;
	index: number;
}

function clamp01(value: number): number {
	return Math.min(1, Math.max(0, value));
}

/** Flips a full anchor (handles included) for mirrored display. */
function flipPointX(point: WebcamMaskPoint): WebcamMaskPoint {
	const flipped: WebcamMaskPoint = { x: 1 - point.x, y: point.y };
	if (point.inX !== undefined && point.inY !== undefined) {
		flipped.inX = 1 - point.inX;
		flipped.inY = point.inY;
	}
	if (point.outX !== undefined && point.outY !== undefined) {
		flipped.outX = 1 - point.outX;
		flipped.outY = point.outY;
	}
	return flipped;
}

function hasHandles(point: WebcamMaskPoint): boolean {
	return point.inX !== undefined || point.outX !== undefined;
}

/** Rigidly translates an anchor and its handles, clamping into 0..1. */
function translatePoint(point: WebcamMaskPoint, dx: number, dy: number): WebcamMaskPoint {
	const moved: WebcamMaskPoint = {
		x: clamp01(point.x + dx),
		y: clamp01(point.y + dy),
	};
	if (point.inX !== undefined && point.inY !== undefined) {
		moved.inX = clamp01(point.inX + dx);
		moved.inY = clamp01(point.inY + dy);
	}
	if (point.outX !== undefined && point.outY !== undefined) {
		moved.outX = clamp01(point.outX + dx);
		moved.outY = clamp01(point.outY + dy);
	}
	return moved;
}

/** Builds the closed cubic SVG path (viewBox 0..100) from display points. */
function buildPathD(points: WebcamMaskPoint[]): string {
	if (points.length < 2) {
		return "";
	}
	const fmt = (value: number) => (value * 100).toFixed(3);
	const segments = [`M ${fmt(points[0].x)},${fmt(points[0].y)}`];
	for (let index = 0; index < points.length; index++) {
		const from = points[index];
		const to = points[(index + 1) % points.length];
		const { c0, c1 } = segmentControls(from, to);
		segments.push(
			`C ${fmt(c0.x)},${fmt(c0.y)} ${fmt(c1.x)},${fmt(c1.y)} ${fmt(to.x)},${fmt(to.y)}`,
		);
	}
	segments.push("Z");
	return segments.join(" ");
}

/**
 * Pen-tool editor for the bezier mask path: shows the webcam frame at the
 * playhead with an SVG overlay. Clicking empty space appends a corner anchor,
 * clicking on the path inserts a shape-preserving anchor, dragging an anchor
 * translates it with its handles, dragging a handle reshapes the curve
 * (mirroring the opposite handle unless Alt is held), double-clicking an
 * anchor toggles corner/smooth, and Delete/Backspace removes the selected
 * anchor while more than three remain. Points are stored in source
 * (unmirrored) coordinates; display flips x when mirrored.
 */
export function WebcamMaskPenEditor({
	points,
	mirrored = false,
	previewSrc = null,
	previewCurrentTime = 0,
	previewPlaying = false,
	previewTimeOffsetMs = 0,
	onPointsChange,
}: WebcamMaskPenEditorProps) {
	const containerRef = useRef<HTMLDivElement | null>(null);
	const previewVideoRef = useRef<HTMLVideoElement | null>(null);
	const dragRef = useRef<DragState | null>(null);
	const dragStartPointsRef = useRef<WebcamMaskPoint[]>([]);
	const dragMovedRef = useRef(false);
	const [previewReady, setPreviewReady] = useState(false);
	const [draftPoints, setDraftPoints] = useState<WebcamMaskPoint[] | null>(null);
	const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

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

	const currentPoints = draftPoints ?? points;
	const displayPoints = mirrored ? currentPoints.map(flipPointX) : currentPoints;

	const getSourcePoint = useCallback(
		(event: { clientX: number; clientY: number }): { x: number; y: number } | null => {
			const rect = containerRef.current?.getBoundingClientRect();
			if (!rect || rect.width <= 0 || rect.height <= 0) {
				return null;
			}
			let x = clamp01((event.clientX - rect.left) / rect.width);
			const y = clamp01((event.clientY - rect.top) / rect.height);
			if (mirrored) {
				x = 1 - x;
			}
			return { x, y };
		},
		[mirrored],
	);

	const handleBackgroundPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
		containerRef.current?.focus();
		if (dragRef.current !== null) {
			return;
		}
		const point = getSourcePoint(event);
		if (!point) {
			return;
		}

		// Click near the path inserts a shape-preserving anchor there; the
		// distance check happens in display pixels so the threshold matches
		// what the user sees regardless of the preview size.
		const rect = containerRef.current?.getBoundingClientRect();
		if (points.length >= 2 && rect) {
			const closest = findClosestPointOnPath(points, point);
			if (closest) {
				const dxPx = (closest.point.x - point.x) * rect.width;
				const dyPx = (closest.point.y - point.y) * rect.height;
				if (Math.hypot(dxPx, dyPx) <= PATH_INSERT_THRESHOLD_PX) {
					onPointsChange(insertPointIntoSegment(points, closest.segmentIndex, closest.t));
					setSelectedIndex(closest.segmentIndex + 1);
					return;
				}
			}
		}

		onPointsChange([...points, point]);
		setSelectedIndex(points.length);
	};

	const startDrag = (event: React.PointerEvent<HTMLDivElement>, drag: DragState) => {
		event.preventDefault();
		event.stopPropagation();
		containerRef.current?.focus();
		dragRef.current = drag;
		dragStartPointsRef.current = points;
		dragMovedRef.current = false;
		setDraftPoints(points);
		try {
			containerRef.current?.setPointerCapture(event.pointerId);
		} catch {
			/* Pointer capture can fail if the drag started outside the control. */
		}
	};

	const handleAnchorPointerDown = (event: React.PointerEvent<HTMLDivElement>, index: number) => {
		setSelectedIndex(index);
		startDrag(event, { kind: "anchor", index });
	};

	const handleHandlePointerDown = (
		event: React.PointerEvent<HTMLDivElement>,
		index: number,
		kind: "in" | "out",
	) => {
		setSelectedIndex(index);
		startDrag(event, { kind, index });
	};

	const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
		const drag = dragRef.current;
		if (drag === null) {
			return;
		}
		const pointer = getSourcePoint(event);
		if (!pointer) {
			return;
		}
		dragMovedRef.current = true;
		const basePoints = dragStartPointsRef.current;
		const basePoint = basePoints[drag.index];
		if (!basePoint) {
			return;
		}

		if (drag.kind === "anchor") {
			const dx = pointer.x - basePoint.x;
			const dy = pointer.y - basePoint.y;
			setDraftPoints(
				basePoints.map((existing, index) =>
					index === drag.index ? translatePoint(basePoint, dx, dy) : existing,
				),
			);
			return;
		}

		const mirrorOpposite = !event.altKey;
		setDraftPoints(
			basePoints.map((existing, index) => {
				if (index !== drag.index) {
					return existing;
				}
				const updated: WebcamMaskPoint = { ...existing };
				if (drag.kind === "out") {
					updated.outX = pointer.x;
					updated.outY = pointer.y;
					if (
						mirrorOpposite &&
						existing.inX !== undefined &&
						existing.inY !== undefined
					) {
						updated.inX = clamp01(2 * existing.x - pointer.x);
						updated.inY = clamp01(2 * existing.y - pointer.y);
					}
				} else {
					updated.inX = pointer.x;
					updated.inY = pointer.y;
					if (
						mirrorOpposite &&
						existing.outX !== undefined &&
						existing.outY !== undefined
					) {
						updated.outX = clamp01(2 * existing.x - pointer.x);
						updated.outY = clamp01(2 * existing.y - pointer.y);
					}
				}
				return updated;
			}),
		);
	};

	const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
		if (dragRef.current === null) {
			return;
		}
		try {
			containerRef.current?.releasePointerCapture(event.pointerId);
		} catch {
			/* Pointer capture may already be released while ending the drag. */
		}
		dragRef.current = null;
		if (draftPoints && dragMovedRef.current) {
			onPointsChange(draftPoints);
		}
		dragMovedRef.current = false;
		setDraftPoints(null);
	};

	const handleAnchorDoubleClick = (event: React.MouseEvent<HTMLDivElement>, index: number) => {
		event.preventDefault();
		event.stopPropagation();
		const point = points[index];
		if (!point) {
			return;
		}
		onPointsChange(
			hasHandles(point) ? makeCornerPoint(points, index) : makeSmoothPoint(points, index),
		);
		setSelectedIndex(index);
	};

	const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
		if (event.key !== "Delete" && event.key !== "Backspace") {
			return;
		}
		event.preventDefault();
		if (
			selectedIndex === null ||
			selectedIndex >= points.length ||
			points.length <= MIN_PATH_POINTS
		) {
			return;
		}
		onPointsChange(points.filter((_, pointIndex) => pointIndex !== selectedIndex));
		setSelectedIndex(null);
	};

	if (!previewSrc) {
		return null;
	}

	const pathD = buildPathD(displayPoints);

	return (
		<div
			ref={containerRef}
			className="relative w-full cursor-crosshair touch-none select-none overflow-hidden rounded-md bg-black/20 outline-none focus-visible:ring-1 focus-visible:ring-[#2563EB]/60"
			role="application"
			aria-label="Draw mask points on the camera frame"
			tabIndex={0}
			onPointerDown={handleBackgroundPointerDown}
			onPointerMove={handlePointerMove}
			onPointerUp={endDrag}
			onPointerCancel={endDrag}
			onKeyDown={handleKeyDown}
		>
			<video
				ref={previewVideoRef}
				src={previewSrc}
				className={cn("pointer-events-none block w-full", mirrored && "-scale-x-100")}
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
			{displayPoints.length >= 2 && (
				<svg
					className="pointer-events-none absolute inset-0 h-full w-full"
					viewBox="0 0 100 100"
					preserveAspectRatio="none"
					aria-hidden="true"
				>
					<path
						d={pathD}
						fill="rgba(37, 99, 235, 0.22)"
						stroke="#2563EB"
						strokeWidth="1.5"
						vectorEffect="non-scaling-stroke"
					/>
					{displayPoints.map((point, index) => {
						if (!hasHandles(point)) {
							return null;
						}
						return (
							<g key={index} stroke="#60A5FA" strokeWidth="1">
								{point.inX !== undefined && point.inY !== undefined && (
									<line
										x1={point.x * 100}
										y1={point.y * 100}
										x2={point.inX * 100}
										y2={point.inY * 100}
										vectorEffect="non-scaling-stroke"
									/>
								)}
								{point.outX !== undefined && point.outY !== undefined && (
									<line
										x1={point.x * 100}
										y1={point.y * 100}
										x2={point.outX * 100}
										y2={point.outY * 100}
										vectorEffect="non-scaling-stroke"
									/>
								)}
							</g>
						);
					})}
				</svg>
			)}
			{displayPoints.map((point, index) => (
				<div key={index} className="contents">
					{point.inX !== undefined && point.inY !== undefined && (
						<div
							className="absolute z-10 h-2 w-2 -translate-x-1/2 -translate-y-1/2 cursor-move rounded-full border border-white bg-[#60A5FA] shadow-sm"
							style={{ left: `${point.inX * 100}%`, top: `${point.inY * 100}%` }}
							aria-label={`Mask point ${index + 1} incoming handle`}
							onPointerDown={(event) => handleHandlePointerDown(event, index, "in")}
						/>
					)}
					{point.outX !== undefined && point.outY !== undefined && (
						<div
							className="absolute z-10 h-2 w-2 -translate-x-1/2 -translate-y-1/2 cursor-move rounded-full border border-white bg-[#60A5FA] shadow-sm"
							style={{ left: `${point.outX * 100}%`, top: `${point.outY * 100}%` }}
							aria-label={`Mask point ${index + 1} outgoing handle`}
							onPointerDown={(event) => handleHandlePointerDown(event, index, "out")}
						/>
					)}
					<div
						className={cn(
							"absolute z-20 h-3 w-3 -translate-x-1/2 -translate-y-1/2 cursor-move rounded-full border-2 border-white bg-[#2563EB] shadow-sm",
							selectedIndex === index && "ring-2 ring-[#2563EB]/50",
						)}
						style={{ left: `${point.x * 100}%`, top: `${point.y * 100}%` }}
						aria-label={`Mask point ${index + 1}`}
						onPointerDown={(event) => handleAnchorPointerDown(event, index)}
						onDoubleClick={(event) => handleAnchorDoubleClick(event, index)}
					/>
				</div>
			))}
		</div>
	);
}
