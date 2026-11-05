import { Assets, Texture } from "pixi.js";
import minimalCursorUrl from "@/assets/cursors/custom/minimal-cursor.svg";
import touchCursorUrl from "@/assets/cursors/custom/touch-cursor.svg";
import { getRenderableAssetUrl } from "@/lib/assetPath";
import { clamp, LoadedCursorAsset, SingleCursorStyle } from "./cursorRenderConfig";

export const MIN_RASTERIZED_CURSOR_HEIGHT = 512;

export async function createPixelGloveAsset(
	url: string,
	anchor: { x: number; y: number },
): Promise<LoadedCursorAsset> {
	await Assets.load(url);
	const image = await loadImage(url);
	const texture = Texture.from(url);
	texture.source.scaleMode = "nearest";
	texture.source.autoGenerateMipmaps = false;
	return {
		texture,
		image,
		aspectRatio: image.naturalWidth / image.naturalHeight,
		anchorX: anchor.x,
		anchorY: anchor.y,
	};
}

export async function createCursorStyleAsset(style: SingleCursorStyle): Promise<LoadedCursorAsset> {
	if (style === "figma") {
		const image = await loadImage(minimalCursorUrl);
		const sourceCanvas = document.createElement("canvas");
		sourceCanvas.width = image.naturalWidth;
		sourceCanvas.height = image.naturalHeight;
		const sourceCtx = sourceCanvas.getContext("2d")!;
		sourceCtx.drawImage(image, 0, 0);
		const trimmed = trimCanvasToAlpha(sourceCanvas, { x: 40, y: 22 });
		await Assets.load(trimmed.dataUrl);
		const trimmedImage = await loadImage(trimmed.dataUrl);
		const texture = configureCursorTexture(Texture.from(trimmed.dataUrl));

		return {
			texture,
			image: trimmedImage,
			aspectRatio: trimmed.height > 0 ? trimmed.width / trimmed.height : 1,
			anchorX: trimmed.hotspot && trimmed.width > 0 ? trimmed.hotspot.x / trimmed.width : 0,
			anchorY: trimmed.hotspot && trimmed.height > 0 ? trimmed.hotspot.y / trimmed.height : 0,
		};
	}

	// The shared SVG wraps Apple's original pixels with a fine rim and shadow.
	return createRasterizedCursorAsset(
		touchCursorUrl,
		{ x: 0.5, y: 0.5 },
		{ preserveCanvas: true },
	);
}

export async function createCursorPackAsset(
	url: string,
	anchor: { x: number; y: number },
): Promise<LoadedCursorAsset> {
	const renderableUrl = await getRenderableAssetUrl(url);
	await Assets.load(renderableUrl);
	const image = await loadImage(renderableUrl);
	const texture = configureCursorTexture(Texture.from(renderableUrl));

	return {
		texture,
		image,
		aspectRatio: image.naturalHeight > 0 ? image.naturalWidth / image.naturalHeight : 1,
		anchorX: clamp(anchor.x, 0, 1),
		anchorY: clamp(anchor.y, 0, 1),
	};
}

export async function createRasterizedCursorAsset(
	url: string,
	anchor: { x: number; y: number },
	options: { preserveCanvas?: boolean } = {},
): Promise<LoadedCursorAsset> {
	const image = await loadImage(url);
	const sourceCanvas = document.createElement("canvas");
	const rasterScale =
		image.naturalHeight > 0
			? Math.max(1, MIN_RASTERIZED_CURSOR_HEIGHT / image.naturalHeight)
			: 1;
	sourceCanvas.width = Math.max(1, Math.round(image.naturalWidth * rasterScale));
	sourceCanvas.height = Math.max(1, Math.round(image.naturalHeight * rasterScale));
	const sourceCtx = sourceCanvas.getContext("2d");
	if (!sourceCtx) {
		await Assets.load(url);
		const texture = configureCursorTexture(Texture.from(url));
		return {
			texture,
			image,
			aspectRatio: image.naturalHeight > 0 ? image.naturalWidth / image.naturalHeight : 1,
			anchorX: clamp(anchor.x, 0, 1),
			anchorY: clamp(anchor.y, 0, 1),
		};
	}

	sourceCtx.clearRect(0, 0, sourceCanvas.width, sourceCanvas.height);
	sourceCtx.drawImage(image, 0, 0, sourceCanvas.width, sourceCanvas.height);

	if (options.preserveCanvas) {
		const dataUrl = sourceCanvas.toDataURL("image/png");
		await Assets.load(dataUrl);
		const rasterizedImage = await loadImage(dataUrl);
		const texture = configureCursorTexture(Texture.from(dataUrl));
		return {
			texture,
			image: rasterizedImage,
			aspectRatio: sourceCanvas.height > 0 ? sourceCanvas.width / sourceCanvas.height : 1,
			anchorX: clamp(anchor.x, 0, 1),
			anchorY: clamp(anchor.y, 0, 1),
		};
	}

	const trimmed = trimCanvasToAlpha(sourceCanvas, {
		x: sourceCanvas.width * clamp(anchor.x, 0, 1),
		y: sourceCanvas.height * clamp(anchor.y, 0, 1),
	});
	await Assets.load(trimmed.dataUrl);
	const trimmedImage = await loadImage(trimmed.dataUrl);
	const texture = configureCursorTexture(Texture.from(trimmed.dataUrl));

	return {
		texture,
		image: trimmedImage,
		aspectRatio: trimmed.height > 0 ? trimmed.width / trimmed.height : 1,
		anchorX:
			trimmed.hotspot && trimmed.width > 0
				? clamp(trimmed.hotspot.x / trimmed.width, 0, 1)
				: clamp(anchor.x, 0, 1),
		anchorY:
			trimmed.hotspot && trimmed.height > 0
				? clamp(trimmed.hotspot.y / trimmed.height, 0, 1)
				: clamp(anchor.y, 0, 1),
	};
}

