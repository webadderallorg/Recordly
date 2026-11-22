import {
	computePaddedLayout,
	scalePreviewBorderRadius,
} from "@/components/video-editor/videoPlayback/layoutUtils";
import { drawSquircleOnGraphics } from "@/lib/geometry/squircle";
import type { FrameRenderContext } from "./modernFrameRenderer";
import type { LayoutCache } from "./modernFrameTypes";

/** Owns geometry resources for one export renderer. */
export class FrameGeometry {
	constructor(
		private readonly context: Pick<FrameRenderContext, "scene" | "config" | "shadows">,
	) {}

	layoutCache: LayoutCache | null = null;

	updateLayout(): void {
		if (
			!this.context.scene.app ||
			!this.context.scene.videoSprite ||
			!this.context.scene.videoMaskGraphics
		)
			return;

		const {
			width,
			height,
			cropRegion,
			borderRadius = 0,
			padding = 0,
			videoWidth,
			videoHeight,
		} = this.context.config;

		const layout = computePaddedLayout({
			width,
			height,
			padding,
			frameInsets: null,
			cropRegion,
			videoWidth,
			videoHeight,
		});

		this.context.scene.videoSprite.scale.set(layout.scale);
		this.context.scene.videoSprite.position.set(layout.spriteX, layout.spriteY);

		const scaledBorderRadius = scalePreviewBorderRadius(
			layout.croppedDisplayWidth,
			layout.croppedDisplayHeight,
			borderRadius,
			{ width, height },
		);

		this.context.scene.videoMaskGraphics.clear();
		drawSquircleOnGraphics(this.context.scene.videoMaskGraphics, {
			x: layout.centerOffsetX,
			y: layout.centerOffsetY,
			width: layout.croppedDisplayWidth,
			height: layout.croppedDisplayHeight,
			radius: scaledBorderRadius,
		});
		this.context.scene.videoMaskGraphics.fill({ color: 0xffffff });

		this.context.shadows.updateVideoShadowLayout({
			maskX: layout.centerOffsetX,
			maskY: layout.centerOffsetY,
			maskWidth: layout.croppedDisplayWidth,
			maskHeight: layout.croppedDisplayHeight,
			maskRadius: scaledBorderRadius,
		});

		this.layoutCache = {
			stageSize: { width, height },
			videoSize: {
				width: videoWidth * cropRegion.width,
				height: videoHeight * cropRegion.height,
			},
			baseScale: layout.scale,
			baseOffset: { x: layout.spriteX, y: layout.spriteY },
			maskRect: {
				x: layout.centerOffsetX,
				y: layout.centerOffsetY,
				width: layout.croppedDisplayWidth,
				height: layout.croppedDisplayHeight,
				sourceCrop: cropRegion,
			},
		};
	}
}
