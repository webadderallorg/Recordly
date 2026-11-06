import { type CursorStyle, DEFAULT_CURSOR_STYLE } from "../types";
import {
	getCursorPackStyleAsset,
	getCursorStyleAsset,
	getStatefulCursorAsset,
	preloadCursorAssets,
} from "./cursorAssetRegistry";
import {
	CursorAssetKey,
	isSingleCursorStyle,
	isStatefulCursorStyle,
	NativeCursorAtlas,
	NativeCursorAtlasEntry,
	SUPPORTED_CURSOR_KEYS,
} from "./cursorRenderConfig";

export const NATIVE_CURSOR_ATLAS_DRAW_HEIGHT = 256;

export const NATIVE_CURSOR_ATLAS_PADDING = 2;

export function getNativeCursorAtlasAsset(style: CursorStyle, key: CursorAssetKey) {
	if (isStatefulCursorStyle(style)) {
		return getStatefulCursorAsset(style, key);
	}

	if (isSingleCursorStyle(style)) {
		return getCursorStyleAsset(style);
	}

	return getCursorPackStyleAsset(style, key);
}

export type CursorStylePreviewAsset = {
	url: string;
	/** Centering offsets relative to the full image height, excluding shadow. */
	offsetX: number;
	offsetY: number;
};

/** Use the exact rendered artwork and center its visible body in the picker. */
export async function getCursorStylePreview(
	style: CursorStyle,
	kind: CursorAssetKey = "arrow",
): Promise<CursorStylePreviewAsset> {
	await preloadCursorAssets();
	const { image } = getNativeCursorAtlasAsset(style, kind);
	const canvas = document.createElement("canvas");
	canvas.width = image.naturalWidth;
	canvas.height = image.naturalHeight;
	const ctx = canvas.getContext("2d")!;
	ctx.drawImage(image, 0, 0);
	const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
	let left = canvas.width,
		right = -1,
		top = canvas.height,
		bottom = -1;
	for (let y = 0; y < canvas.height; y++)
		for (let x = 0; x < canvas.width; x++) {
			if (pixels[(y * canvas.width + x) * 4 + 3] >= 128) {
				left = Math.min(left, x);
				right = Math.max(right, x);
				top = Math.min(top, y);
				bottom = Math.max(bottom, y);
			}
		}
	return {
		url: image.src,
		offsetX: right < left ? 0 : (canvas.width / 2 - (left + right + 1) / 2) / canvas.height,
		offsetY: bottom < top ? 0 : (canvas.height / 2 - (top + bottom + 1) / 2) / canvas.height,
	};
}

export async function buildNativeCursorAtlas(
	style: CursorStyle = DEFAULT_CURSOR_STYLE,
): Promise<NativeCursorAtlas | null> {
	if (typeof document === "undefined") {
		return null;
	}

	await preloadCursorAssets();

	const entries: NativeCursorAtlasEntry[] = [];
	const packedAssets = SUPPORTED_CURSOR_KEYS.map((key, index) => {
		const asset = getNativeCursorAtlasAsset(style, key);
		const height = NATIVE_CURSOR_ATLAS_DRAW_HEIGHT;
		const width = Math.max(1, Math.round(height * asset.aspectRatio));
		return { key, index, asset, width, height };
	});

	const atlasWidth = packedAssets.reduce(
		(total, item) => total + item.width + NATIVE_CURSOR_ATLAS_PADDING,
		NATIVE_CURSOR_ATLAS_PADDING,
	);
	const atlasHeight = NATIVE_CURSOR_ATLAS_DRAW_HEIGHT + NATIVE_CURSOR_ATLAS_PADDING * 2;
	const canvas = document.createElement("canvas");
	canvas.width = atlasWidth;
	canvas.height = atlasHeight;

	const ctx = canvas.getContext("2d");
	if (!ctx) {
		return null;
	}

	ctx.clearRect(0, 0, atlasWidth, atlasHeight);
	ctx.imageSmoothingEnabled = style !== "pixel-hand";
	let x = NATIVE_CURSOR_ATLAS_PADDING;
	for (const { key, index, asset, width, height } of packedAssets) {
		const y = NATIVE_CURSOR_ATLAS_PADDING;
		ctx.drawImage(asset.image, x, y, width, height);
		entries.push({
			cursorType: key,
			index,
			x,
			y,
			width,
			height,
			anchorX: asset.anchorX,
			anchorY: asset.anchorY,
			aspectRatio: asset.aspectRatio,
		});
		x += width + NATIVE_CURSOR_ATLAS_PADDING;
	}

	return {
		style,
		width: atlasWidth,
		height: atlasHeight,
		dataUrl: canvas.toDataURL("image/png"),
		entries,
	};
}
