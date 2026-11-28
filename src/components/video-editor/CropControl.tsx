import { type PointerEvent, useEffect, useRef } from "react";
import { useScopedT } from "@/contexts/I18nContext";
import { type CropHandle, dragCrop } from "./cropGeometry";
import type { CropRegion } from "./types";

interface CropControlProps {
	videoElement: HTMLVideoElement | null;
	cropRegion: CropRegion;
	onCropChange: (region: CropRegion) => void;
	lockedRatio?: number | null;
}
const handles: CropHandle[] = ["n", "s", "e", "w", "nw", "ne", "sw", "se"];

export function CropControl({
	videoElement,
	cropRegion,
	onCropChange,
	lockedRatio = null,
}: CropControlProps) {
	const te = useScopedT("editing");
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const containerRef = useRef<HTMLDivElement>(null);
	const drag = useRef<{
		handle: CropHandle;
		x: number;
		y: number;
		crop: CropRegion;
		ratio: number;
		dx: number;
		dy: number;
	} | null>(null);
	const sourceRatio = (videoElement?.videoWidth || 1920) / (videoElement?.videoHeight || 1080);

	useEffect(() => {
		if (!videoElement || !canvasRef.current) return;
		const canvas = canvasRef.current;
		const ctx = canvas.getContext("2d", { alpha: false });
		if (!ctx) return;
		let frame = 0;
		let lastTime = -1;
		const draw = () => {
			if (
				videoElement.readyState >= 2 &&
				(lastTime !== videoElement.currentTime ||
					canvas.width !== videoElement.videoWidth ||
					canvas.height !== videoElement.videoHeight)
			) {
				if (canvas.width !== videoElement.videoWidth)
					canvas.width = videoElement.videoWidth;
				if (canvas.height !== videoElement.videoHeight)
					canvas.height = videoElement.videoHeight;
				ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
				lastTime = videoElement.currentTime;
			}
			frame = requestAnimationFrame(draw);
		};
		frame = requestAnimationFrame(draw);
		return () => cancelAnimationFrame(frame);
	}, [videoElement]);

	useEffect(() => {
		const snap = (event: KeyboardEvent) => {
			const active = drag.current;
			if (event.key === "Shift" && active)
				onCropChange(
					dragCrop(
						active.crop,
						active.handle,
						active.dx,
						active.dy,
						lockedRatio ?? (event.type === "keydown" ? active.ratio : null),
						sourceRatio,
					),
				);
		};
		window.addEventListener("keydown", snap);
		window.addEventListener("keyup", snap);
		return () => {
			window.removeEventListener("keydown", snap);
			window.removeEventListener("keyup", snap);
		};
	}, [onCropChange, lockedRatio, sourceRatio]);

	const start = (event: PointerEvent<HTMLDivElement>, handle: CropHandle) => {
		if (event.button !== 0) return;
		event.preventDefault();
		event.stopPropagation();
		drag.current = {
			handle,
			x: event.clientX,
			y: event.clientY,
			crop: cropRegion,
			ratio: (cropRegion.width * sourceRatio) / cropRegion.height,
			dx: 0,
			dy: 0,
		};
		event.currentTarget.setPointerCapture(event.pointerId);
	};
	const move = (event: PointerEvent) => {
		const active = drag.current;
		const rect = containerRef.current?.getBoundingClientRect();
		if (!active || !rect?.width || !rect.height) return;
		active.dx = (event.clientX - active.x) / rect.width;
		active.dy = (event.clientY - active.y) / rect.height;
		onCropChange(
			dragCrop(
				active.crop,
				active.handle,
				active.dx,
				active.dy,
				lockedRatio ?? (event.shiftKey ? active.ratio : null),
				sourceRatio,
			),
		);
	};
	const stop = () => {
		drag.current = null;
	};
	return (
		<div
			ref={containerRef}
			data-testid="crop-surface"
			className="relative select-none bg-black"
			style={{
				width: `min(100cqw, calc(100cqh * ${sourceRatio}))`,
				height: `min(100cqh, calc(100cqw / ${sourceRatio}))`,
				touchAction: "none",
			}}
			onPointerMove={move}
			onPointerUp={stop}
			onPointerCancel={stop}
			onLostPointerCapture={stop}
		>
			<canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
			<div
				data-testid="crop-selection"
				aria-label={te("moveCrop", "Move crop")}
				className="crop-selection absolute cursor-move"
				style={{
					left: `${cropRegion.x * 100}%`,
					top: `${cropRegion.y * 100}%`,
					width: `${cropRegion.width * 100}%`,
					height: `${cropRegion.height * 100}%`,
				}}
				onPointerDown={(event) => start(event, "move")}
			>
				{handles.map((handle) => (
					<div
						key={handle}
						aria-label={te(`crop${handle}`)}
						data-crop-handle={handle}
						className="absolute z-10"
						style={{
							left: handle.includes("w") ? 0 : handle.includes("e") ? "100%" : "50%",
							top: handle.includes("n") ? 0 : handle.includes("s") ? "100%" : "50%",
							width:
								handle === "n" || handle === "s"
									? "max(0px, calc(100% - 28px))"
									: 28,
							height:
								handle === "e" || handle === "w"
									? "max(0px, calc(100% - 28px))"
									: 28,
							transform: "translate(-50%, -50%)",
							cursor: `${handle}-resize`,
						}}
						onPointerDown={(event) => start(event, handle)}
					>
						<span className="crop-grip" aria-hidden="true" />
					</div>
				))}
			</div>
		</div>
	);
}
