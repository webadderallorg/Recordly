import { drawCssGradientBackground } from "@/lib/exporter/cssGradientBackground";
import { FrameRenderer as LegacyFrameRenderer } from "@/lib/exporter/frameRenderer";
import { FrameRenderer as ModernFrameRenderer } from "@/lib/exporter/modernFrameRenderer";

const width = 160;
const height = 90;
function pixels(canvas: HTMLCanvasElement) {
	const composite = document.createElement("canvas");
	composite.width = width;
	composite.height = height;
	const ctx = composite.getContext("2d")!;
	ctx.fillStyle = "white";
	ctx.fillRect(0, 0, width, height);
	ctx.drawImage(canvas, 0, 0);
	const data = ctx.getImageData(0, 0, width, height).data;
	// Return exactly the channels asserted by the smoke test. Full pixel arrays
	// produce huge Playwright protocol/trace payloads and can consume the timeout.
	const samples: Record<number, number> = {};
	for (const x of [10, 40, 80, 120, 150])
		for (const y of [10, 30, 60, 80])
			for (let channel = 0; channel < 4; channel++) {
				const offset = (y * width + x) * 4 + channel;
				samples[offset] = data[offset];
			}
	return samples;
}

Object.assign(window, {
	async renderGradientBackgrounds(presets: string[]) {
		const results = [];
		for (const wallpaper of presets) {
			const preview = document.createElement("div");
			preview.style.cssText = `width:${width}px;height:${height}px;background:${wallpaper}`;
			document.getElementById("reference")!.append(preview);
			const canvas = document.createElement("canvas");
			canvas.width = width;
			canvas.height = height;
			const supported = drawCssGradientBackground(
				canvas.getContext("2d")!,
				wallpaper,
				width,
				height,
			);
			const config = { width, height, wallpaper, backgroundBlur: 0 };
			// Exercise actual background construction with real Canvas and Pixi textures.
			const legacy = new LegacyFrameRenderer(config as never) as unknown as {
				setupBackground(): Promise<void>;
				backgroundSprite: HTMLCanvasElement;
			};
			const modern = new ModernFrameRenderer(config as never) as unknown as {
				background: {
					setupBackground(): Promise<void>;
					backgroundSprite: {
						texture: {
							source: { resource: HTMLCanvasElement };
							destroy(deep: boolean): void;
						};
						destroy(): void;
					};
				};
			};
			await legacy.setupBackground();
			await modern.background.setupBackground();
			results.push({
				wallpaper,
				supported,
				helper: pixels(canvas),
				legacy: pixels(legacy.backgroundSprite),
				modern: pixels(modern.background.backgroundSprite.texture.source.resource),
			});
			modern.background.backgroundSprite.texture.destroy(true);
			modern.background.backgroundSprite.destroy();
		}
		return results;
	},
});
document.body.dataset.ready = "true";
