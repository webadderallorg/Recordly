import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { type AspectRatio } from "@/utils/aspectRatioUtils";
import {
	computeCursorFollowCrop,
	createCursorFollowCropState,
	resetCursorFollowCropState,
} from "./videoPlayback/cursorFollowCrop";
import type { CursorFollowCropSettings, CursorTelemetryPoint } from "./types";

interface CropRegion {
	x: number; // 0-1 normalized
	y: number; // 0-1 normalized
	width: number; // 0-1 normalized
	height: number; // 0-1 normalized
}

interface CropControlProps {
	videoElement: HTMLVideoElement | null;
	cropRegion: CropRegion;
	onCropChange: (region: CropRegion) => void;
	aspectRatio: AspectRatio;
	cursorFollow?: CursorFollowCropSettings;
	onCursorFollowChange?: (settings: CursorFollowCropSettings) => void;
	cursorTelemetry?: CursorTelemetryPoint[];
	currentTimeMs?: number;
}

type DragHandle = "top" | "right" | "bottom" | "left" | null;

interface ResolutionPreset {
	id: string;
	label: string;
	width: number;
	height: number;
}

const OUTPUT_RESOLUTION_PRESETS: ResolutionPreset[] = [
	{ id: "1080p", label: "1080p", width: 1920, height: 1080 },
	{ id: "720p", label: "720p", width: 1280, height: 720 },
	{ id: "480p", label: "480p", width: 854, height: 480 },
];

const RESOLUTION_MATCH_EPSILON = 0.005;

function matchActiveResolutionPreset(
	crop: CropRegion,
	sourceWidth: number,
	sourceHeight: number,
): string | null {
	if (!sourceWidth || !sourceHeight) return null;
	for (const preset of OUTPUT_RESOLUTION_PRESETS) {
		const w = Math.min(1, preset.width / sourceWidth);
		const h = Math.min(1, preset.height / sourceHeight);
		if (
			Math.abs(crop.width - w) < RESOLUTION_MATCH_EPSILON &&
			Math.abs(crop.height - h) < RESOLUTION_MATCH_EPSILON
		) {
			return preset.id;
		}
	}
	return null;
}

