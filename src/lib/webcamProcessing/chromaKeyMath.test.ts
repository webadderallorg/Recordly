import { describe, expect, it } from "vitest";
import {
	applyColorAdjustments,
	chromaKeyAlpha,
	chromaKeyAlphaMulti,
	DEFAULT_KEY_COLOR,
	hexToRgb01,
	maskAlpha,
	suppressSpill,
} from "./chromaKeyMath";

const GREEN = { r: 0.1, g: 0.85, b: 0.12 };
const SKIN = { r: 0.85, g: 0.62, b: 0.5 };

describe("chromaKeyAlpha", () => {
	it("keys out a saturated green pixel at default strength", () => {
		expect(chromaKeyAlpha(GREEN, DEFAULT_KEY_COLOR, 0.5, 0.35)).toBe(0);
	});

	it("keeps a skin-tone pixel fully opaque", () => {
		expect(chromaKeyAlpha(SKIN, DEFAULT_KEY_COLOR, 0.5, 0.35)).toBe(1);
	});

	it("produces partial alpha on edge pixels, softer with higher edgeSoftness", () => {
		// A pixel partway between green screen and foreground.
		const edge = { r: 0.35, g: 0.62, b: 0.33 };
		const hard = chromaKeyAlpha(edge, DEFAULT_KEY_COLOR, 0.5, 0.05);
		const soft = chromaKeyAlpha(edge, DEFAULT_KEY_COLOR, 0.5, 0.9);
		expect(soft).toBeGreaterThan(0);
		expect(soft).toBeLessThan(1);
		expect(hard).toBeGreaterThanOrEqual(soft);
	});

	it("higher keyStrength removes more green", () => {
		const nearGreen = { r: 0.3, g: 0.6, b: 0.3 };
		const weak = chromaKeyAlpha(nearGreen, DEFAULT_KEY_COLOR, 0.05, 0.2);
		const strong = chromaKeyAlpha(nearGreen, DEFAULT_KEY_COLOR, 0.95, 0.2);
		expect(strong).toBeLessThanOrEqual(weak);
	});
});

describe("hexToRgb01", () => {
	it("parses 6-digit hex", () => {
		expect(hexToRgb01("#00cc00")).toEqual({ r: 0, g: 0.8, b: 0 });
		const lime = hexToRgb01("#8CC63F");
		expect(lime.r).toBeCloseTo(140 / 255, 6);
		expect(lime.g).toBeCloseTo(198 / 255, 6);
		expect(lime.b).toBeCloseTo(63 / 255, 6);
	});

	it("falls back to the default key color on junk", () => {
		expect(hexToRgb01("green")).toEqual(DEFAULT_KEY_COLOR);
		expect(hexToRgb01("#fff")).toEqual(DEFAULT_KEY_COLOR);
		expect(hexToRgb01(null)).toEqual(DEFAULT_KEY_COLOR);
		expect(hexToRgb01(undefined)).toEqual(DEFAULT_KEY_COLOR);
	});

	it("a picked real-world lime keys out lime pixels that the default green missed", () => {
		// A bright lime screen under warm light.
		const screenPixel = { r: 0.55, g: 0.78, b: 0.25 };
		const defaultAlpha = chromaKeyAlpha(screenPixel, DEFAULT_KEY_COLOR, 0.5, 0.35);
		const picked = hexToRgb01("#8cc73f");
		const pickedAlpha = chromaKeyAlpha(screenPixel, picked, 0.5, 0.35);
		expect(defaultAlpha).toBe(1); // the bug Michael hit: nothing keyed
		expect(pickedAlpha).toBeLessThan(0.2); // eyedropper fixes it
	});
});

describe("chromaKeyAlphaMulti", () => {
	it("keys a pixel that matches either color", () => {
		const brightLime = hexToRgb01("#8cc73f");
		const shadowGreen = hexToRgb01("#3f7a2a");
		const colors = [brightLime, shadowGreen];
		// A pixel near the SHADOW green: missed by the bright key alone.
		const shadowPixel = { r: 0.26, g: 0.49, b: 0.18 };
		const brightOnly = chromaKeyAlpha(shadowPixel, brightLime, 0.5, 0.35);
		const combined = chromaKeyAlphaMulti(shadowPixel, colors, 0.5, 0.35);
		expect(combined).toBeLessThanOrEqual(brightOnly);
		expect(combined).toBeLessThan(0.5);
	});

	it("keeps foreground pixels opaque under both keys", () => {
		const colors = [hexToRgb01("#8cc73f"), hexToRgb01("#3f7a2a")];
		expect(chromaKeyAlphaMulti(SKIN, colors, 0.5, 0.35)).toBe(1);
	});

	it("single color behaves identically to chromaKeyAlpha", () => {
		const color = hexToRgb01("#8cc73f");
		const pixel = { r: 0.5, g: 0.7, b: 0.3 };
		expect(chromaKeyAlphaMulti(pixel, [color], 0.5, 0.35)).toBe(
			chromaKeyAlpha(pixel, color, 0.5, 0.35),
		);
	});
});

describe("suppressSpill", () => {
	it("leaves fully opaque pixels untouched", () => {
		expect(suppressSpill(SKIN, 1)).toEqual(SKIN);
	});

	it("clamps green toward max(r, b) on semi-transparent edge pixels", () => {
		const spilled = { r: 0.4, g: 0.8, b: 0.45 };
		const out = suppressSpill(spilled, 0.5);
		expect(out.g).toBeLessThan(spilled.g);
		expect(out.g).toBeGreaterThanOrEqual(Math.min(spilled.g, Math.max(out.r, out.b)) - 1e-6);
		expect(out.r).toBe(spilled.r);
		expect(out.b).toBe(spilled.b);
	});

	it("never raises the green channel", () => {
		const noSpill = { r: 0.7, g: 0.3, b: 0.6 };
		expect(suppressSpill(noSpill, 0).g).toBeLessThanOrEqual(noSpill.g);
	});
});

