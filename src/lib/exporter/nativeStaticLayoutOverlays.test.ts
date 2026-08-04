import { describe, expect, it } from "vitest";
import type { NativeStaticLayoutOverlayLayer } from "./nativeStaticLayoutOverlays";
import {
	areNativeStaticLayoutOverlayFramesEqual,
	getNativeStaticLayoutOverlayFrameByteSize,
	sortNativeStaticLayoutOverlayLayers,
	validateNativeStaticLayoutOverlayLayer,
} from "./nativeStaticLayoutOverlays";

const layer = (
	overrides: Partial<NativeStaticLayoutOverlayLayer> = {},
): NativeStaticLayoutOverlayLayer => ({
	id: "overlay",
	order: 0,
	path: "C:/Temp/overlay.rgba",
	x: 0,
	y: 0,
	width: 1920,
	height: 1080,
	frameRate: 30,
	durationSec: 2,
	frameCount: 60,
	pixelFormat: "rgba",
	...overrides,
});

describe("native static-layout overlay layers", () => {
	it("calculates RGBA frame size", () => {
		expect(getNativeStaticLayoutOverlayFrameByteSize(1920, 1080)).toBe(1920 * 1080 * 4);
	});

	it("detects byte-identical RGBA overlay frames", () => {
		const frameA = new Uint8Array([1, 2, 3, 4, 5]);
		const frameACopy = new Uint8Array([1, 2, 3, 4, 5]);
		const frameB = new Uint8Array([1, 2, 3, 4, 6]);
		const shortFrame = new Uint8Array([1, 2, 3, 4]);

		expect(areNativeStaticLayoutOverlayFramesEqual(frameA, frameA)).toBe(true);
		expect(areNativeStaticLayoutOverlayFramesEqual(frameA, frameACopy)).toBe(true);
		expect(areNativeStaticLayoutOverlayFramesEqual(frameA, frameB)).toBe(false);
		expect(areNativeStaticLayoutOverlayFramesEqual(frameA, shortFrame)).toBe(false);
		expect(areNativeStaticLayoutOverlayFramesEqual(shortFrame, frameA)).toBe(false);
	});

	it("rejects layers with an invalid effective frame count", () => {
		const options = {
			outputWidth: 1920,
			outputHeight: 1080,
			durationSec: 2,
			frameRate: 30,
		};
		expect(
			validateNativeStaticLayoutOverlayLayer(layer({ effectiveFrameCount: 1 }), options),
		).toBeNull();
		expect(
			validateNativeStaticLayoutOverlayLayer(layer({ effectiveFrameCount: 60 }), options),
		).toBeNull();
		expect(
			validateNativeStaticLayoutOverlayLayer(layer({ effectiveFrameCount: 0 }), options),
		).toBe("overlay layer overlay has an invalid effective frame count");
		expect(
			validateNativeStaticLayoutOverlayLayer(layer({ effectiveFrameCount: 61 }), options),
		).toBe("overlay layer overlay has an invalid effective frame count");
		expect(
			validateNativeStaticLayoutOverlayLayer(layer({ effectiveFrameCount: 1.5 }), options),
		).toBe("overlay layer overlay has an invalid effective frame count");
	});

	it("sorts layers by z-order and then id", () => {
		expect(
			sortNativeStaticLayoutOverlayLayers([
				layer({ id: "b", order: 1 }),
				layer({ id: "z", order: 0 }),
				layer({ id: "a", order: 0 }),
			]).map((entry) => entry.id),
		).toEqual(["a", "z", "b"]);
	});

	it("rejects layers that do not match the output timeline", () => {
		expect(
			validateNativeStaticLayoutOverlayLayer(layer({ width: 1921 }), {
				outputWidth: 1920,
				outputHeight: 1080,
				durationSec: 2,
				frameRate: 30,
			}),
		).toBe("overlay layer overlay has invalid output bounds");
		expect(
			validateNativeStaticLayoutOverlayLayer(layer({ frameRate: 24 }), {
				outputWidth: 1920,
				outputHeight: 1080,
				durationSec: 2,
				frameRate: 30,
			}),
		).toContain("incompatible frame rate");
	});
});
