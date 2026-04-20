import { Assets, Texture } from "pixi.js";
import { getRenderableAssetUrl } from "@/lib/assetPath";
import { extensionHost } from "@/lib/extensions";
import minimalCursorUrl from "../../../../../Minimal Cursor.svg";
import { UPLOADED_CURSOR_SAMPLE_SIZE, uploadedCursorAssets } from "../uploadedCursorAssets";
import {
	BUILTIN_CURSOR_PACK_SOURCES,
	clampCursorValue,
	CURSOR_PACK_POINTER_TYPES,
	DEFAULT_CURSOR_PACK_ANCHOR,
	type CursorAssetKey,
	type CursorPackSource,
	type CursorPackStyle,
	type LoadedCursorAsset,
	type LoadedCursorPackAssets,
	type SingleCursorStyle,
	type StatefulCursorStyle,
	isSingleCursorStyle,
	resolveCursorPackVariant,
	SUPPORTED_CURSOR_KEYS,
} from "./shared";

let cursorAssetsPromise: Promise<void> | null = null;
let cursorPackAssetsPromise: Promise<void> | null = null;
let loadedCursorPackSourcesSignature = "";
let loadedCursorAssets: Partial<Record<CursorAssetKey, LoadedCursorAsset>> = {};
let loadedInvertedCursorAssets: Partial<Record<CursorAssetKey, LoadedCursorAsset>> = {};
let loadedCursorStyleAssets: Partial<Record<SingleCursorStyle, LoadedCursorAsset>> = {};
let loadedCursorPackAssets: Partial<Record<string, LoadedCursorPackAssets>> = {};
const warnedMissingCursorPackStyles = new Set<string>();

function getCursorPackSources(): Record<string, CursorPackSource> {
	const sources: Record<string, CursorPackSource> = { ...BUILTIN_CURSOR_PACK_SOURCES };

	for (const cursorStyle of extensionHost.getContributedCursorStyles()) {
		const hotspot = cursorStyle.cursorStyle.hotspot ?? DEFAULT_CURSOR_PACK_ANCHOR;
		sources[cursorStyle.id] = {
			defaultUrl: cursorStyle.resolvedDefaultUrl,
			pointerUrl: cursorStyle.resolvedClickUrl ?? cursorStyle.resolvedDefaultUrl,
			defaultAnchor: hotspot,
			pointerAnchor: hotspot,
		};
	}

	return sources;
}

function buildCursorPackSourcesSignature(sources: Record<string, CursorPackSource>): string {
	return Object.entries(sources)
		.sort(([left], [right]) => left.localeCompare(right))
		.map(
			([style, source]) =>
				`${style}:${source.defaultUrl}:${source.pointerUrl}:${source.defaultAnchor.x}:${source.defaultAnchor.y}:${source.pointerAnchor.x}:${source.pointerAnchor.y}`,
		)
		.join("|");
}

async function createCursorStyleAsset(style: SingleCursorStyle): Promise<LoadedCursorAsset> {
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
		const texture = Texture.from(trimmed.dataUrl);

		return {
			texture,
			image: trimmedImage,
			aspectRatio: trimmed.height > 0 ? trimmed.width / trimmed.height : 1,
			anchorX: trimmed.hotspot && trimmed.width > 0 ? trimmed.hotspot.x / trimmed.width : 0,
			anchorY: trimmed.hotspot && trimmed.height > 0 ? trimmed.hotspot.y / trimmed.height : 0,
		};
	}

	const canvas = document.createElement("canvas");
	canvas.width = 112;
	canvas.height = 112;
	const ctx = canvas.getContext("2d")!;
	const cx = canvas.width / 2;
	const cy = canvas.height / 2;
	const radius = 26;
	ctx.fillStyle = "#ffffff";
	ctx.strokeStyle = "rgba(15, 23, 42, 0.88)";
	ctx.lineWidth = 10;
	ctx.beginPath();
	ctx.arc(cx, cy, radius, 0, Math.PI * 2);
	ctx.fill();
	ctx.stroke();

	const dataUrl = canvas.toDataURL("image/png");
	await Assets.load(dataUrl);
	const image = await loadImage(dataUrl);
	const texture = Texture.from(dataUrl);

	return {
		texture,
		image,
		aspectRatio: canvas.height > 0 ? canvas.width / canvas.height : 1,
		anchorX: 0.5,
		anchorY: 0.5,
	};
}

async function createCursorPackAsset(
	url: string,
	anchor: { x: number; y: number },
): Promise<LoadedCursorAsset> {
	const renderableUrl = await getRenderableAssetUrl(url);
	await Assets.load(renderableUrl);
	const image = await loadImage(renderableUrl);
	const texture = Texture.from(renderableUrl);

	return {
		texture,
		image,
		aspectRatio: image.naturalHeight > 0 ? image.naturalWidth / image.naturalHeight : 1,
		anchorX: clampCursorValue(anchor.x, 0, 1),
		anchorY: clampCursorValue(anchor.y, 0, 1),
	};
}