describe("maskAlpha", () => {
	const rect = { x: 0.2, y: 0.2, width: 0.6, height: 0.6 };

	it("is fully opaque well inside the rect", () => {
		expect(maskAlpha(0.5, 0.5, rect, 0, 0.2)).toBe(1);
	});

	it("is fully transparent well outside the rect", () => {
		expect(maskAlpha(0.05, 0.05, rect, 0, 0.2)).toBe(0);
	});

	it("feathers smoothly across the boundary", () => {
		// Just outside the right edge, within the feather band.
		const near = maskAlpha(0.815, 0.5, rect, 0, 0.5);
		const far = maskAlpha(0.9, 0.5, rect, 0, 0.5);
		expect(near).toBeGreaterThan(far);
		expect(near).toBeGreaterThan(0);
		expect(near).toBeLessThan(1);
	});

	it("rounds corners: a point inside the bounding box but outside the corner arc fades", () => {
		const sharp = maskAlpha(0.21, 0.21, rect, 0, 0);
		const rounded = maskAlpha(0.21, 0.21, rect, 0.3, 0);
		expect(sharp).toBe(1);
		expect(rounded).toBeLessThan(1);
	});
});

describe("applyColorAdjustments", () => {
	const neutral = {
		brightness: 0,
		contrast: 0,
		highlights: 0,
		shadows: 0,
		temperature: 0,
		saturation: 0,
	};

	it("is identity at neutral settings", () => {
		expect(applyColorAdjustments(SKIN, neutral)).toEqual(SKIN);
	});

	it("brightness shifts all channels", () => {
		const out = applyColorAdjustments(
			{ r: 0.4, g: 0.4, b: 0.4 },
			{ ...neutral, brightness: 0.5 },
		);
		expect(out.r).toBeGreaterThan(0.4);
		expect(out.g).toEqual(out.r);
	});

	it("contrast pivots around mid gray", () => {
		const dark = applyColorAdjustments(
			{ r: 0.25, g: 0.25, b: 0.25 },
			{ ...neutral, contrast: 0.5 },
		);
		const bright = applyColorAdjustments(
			{ r: 0.75, g: 0.75, b: 0.75 },
			{ ...neutral, contrast: 0.5 },
		);
		expect(dark.r).toBeLessThan(0.25);
		expect(bright.r).toBeGreaterThan(0.75);
		const mid = applyColorAdjustments(
			{ r: 0.5, g: 0.5, b: 0.5 },
			{ ...neutral, contrast: 0.5 },
		);
		expect(mid.r).toBeCloseTo(0.5, 6);
	});

	it("highlights only lift bright pixels", () => {
		const dark = applyColorAdjustments(
			{ r: 0.2, g: 0.2, b: 0.2 },
			{ ...neutral, highlights: 0.8 },
		);
		const bright = applyColorAdjustments(
			{ r: 0.8, g: 0.8, b: 0.8 },
			{ ...neutral, highlights: 0.8 },
		);
		expect(dark.r).toBeCloseTo(0.2, 6);
		expect(bright.r).toBeGreaterThan(0.8);
	});

	it("shadows only lift dark pixels", () => {
		const dark = applyColorAdjustments(
			{ r: 0.2, g: 0.2, b: 0.2 },
			{ ...neutral, shadows: 0.8 },
		);
		const bright = applyColorAdjustments(
			{ r: 0.8, g: 0.8, b: 0.8 },
			{ ...neutral, shadows: 0.8 },
		);
		expect(dark.r).toBeGreaterThan(0.2);
		expect(bright.r).toBeCloseTo(0.8, 6);
	});

	it("temperature warms by raising red and lowering blue, cools in reverse", () => {
		const base = { r: 0.5, g: 0.5, b: 0.5 };
		const warm = applyColorAdjustments(base, { ...neutral, temperature: 0.5 });
		expect(warm.r).toBeGreaterThan(0.5);
		expect(warm.b).toBeLessThan(0.5);
		expect(warm.g).toBeCloseTo(0.5, 6);
		const cool = applyColorAdjustments(base, { ...neutral, temperature: -0.5 });
		expect(cool.r).toBeLessThan(0.5);
		expect(cool.b).toBeGreaterThan(0.5);
	});

	it("saturation -1 fully desaturates to luma; +0.5 pushes channels apart", () => {
		const gray = applyColorAdjustments(SKIN, { ...neutral, saturation: -1 });
		expect(gray.r).toBeCloseTo(gray.g, 6);
		expect(gray.g).toBeCloseTo(gray.b, 6);
		const vivid = applyColorAdjustments(SKIN, { ...neutral, saturation: 0.5 });
		expect(vivid.r - vivid.b).toBeGreaterThan(SKIN.r - SKIN.b);
	});

	it("clamps output to 0..1", () => {
		const out = applyColorAdjustments(
			{ r: 0.9, g: 0.9, b: 0.9 },
			{ ...neutral, brightness: 1 },
		);
		expect(out.r).toBeLessThanOrEqual(1);
		const low = applyColorAdjustments(
			{ r: 0.1, g: 0.1, b: 0.1 },
			{ ...neutral, brightness: -1 },
		);
		expect(low.r).toBeGreaterThanOrEqual(0);
	});
});
