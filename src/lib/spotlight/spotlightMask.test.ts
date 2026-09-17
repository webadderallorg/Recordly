import { describe, expect, it, vi } from "vitest";
import type { AnnotationRegion } from "@/components/video-editor/types";
import {
	getActiveSpotlights,
	getSpotlightDimAlpha,
	getSpotlightFadeFactor,
	getSpotlightHoleStrengths,
	paintSpotlightMask,
	SPOTLIGHT_FADE_MS,
} from "./spotlightMask";

function region(overrides: Partial<AnnotationRegion>): AnnotationRegion {
	return {
		id: "s1",
		startMs: 1000,
		endMs: 3000,
		type: "spotlight",
		content: "",
		position: { x: 10, y: 10 },
		size: { width: 20, height: 20 },
		style: {} as AnnotationRegion["style"],
		zIndex: 1,
		...overrides,
	};
}

describe("getSpotlightFadeFactor", () => {
	it("fades in, holds and fades out", () => {
		const r = region({});
		expect(getSpotlightFadeFactor(r, 999)).toBe(0);
		expect(getSpotlightFadeFactor(r, 1000)).toBe(0);
		expect(getSpotlightFadeFactor(r, 1000 + SPOTLIGHT_FADE_MS / 2)).toBeCloseTo(0.5);
		expect(getSpotlightFadeFactor(r, 2000)).toBe(1);
		expect(getSpotlightFadeFactor(r, 3000 - SPOTLIGHT_FADE_MS / 2)).toBeCloseTo(0.5);
		expect(getSpotlightFadeFactor(r, 3001)).toBe(0);
	});

	it("shortens the fade for very short regions", () => {
		const r = region({ startMs: 0, endMs: 200 });
		expect(getSpotlightFadeFactor(r, 100)).toBe(1);
	});
});

describe("getActiveSpotlights", () => {
	it("returns only enabled spotlights inside their time range", () => {
		const annotations = [
			region({ id: "a" }),
			region({ id: "b", disabled: true }),
			region({ id: "c", type: "blur" }),
			region({ id: "d", startMs: 5000, endMs: 6000 }),
		];
		expect(getActiveSpotlights(annotations, 2000).map((r) => r.id)).toEqual(["a"]);
	});
});

describe("getSpotlightDimAlpha", () => {
	it("uses the strongest overlapping spotlight", () => {
		const alpha = getSpotlightDimAlpha(
			[region({ spotlightOpacity: 30 }), region({ id: "s2", spotlightOpacity: 80 })],
			2000,
		);
		expect(alpha).toBeCloseTo(0.8);
	});

	it("defaults to 50% and applies the fade", () => {
		expect(getSpotlightDimAlpha([region({})], 2000)).toBeCloseTo(0.5);
		expect(getSpotlightDimAlpha([region({})], 1000 + SPOTLIGHT_FADE_MS / 2)).toBeCloseTo(0.25);
	});
});

describe("getSpotlightHoleStrengths", () => {
	it("keeps a lone spotlight fully cut out while it fades", () => {
		const r = region({});
		expect(getSpotlightHoleStrengths([r], 1000 + SPOTLIGHT_FADE_MS / 2)).toEqual([1]);
	});

	it("fades in a spotlight that starts while another is fully visible", () => {
		const visible = region({ id: "a", startMs: 0, endMs: 5000 });
		const fadingIn = region({ id: "b", startMs: 2000, endMs: 5000 });
		const [a, b] = getSpotlightHoleStrengths([visible, fadingIn], 2000 + SPOTLIGHT_FADE_MS / 2);
		expect(a).toBe(1);
		expect(b).toBeCloseTo(0.5);
	});

	it("fades out a spotlight that ends while another stays visible", () => {
		const fadingOut = region({ id: "a", startMs: 0, endMs: 3000 });
		const visible = region({ id: "b", startMs: 1000, endMs: 6000 });
		const [a, b] = getSpotlightHoleStrengths(
			[fadingOut, visible],
			3000 - SPOTLIGHT_FADE_MS / 4,
		);
		expect(a).toBeCloseTo(0.25);
		expect(b).toBe(1);
	});
});

describe("paintSpotlightMask", () => {
	function mockContext() {
		return {
			save: vi.fn(),
			restore: vi.fn(),
			beginPath: vi.fn(),
			roundRect: vi.fn(),
			fill: vi.fn(),
			fillStyle: "",
			globalCompositeOperation: "source-over",
			globalAlpha: 1,
		} as unknown as CanvasRenderingContext2D & { roundRect: ReturnType<typeof vi.fn> };
	}

	it("dims the area once and cuts every hole in a single path", () => {
		const ctx = mockContext();
		const painted = paintSpotlightMask(ctx, {
			area: { x: 0, y: 0, width: 100, height: 100 },
			areaRadius: 10,
			holes: [
				{ x: 10, y: 10, width: 20, height: 20 },
				{ x: 20, y: 20, width: 20, height: 20 },
			],
			holeRadius: 50,
			alpha: 0.5,
		});
		expect(painted).toBe(true);
		expect(ctx.fill).toHaveBeenCalledTimes(2);
		expect(ctx.roundRect).toHaveBeenCalledTimes(3);
		// Hole radius is clamped to half the hole size.
		expect(ctx.roundRect).toHaveBeenLastCalledWith(20, 20, 20, 20, 10);
	});

	it("skips painting when nothing is visible", () => {
		const ctx = mockContext();
		expect(
			paintSpotlightMask(ctx, {
				area: { x: 0, y: 0, width: 100, height: 100 },
				areaRadius: 0,
				holes: [{ x: 0, y: 0, width: 10, height: 10 }],
				holeRadius: 0,
				alpha: 0,
			}),
		).toBe(false);
		expect(ctx.fill).not.toHaveBeenCalled();
	});

	it("cuts partially faded holes with their own strength", () => {
		const ctx = mockContext();
		const alphas: number[] = [];
		(ctx.fill as ReturnType<typeof vi.fn>).mockImplementation(() => {
			alphas.push(ctx.globalAlpha);
		});
		paintSpotlightMask(ctx, {
			area: { x: 0, y: 0, width: 100, height: 100 },
			areaRadius: 0,
			holes: [
				{ x: 0, y: 0, width: 10, height: 10 },
				{ x: 50, y: 50, width: 10, height: 10, strength: 0.4 },
			],
			holeRadius: 0,
			alpha: 0.5,
		});
		// Dim layer, merged full-strength holes, then the partial hole.
		expect(alphas).toEqual([1, 1, 0.4]);
	});
});