function loadImage(dataUrl: string) {
	return new Promise<HTMLImageElement>((resolve, reject) => {
		const image = new Image();
		image.onload = () => resolve(image);
		image.onerror = () =>
			reject(new Error(`Failed to load cursor image: ${dataUrl.slice(0, 128)}`));
		image.src = dataUrl;
	});
}

function trimCanvasToAlpha(canvas: HTMLCanvasElement, hotspot?: { x: number; y: number }) {
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
	croppedCtx.drawImage(canvas, minX, minY, croppedWidth, croppedHeight, 0, 0, croppedWidth, croppedHeight);

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

async function createInvertedCursorAsset(asset: LoadedCursorAsset): Promise<LoadedCursorAsset> {
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
	const texture = Texture.from(dataUrl);

	return {
		texture,
		image,
		aspectRatio: asset.aspectRatio,
		anchorX: asset.anchorX,
		anchorY: asset.anchorY,
	};
}

function getNormalizedAnchor(
	systemAsset: SystemCursorAsset | undefined,
	fallbackAnchor: { x: number; y: number },
) {
	if (!systemAsset || systemAsset.width <= 0 || systemAsset.height <= 0) {
		return fallbackAnchor;
	}

	return {
		x: clampCursorValue(systemAsset.hotspotX / systemAsset.width, 0, 1),
		y: clampCursorValue(systemAsset.hotspotY / systemAsset.height, 0, 1),
	};
}

async function rasterizeAndCropSvg(
	url: string,
	sampleSize: number,
	trimX: number,
	trimY: number,
	trimWidth: number,
	trimHeight: number,
): Promise<{ dataUrl: string; width: number; height: number }> {
	const img = await loadImage(url);
	const srcCanvas = document.createElement("canvas");
	srcCanvas.width = sampleSize;
	srcCanvas.height = sampleSize;
	const srcCtx = srcCanvas.getContext("2d")!;
	srcCtx.drawImage(img, 0, 0, sampleSize, sampleSize);

	const dstCanvas = document.createElement("canvas");
	dstCanvas.width = trimWidth;
	dstCanvas.height = trimHeight;
	const dstCtx = dstCanvas.getContext("2d")!;
	dstCtx.drawImage(srcCanvas, trimX, trimY, trimWidth, trimHeight, 0, 0, trimWidth, trimHeight);

	return {
		dataUrl: dstCanvas.toDataURL("image/png"),
		width: dstCanvas.width,
		height: dstCanvas.height,
	};
}

export function getCursorAsset(key: CursorAssetKey): LoadedCursorAsset {
	const asset = loadedCursorAssets[key];
	if (!asset) {
		throw new Error(`Missing cursor asset for ${key}`);
	}

	return asset;
}

export function getAvailableCursorKeys(): CursorAssetKey[] {
	const loadedKeys = Object.keys(loadedCursorAssets) as CursorAssetKey[];
	return loadedKeys.length > 0 ? loadedKeys : ["arrow"];
}

export function getCursorStyleAsset(style: SingleCursorStyle) {
	const asset = loadedCursorStyleAssets[style];
	if (!asset) {
		throw new Error(`Missing cursor style asset for ${style}`);
	}

	return asset;
}

export function getStatefulCursorAsset(style: StatefulCursorStyle, key: CursorAssetKey) {
	const assetMap = style === "mono" ? loadedInvertedCursorAssets : loadedCursorAssets;
	const asset = assetMap[key] ?? assetMap.arrow;
	if (!asset) {
		throw new Error(`Missing ${style} cursor asset for ${key}`);
	}

	return asset;
}

export function getCursorPackStyleAsset(style: CursorPackStyle, key: CursorAssetKey) {
	const styleAssets = loadedCursorPackAssets[style];
	if (!styleAssets) {
		if (!warnedMissingCursorPackStyles.has(style)) {
			warnedMissingCursorPackStyles.add(style);
			console.warn(
				`[CursorRenderer] Missing cursor pack assets for ${style}; falling back to Tahoe cursors.`,
			);
		}
		return getStatefulCursorAsset("tahoe", key);
	}

	const variant = resolveCursorPackVariant(key);
	return styleAssets[variant] ?? styleAssets.default;
}

async function ensureCursorPackAssetsLoaded() {
	const sources = getCursorPackSources();
	const signature = buildCursorPackSourcesSignature(sources);

	if (!cursorPackAssetsPromise || loadedCursorPackSourcesSignature !== signature) {
		loadedCursorPackSourcesSignature = signature;
		warnedMissingCursorPackStyles.clear();
		cursorPackAssetsPromise = (async () => {
			const cursorPackEntries = await Promise.all(
				Object.entries(sources).map(async ([style, source]) => {
					try {
						const [defaultAsset, pointerAsset] = await Promise.all([
							createCursorPackAsset(source.defaultUrl, source.defaultAnchor),
							createCursorPackAsset(source.pointerUrl, source.pointerAnchor),
						]);
						return [style, { default: defaultAsset, pointer: pointerAsset }] as const;
					} catch (error) {
						console.warn(
							`[CursorRenderer] Failed to load cursor pack style for: ${style}`,
							error,
						);
						return null;
					}
				}),
			);

			loadedCursorPackAssets = Object.fromEntries(
				cursorPackEntries.filter(Boolean).map((entry) => entry!),
			) as Partial<Record<string, LoadedCursorPackAssets>>;
		})();
	}

	await cursorPackAssetsPromise;
}

export async function preloadCursorAssets() {
	if (!cursorAssetsPromise) {
		cursorAssetsPromise = (async () => {
			const isLinux = typeof navigator !== "undefined" && /linux/i.test(navigator.platform);
			let systemCursors: Record<string, SystemCursorAsset> = {};

			try {
				const result = await window.electronAPI.getSystemCursorAssets();
				if (result.success && result.cursors) {
					systemCursors = result.cursors;
				}
			} catch (error) {
				console.warn("[CursorRenderer] Failed to fetch system cursor assets:", error);
			}

			const entries = await Promise.all(
				SUPPORTED_CURSOR_KEYS.map(async (key) => {
					const systemAsset = systemCursors[key];
					const uploadedAsset = uploadedCursorAssets[key];
					const assetUrl = isLinux
						? uploadedAsset?.url
						: uploadedAsset?.url ?? systemAsset?.dataUrl;

					if (!assetUrl) {
						console.warn(`[CursorRenderer] No cursor image for: ${key}`);
						return null;
					}

					try {
						let finalUrl: string;
						let width: number;
						let height: number;
						let normalizedAnchor: { x: number; y: number };

						if (uploadedAsset) {
							const { trim } = uploadedAsset;
							const rasterized = await rasterizeAndCropSvg(
								assetUrl,
								UPLOADED_CURSOR_SAMPLE_SIZE,
								trim.x,
								trim.y,
								trim.width,
								trim.height,
							);
							finalUrl = rasterized.dataUrl;
							width = rasterized.width;
							height = rasterized.height;
							normalizedAnchor = {
								x: clampCursorValue(
									(uploadedAsset.fallbackAnchor.x * trim.width) / width,
									0,
									1,
								),
								y: clampCursorValue(
									(uploadedAsset.fallbackAnchor.y * trim.height) / height,
									0,
									1,
								),
							};
						} else {
							finalUrl = assetUrl;
							const img = await loadImage(finalUrl);
							width = img.naturalWidth;
							height = img.naturalHeight;
							normalizedAnchor = getNormalizedAnchor(systemAsset, { x: 0, y: 0 });
						}

						await Assets.load(finalUrl);
						const image = await loadImage(finalUrl);
						const texture = Texture.from(finalUrl);

						return [
							key,
							{
								texture,
								image,
								aspectRatio: height > 0 ? width / height : 1,
								anchorX: normalizedAnchor.x,
								anchorY: normalizedAnchor.y,
							} satisfies LoadedCursorAsset,
						] as const;
					} catch (error) {
						console.warn(`[CursorRenderer] Failed to load cursor image for: ${key}`, error);
						return null;
					}
				}),
			);

			loadedCursorAssets = Object.fromEntries(
				entries.filter(Boolean).map((entry) => entry!),
			) as Partial<Record<CursorAssetKey, LoadedCursorAsset>>;

			const invertedEntries = await Promise.all(
				(Object.entries(loadedCursorAssets) as Array<[CursorAssetKey, LoadedCursorAsset]>).map(
					async ([key, asset]) => [key, await createInvertedCursorAsset(asset)] as const,
				),
			);

			loadedInvertedCursorAssets = Object.fromEntries(invertedEntries) as Partial<
				Record<CursorAssetKey, LoadedCursorAsset>
			>;

			const customStyleEntries = await Promise.all(
				(["dot", "figma"] as const).map(
					async (style) => [style, await createCursorStyleAsset(style)] as const,
				),
			);

			loadedCursorStyleAssets = Object.fromEntries(customStyleEntries) as Partial<
				Record<SingleCursorStyle, LoadedCursorAsset>
			>;

			if (!loadedCursorAssets.arrow) {
				throw new Error("Failed to initialize the fallback arrow cursor asset");
			}
		})();
	}

	await cursorAssetsPromise;
	await ensureCursorPackAssetsLoaded();
}

export function isCursorPackPointerType(cursorType: CursorAssetKey) {
	return CURSOR_PACK_POINTER_TYPES.has(cursorType);
}

export { isSingleCursorStyle };