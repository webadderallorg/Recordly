import { useScopedT } from "@/contexts/I18nContext";
import { useEffect, useId, useRef, type PointerEvent } from "react";
import { dragCrop, type CropHandle } from "./cropGeometry";
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
		dx: number;
		dy: number;
	} | null>(null);
	const maskId = useId();
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
						event.type === "keydown" ? 1 : lockedRatio,
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
				event.shiftKey ? 1 : lockedRatio,
				sourceRatio,
			),
		);
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
			onPointerUp={() => {
				drag.current = null;
			}}
			onPointerCancel={() => {
				drag.current = null;
			}}
			onLostPointerCapture={() => {
				drag.current = null;
			}}
		>
			<canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
			<svg className="pointer-events-none absolute inset-0 h-full w-full">
				<defs>
					<mask id={maskId}>
						<rect width="100%" height="100%" fill="white" />
						<rect
							x={`${cropRegion.x * 100}%`}
							y={`${cropRegion.y * 100}%`}
							width={`${cropRegion.width * 100}%`}
							height={`${cropRegion.height * 100}%`}
							fill="black"
						/>
					</mask>
				</defs>
				<rect
					width="100%"
					height="100%"
					fill="black"
					fillOpacity="0.6"
					mask={`url(#${maskId})`}
				/>
			</svg>
			<div
				data-testid="crop-selection"
				aria-label={te("moveCrop", "Move crop")}
				className="absolute cursor-move border-2 border-white"
				style={{
					left: `${cropRegion.x * 100}%`,
					top: `${cropRegion.y * 100}%`,
					width: `${cropRegion.width * 100}%`,
					height: `${cropRegion.height * 100}%`,
				}}
				onPointerDown={(event) => start(event, "move")}
			>
				{[1, 2].map((line) => (
					<div key={line} className="pointer-events-none absolute inset-0">
						<div
							className="absolute h-full border-l border-white/30"
							style={{ left: `${(line * 100) / 3}%` }}
						/>
						<div
							className="absolute w-full border-t border-white/30"
							style={{ top: `${(line * 100) / 3}%` }}
						/>
					</div>
				))}
				{handles.map((handle) => (
					<div
						key={handle}
						aria-label={te(`crop${handle}`)}
						className="absolute z-10"
						style={{
							left: handle.includes("w") ? 0 : handle.includes("e") ? "100%" : "50%",
							top: handle.includes("n") ? 0 : handle.includes("s") ? "100%" : "50%",
							width: handle === "n" || handle === "s" ? "calc(100% - 20px)" : 20,
							height: handle === "e" || handle === "w" ? "calc(100% - 20px)" : 20,
							transform: "translate(-50%, -50%)",
							cursor: `${handle}-resize`,
						}}
						onPointerDown={(event) => start(event, handle)}
					>
						<span
							className="absolute left-1/2 top-1/2 block rounded-sm bg-white shadow"
							style={{
								transform: "translate(-50%, -50%)",
								width:
									handle.length === 2
										? 10
										: handle === "n" || handle === "s"
											? 24
											: 4,
								height:
									handle.length === 2
										? 10
										: handle === "e" || handle === "w"
											? 24
											: 4,
							}}
						/>
					</div>
				))}
			</div>
		</div>
	);
}
