import { useEffect, useRef } from "react";
import {
	getActiveSpotlights,
	getSpotlightDimAlpha,
	getSpotlightHoleStrengths,
	paintSpotlightMask,
	SPOTLIGHT_CORNER_RADIUS,
} from "@/lib/spotlight/spotlightMask";
import { type AnnotationRegion, BASE_PREVIEW_WIDTH } from "./types";

const MAX_CANVAS_EDGE = 4096;

interface SpotlightMaskOverlayProps {
	annotations: AnnotationRegion[];
	timeMs: number;
	/** Size of the video (recording) rect in unscaled preview pixels. */
	width: number;
	height: number;
	/** Rounded corner radius of the video in unscaled preview pixels. */
	videoCornerRadius: number;
	/** Current scene zoom, used to keep the mask edges sharp while zoomed in. */
	sceneScale: number;
}

/** Dims the preview video outside every active spotlight annotation. */
export function SpotlightMaskOverlay({
	annotations,
	timeMs,
	width,
	height,
	videoCornerRadius,
	sceneScale,
}: SpotlightMaskOverlayProps) {
	const canvasRef = useRef<HTMLCanvasElement>(null);

	useEffect(() => {
		const canvas = canvasRef.current;
		const ctx = canvas?.getContext("2d");
		if (!canvas || !ctx || width <= 0 || height <= 0) return;

		const pixelRatio = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
		const resolution = Math.min(
			pixelRatio * Math.max(1, sceneScale),
			MAX_CANVAS_EDGE / Math.max(width, height),
		);
		const pixelWidth = Math.max(1, Math.round(width * resolution));
		const pixelHeight = Math.max(1, Math.round(height * resolution));
		if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
			canvas.width = pixelWidth;
			canvas.height = pixelHeight;
		}

		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.clearRect(0, 0, canvas.width, canvas.height);

		const spotlights = getActiveSpotlights(annotations, timeMs);
		if (spotlights.length === 0) return;

		const strengths = getSpotlightHoleStrengths(spotlights, timeMs);
		ctx.setTransform(resolution, 0, 0, resolution, 0, 0);
		paintSpotlightMask(ctx, {
			area: { x: 0, y: 0, width, height },
			areaRadius: videoCornerRadius,
			holes: spotlights.map((spotlight, index) => ({
				x: (spotlight.position.x / 100) * width,
				y: (spotlight.position.y / 100) * height,
				width: (spotlight.size.width / 100) * width,
				height: (spotlight.size.height / 100) * height,
				strength: strengths[index],
			})),
			holeRadius: SPOTLIGHT_CORNER_RADIUS * (width / BASE_PREVIEW_WIDTH),
			alpha: getSpotlightDimAlpha(spotlights, timeMs),
		});
	}, [annotations, timeMs, width, height, videoCornerRadius, sceneScale]);

	return (
		<canvas
			ref={canvasRef}
			aria-hidden="true"
			className="absolute left-0 top-0"
			style={{ width, height, pointerEvents: "none" }}
		/>
	);
}
