import { Graphics } from "pixi.js";
import { describe, expect, it } from "vitest";
import {
	drawDeviceFrameLetterbox,
	drawVideoScreenMask,
	getDeviceFrameGeometry,
	getDeviceFrameInsets,
} from "./deviceFrame";
import { computePaddedLayout } from "./videoPlayback/layoutUtils";

describe("photographic device frame composition", () => {
	it.each([
		"iphone-black",
		"iphone-silver",
	] as const)("fits the complete %s photo at zero padding without stretching a crop", (frame) => {
		for (const [videoWidth, videoHeight] of [
			[1206, 2622],
			[2622, 1206],
		]) {
			for (const cropRegion of [
				{ x: 0, y: 0, width: 1, height: 1 },
				{ x: 0.1, y: 0.1, width: 0.8, height: 0.15 },
			]) {
				const layout = computePaddedLayout({
					width: 1080,
					height: 1080,
					padding: 0,
					videoWidth,
					videoHeight,
					cropRegion,
					deviceFrame: frame,
				});
				const screen = {
					x: layout.centerOffsetX,
					y: layout.centerOffsetY,
					width: layout.croppedDisplayWidth,
					height: layout.croppedDisplayHeight,
				};
				const geometry = getDeviceFrameGeometry(
					frame,
					screen,
					videoWidth <= videoHeight ? "portrait" : "landscape",
				)!;
				expect(screen.width / screen.height).toBeCloseTo(
					(videoWidth * cropRegion.width) / (videoHeight * cropRegion.height),
				);
				expect(layout.spriteX + videoWidth * cropRegion.x * layout.scale).toBeCloseTo(
					screen.x,
				);
				expect(layout.spriteY + videoHeight * cropRegion.y * layout.scale).toBeCloseTo(
					screen.y,
				);
				expect(geometry.bounds.width / geometry.bounds.height).toBeCloseTo(
					videoWidth <= videoHeight ? 450 / 920 : 920 / 450,
				);
				for (const rect of [geometry.bounds, geometry.body, ...geometry.buttons]) {
					expect(rect.x).toBeGreaterThanOrEqual(-0.000001);
					expect(rect.y).toBeGreaterThanOrEqual(-0.000001);
					expect(rect.x + rect.width).toBeLessThanOrEqual(1080.000001);
					expect(rect.y + rect.height).toBeLessThanOrEqual(1080.000001);
				}
			}
		}
	});

	it("matches the physical iPhone capture to the photo screen without letterboxing", () => {
		const content = { x: 100, y: 100, width: 1206, height: 2622 };
		const geometry = getDeviceFrameGeometry("iphone-black", content)!;
		expect(geometry.screen).toEqual(content);
		expect(geometry.scale).toBe(3);
		expect(geometry.bounds).toEqual({ x: 28, y: 31, width: 1350, height: 2760 });
		const graphics = new Graphics();
		drawDeviceFrameLetterbox(graphics, "iphone-black", content);
		expect(graphics.context.instructions).toHaveLength(0);
		graphics.destroy();
	});

	it("retains portrait hardware for a wide crop and never reveals pixels outside the crop", () => {
		const content = { x: 24, y: 350, width: 402, height: 220 };
		const geometry = getDeviceFrameGeometry("iphone-black", content, "portrait")!;
		expect(geometry.screen).toEqual({ x: 24, y: 23, width: 402, height: 874 });
		const mask = new Graphics();
		const bars = new Graphics();
		drawVideoScreenMask(mask, "iphone-black", content, 0, "portrait");
		drawDeviceFrameLetterbox(bars, "iphone-black", content, "portrait");
		for (const point of [
			{ x: 225, y: 30 },
			{ x: 225, y: 349 },
			{ x: 225, y: 571 },
			{ x: 225, y: 890 },
		]) {
			expect(mask.context.containsPoint(point)).toBe(false);
			expect(bars.context.containsPoint(point)).toBe(true);
		}
		expect(mask.context.containsPoint({ x: 25, y: 460 })).toBe(true);
		expect(bars.context.containsPoint({ x: 25, y: 460 })).toBe(false);
		expect(bars.context.containsPoint({ x: 24, y: 23 })).toBe(false);
		mask.destroy();
		bars.destroy();
	});

	it("clips only the physical aperture corners when the recording fills the screen", () => {
		const content = { x: 24, y: 23, width: 402, height: 874 };
		const mask = new Graphics();
		drawVideoScreenMask(mask, "iphone-black", content, 0);
		for (const point of [
			{ x: 225, y: 24 },
			{ x: 225, y: 55 },
			{ x: 25, y: 460 },
			{ x: 225, y: 896 },
		])
			expect(mask.context.containsPoint(point)).toBe(true);
		expect(mask.context.containsPoint({ x: 24, y: 23 })).toBe(false);
		expect(mask.context.containsPoint({ x: 23, y: 460 })).toBe(false);
		mask.destroy();
	});

	it("leaves None geometry unchanged", () => {
		expect(getDeviceFrameInsets("none", 300, 650)).toBeNull();
		expect(
			getDeviceFrameGeometry(undefined, { x: 0, y: 0, width: 300, height: 650 }),
		).toBeNull();
		const without = computePaddedLayout({
			width: 1080,
			height: 1080,
			padding: 0,
			videoWidth: 1206,
			videoHeight: 2622,
			cropRegion: { x: 0, y: 0, width: 1, height: 1 },
		});
		const none = computePaddedLayout({
			width: 1080,
			height: 1080,
			padding: 0,
			videoWidth: 1206,
			videoHeight: 2622,
			cropRegion: { x: 0, y: 0, width: 1, height: 1 },
			deviceFrame: "none",
		});
		expect(none).toEqual(without);
	});
});
