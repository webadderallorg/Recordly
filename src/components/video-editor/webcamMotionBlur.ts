import { getWebcamShadowFilter, getWebcamShadowPadding } from "@/lib/exporter/shadowProfile";
import { drawWebcamGlassRim } from "./glassRim";
import type { CropRegion, WebcamShape } from "./types";
import { WebcamEdgeFeather } from "./webcamEdgeFeather";
import { getWebcamCropSourceRect } from "./webcamOverlay";
import { traceWebcamShapeOnCanvas } from "./webcamShapePath";

export interface WebcamMotionLayout {
	x: number;
	y: number;
	width: number;
	height: number;
	radius: number;
}

// Spatial shutter samples use the current video frame, like the scene's zoom blur.
// Sampling the whole masked overlay also blurs its outline, in either direction.
export function getWebcamMotionSamples(
	previous: WebcamMotionLayout,
	current: WebcamMotionLayout,
	deltaMs: number,
	amount: number,
): WebcamMotionLayout[] {
	if (!Number.isFinite(amount) || amount <= 0 || deltaMs <= 0 || deltaMs > 100) return [];
	const size = Math.min(current.width, current.height, previous.width, previous.height);
	const resize = Math.max(
		Math.abs(current.width - previous.width),
		Math.abs(current.height - previous.height),
	);
	const travel = Math.hypot(current.x - previous.x, current.y - previous.y);
	// Skip stationary frames and discontinuities (cuts, seeks, layout changes).
	if (size <= 0 || resize < 0.01 || resize > size * 0.35 || travel > size * 0.5) return [];
	const shutter = Math.min(
		((1000 / 60) * Math.min(1, amount) * 4) / deltaMs,
		(size * 0.25) / Math.max(resize, travel),
	);
	if (resize * shutter < 0.25) return [];
	const sampleCount = 8;
	// A power-of-two sample count keeps opaque interiors opaque when adding
	// 8-bit canvas samples (1/8 is an exact binary fraction).
	return Array.from({ length: sampleCount }, (_, index) => {
		const t = (index / (sampleCount - 1)) * shutter;
		return {
			x: current.x + (previous.x - current.x) * t,
			y: current.y + (previous.y - current.y) * t,
			width: current.width + (previous.width - current.width) * t,
			height: current.height + (previous.height - current.height) * t,
			radius: current.radius + (previous.radius - current.radius) * t,
		};
	});
}

interface RenderOptions {
	/** Physical pixels per layout pixel; exports already use output-pixel coordinates. */
	resolution?: number;
	/** Width of the soft border in layout pixels; zero keeps the standard frame. */
	edgeFeatherPx?: number;
	// Composite a single clipped frame and its shadow when there is no shutter.
	renderStill?: boolean;
	shape?: WebcamShape;
	layout: WebcamMotionLayout;
	timeMs: number;
	playing: boolean;
	amount: number;
	source: CanvasImageSource;
	sourceWidth: number;
	sourceHeight: number;
	cropRegion?: CropRegion;
	mirror: boolean;
	shadow: number;
}

export class WebcamMotionBlur {
	private edgeFeather = new WebcamEdgeFeather();
	private previous: { layout: WebcamMotionLayout; timeMs: number } | null = null;
	private samples: WebcamMotionLayout[] = [];
	private lastMotionTimeMs: number | null = null;
	private accumulation: HTMLCanvasElement | null = null;
	private output: HTMLCanvasElement | null = null;
	private layoutWidth = 0;
	private layoutHeight = 0;

	reset() {
		this.previous = null;
		this.samples = [];
		this.lastMotionTimeMs = null;
	}

	destroy() {
		this.reset();
		this.edgeFeather.destroy();
		for (const canvas of [this.accumulation, this.output]) {
			if (canvas) {
				canvas.width = 0;
				canvas.height = 0;
			}
		}
		this.accumulation = null;
		this.output = null;
		this.layoutWidth = 0;
		this.layoutHeight = 0;
	}

