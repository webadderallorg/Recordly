import { describe, expect, it } from "vitest";
import { normalizeProjectEditor } from "./projectPersistence";
import { DEFAULT_WEBCAM_COLOR, DEFAULT_WEBCAM_GREENSCREEN, DEFAULT_WEBCAM_MASK } from "./types";

describe("normalizeProjectEditor webcam processing settings", () => {
	it("defaults greenscreen/mask/color on legacy projects without the fields", () => {
		const normalized = normalizeProjectEditor({ webcam: { enabled: true } });
		expect(normalized.webcam.greenscreen).toEqual(DEFAULT_WEBCAM_GREENSCREEN);
		expect(normalized.webcam.mask).toEqual(DEFAULT_WEBCAM_MASK);
		expect(normalized.webcam.color).toEqual(DEFAULT_WEBCAM_COLOR);
	});

	it("round-trips non-default values", () => {
		const webcam = {
			greenscreen: {
				enabled: true,
				backgroundImagePath: "assets/bg.png",
				keyStrength: 0.7,
				edgeSoftness: 0.2,
				keyColor: "#73b94a",
				keyColor2: "#3f7a2a",
			},
			mask: {
				enabled: true,
				shape: "polygon" as const,
				rect: { x: 0.1, y: 0.05, width: 0.8, height: 0.85 },
				cornerRadius: 0.4,
				feather: 0.5,
				points: [
					{ x: 0.1, y: 0.2 },
					{ x: 0.9, y: 0.15, inX: 0.7, inY: 0.05, outX: 0.95, outY: 0.4 },
					{ x: 0.5, y: 0.95 },
				],
			},
			color: {
				brightness: 0.2,
				contrast: -0.3,
				highlights: 0.1,
				shadows: 0.6,
				temperature: 0.4,
				saturation: -0.2,
			},
		};
		const normalized = normalizeProjectEditor({ webcam });
		expect(normalized.webcam.greenscreen).toEqual(webcam.greenscreen);
		expect(normalized.webcam.mask).toEqual(webcam.mask);
		expect(normalized.webcam.color).toEqual(webcam.color);
	});

	it("clamps out-of-range values and rejects junk", () => {
		const normalized = normalizeProjectEditor({
			webcam: {
				greenscreen: {
					enabled: "yes",
					backgroundImagePath: 7,
					keyStrength: 5,
					edgeSoftness: -2,
				},
				mask: {
					enabled: true,
					shape: "blob",
					rect: { x: -1, y: 2, width: 9, height: 9 },
					cornerRadius: 3,
					feather: "soft",
					points: [
						{ x: 2, y: -1, inX: -1, inY: 4 },
						{ x: "a", y: 0.5 },
						null,
						{ x: 0.25 },
						{ x: 0.5, y: 0.5, inX: 0.4, inY: "junk", outX: 0.6, outY: 0.5 },
					],
				},
				color: { brightness: 99, contrast: Number.NaN, highlights: -99, shadows: null },
			} as never,
		});
		expect(normalized.webcam.greenscreen).toEqual({
			enabled: false,
			backgroundImagePath: null,
			keyStrength: 1,
			edgeSoftness: 0,
			keyColor: "#00cc00",
			keyColor2: null,
		});
		expect(normalized.webcam.mask?.enabled).toBe(true);
		expect(normalized.webcam.mask?.shape).toBe(DEFAULT_WEBCAM_MASK.shape);
		expect(normalized.webcam.mask?.cornerRadius).toBe(1);
		expect(normalized.webcam.mask?.feather).toBe(DEFAULT_WEBCAM_MASK.feather);
		// Out-of-range coords clamp; a half-finite in-handle is dropped while
		// the finite out-handle is kept.
		expect(normalized.webcam.mask?.points).toEqual([
			{ x: 1, y: 0, inX: 0, inY: 1 },
			{ x: 0.5, y: 0.5, outX: 0.6, outY: 0.5 },
		]);
		const rect = normalized.webcam.mask?.rect;
		expect(rect && rect.x >= 0 && rect.width <= 1).toBe(true);
		expect(normalized.webcam.color).toEqual({
			brightness: 1,
			contrast: DEFAULT_WEBCAM_COLOR.contrast,
			highlights: -1,
			shadows: DEFAULT_WEBCAM_COLOR.shadows,
			temperature: DEFAULT_WEBCAM_COLOR.temperature,
			saturation: DEFAULT_WEBCAM_COLOR.saturation,
		});
	});
});
