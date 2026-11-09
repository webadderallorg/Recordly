import type { WebcamOverlaySettings } from "./types";
import { scaleWebcamOverlayPixels } from "./webcamOverlay";
import { traceWebcamShapeOnCanvas } from "./webcamShapePath";

/** Keep the edge transition the same size relative to the scene in preview and export. */
export function getWebcamEdgeFeatherPixels(
	frame: WebcamOverlaySettings["previewFrame"],
	viewportWidth: number,
): number {
	return frame === "standard" ? 0 : scaleWebcamOverlayPixels(16, viewportWidth);
}

/** Blends a blurred perimeter into a sharp center, then feathers its alpha. */
export class WebcamEdgeFeather {
	private source: HTMLCanvasElement | null = null;
	private mask: HTMLCanvasElement | null = null;

	destroy() {
		for (const canvas of [this.source, this.mask]) {
			if (canvas) {
				canvas.width = 0;
				canvas.height = 0;
			}
		}
		this.source = null;
		this.mask = null;
	}

	apply(
		canvas: HTMLCanvasElement,
		contour: Parameters<typeof traceWebcamShapeOnCanvas>[1],
		featherPixels: number,
	) {
		const inset = Math.min(featherPixels, contour.width / 8, contour.height / 8);
		if (!Number.isFinite(inset) || inset <= 0) return;
		this.source ??= document.createElement("canvas");
		this.mask ??= document.createElement("canvas");
		for (const scratch of [this.source, this.mask]) {
			if (scratch.width !== canvas.width) scratch.width = canvas.width;
			if (scratch.height !== canvas.height) scratch.height = canvas.height;
		}
		const output = canvas.getContext("2d");
		const source = this.source.getContext("2d");
		const mask = this.mask.getContext("2d");
		if (!output || !source || !mask) return;
		const blur = `blur(${(inset * 3) / 8}px)`;
		const drawMask = (distance: number) => {
			mask.clearRect(0, 0, canvas.width, canvas.height);
			mask.save();
			mask.filter = blur;
			mask.fillStyle = "white";
			mask.beginPath();
			traceWebcamShapeOnCanvas(mask, {
				...contour,
				x: contour.x + distance,
				y: contour.y + distance,
				width: contour.width - distance * 2,
				height: contour.height - distance * 2,
				radius: Math.max(0, contour.radius - distance),
			});
			mask.fill();
			mask.restore();
		};

		source.clearRect(0, 0, canvas.width, canvas.height);
		source.drawImage(canvas, 0, 0);
		output.clearRect(0, 0, canvas.width, canvas.height);
		output.save();
		output.filter = blur;
		output.drawImage(this.source, 0, 0);
		output.filter = "none";

		// Retain the original pixels in the center instead of blurring the whole camera.
		drawMask(inset * 2);
		source.save();
		source.globalCompositeOperation = "destination-in";
		source.drawImage(this.mask, 0, 0);
		source.restore();
		output.drawImage(this.source, 0, 0);

		drawMask(inset);
		output.globalCompositeOperation = "destination-in";
		output.drawImage(this.mask, 0, 0);
		output.restore();
	}
}
