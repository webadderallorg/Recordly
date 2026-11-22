import {
	type AnnotationRegion,
	BASE_PREVIEW_WIDTH,
	BLUR_ANNOTATION_STRENGTH,
	type CropRegion,
} from "@/components/video-editor/types";

export interface SourceRedactionOptions {
	width: number;
	height: number;
	annotations: readonly AnnotationRegion[];
	timeMs: number;
	cropRegion: CropRegion;
}

interface PixelRect {
	x: number;
	y: number;
	width: number;
	height: number;
}

function sourceRect(annotation: AnnotationRegion, options: SourceRedactionOptions): PixelRect {
	const { width, height, cropRegion: crop } = options;
	return {
		x: (crop.x + (annotation.position.x / 100) * crop.width) * width,
		y: (crop.y + (annotation.position.y / 100) * crop.height) * height,
		width: (annotation.size.width / 100) * crop.width * width,
		height: (annotation.size.height / 100) * crop.height * height,
	};
}

function intersectSource(rect: PixelRect, width: number, height: number): PixelRect | null {
	if (![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)) {
		throw new Error("Redaction geometry is invalid");
	}
	const x = Math.max(0, Math.floor(rect.x));
	const y = Math.max(0, Math.floor(rect.y));
	const right = Math.min(width, Math.ceil(rect.x + rect.width));
	const bottom = Math.min(height, Math.ceil(rect.y + rect.height));
	return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : null;
}

function getContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
	const context = canvas.getContext("2d");
	if (!context) throw new Error("Source redaction canvas is unavailable");
	context.imageSmoothingEnabled = true;
	context.imageSmoothingQuality = "high";
	return context;
}

/** Fill out-of-source support with edge pixels, rather than transparent black. */
function copyClampedSource(
	context: CanvasRenderingContext2D,
	source: HTMLCanvasElement,
	originX: number,
	originY: number,
): void {
	const width = context.canvas.width;
	const height = context.canvas.height;
	const sourceX = Math.max(0, originX);
	const sourceY = Math.max(0, originY);
	const sourceRight = Math.min(source.width, originX + width);
	const sourceBottom = Math.min(source.height, originY + height);
	const sourceWidth = sourceRight - sourceX;
	const sourceHeight = sourceBottom - sourceY;
	const left = sourceX - originX;
	const top = sourceY - originY;
	const right = width - left - sourceWidth;
	const bottom = height - top - sourceHeight;
	context.clearRect(0, 0, width, height);
	context.drawImage(
		source,
		sourceX,
		sourceY,
		sourceWidth,
		sourceHeight,
		left,
		top,
		sourceWidth,
		sourceHeight,
	);
	if (left > 0)
		context.drawImage(source, 0, sourceY, 1, sourceHeight, 0, top, left, sourceHeight);
	if (right > 0)
		context.drawImage(
			source,
			source.width - 1,
			sourceY,
			1,
			sourceHeight,
			left + sourceWidth,
			top,
			right,
			sourceHeight,
		);
	if (top > 0) context.drawImage(source, sourceX, 0, sourceWidth, 1, left, 0, sourceWidth, top);
	if (bottom > 0)
		context.drawImage(
			source,
			sourceX,
			source.height - 1,
			sourceWidth,
			1,
			left,
			top + sourceHeight,
			sourceWidth,
			bottom,
		);
	for (const [x, destinationX, stripWidth] of [
		[0, 0, left],
		[source.width - 1, left + sourceWidth, right],
	]) {
		if (stripWidth <= 0) continue;
		if (top > 0) context.drawImage(source, x, 0, 1, 1, destinationX, 0, stripWidth, top);
		if (bottom > 0)
			context.drawImage(
				source,
				x,
				source.height - 1,
				1,
				1,
				destinationX,
				top + sourceHeight,
				stripWidth,
				bottom,
			);
	}
}