	render(
		options: RenderOptions,
	): { canvas: HTMLCanvasElement; x: number; y: number; width: number; height: number } | null {
		const {
			layout,
			timeMs,
			playing,
			amount,
			source,
			sourceWidth,
			sourceHeight,
			cropRegion,
			mirror,
			shadow,
		} = options;
		if (!playing || !Number.isFinite(amount) || amount <= 0 || !Number.isFinite(timeMs)) {
			this.reset();
			if (!options.renderStill) return null;
		}
		const previous = this.previous;
		// Repeated display ticks at the same content time retain the same shutter.
		if (
			previous &&
			previous.timeMs === timeMs &&
			Object.keys(layout).some(
				(key) =>
					layout[key as keyof WebcamMotionLayout] !==
					previous.layout[key as keyof WebcamMotionLayout],
			)
		) {
			this.samples = [];
			this.previous = { layout: { ...layout }, timeMs };
		}
		if (!previous || previous.timeMs !== timeMs) {
			this.samples = previous
				? getWebcamMotionSamples(previous.layout, layout, timeMs - previous.timeMs, amount)
				: [];
			const deltaMs = previous ? timeMs - previous.timeMs : 0;
			if (deltaMs <= 0 || deltaMs > 100) this.lastMotionTimeMs = null;
			if (this.samples.length > 0) this.lastMotionTimeMs = timeMs;
			this.previous = { layout: { ...layout }, timeMs };
		}
		if (this.samples.length === 0) {
			// Near the shutter threshold, tiny zoom steps alternated CSS/Pixi shadows
			// with canvas shadows every frame. Keep one renderer until motion settles;
			// a single current-pose sample clears the blur immediately without a pop.
			if (
				!options.renderStill &&
				(this.lastMotionTimeMs === null || timeMs - this.lastMotionTimeMs > 120)
			) {
				return null;
			}
			this.samples = [{ ...layout }];
		}

		const resolution = Number.isFinite(options.resolution)
			? Math.max(1, Math.min(3, options.resolution!))
			: 1;
		const shadowSize = Math.min(layout.width, layout.height);
		const padding = getWebcamShadowPadding(shadowSize, shadow) + 2;
		// Align the backing store to physical pixels, including Retina displays.
		const x =
			Math.floor((Math.min(...this.samples.map((s) => s.x)) - padding) * resolution) /
			resolution;
		const y =
			Math.floor((Math.min(...this.samples.map((s) => s.y)) - padding) * resolution) /
			resolution;
		// Keep backing stores large enough for the whole transition rather than
		// reallocating canvas/GPU textures on every shrinking frame.
		const width = Math.max(
			this.layoutWidth,
			Math.ceil((Math.max(...this.samples.map((s) => s.x + s.width)) - x + padding) / 32) *
				32,
		);
		const height = Math.max(
			this.layoutHeight,
			Math.ceil((Math.max(...this.samples.map((s) => s.y + s.height)) - y + padding) / 32) *
				32,
		);
		const pixelWidth = Math.ceil(width * resolution);
		const pixelHeight = Math.ceil(height * resolution);
		this.layoutWidth = width;
		this.layoutHeight = height;
		this.accumulation ??= document.createElement("canvas");
		this.output ??= document.createElement("canvas");
		for (const canvas of [this.accumulation, this.output]) {
			if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
			if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
		}
		const ctx = this.accumulation.getContext("2d");
		const out = this.output.getContext("2d");
		if (!ctx || !out) return null;
		ctx.clearRect(0, 0, pixelWidth, pixelHeight);
		ctx.save();
		ctx.scale(resolution, resolution);
		ctx.imageSmoothingEnabled = true;
		ctx.imageSmoothingQuality = "high";
		// Add weighted premultiplied samples so overlapping interiors stay opaque.
		ctx.globalCompositeOperation = "lighter";
		ctx.globalAlpha = 1 / this.samples.length;
		const { sx, sy, sw, sh } = getWebcamCropSourceRect(cropRegion, sourceWidth, sourceHeight);
		const edgeFeatherPx = Number.isFinite(options.edgeFeatherPx)
			? Math.max(0, options.edgeFeatherPx!)
			: 0;
		for (const sample of this.samples) {
			// Reuse the output as scratch until the final shadow pass. The rim must
			// composite over each pose before weighted accumulation, not add light to it.
			out.clearRect(0, 0, pixelWidth, pixelHeight);
			out.save();
			out.scale(resolution, resolution);
			out.imageSmoothingEnabled = true;
			out.imageSmoothingQuality = "high";
			out.globalCompositeOperation = "source-over";
			out.globalAlpha = 1;
			out.translate(sample.x - x, sample.y - y);
			out.beginPath();
			traceWebcamShapeOnCanvas(out, {
				...sample,
				x: 0,
				y: 0,
				shape: options.shape,
			});
			out.clip();
			out.save();
			if (mirror) {
				out.translate(sample.width, 0);
				out.scale(-1, 1);
			}
			const scale = Math.max(sample.width / sw, sample.height / sh);
			out.drawImage(
				source,
				sx,
				sy,
				sw,
				sh,
				(sample.width - sw * scale) / 2,
				(sample.height - sh * scale) / 2,
				sw * scale,
				sh * scale,
			);
			out.restore();
			if (edgeFeatherPx === 0)
				drawWebcamGlassRim(out, { ...sample, x: 0, y: 0, shape: options.shape });
			out.restore();
			if (edgeFeatherPx > 0) {
				this.edgeFeather.apply(
					this.output,
					{
						x: (sample.x - x) * resolution,
						y: (sample.y - y) * resolution,
						width: sample.width * resolution,
						height: sample.height * resolution,
						radius: sample.radius * resolution,
						shape: options.shape,
					},
					edgeFeatherPx * resolution,
				);
			}
			ctx.drawImage(
				this.output,
				0,
				0,
				pixelWidth,
				pixelHeight,
				0,
				0,
				pixelWidth / resolution,
				pixelHeight / resolution,
			);
		}
		ctx.restore();

		out.clearRect(0, 0, pixelWidth, pixelHeight);
		out.save();
		out.filter = getWebcamShadowFilter(shadowSize * resolution, shadow);
		out.drawImage(this.accumulation, 0, 0);
		out.restore();
		return {
			canvas: this.output,
			x,
			y,
			width: pixelWidth / resolution,
			height: pixelHeight / resolution,
		};
	}
}
