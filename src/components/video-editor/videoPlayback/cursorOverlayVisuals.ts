import { BlurFilter, Container, Graphics, Sprite } from "pixi.js";
import { MotionBlurFilter } from "pixi-filters/motion-blur";
import type { CursorStyle } from "../types";
import {
	getAvailableCursorKeys,
	getCursorAsset,
	getCursorPackStyleAsset,
	getCursorStyleAsset,
	getStatefulCursorAsset,
} from "./cursorAssetRegistry";
import {
	CURSOR_SHADOW_ALPHA,
	CURSOR_SHADOW_BLUR,
	CURSOR_SHADOW_COLOR,
	CURSOR_SHADOW_PADDING,
	type CursorAssetKey,
	isSingleCursorStyle,
	isStatefulCursorStyle,
} from "./cursorRenderConfig";
export function createCursorOverlayVisuals() {
	const container: Container = new Container();

	container.label = "cursor-overlay";

	const clickRingGraphics: Graphics = new Graphics();

	const initialCustomAsset = getCursorStyleAsset("figma");

	const customCursorShadowSprite: Sprite = new Sprite(initialCustomAsset.texture);

	customCursorShadowSprite.anchor.set(initialCustomAsset.anchorX, initialCustomAsset.anchorY);

	customCursorShadowSprite.visible = false;

	customCursorShadowSprite.roundPixels = true;

	customCursorShadowSprite.tint = CURSOR_SHADOW_COLOR;

	customCursorShadowSprite.alpha = CURSOR_SHADOW_ALPHA;

	const customCursorShadowFilter: BlurFilter = new BlurFilter();

	customCursorShadowFilter.blur = CURSOR_SHADOW_BLUR;

	customCursorShadowFilter.quality = 4;

	customCursorShadowFilter.padding = CURSOR_SHADOW_PADDING;

	customCursorShadowSprite.filters = [customCursorShadowFilter];

	const customCursorSprite: Sprite = new Sprite(initialCustomAsset.texture);

	customCursorSprite.anchor.set(initialCustomAsset.anchorX, initialCustomAsset.anchorY);

	customCursorSprite.visible = false;

	customCursorSprite.roundPixels = true;

	const cursorShadowSprites: Partial<Record<CursorAssetKey, Sprite>> = {};

	const cursorShadowFilters: Partial<Record<CursorAssetKey, BlurFilter>> = {};

	const cursorSprites: Partial<Record<CursorAssetKey, Sprite>> = {};

	for (const key of getAvailableCursorKeys()) {
		const asset = getCursorAsset(key);
		const shadowSprite = new Sprite(asset.texture);
		shadowSprite.anchor.set(asset.anchorX, asset.anchorY);
		shadowSprite.visible = false;
		shadowSprite.roundPixels = true;
		shadowSprite.tint = CURSOR_SHADOW_COLOR;
		shadowSprite.alpha = CURSOR_SHADOW_ALPHA;
		const shadowFilter = new BlurFilter();
		shadowFilter.blur = CURSOR_SHADOW_BLUR;
		shadowFilter.quality = 4;
		shadowFilter.padding = CURSOR_SHADOW_PADDING;
		shadowSprite.filters = [shadowFilter];
		cursorShadowSprites[key] = shadowSprite;
		cursorShadowFilters[key] = shadowFilter;

		const sprite = new Sprite(asset.texture);
		sprite.anchor.set(asset.anchorX, asset.anchorY);
		sprite.visible = false;
		sprite.roundPixels = true;
		cursorSprites[key] = sprite;
	}

	const cursorMotionBlurFilter: MotionBlurFilter = new MotionBlurFilter([0, 0], 5, 0);

	container.filters = null;

	container.addChild(
		clickRingGraphics,
		customCursorShadowSprite,
		...Object.values(cursorShadowSprites),
		customCursorSprite,
		...Object.values(cursorSprites),
	);
	return {
		container,
		clickRingGraphics,
		customCursorShadowSprite,
		customCursorShadowFilter,
		customCursorSprite,
		cursorShadowSprites,
		cursorShadowFilters,
		cursorSprites,
		cursorMotionBlurFilter,
	};
}
export type CursorOverlayVisuals = ReturnType<typeof createCursorOverlayVisuals>;

export function applyCursorVisualStyle(visuals: CursorOverlayVisuals, style: CursorStyle) {
	if (isStatefulCursorStyle(style)) {
		for (const key of getAvailableCursorKeys()) {
			const asset = getStatefulCursorAsset(style, key);
			const shadowSprite = visuals.cursorShadowSprites[key];
			const sprite = visuals.cursorSprites[key];
			shadowSprite?.anchor.set(asset.anchorX, asset.anchorY);
			if (shadowSprite) {
				shadowSprite.texture = asset.texture;
			}
			sprite?.anchor.set(asset.anchorX, asset.anchorY);
			if (sprite) {
				sprite.texture = asset.texture;
			}
		}
		return;
	}

	const asset = isSingleCursorStyle(style)
		? getCursorStyleAsset(style)
		: getCursorPackStyleAsset(style, "arrow");

	visuals.customCursorShadowSprite.texture = asset.texture;

	visuals.customCursorShadowSprite.anchor.set(asset.anchorX, asset.anchorY);

	visuals.customCursorSprite.texture = asset.texture;

	visuals.customCursorSprite.anchor.set(asset.anchorX, asset.anchorY);
}