function isOpaqueHexColor(color: string | undefined): boolean {
	return (
		!!color &&
		(/^#[\da-f]{3}$/i.test(color) ||
			/^#[\da-f]{6}$/i.test(color) ||
			/^#[\da-f]{3}f$/i.test(color) ||
			/^#[\da-f]{6}ff$/i.test(color))
	);
}

/**
 * Removes private pixels before camera transforms and decorative motion filters.
 * Each owner reuses its source canvas and mask buffers; no GPU readback is needed.
 */
export class SourceRedactionCanvas {
	private canvas: HTMLCanvasElement | null = null;
	private context: CanvasRenderingContext2D | null = null;
	private buffers = new Map<string, HTMLCanvasElement>();

	render(
		source: CanvasImageSource | VideoFrame,
		options: SourceRedactionOptions,
	): HTMLCanvasElement | null {
		const active = options.annotations
			.filter(
				(annotation) =>
					annotation.type === "blur" &&
					options.timeMs >= annotation.startMs &&
					options.timeMs <= annotation.endMs,
			)
			.sort((left, right) => left.zIndex - right.zIndex);
		if (active.length === 0) return null;
		const width = Math.floor(options.width);
		const height = Math.floor(options.height);
		if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
			throw new Error("Cannot redact an empty source frame");
		}
		this.canvas ??= document.createElement("canvas");
		if (this.canvas.width !== width) this.canvas.width = width;
		if (this.canvas.height !== height) this.canvas.height = height;
		this.context = getContext(this.canvas);
		const context = this.context;
		context.clearRect(0, 0, width, height);
		context.drawImage(source, 0, 0, width, height);
		const retainedIds = new Set(
			options.annotations
				.filter((annotation) => annotation.type === "blur")
				.map((annotation) => annotation.id),
		);
		for (const id of this.buffers.keys()) if (!retainedIds.has(id)) this.buffers.delete(id);
		for (const annotation of active) {
			const rect = intersectSource(sourceRect(annotation, options), width, height);
			if (!rect) continue;
			context.save();
			try {
				context.beginPath();
				context.rect(rect.x, rect.y, rect.width, rect.height);
				context.clip();
				if (isOpaqueHexColor(annotation.blurColor)) {
					context.fillStyle = annotation.blurColor!;
					context.fillRect(rect.x, rect.y, rect.width, rect.height);
					continue;
				}
				const strength = Math.max(
					0,
					(annotation.blurIntensity ?? BLUR_ANNOTATION_STRENGTH) *
						((width * options.cropRegion.width) / BASE_PREVIEW_WIDTH),
				);
				if (!Number.isFinite(strength))
					throw new Error("Redaction blur strength is invalid");
				if (strength > 0) {
					const padding = Math.ceil(strength * 3);
					const bufferWidth = Math.min(width, rect.width + padding * 2);
					const bufferHeight = Math.min(height, rect.height + padding * 2);
					const originX = Math.floor(rect.x + rect.width / 2 - bufferWidth / 2);
					const originY = Math.floor(rect.y + rect.height / 2 - bufferHeight / 2);
					let buffer = this.buffers.get(annotation.id);
					if (!buffer) {
						buffer = document.createElement("canvas");
						this.buffers.set(annotation.id, buffer);
					}
					if (buffer.width !== bufferWidth) buffer.width = bufferWidth;
					if (buffer.height !== bufferHeight) buffer.height = bufferHeight;
					copyClampedSource(getContext(buffer), this.canvas, originX, originY);
					context.filter = `blur(${strength}px)`;
					// Replace the original pixels; transparent filter edges must never mix
					// sharp private content back into the redacted result.
					context.globalCompositeOperation = "copy";
					context.drawImage(buffer, originX, originY);
				}
				// Partially transparent tints keep the blur underneath; a transparent
				// persisted CSS color must never bypass removal of the sharp source.
				if (annotation.blurColor && annotation.blurColor !== "transparent") {
					context.filter = "none";
					context.globalCompositeOperation = "source-over";
					context.fillStyle = annotation.blurColor;
					context.fillRect(rect.x, rect.y, rect.width, rect.height);
				}
			} finally {
				context.restore();
			}
		}
		return this.canvas;
	}

	dispose(): void {
		// A Pixi texture may still reference the last canvas until its own cleanup.
		// Releasing ownership must not invalidate an in-flight image source.
		this.canvas = null;
		this.context = null;
		this.buffers.clear();
	}
}