export function CropControl({
	videoElement,
	cropRegion,
	onCropChange,
	cursorFollow,
	onCursorFollowChange,
	cursorTelemetry,
	currentTimeMs,
}: CropControlProps) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const containerRef = useRef<HTMLDivElement>(null);
	const [isDragging, setIsDragging] = useState<DragHandle>(null);
	const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
	const [initialCrop, setInitialCrop] = useState<CropRegion>(cropRegion);

	const followEnabled = cursorFollow?.enabled === true;
	const previewMode = cursorFollow?.previewMode ?? "source";
	const showOutputMode = followEnabled && previewMode === "output";

	const followStateRef = useRef(createCursorFollowCropState());
	const [effectiveCrop, setEffectiveCrop] = useState<CropRegion>(cropRegion);

	useEffect(() => {
		resetCursorFollowCropState(followStateRef.current);
	}, [followEnabled, cropRegion.width, cropRegion.height]);

	useEffect(() => {
		if (!followEnabled || !cursorFollow) {
			setEffectiveCrop(cropRegion);
			return;
		}
		const samples = cursorTelemetry ?? [];
		const t = typeof currentTimeMs === "number" ? currentTimeMs : 0;
		const next = computeCursorFollowCrop(
			followStateRef.current,
			samples,
			t,
			cropRegion,
			cursorFollow,
		);
		setEffectiveCrop(next);
	}, [followEnabled, cursorFollow, cropRegion, cursorTelemetry, currentTimeMs]);

	useEffect(() => {
		if (!videoElement || !canvasRef.current) return;

		const canvas = canvasRef.current;
		const ctx = canvas.getContext("2d", { alpha: false });
		if (!ctx) return;

		const sourceWidth = videoElement.videoWidth || 1920;
		const sourceHeight = videoElement.videoHeight || 1080;
		canvas.width = sourceWidth;
		canvas.height = sourceHeight;

		let animationFrameId = 0;
		let isCancelled = false;

		const draw = () => {
			if (isCancelled) {
				return;
			}

			if (videoElement.readyState >= 2) {
				ctx.clearRect(0, 0, canvas.width, canvas.height);
				if (showOutputMode) {
					const sx = effectiveCrop.x * sourceWidth;
					const sy = effectiveCrop.y * sourceHeight;
					const sw = Math.max(1, effectiveCrop.width * sourceWidth);
					const sh = Math.max(1, effectiveCrop.height * sourceHeight);
					ctx.drawImage(videoElement, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
				} else {
					ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
				}
			}
			animationFrameId = requestAnimationFrame(draw);
		};

		animationFrameId = requestAnimationFrame(draw);
		return () => {
			isCancelled = true;
			cancelAnimationFrame(animationFrameId);
		};
	}, [videoElement, showOutputMode, effectiveCrop]);

	const getContainerRect = () => {
		return (
			containerRef.current?.getBoundingClientRect() || {
				width: 0,
				height: 0,
				left: 0,
				top: 0,
			}
		);
	};

	const handlePointerDown = (e: React.PointerEvent, handle: DragHandle) => {
		e.stopPropagation();
		e.preventDefault();
		const rect = getContainerRect();
		if (rect.width <= 0 || rect.height <= 0) {
			return;
		}

		setIsDragging(handle);
		setDragStart({
			x: (e.clientX - rect.left) / rect.width,
			y: (e.clientY - rect.top) / rect.height,
		});
		setInitialCrop(cropRegion);

		e.currentTarget.setPointerCapture(e.pointerId);
	};

	const handlePointerMove = (e: React.PointerEvent) => {
		if (!isDragging) return;

		const rect = getContainerRect();
		if (rect.width <= 0 || rect.height <= 0) {
			return;
		}

		const currentX = (e.clientX - rect.left) / rect.width;
		const currentY = (e.clientY - rect.top) / rect.height;
		const deltaX = currentX - dragStart.x;
		const deltaY = currentY - dragStart.y;

		let newCrop = { ...initialCrop };

		if (followEnabled) {
			// When tracking cursor, drag handles only resize the viewport — never
			// reposition. The viewport's top-left is computed per-frame from cursor
			// telemetry, so we keep crop.x/y as the home position unchanged and only
			// adjust width/height.
			switch (isDragging) {
				case "top": {
					const nextHeight = Math.max(0.1, Math.min(1, initialCrop.height - deltaY));
					newCrop.height = nextHeight;
					break;
				}
				case "bottom": {
					const nextHeight = Math.max(0.1, Math.min(1, initialCrop.height + deltaY));
					newCrop.height = nextHeight;
					break;
				}
				case "left": {
					const nextWidth = Math.max(0.1, Math.min(1, initialCrop.width - deltaX));
					newCrop.width = nextWidth;
					break;
				}
				case "right": {
					const nextWidth = Math.max(0.1, Math.min(1, initialCrop.width + deltaX));
					newCrop.width = nextWidth;
					break;
				}
			}
		} else {
			switch (isDragging) {
				case "top": {
					const newY = Math.max(0, initialCrop.y + deltaY);
					const bottom = initialCrop.y + initialCrop.height;
					newCrop.y = Math.min(newY, bottom - 0.1);
					newCrop.height = bottom - newCrop.y;
					break;
				}
				case "bottom":
					newCrop.height = Math.max(
						0.1,
						Math.min(initialCrop.height + deltaY, 1 - initialCrop.y),
					);
					break;
				case "left": {
					const newX = Math.max(0, initialCrop.x + deltaX);
					const right = initialCrop.x + initialCrop.width;
					newCrop.x = Math.min(newX, right - 0.1);
					newCrop.width = right - newCrop.x;
					break;
				}
				case "right":
					newCrop.width = Math.max(
						0.1,
						Math.min(initialCrop.width + deltaX, 1 - initialCrop.x),
					);
					break;
			}
		}

		onCropChange(newCrop);
	};

	const handlePointerUp = (e: React.PointerEvent) => {
		if (isDragging) {
			try {
				e.currentTarget.releasePointerCapture(e.pointerId);
			} catch {
				/* Pointer capture may already be released while ending the drag. */
			}
		}
		setIsDragging(null);
	};

	const overlayCrop = followEnabled ? effectiveCrop : cropRegion;
	const cropPixelX = overlayCrop.x * 100;
	const cropPixelY = overlayCrop.y * 100;
	const cropPixelWidth = overlayCrop.width * 100;
	const cropPixelHeight = overlayCrop.height * 100;
	const videoAspectRatio = videoElement
		? videoElement.videoWidth / videoElement.videoHeight
		: 16 / 9;
	const isVideoPortrait = videoAspectRatio < 1;
	const maxContainerWidth = isVideoPortrait ? "40vw" : "75vw";
	const maxContainerHeight = "75vh";

	const handleToggleFollow = (next: boolean) => {
		if (!cursorFollow || !onCursorFollowChange) return;
		onCursorFollowChange({ ...cursorFollow, enabled: next });
	};
	const handleSafeZoneChange = (value: number) => {
		if (!cursorFollow || !onCursorFollowChange) return;
		onCursorFollowChange({ ...cursorFollow, safeZoneRatio: value });
	};
	const handleSmoothnessChange = (value: number) => {
		if (!cursorFollow || !onCursorFollowChange) return;
		onCursorFollowChange({ ...cursorFollow, smoothness: value });
	};
	const handlePreviewModeChange = (mode: "source" | "output") => {
		if (!cursorFollow || !onCursorFollowChange) return;
		onCursorFollowChange({ ...cursorFollow, previewMode: mode });
	};
	const handleTrackTextCursorChange = (value: boolean) => {
		if (!cursorFollow || !onCursorFollowChange) return;
		onCursorFollowChange({ ...cursorFollow, trackTextCursor: value });
	};
	const handleTextZoomChange = (value: boolean) => {
		if (!cursorFollow || !onCursorFollowChange) return;
		onCursorFollowChange({ ...cursorFollow, textZoomEnabled: value });
	};

	const sourceWidthPx = videoElement?.videoWidth ?? 0;
	const sourceHeightPx = videoElement?.videoHeight ?? 0;
	const activePresetId = matchActiveResolutionPreset(cropRegion, sourceWidthPx, sourceHeightPx);
	const currentOutputWidthPx = Math.max(1, Math.round(cropRegion.width * sourceWidthPx));
	const currentOutputHeightPx = Math.max(1, Math.round(cropRegion.height * sourceHeightPx));

	const handleResolutionPreset = (preset: ResolutionPreset) => {
		if (!sourceWidthPx || !sourceHeightPx) return;
		const width = Math.min(1, preset.width / sourceWidthPx);
		const height = Math.min(1, preset.height / sourceHeightPx);
		// Keep the crop centered on its current center where possible.
		const cx = cropRegion.x + cropRegion.width / 2;
		const cy = cropRegion.y + cropRegion.height / 2;
		const x = Math.max(0, Math.min(1 - width, cx - width / 2));
		const y = Math.max(0, Math.min(1 - height, cy - height / 2));
		onCropChange({ x, y, width, height });
	};

	const showOverlay = !showOutputMode;
	const showHandles = !showOutputMode && (!followEnabled ? true : true);

	const controlsAvailable = useMemo(
		() => Boolean(cursorFollow && onCursorFollowChange),
		[cursorFollow, onCursorFollowChange],
	);

	return (
		<div className="w-full p-8">
			{controlsAvailable && cursorFollow ? (
				<div className="mx-auto mb-4 flex max-w-3xl flex-col gap-3 rounded-lg border border-border bg-card/40 p-4">
					<label className="flex items-center justify-between gap-3 text-sm">
						<span className="font-medium">Track cursor</span>
						<input
							type="checkbox"
							checked={cursorFollow.enabled}
							onChange={(e) => handleToggleFollow(e.target.checked)}
							className="h-4 w-4"
						/>
					</label>
					<label className="flex items-center justify-between gap-3 text-sm">
						<span className="flex flex-col">
							<span className="font-medium">Text zoom</span>
							<span className="text-xs text-muted-foreground/60">
								Zooms in on the typing area while you type
							</span>
						</span>
						<input
							type="checkbox"
							checked={cursorFollow.textZoomEnabled ?? false}
							onChange={(e) => handleTextZoomChange(e.target.checked)}
							className="h-4 w-4"
						/>
					</label>
					{cursorFollow.enabled ? (
						<>
							<div className="flex items-center gap-3 text-xs">
								<span className="w-28 text-muted-foreground">Output size</span>
								<div className="inline-flex flex-wrap gap-1">
									{OUTPUT_RESOLUTION_PRESETS.map((preset) => {
										const fits =
											sourceWidthPx >= preset.width &&
											sourceHeightPx >= preset.height;
										const active = activePresetId === preset.id;
										return (
											<button
												key={preset.id}
												type="button"
												disabled={!fits}
												onClick={() => handleResolutionPreset(preset)}
												className={cn(
													"rounded-md border px-2 py-1 transition",
													active
														? "border-foreground bg-foreground text-background"
														: "border-border bg-transparent text-muted-foreground hover:bg-foreground/10",
													!fits && "cursor-not-allowed opacity-40",
												)}
											>
												{preset.label}
											</button>
										);
									})}
								</div>
								<span className="ml-auto text-right tabular-nums text-muted-foreground">
									{sourceWidthPx && sourceHeightPx
										? `${currentOutputWidthPx}×${currentOutputHeightPx}`
										: "—"}
								</span>
							</div>
							<div className="flex items-center gap-3 text-xs">
								<span className="w-28 text-muted-foreground">Safe zone</span>
								<input
									type="range"
									min={0}
									max={0.49}
									step={0.01}
									value={cursorFollow.safeZoneRatio}
									onChange={(e) =>
										handleSafeZoneChange(Number(e.target.value))
									}
									className="flex-1"
								/>
								<span className="w-10 text-right tabular-nums">
									{Math.round(cursorFollow.safeZoneRatio * 100)}%
								</span>
							</div>
							<div className="flex items-center gap-3 text-xs">
								<span className="w-28 text-muted-foreground">Smoothness</span>
								<input
									type="range"
									min={0}
									max={1}
									step={0.01}
									value={cursorFollow.smoothness}
									onChange={(e) =>
										handleSmoothnessChange(Number(e.target.value))
									}
									className="flex-1"
								/>
								<span className="w-10 text-right tabular-nums">
									{Math.round(cursorFollow.smoothness * 100)}%
								</span>
							</div>
							<label className="flex items-center gap-3 text-xs">
								<span className="w-28 text-muted-foreground">Text cursor focus</span>
								<input
									type="checkbox"
									checked={cursorFollow.trackTextCursor ?? false}
									onChange={(e) => handleTrackTextCursorChange(e.target.checked)}
									className="h-4 w-4"
								/>
								<span className="text-muted-foreground/60">
									Locks on typing area; follows mouse when moving
								</span>
							</label>
							<div className="flex items-center gap-2 text-xs">
								<span className="w-28 text-muted-foreground">Preview</span>
								<div className="inline-flex overflow-hidden rounded-md border border-border">
									<button
										type="button"
										onClick={() => handlePreviewModeChange("source")}
										className={cn(
											"px-3 py-1 transition",
											previewMode === "source"
												? "bg-foreground text-background"
												: "bg-transparent text-muted-foreground hover:bg-foreground/10",
										)}
									>
										Source
									</button>
									<button
										type="button"
										onClick={() => handlePreviewModeChange("output")}
										className={cn(
											"px-3 py-1 transition",
											previewMode === "output"
												? "bg-foreground text-background"
												: "bg-transparent text-muted-foreground hover:bg-foreground/10",
										)}
									>
										Output
									</button>
								</div>
							</div>
						</>
					) : null}
				</div>
			) : null}
			<div
				ref={containerRef}
				className="relative w-full bg-black rounded-lg overflow-visible cursor-default select-none shadow-2xl"
				style={{
					aspectRatio: videoAspectRatio,
					maxWidth: maxContainerWidth,
					maxHeight: maxContainerHeight,
					margin: "0 auto",
				}}
				onPointerMove={handlePointerMove}
				onPointerUp={handlePointerUp}
				onPointerLeave={handlePointerUp}
			>
				<canvas
					ref={canvasRef}
					className="w-full h-full rounded-lg"
					style={{ imageRendering: "auto" }}
				/>

				{showOverlay ? (
					<div
						className="absolute inset-0 pointer-events-none"
						style={{ transition: "none" }}
					>
						<svg
							width="100%"
							height="100%"
							className="absolute inset-0"
							style={{ transition: "none" }}
						>
							<defs>
								<mask id="cropMask">
									<rect width="100%" height="100%" fill="white" />
									<rect
										x={`${cropPixelX}%`}
										y={`${cropPixelY}%`}
										width={`${cropPixelWidth}%`}
										height={`${cropPixelHeight}%`}
										fill="black"
										style={{ transition: "none" }}
									/>
								</mask>
							</defs>
							<rect
								width="100%"
								height="100%"
								fill="black"
								fillOpacity="0.6"
								mask="url(#cropMask)"
								style={{ transition: "none" }}
							/>
						</svg>
					</div>
				) : null}

				{showHandles ? (
					<>
						<div
							className={cn(
								"absolute h-[3px] cursor-ns-resize z-20 pointer-events-auto bg-[#2563EB]",
							)}
							style={{
								left: `${cropPixelX}%`,
								top: `${cropPixelY}%`,
								width: `${cropPixelWidth}%`,
								transform: "translateY(-50%)",
								willChange: "transform",
								transition: "none",
							}}
							onPointerDown={(e) => handlePointerDown(e, "top")}
						/>

						<div
							className={cn(
								"absolute h-[3px] cursor-ns-resize z-20 pointer-events-auto bg-[#2563EB]",
							)}
							style={{
								left: `${cropPixelX}%`,
								top: `${cropPixelY + cropPixelHeight}%`,
								width: `${cropPixelWidth}%`,
								transform: "translateY(-50%)",
								willChange: "transform",
								transition: "none",
							}}
							onPointerDown={(e) => handlePointerDown(e, "bottom")}
						/>

						<div
							className={cn(
								"absolute w-[3px] cursor-ew-resize z-20 pointer-events-auto bg-[#2563EB]",
							)}
							style={{
								left: `${cropPixelX}%`,
								top: `${cropPixelY}%`,
								height: `${cropPixelHeight}%`,
								transform: "translateX(-50%)",
								willChange: "transform",
								transition: "none",
							}}
							onPointerDown={(e) => handlePointerDown(e, "left")}
						/>

						<div
							className={cn(
								"absolute w-[3px] cursor-ew-resize z-20 pointer-events-auto bg-[#2563EB]",
							)}
							style={{
								left: `${cropPixelX + cropPixelWidth}%`,
								top: `${cropPixelY}%`,
								height: `${cropPixelHeight}%`,
								transform: "translateX(-50%)",
								willChange: "transform",
								transition: "none",
							}}
							onPointerDown={(e) => handlePointerDown(e, "right")}
						/>
					</>
				) : null}
			</div>
		</div>
	);
}
