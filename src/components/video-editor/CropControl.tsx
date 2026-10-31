import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

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
}

type DragHandle = "top" | "right" | "bottom" | "left" | null;

function getVideoAspectRatio(videoElement: HTMLVideoElement | null): number {
	if (!videoElement) return 16 / 9;
	return videoElement.videoWidth > 0 && videoElement.videoHeight > 0
		? videoElement.videoWidth / videoElement.videoHeight
		: 16 / 9;
}

export function CropControl({ videoElement, cropRegion, onCropChange }: CropControlProps) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const containerRef = useRef<HTMLDivElement>(null);
	const [isDragging, setIsDragging] = useState<DragHandle>(null);
	const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
	const [initialCrop, setInitialCrop] = useState<CropRegion>(cropRegion);
	const [videoAspectRatio, setVideoAspectRatio] = useState(() =>
		getVideoAspectRatio(videoElement),
	);

	useEffect(() => {
		const updateVideoAspectRatio = () => {
			setVideoAspectRatio(getVideoAspectRatio(videoElement));
		};

		updateVideoAspectRatio();
		videoElement?.addEventListener("loadedmetadata", updateVideoAspectRatio);
		videoElement?.addEventListener("resize", updateVideoAspectRatio);
		return () => {
			videoElement?.removeEventListener("loadedmetadata", updateVideoAspectRatio);
			videoElement?.removeEventListener("resize", updateVideoAspectRatio);
		};
	}, [videoElement]);

	useEffect(() => {
		if (!videoElement || !canvasRef.current) return;

		const canvas = canvasRef.current;
		const ctx = canvas.getContext("2d", { alpha: false });
		if (!ctx) return;

		let animationFrameId = 0;
		let isCancelled = false;

		const draw = () => {
			if (isCancelled) {
				return;
			}

			const width = videoElement.videoWidth || canvas.width || 1920;
			const height = videoElement.videoHeight || canvas.height || 1080;
			if (canvas.width !== width) canvas.width = width;
			if (canvas.height !== height) canvas.height = height;

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

	return (
		<div
			className="flex h-full min-h-0 w-full touch-none items-center justify-center p-2"
			style={{ containerType: "size" }}
		>
			<div
				ref={containerRef}
				className="relative overflow-visible rounded-lg bg-black shadow-2xl cursor-default select-none"
				style={{
					aspectRatio: videoAspectRatio,
					width: `min(100cqw, calc(100cqh * ${videoAspectRatio}))`,
					height: `min(100cqh, calc(100cqw / ${videoAspectRatio}))`,
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
		</div>
	);
}
