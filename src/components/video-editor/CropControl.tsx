import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { type AspectRatio } from "@/utils/aspectRatioUtils";

interface CropRegion {
	x: number;
	y: number;
	width: number;
	height: number;
}

interface CropControlProps {
	videoElement: HTMLVideoElement | null;
	cropRegion: CropRegion;
	onCropChange: (region: CropRegion) => void;
	aspectRatio: AspectRatio;
}

type DragHandle = "top" | "right" | "bottom" | "left" | "move" | null;

type CropRatioPreset = "free" | "16:9" | "9:16" | "1:1" | "4:3" | "4:5" | "21:9";

const CROP_RATIO_PRESETS: Array<{ value: CropRatioPreset; label: string }> = [
	{ value: "free", label: "Free" },
	{ value: "16:9", label: "16:9" },
	{ value: "9:16", label: "9:16" },
	{ value: "1:1", label: "1:1" },
	{ value: "4:3", label: "4:3" },
	{ value: "4:5", label: "4:5" },
	{ value: "21:9", label: "21:9" },
];

function getRatioNumeric(preset: CropRatioPreset): number | null {
	if (preset === "free") return null;
	const [w, h] = preset.split(":").map(Number);
	return w / h;
}

export function CropControl({ videoElement, cropRegion, onCropChange }: CropControlProps) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const containerRef = useRef<HTMLDivElement>(null);
	const isDraggingRef = useRef<DragHandle>(null);
	const dragStartRef = useRef({ x: 0, y: 0 });
	const initialCropRef = useRef<CropRegion>(cropRegion);
	const [cropRatioPreset, setCropRatioPreset] = useState<CropRatioPreset>("free");

	const videoAspectRatio = videoElement?.videoWidth && videoElement?.videoHeight
		? videoElement.videoWidth / videoElement.videoHeight
		: 16 / 9;

	useEffect(() => {
		if (!videoElement || !canvasRef.current) return;

		const canvas = canvasRef.current;
		const ctx = canvas.getContext("2d", { alpha: false });
		if (!ctx) return;

		canvas.width = videoElement.videoWidth || 1920;
		canvas.height = videoElement.videoHeight || 1080;

		let animationFrameId = 0;
		let isCancelled = false;

		const draw = () => {
			if (isCancelled) return;
			if (videoElement.readyState >= 2) {
				ctx.clearRect(0, 0, canvas.width, canvas.height);
				ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
			}
			animationFrameId = requestAnimationFrame(draw);
		};

		animationFrameId = requestAnimationFrame(draw);
		return () => {
			isCancelled = true;
			cancelAnimationFrame(animationFrameId);
		};
	}, [videoElement]);

	const targetNormalizedRatio = useMemo(() => {
		if (cropRatioPreset === "free") return null;
		const ratio = getRatioNumeric(cropRatioPreset);
		return ratio !== null ? ratio / videoAspectRatio : null;
	}, [cropRatioPreset, videoAspectRatio]);

	const constrainToRatio = useCallback(
		(crop: CropRegion, handle: Exclude<DragHandle, null>): CropRegion => {
			if (targetNormalizedRatio === null) return crop;

			const { x, y, width, height } = crop;
			const MIN_SIZE = 0.1;

			switch (handle) {
				case "bottom": {
					let h = Math.max(MIN_SIZE, Math.min(height, 1 - y));
					let w = h * targetNormalizedRatio;
					if (x + w > 1) {
						w = Math.max(MIN_SIZE, 1 - x);
						h = w / targetNormalizedRatio;
					}
					if (y + h > 1) {
						h = Math.max(MIN_SIZE, 1 - y);
						w = h * targetNormalizedRatio;
					}
					return { x, y, width: w, height: h };
				}
				case "right": {
					let w = Math.max(MIN_SIZE, Math.min(width, 1 - x));
					let h = w / targetNormalizedRatio;
					if (y + h > 1) {
						h = Math.max(MIN_SIZE, 1 - y);
						w = h * targetNormalizedRatio;
					}
					if (x + w > 1) {
						w = Math.max(MIN_SIZE, 1 - x);
						h = w / targetNormalizedRatio;
					}
					return { x, y, width: w, height: h };
				}
				case "top": {
					const bottomEdge = y + height;
					let h = Math.max(MIN_SIZE, bottomEdge - y);
					let w = h * targetNormalizedRatio;
					if (x + w > 1) {
						w = Math.max(MIN_SIZE, 1 - x);
						h = w / targetNormalizedRatio;
					}
					const ny = Math.max(0, bottomEdge - h);
					return { x, y: ny, width: w, height: bottomEdge - ny };
				}
				case "left": {
					const rightEdge = x + width;
					let w = Math.max(MIN_SIZE, rightEdge - x);
					let h = w / targetNormalizedRatio;
					if (y + h > 1) {
						h = Math.max(MIN_SIZE, 1 - y);
						w = h * targetNormalizedRatio;
					}
					const nx = Math.max(0, rightEdge - w);
					return { x: nx, y, width: rightEdge - nx, height: h };
				}
				default:
					return crop;
			}
		},
		[targetNormalizedRatio],
	);

	const handlePointerDown = (e: React.PointerEvent, handle: DragHandle) => {
		e.stopPropagation();
		e.preventDefault();
		const rect = containerRef.current?.getBoundingClientRect();
		if (!rect || rect.width <= 0 || rect.height <= 0) return;

		isDraggingRef.current = handle;
		dragStartRef.current = {
			x: (e.clientX - rect.left) / rect.width,
			y: (e.clientY - rect.top) / rect.height,
		};
		initialCropRef.current = cropRegion;
		document.body.style.cursor = "grabbing";
	};

	const handlePointerMove = (e: React.PointerEvent) => {
		const handle = isDraggingRef.current;
		if (!handle) return;

		const rect = containerRef.current?.getBoundingClientRect();
		if (!rect || rect.width <= 0 || rect.height <= 0) return;

		const currentX = (e.clientX - rect.left) / rect.width;
		const currentY = (e.clientY - rect.top) / rect.height;
		const deltaX = currentX - dragStartRef.current.x;
		const deltaY = currentY - dragStartRef.current.y;
		const init = initialCropRef.current;

		let newCrop = { ...init };

		switch (handle) {
			case "move": {
				let newX = init.x + deltaX;
				let newY = init.y + deltaY;
				newX = Math.max(0, Math.min(newX, 1 - init.width));
				newY = Math.max(0, Math.min(newY, 1 - init.height));
				newCrop.x = newX;
				newCrop.y = newY;
				break;
			}
			case "top": {
				const newY = Math.max(0, init.y + deltaY);
				const bottom = init.y + init.height;
				newCrop.y = Math.min(newY, bottom - 0.1);
				newCrop.height = bottom - newCrop.y;
				break;
			}
			case "bottom":
				newCrop.height = Math.max(0.1, Math.min(init.height + deltaY, 1 - init.y));
				break;
			case "left": {
				const newX = Math.max(0, init.x + deltaX);
				const right = init.x + init.width;
				newCrop.x = Math.min(newX, right - 0.1);
				newCrop.width = right - newCrop.x;
				break;
			}
			case "right":
				newCrop.width = Math.max(0.1, Math.min(init.width + deltaX, 1 - init.x));
				break;
		}

		if (targetNormalizedRatio !== null) {
			newCrop = constrainToRatio(newCrop, handle);
		}

		onCropChange(newCrop);
	};

	const handlePointerUp = () => {
		if (!isDraggingRef.current) return;
		document.body.style.cursor = "";
		isDraggingRef.current = null;
	};

	const cropPixelX = cropRegion.x * 100;
	const cropPixelY = cropRegion.y * 100;
	const cropPixelWidth = cropRegion.width * 100;
	const cropPixelHeight = cropRegion.height * 100;
	const isVideoPortrait = videoAspectRatio < 1;
	const maxContainerWidth = isVideoPortrait ? "40vw" : "75vw";
	const maxContainerHeight = "75vh";

	return (
		<div className="w-full p-8 font-sans">
			<div
				ref={containerRef}
				className="relative w-full bg-black rounded-lg overflow-visible cursor-default select-none shadow-2xl"
				style={{
					aspectRatio: videoAspectRatio,
					maxWidth: maxContainerWidth,
					maxHeight: maxContainerHeight,
					margin: "0 auto",
					touchAction: "none",
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

				<div className="absolute inset-0 pointer-events-none" style={{ transition: "none" }}>
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
				<div
					className="absolute z-10 pointer-events-auto cursor-grab active:cursor-grabbing"
					style={{
						left: `${cropPixelX}%`,
						top: `${cropPixelY}%`,
						width: `${cropPixelWidth}%`,
						height: `${cropPixelHeight}%`,
					}}
					onPointerDown={(e) => handlePointerDown(e, "move")}
				/>

				<div
					className="absolute cursor-ns-resize z-20 pointer-events-auto bg-[#2563EB]"
					style={{
						left: `${cropPixelX}%`,
						top: `${cropPixelY}%`,
						width: `${cropPixelWidth}%`,
						height: "3px",
						transform: "translateY(-50%)",
					}}
					onPointerDown={(e) => handlePointerDown(e, "top")}
				/>

				<div
					className="absolute cursor-ns-resize z-20 pointer-events-auto bg-[#2563EB]"
					style={{
						left: `${cropPixelX}%`,
						top: `${cropPixelY + cropPixelHeight}%`,
						width: `${cropPixelWidth}%`,
						height: "3px",
						transform: "translateY(-50%)",
					}}
					onPointerDown={(e) => handlePointerDown(e, "bottom")}
				/>

				<div
					className="absolute cursor-ew-resize z-20 pointer-events-auto bg-[#2563EB]"
					style={{
						left: `${cropPixelX}%`,
						top: `${cropPixelY}%`,
						height: `${cropPixelHeight}%`,
						width: "3px",
						transform: "translateX(-50%)",
					}}
					onPointerDown={(e) => handlePointerDown(e, "left")}
				/>

				<div
					className="absolute cursor-ew-resize z-20 pointer-events-auto bg-[#2563EB]"
					style={{
						left: `${cropPixelX + cropPixelWidth}%`,
						top: `${cropPixelY}%`,
						height: `${cropPixelHeight}%`,
						width: "3px",
						transform: "translateX(-50%)",
					}}
					onPointerDown={(e) => handlePointerDown(e, "right")}
				/>
			</div>

			<div className="mt-12 flex items-center justify-center gap-2">
				{CROP_RATIO_PRESETS.map((preset) => {
					const isActive = cropRatioPreset === preset.value;
					return (
						<button
							key={preset.value}
							type="button"
							onClick={() => {
								setCropRatioPreset(preset.value);
								if (preset.value !== "free") {
									const ratio = getRatioNumeric(preset.value);
									if (ratio !== null) {
										const currentRatio = (cropRegion.width / cropRegion.height) * videoAspectRatio;
										if (Math.abs(currentRatio - ratio) > 0.001) {
											const normRatio = ratio / videoAspectRatio;
											let newW: number;
											let newH: number;
											if (currentRatio > ratio) {
												newH = cropRegion.height;
												newW = newH * normRatio;
												if (cropRegion.x + newW > 1) {
													newW = Math.max(0.1, 1 - cropRegion.x);
													newH = newW / normRatio;
												}
											} else {
												newW = cropRegion.width;
												newH = newW / normRatio;
												if (cropRegion.y + newH > 1) {
													newH = Math.max(0.1, 1 - cropRegion.y);
													newW = newH * normRatio;
												}
											}
											const newX = Math.max(0, cropRegion.x + (cropRegion.width - newW) / 2);
											const newY = Math.max(0, cropRegion.y + (cropRegion.height - newH) / 2);
											onCropChange({
												x: newX,
												y: newY,
												width: Math.min(newW, 1 - newX),
												height: Math.min(newH, 1 - newY),
											});
										}
									}
								}
							}}
							className={cn(
								"relative flex items-center gap-1 rounded-lg px-4 py-2.5 text-xs font-semibold shadow-sm transition-all",
								isActive
									? "bg-[#2563EB] text-white"
									: "bg-foreground/[0.06] text-muted-foreground hover:bg-foreground/[0.10] hover:text-foreground",
							)}
						>
							{preset.label}
						</button>
					);
				})}
			</div>
		</div>
	);
}
