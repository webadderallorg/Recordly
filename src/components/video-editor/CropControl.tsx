import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { AspectRatio } from "@/utils/aspectRatioUtils";
import {
	type CropRegionPixels,
	cropRegionFromPixels,
	cropRegionToPixels,
	getCropSourceDimensions,
} from "./cropRegionPixels";
import type { CropRegion } from "./types";

interface CropControlProps {
	videoElement: HTMLVideoElement | null;
	cropRegion: CropRegion;
	onCropChange: (region: CropRegion) => void;
	aspectRatio: AspectRatio;
}

type DragHandle = "top" | "right" | "bottom" | "left" | null;

export function CropControl({ videoElement, cropRegion, onCropChange }: CropControlProps) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const containerRef = useRef<HTMLDivElement>(null);
	const [isDragging, setIsDragging] = useState<DragHandle>(null);
	const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
	const [initialCrop, setInitialCrop] = useState<CropRegion>(cropRegion);

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
			if (isCancelled) {
				return;
			}

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

	const cropPixelX = cropRegion.x * 100;
	const cropPixelY = cropRegion.y * 100;
	const cropPixelWidth = cropRegion.width * 100;
	const cropPixelHeight = cropRegion.height * 100;
	const cropSourceDimensions = getCropSourceDimensions(videoElement);
	const preciseCropPixels = cropRegionToPixels(
		cropRegion,
		cropSourceDimensions.width,
		cropSourceDimensions.height,
	);
	const videoAspectRatio = cropSourceDimensions.width / cropSourceDimensions.height;
	const isVideoPortrait = videoAspectRatio < 1;
	const maxContainerWidth = isVideoPortrait ? "40vw" : "75vw";
	const maxContainerHeight = "75vh";
	const handlePixelInputChange = (field: keyof CropRegionPixels, value: number) => {
		onCropChange(
			cropRegionFromPixels(
				{
					...preciseCropPixels,
					[field]: value,
				},
				cropSourceDimensions.width,
				cropSourceDimensions.height,
			),
		);
	};

	return (
		<div className="w-full p-8">
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
			</div>
			<div className="mx-auto mt-4 max-w-2xl rounded-xl border border-white/10 bg-black/80 p-3 shadow-lg backdrop-blur">
				<div className="mb-2 flex items-center justify-between">
					<span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/70">
						Precise crop
					</span>
					<span className="text-[10px] text-white/45">
						{cropSourceDimensions.width} x {cropSourceDimensions.height}px source
					</span>
				</div>
				<div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
					{(
						[
							{ key: "x", label: "X", max: cropSourceDimensions.width - 1 },
							{ key: "y", label: "Y", max: cropSourceDimensions.height - 1 },
							{ key: "width", label: "W", max: cropSourceDimensions.width },
							{ key: "height", label: "H", max: cropSourceDimensions.height },
						] as const
					).map((input) => (
						<label key={input.key} className="space-y-1">
							<span className="text-[10px] font-medium uppercase tracking-[0.12em] text-white/50">
								{input.label}
							</span>
							<div className="flex items-center rounded-lg border border-white/10 bg-white/5 px-2 focus-within:border-[#2563EB]/70">
								<input
									type="number"
									min={0}
									max={input.max}
									step={1}
									value={preciseCropPixels[input.key]}
									onChange={(event) =>
										handlePixelInputChange(input.key, Number(event.currentTarget.value))
									}
									className="min-w-0 flex-1 bg-transparent py-1.5 text-sm tabular-nums text-white outline-none"
								/>
								<span className="text-[10px] text-white/35">px</span>
							</div>
						</label>
					))}
				</div>
			</div>
		</div>
	);
}
