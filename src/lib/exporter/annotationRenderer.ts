import {
	type AnnotationRegion,
	type ArrowDirection,
	BLUR_ANNOTATION_STRENGTH,
} from "@/components/video-editor/types";

export interface AnnotationRenderAssets {
	imageCache: Map<string, HTMLImageElement>;
}

interface AnnotationSceneTransform {
	scale: number;
	x: number;
	y: number;
}

interface AnnotationCoordinateRect {
	x: number;
	y: number;
	width: number;
	height: number;
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
	const scaledFontSize = style.fontSize * scaleFactor;
	ctx.font = `${fontStyle} ${fontWeight} ${scaledFontSize}px ${style.fontFamily}`;
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
	const rawLines = annotation.content.split("\n");
	const lines: string[] = [];
	for (const rawLine of rawLines) {
		if (!rawLine) {
			lines.push("");
			continue;
		}
		const words = rawLine.split(/(\s+)/);
		let current = "";
		for (const word of words) {
			const test = current + word;
			if (current && ctx.measureText(test).width > availableWidth) {
				lines.push(current);
				current = word.trimStart();
			} else {
				current = test;
			}
		}
		if (current) lines.push(current);
	}
	const lineHeight = scaledFontSize * 1.4;

	const startY = textY - ((lines.length - 1) * lineHeight) / 2;

	lines.forEach((line, index) => {
		const currentY = startY + index * lineHeight;

		if (style.backgroundColor && style.backgroundColor !== "transparent") {
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
		const rect = transformAnnotationRect(
			{
				x: annotationRect.x + (annotation.position.x / 100) * annotationRect.width,
				y: annotationRect.y + (annotation.position.y / 100) * annotationRect.height,
				width: (annotation.size.width / 100) * annotationRect.width,
				height: (annotation.size.height / 100) * annotationRect.height,
			},
			sceneTransform,
		);
		const { x, y, width, height } = rect;
		const effectiveScaleFactor = scaleFactor * (sceneTransform?.scale ?? 1);

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
			// Blur annotations must sample already-rendered scene pixels,
			// so they cannot be rasterized as standalone sprites.
			return null;
	}

	return canvas;
}
