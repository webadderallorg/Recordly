import {
	type AnnotationRegion,
	type ArrowDirection,
	BASE_PREVIEW_HEIGHT,
	BASE_PREVIEW_WIDTH,
	BLUR_ANNOTATION_STRENGTH,
	type CropRegion,
	DEFAULT_HIGHLIGHT_DIM,
	type Padding,
} from "@/components/video-editor/types";
import { computePaddedLayout } from "@/components/video-editor/videoPlayback/layoutUtils";

export interface AnnotationRenderAssets {
	imageCache: Map<string, HTMLImageElement>;
}

export interface AnnotationSceneTransform {
	scale: number;
	x: number;
	y: number;
}

export interface AnnotationCoordinateRect {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface AnnotationPlacement {
	x: number;
	y: number;
	width: number;
	height: number;
	scaleFactor: number;
}

export interface AnnotationFrameConfig {
	width: number;
	height: number;
	padding?: Padding | number;
	cropRegion: CropRegion;
	videoWidth: number;
	videoHeight: number;
}

export function getAnnotationFrameRect(config: AnnotationFrameConfig): AnnotationCoordinateRect {
	const layout = computePaddedLayout({
		width: config.width,
		height: config.height,
		padding: config.padding ?? 0,
		frameInsets: null,
		cropRegion: config.cropRegion,
		videoWidth: config.videoWidth,
		videoHeight: config.videoHeight,
	});

	return {
		x: layout.centerOffsetX,
		y: layout.centerOffsetY,
		width: layout.croppedDisplayWidth,
		height: layout.croppedDisplayHeight,
	};
}

export function getAnnotationScaleFactor(config: {
	width: number;
	height: number;
	previewWidth?: number;
	previewHeight?: number;
}): number {
	const previewWidth = config.previewWidth || BASE_PREVIEW_WIDTH;
	const previewHeight = config.previewHeight || BASE_PREVIEW_HEIGHT;
	return (config.width / previewWidth + config.height / previewHeight) / 2;
}

function transformAnnotationRect(
	rect: { x: number; y: number; width: number; height: number },
	sceneTransform?: AnnotationSceneTransform,
) {
	if (!sceneTransform) {
		return rect;
	}

	return {
		x: rect.x * sceneTransform.scale + sceneTransform.x,
		y: rect.y * sceneTransform.scale + sceneTransform.y,
		width: rect.width * sceneTransform.scale,
		height: rect.height * sceneTransform.scale,
	};
}

export function placeAnnotation(
	annotation: AnnotationRegion,
	canvas: { width: number; height: number },
	frameRect: AnnotationCoordinateRect,
	scaleFactor: number,
	sceneTransform?: AnnotationSceneTransform,
): AnnotationPlacement {
	const pinned = annotation.space === "screen";
	const space = pinned ? { x: 0, y: 0, width: canvas.width, height: canvas.height } : frameRect;
	const rect = transformAnnotationRect(
		{
			x: space.x + (annotation.position.x / 100) * space.width,
			y: space.y + (annotation.position.y / 100) * space.height,
			width: (annotation.size.width / 100) * space.width,
			height: (annotation.size.height / 100) * space.height,
		},
		pinned ? undefined : sceneTransform,
	);

	return {
		...rect,
		scaleFactor: scaleFactor * (pinned ? 1 : (sceneTransform?.scale ?? 1)),
	};
}

const annotationImagePromiseCache = new Map<string, Promise<HTMLImageElement | null>>();

let blurBufferCanvas: HTMLCanvasElement | null = null;
function getBlurBufferCanvas(): HTMLCanvasElement | null {
	if (typeof document === "undefined") return null;
	if (!blurBufferCanvas) {
		blurBufferCanvas = document.createElement("canvas");
	}
	return blurBufferCanvas;
}

function getAnnotationImageContent(annotation: AnnotationRegion): string | null {
	const source = annotation.imageContent || annotation.content;
	if (!source || !source.startsWith("data:image")) {
		return null;
	}

	return source;
}

function loadAnnotationImage(source: string): Promise<HTMLImageElement | null> {
	const cachedPromise = annotationImagePromiseCache.get(source);
	if (cachedPromise) {
		return cachedPromise;
	}

	const loadPromise = new Promise<HTMLImageElement | null>((resolve) => {
		const img = new Image();
		img.onload = () => resolve(img);
		img.onerror = () => {
			console.error("[AnnotationRenderer] Failed to load image annotation");
			resolve(null);
		};
		img.src = source;
	});

	annotationImagePromiseCache.set(source, loadPromise);
	return loadPromise;
}

export async function preloadAnnotationAssets(
	annotations: AnnotationRegion[] = [],
): Promise<AnnotationRenderAssets> {
	const uniqueSources = [
		...new Set(
			annotations
				.filter((annotation) => annotation.type === "image")
				.map((annotation) => getAnnotationImageContent(annotation))
				.filter((source): source is string => !!source),
		),
	];

	if (uniqueSources.length === 0) {
		return { imageCache: new Map() };
	}

	const loadedSources = await Promise.all(
		uniqueSources.map(async (source) => {
			const image = await loadAnnotationImage(source);
			return image ? ([source, image] as const) : null;
		}),
	);

	return {
		imageCache: new Map(
			loadedSources.filter((entry): entry is readonly [string, HTMLImageElement] => !!entry),
		),
	};
}

const ARROW_PATHS: Record<ArrowDirection, string[]> = {
	up: ["M 50 20 L 50 80", "M 50 20 L 35 35", "M 50 20 L 65 35"],
	down: ["M 50 20 L 50 80", "M 50 80 L 35 65", "M 50 80 L 65 65"],
	left: ["M 80 50 L 20 50", "M 20 50 L 35 35", "M 20 50 L 35 65"],
	right: ["M 20 50 L 80 50", "M 80 50 L 65 35", "M 80 50 L 65 65"],
	"up-right": ["M 25 75 L 75 25", "M 75 25 L 60 30", "M 75 25 L 70 40"],
	"up-left": ["M 75 75 L 25 25", "M 25 25 L 40 30", "M 25 25 L 30 40"],
	"down-right": ["M 25 25 L 75 75", "M 75 75 L 70 60", "M 75 75 L 60 70"],
	"down-left": ["M 75 25 L 25 75", "M 25 75 L 30 60", "M 25 75 L 40 70"],
};

function parseSvgPath(
	pathString: string,
	scaleX: number,
	scaleY: number,
): Array<{ cmd: string; args: number[] }> {
	const commands: Array<{ cmd: string; args: number[] }> = [];
	const parts = pathString.trim().split(/\s+/);

	let i = 0;
	while (i < parts.length) {
		const cmd = parts[i];
		if (cmd === "M" || cmd === "L") {
			const x = parseFloat(parts[i + 1]) * scaleX;
			const y = parseFloat(parts[i + 2]) * scaleY;
			commands.push({ cmd, args: [x, y] });
			i += 3;
		} else {
			i++;
		}
	}

	return commands;
}

function renderArrow(
	ctx: CanvasRenderingContext2D,
	direction: ArrowDirection,
	color: string,
	strokeWidth: number,
	x: number,
	y: number,
	width: number,
	height: number,
	_scaleFactor: number,
) {
	const paths = ARROW_PATHS[direction];
	if (!paths) return;

	ctx.save();
	ctx.translate(x, y);

	const padding = 8 * _scaleFactor;
	const availableWidth = Math.max(0, width - padding * 2);
	const availableHeight = Math.max(0, height - padding * 2);

	const scale = Math.min(availableWidth / 100, availableHeight / 100);

	const offsetX = padding + (availableWidth - 100 * scale) / 2;
	const offsetY = padding + (availableHeight - 100 * scale) / 2;

	ctx.translate(offsetX, offsetY);

	ctx.shadowColor = "rgba(0, 0, 0, 0.3)";
	ctx.shadowBlur = 8 * scale;
	ctx.shadowOffsetX = 0;
	ctx.shadowOffsetY = 4 * scale;

	ctx.strokeStyle = color;
	ctx.lineWidth = strokeWidth * scale;
	ctx.lineCap = "round";
	ctx.lineJoin = "round";

	ctx.beginPath();

	for (const pathString of paths) {
		const commands = parseSvgPath(pathString, scale, scale);

		for (const { cmd, args } of commands) {
			if (cmd === "M") {
				ctx.moveTo(args[0], args[1]);
			} else if (cmd === "L") {
				ctx.lineTo(args[0], args[1]);
			}
		}
	}

	ctx.stroke();

	ctx.restore();
}

const LINE_HEIGHT_RATIO = 1.4;
const MIN_TEXT_FONT_SIZE = 1;
const FIT_STEPS = 8;

function renderText(
	ctx: CanvasRenderingContext2D,
	annotation: AnnotationRegion,
	x: number,
	y: number,
	width: number,
	height: number,
	scaleFactor: number,
) {
	const style = annotation.style;

	ctx.save();

	ctx.beginPath();
	ctx.rect(x, y, width, height);
	ctx.clip();

	const fontWeight = style.fontWeight === "bold" ? "bold" : "normal";
	const fontStyle = style.fontStyle === "italic" ? "italic" : "normal";
	ctx.textBaseline = "middle";

	const containerPadding = 8 * scaleFactor;

	let textX = x;
	const textY = y + height / 2;

	if (style.textAlign === "center") {
		textX = x + width / 2;
		ctx.textAlign = "center";
	} else if (style.textAlign === "right") {
		textX = x + width - containerPadding;
		ctx.textAlign = "right";
	} else {
		textX = x + containerPadding;
		ctx.textAlign = "left";
	}

	const availableWidth = width - containerPadding * 2;
	const wrapAt = (fontSize: number) => {
		ctx.font = `${fontStyle} ${fontWeight} ${fontSize}px ${style.fontFamily}`;
		const wrapped: string[] = [];
		for (const rawLine of annotation.content.split("\n")) {
			if (!rawLine) {
				wrapped.push("");
				continue;
			}
			const words = rawLine.split(/(\s+)/);
			let current = "";
			for (const word of words) {
				const test = current + word;
				if (current && ctx.measureText(test).width > availableWidth) {
					wrapped.push(current);
					current = word.trimStart();
				} else {
					current = test;
				}
			}
			if (current) wrapped.push(current);
		}
		return wrapped;
	};
	const wrapWithinBox = (fontSize: number): string[] | null => {
		const wrapped = wrapAt(fontSize);
		const widest = wrapped.reduce(
			(most, line) => Math.max(most, ctx.measureText(line).width),
			0,
		);
		if (widest > availableWidth) return null;
		if (wrapped.length * fontSize * LINE_HEIGHT_RATIO > height) return null;
		return wrapped;
	};

	// Clipped words are worth nothing, so text that still overflows after wrapping
	// shrinks to the largest size that fits instead.
	let scaledFontSize = style.fontSize * scaleFactor;
	let fitted = wrapWithinBox(scaledFontSize);
	if (!fitted) {
		let smallest = MIN_TEXT_FONT_SIZE;
		let largest = scaledFontSize;
		for (let step = 0; step < FIT_STEPS; step++) {
			const candidate = (smallest + largest) / 2;
			const wrapped = wrapWithinBox(candidate);
			if (wrapped) {
				smallest = candidate;
				fitted = wrapped;
			} else {
				largest = candidate;
			}
		}
		scaledFontSize = smallest;
	}
	const lines = fitted ?? wrapAt(scaledFontSize);
	const lineHeight = scaledFontSize * LINE_HEIGHT_RATIO;

	const startY = textY - ((lines.length - 1) * lineHeight) / 2;

	const fillsWholeBox =
		style.fillBox === true &&
		Boolean(style.backgroundColor) &&
		style.backgroundColor !== "transparent";
	if (fillsWholeBox && style.backgroundColor) {
		ctx.fillStyle = style.backgroundColor;
		ctx.beginPath();
		ctx.roundRect(x, y, width, height, (style.borderRadius ?? 0) * scaleFactor);
		ctx.fill();
	}

	lines.forEach((line, index) => {
		const currentY = startY + index * lineHeight;

		if (!fillsWholeBox && style.backgroundColor && style.backgroundColor !== "transparent") {
			const metrics = ctx.measureText(line);
			const verticalPadding = scaledFontSize * 0.1;
			const horizontalPadding = scaledFontSize * 0.2;
			const borderRadius = 4 * scaleFactor;

			let bgX = textX - horizontalPadding;
			const bgWidth = metrics.width + horizontalPadding * 2;

			const contentHeight = scaledFontSize * 1.4;
			const bgHeight = contentHeight + verticalPadding * 2;
			const bgY = currentY - bgHeight / 2;

			if (style.textAlign === "center") {
				bgX = textX - bgWidth / 2;
			} else if (style.textAlign === "right") {
				bgX = textX - bgWidth;
			}

			ctx.fillStyle = style.backgroundColor;
			ctx.beginPath();
			ctx.roundRect(bgX, bgY, bgWidth, bgHeight, borderRadius);
			ctx.fill();
		}

		ctx.fillStyle = style.color;
		ctx.fillText(line, textX, currentY);

		if (style.textDecoration === "underline") {
			const metrics = ctx.measureText(line);
			let underlineX = textX;
			const underlineY = currentY + scaledFontSize * 0.15;

			if (style.textAlign === "center") {
				underlineX = textX - metrics.width / 2;
			} else if (style.textAlign === "right") {
				underlineX = textX - metrics.width;
			}

			ctx.strokeStyle = style.color;
			ctx.lineWidth = Math.max(1, scaledFontSize / 16);
			ctx.beginPath();
			ctx.moveTo(underlineX, underlineY);
			ctx.lineTo(underlineX + metrics.width, underlineY);
			ctx.stroke();
		}
	});

	ctx.restore();
}

async function renderImage(
	ctx: CanvasRenderingContext2D,
	annotation: AnnotationRegion,
	x: number,
	y: number,
	width: number,
	height: number,
	assets?: AnnotationRenderAssets,
): Promise<void> {
	const source = getAnnotationImageContent(annotation);
	if (!source) {
		return;
	}

	const img = assets?.imageCache.get(source) ?? (await loadAnnotationImage(source));
	if (!img) {
		return;
	}

	const imgAspect = img.width / img.height;
	const boxAspect = width / height;

	let drawWidth = width;
	let drawHeight = height;
	let drawX = x;
	let drawY = y;

	if (imgAspect > boxAspect) {
		drawHeight = width / imgAspect;
		drawY = y + (height - drawHeight) / 2;
	} else {
		drawWidth = height * imgAspect;
		drawX = x + (width - drawWidth) / 2;
	}

	ctx.drawImage(img, drawX, drawY, drawWidth, drawHeight);
}

export async function renderAnnotations(
	ctx: CanvasRenderingContext2D,
	annotations: AnnotationRegion[],
	canvasWidth: number,
	canvasHeight: number,
	currentTimeMs: number,
	scaleFactor: number = 1.0,
	assets?: AnnotationRenderAssets,
	sceneTransform?: AnnotationSceneTransform,
	coordinateRect?: AnnotationCoordinateRect,
): Promise<void> {
	const activeAnnotations = annotations.filter(
		(ann) => currentTimeMs >= ann.startMs && currentTimeMs <= ann.endMs,
	);

	const sortedAnnotations = [...activeAnnotations].sort((a, b) => a.zIndex - b.zIndex);
	const annotationRect = coordinateRect ?? {
		x: 0,
		y: 0,
		width: canvasWidth,
		height: canvasHeight,
	};

	for (const annotation of sortedAnnotations) {
		const {
			x,
			y,
			width,
			height,
			scaleFactor: effectiveScaleFactor,
		} = placeAnnotation(
			annotation,
			{ width: canvasWidth, height: canvasHeight },
			annotationRect,
			scaleFactor,
			sceneTransform,
		);

		switch (annotation.type) {
			case "text":
				renderText(ctx, annotation, x, y, width, height, effectiveScaleFactor);
				break;

			case "image":
				await renderImage(ctx, annotation, x, y, width, height, assets);
				break;

			case "figure":
				if (annotation.figureData) {
					renderArrow(
						ctx,
						annotation.figureData.arrowDirection,
						annotation.figureData.color,
						annotation.figureData.strokeWidth,
						x,
						y,
						width,
						height,
						effectiveScaleFactor,
					);
				}
				break;

			case "highlight": {
				const left = Math.min(Math.max(Math.round(x), 0), canvasWidth);
				const top = Math.min(Math.max(Math.round(y), 0), canvasHeight);
				const right = Math.min(Math.max(Math.round(x + width), left), canvasWidth);
				const bottom = Math.min(Math.max(Math.round(y + height), top), canvasHeight);

				ctx.save();
				ctx.fillStyle = "#000000";
				ctx.globalAlpha = annotation.highlightDim ?? DEFAULT_HIGHLIGHT_DIM;
				ctx.fillRect(0, 0, canvasWidth, top);
				ctx.fillRect(0, bottom, canvasWidth, canvasHeight - bottom);
				ctx.fillRect(0, top, left, bottom - top);
				ctx.fillRect(right, top, canvasWidth - right, bottom - top);
				ctx.restore();
				break;
			}

			case "blur": {
				const blurStrength =
					(annotation.blurIntensity ?? BLUR_ANNOTATION_STRENGTH) * effectiveScaleFactor;
				const padding = Math.ceil(blurStrength * 2);

				ctx.save();

				ctx.beginPath();
				const borderRadius = (annotation.style.borderRadius ?? 0) * effectiveScaleFactor;
				ctx.roundRect(x, y, width, height, borderRadius);
				ctx.clip();

				const sx = Math.max(0, x - padding);
				const sy = Math.max(0, y - padding);
				const sw = Math.min(canvasWidth - sx, width + padding * 2);
				const sh = Math.min(canvasHeight - sy, height + padding * 2);

				if (sw > 0 && sh > 0) {
					const buffer = getBlurBufferCanvas();
					if (buffer) {
						buffer.width = sw;
						buffer.height = sh;
						const bCtx = buffer.getContext("2d");
						if (bCtx) {
							bCtx.drawImage(ctx.canvas, sx, sy, sw, sh, 0, 0, sw, sh);

							ctx.filter = `blur(${blurStrength}px)`;
							ctx.drawImage(buffer, sx, sy);

							if (annotation.blurColor && annotation.blurColor !== "transparent") {
								ctx.filter = "none";
								ctx.fillStyle = annotation.blurColor;
								ctx.fillRect(x, y, width, height);
							}
						}
					}
				}

				ctx.restore();
				break;
			}
		}
	}
}

export async function renderAnnotationToCanvas(
	annotation: AnnotationRegion,
	width: number,
	height: number,
	scaleFactor: number = 1.0,
	assets?: AnnotationRenderAssets,
): Promise<HTMLCanvasElement | null> {
	const canvasWidth = Math.max(1, Math.ceil(width));
	const canvasHeight = Math.max(1, Math.ceil(height));
	const canvas = document.createElement("canvas");
	canvas.width = canvasWidth;
	canvas.height = canvasHeight;

	const ctx = canvas.getContext("2d");
	if (!ctx) {
		return null;
	}

	ctx.imageSmoothingEnabled = true;
	ctx.imageSmoothingQuality = "high";

	switch (annotation.type) {
		case "text":
			renderText(ctx, annotation, 0, 0, canvasWidth, canvasHeight, scaleFactor);
			break;

		case "image":
			await renderImage(ctx, annotation, 0, 0, canvasWidth, canvasHeight, assets);
			break;

		case "figure":
			if (!annotation.figureData) {
				return null;
			}

			renderArrow(
				ctx,
				annotation.figureData.arrowDirection,
				annotation.figureData.color,
				annotation.figureData.strokeWidth,
				0,
				0,
				canvasWidth,
				canvasHeight,
				scaleFactor,
			);
			break;
		case "blur":
		case "highlight":
			// Blur annotations must sample already-rendered scene pixels,
			// so they cannot be rasterized as standalone sprites.
			return null;
	}

	return canvas;
}