export function loadImage(dataUrl: string) {
	return new Promise<HTMLImageElement>((resolve, reject) => {
		const image = new Image();
		image.onload = () => resolve(image);
		image.onerror = () =>
			reject(new Error(`Failed to load cursor image: ${dataUrl.slice(0, 128)}`));
		image.src = dataUrl;
	});
}

export function configureCursorTexture(texture: Texture) {
	texture.source.scaleMode = "linear";
	texture.source.autoGenerateMipmaps = true;
	return texture;
}

export function trimCanvasToAlpha(canvas: HTMLCanvasElement, hotspot?: { x: number; y: number }) {
	const ctx = canvas.getContext("2d");
	if (!ctx) {
		return {
			dataUrl: canvas.toDataURL("image/png"),
			width: canvas.width,
			height: canvas.height,
			hotspot,
		};
	}

	const { width, height } = canvas;
	const imageData = ctx.getImageData(0, 0, width, height);
	const { data } = imageData;
	let minX = width;
	let minY = height;
	let maxX = -1;
	let maxY = -1;

	for (let y = 0; y < height; y += 1) {
		for (let x = 0; x < width; x += 1) {
			const alpha = data[(y * width + x) * 4 + 3];
			if (alpha === 0) {
				continue;
			}

			minX = Math.min(minX, x);
			minY = Math.min(minY, y);
			maxX = Math.max(maxX, x);
			maxY = Math.max(maxY, y);
		}
	}

	if (maxX < minX || maxY < minY) {
		return {
			dataUrl: canvas.toDataURL("image/png"),
			width,
			height,
			hotspot,
		};
	}

	const croppedWidth = maxX - minX + 1;
	const croppedHeight = maxY - minY + 1;
	const croppedCanvas = document.createElement("canvas");
	croppedCanvas.width = croppedWidth;
	croppedCanvas.height = croppedHeight;
	const croppedCtx = croppedCanvas.getContext("2d")!;
	croppedCtx.drawImage(
		canvas,
		minX,
		minY,
		croppedWidth,
		croppedHeight,
		0,
		0,
		croppedWidth,
		croppedHeight,
	);

	return {
		dataUrl: croppedCanvas.toDataURL("image/png"),
		width: croppedWidth,
		height: croppedHeight,
		hotspot: hotspot
			? {
					x: hotspot.x - minX,
					y: hotspot.y - minY,
				}
			: undefined,
	};
}

export async function createInvertedCursorAsset(
	asset: LoadedCursorAsset,
): Promise<LoadedCursorAsset> {
	const canvas = document.createElement("canvas");
	canvas.width = asset.image.naturalWidth;
	canvas.height = asset.image.naturalHeight;
	const ctx = canvas.getContext("2d")!;
	ctx.drawImage(asset.image, 0, 0);
	const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
	const { data } = imageData;
	for (let index = 0; index < data.length; index += 4) {
		if (data[index + 3] === 0) {
			continue;
		}

		data[index] = 255 - data[index];
		data[index + 1] = 255 - data[index + 1];
		data[index + 2] = 255 - data[index + 2];
	}
	ctx.putImageData(imageData, 0, 0);

	const dataUrl = canvas.toDataURL("image/png");
	await Assets.load(dataUrl);
	const image = await loadImage(dataUrl);
	const texture = configureCursorTexture(Texture.from(dataUrl));

	return {
		texture,
		image,
		aspectRatio: asset.aspectRatio,
		anchorX: asset.anchorX,
		anchorY: asset.anchorY,
	};
}
