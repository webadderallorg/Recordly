import { describe, expect, it } from "vitest";
import {
	clampWebcamLayoutSpan,
	eventsToWebcamLayoutRegions,
	expandRectToAspect,
	getCoverRect,
	getLetterboxRect,
	isCameraFullAtMs,
	normalizeWebcamLayoutStyle,
	type WebcamLayoutEvent,
} from "./webcamLayoutRegions";

describe("eventsToWebcamLayoutRegions", () => {
	it("pairs camera-full/screen events into regions", () => {
		const events: WebcamLayoutEvent[] = [
			{ timeMs: 5000, mode: "camera-full" },
			{ timeMs: 9000, mode: "screen" },
			{ timeMs: 20000, mode: "camera-full" },
			{ timeMs: 31000, mode: "screen" },
		];
		const regions = eventsToWebcamLayoutRegions(events);
		expect(regions.map((r) => [r.startMs, r.endMs])).toEqual([
			[5000, 9000],
			[20000, 31000],
		]);
		expect(regions[0].id).not.toBe(regions[1].id);
	});

	it("extends an unterminated camera-full segment to the end", () => {
		const regions = eventsToWebcamLayoutRegions([{ timeMs: 5000, mode: "camera-full" }]);
		expect(regions).toHaveLength(1);
		expect(regions[0].endMs).toBe(Number.MAX_SAFE_INTEGER);
	});

	it("dedupes consecutive same-mode events and sorts by time", () => {
		const regions = eventsToWebcamLayoutRegions([
			{ timeMs: 9000, mode: "screen" },
			{ timeMs: 5000, mode: "camera-full" },
			{ timeMs: 6000, mode: "camera-full" },
		]);
		expect(regions.map((r) => [r.startMs, r.endMs])).toEqual([[5000, 9000]]);
	});

	it("drops zero-length segments and ignores leading screen events", () => {
		expect(
			eventsToWebcamLayoutRegions([
				{ timeMs: 0, mode: "screen" },
				{ timeMs: 5000, mode: "camera-full" },
				{ timeMs: 5000, mode: "screen" },
			]),
		).toEqual([]);
	});

	it("ignores invalid events", () => {
		expect(
			eventsToWebcamLayoutRegions([
				{ timeMs: Number.NaN, mode: "camera-full" },
				{ timeMs: -5, mode: "camera-full" },
			]),
		).toEqual([]);
	});
});

describe("isCameraFullAtMs", () => {
	const regions = eventsToWebcamLayoutRegions([
		{ timeMs: 5000, mode: "camera-full" },
		{ timeMs: 9000, mode: "screen" },
	]);
	it("is true inside and false outside (end exclusive)", () => {
		expect(isCameraFullAtMs(regions, 4999)).toBe(false);
		expect(isCameraFullAtMs(regions, 5000)).toBe(true);
		expect(isCameraFullAtMs(regions, 8999)).toBe(true);
		expect(isCameraFullAtMs(regions, 9000)).toBe(false);
	});
});

describe("getLetterboxRect", () => {
	it("fits wide content into a taller frame, centered, with padding", () => {
		const rect = getLetterboxRect(
			{ width: 1600, height: 900 },
			{ width: 1000, height: 1000 },
			50,
		);
		// available 900x900; 16:9 fit -> 900x506.25
		expect(rect.width).toBeCloseTo(900);
		expect(rect.height).toBeCloseTo(506.25);
		expect(rect.x).toBeCloseTo(50);
		expect(rect.y).toBeCloseTo((1000 - 506.25) / 2);
	});

	it("fits tall content into a wider frame", () => {
		const rect = getLetterboxRect(
			{ width: 900, height: 1600 },
			{ width: 1920, height: 1080 },
			0,
		);
		expect(rect.height).toBeCloseTo(1080);
		expect(rect.width).toBeCloseTo(1080 * (900 / 1600));
		expect(rect.y).toBeCloseTo(0);
	});

	it("degrades safely on invalid input", () => {
		const rect = getLetterboxRect({ width: 0, height: 0 }, { width: 1000, height: 500 }, 10);
		expect(rect).toEqual({ x: 10, y: 10, width: 980, height: 480 });
	});
});

describe("getCoverRect", () => {
	it("covers the frame, cropping the long axis, centered", () => {
		const rect = getCoverRect({ width: 1600, height: 900 }, { width: 1000, height: 1000 });
		// scale = max(1000/1600, 1000/900) = 1.111... -> 1777.8 x 1000
		expect(rect.height).toBeCloseTo(1000);
		expect(rect.width).toBeCloseTo(1000 * (1600 / 900));
		expect(rect.x).toBeCloseTo((1000 - 1000 * (1600 / 900)) / 2);
		expect(rect.y).toBeCloseTo(0);
	});

	it("degrades safely on invalid content", () => {
		expect(getCoverRect({ width: 0, height: 0 }, { width: 1000, height: 500 })).toEqual({
			x: 0,
			y: 0,
			width: 1000,
			height: 500,
		});
	});
});

describe("clampWebcamLayoutSpan", () => {
	const others = [
		{ id: "a", startMs: 1000, endMs: 2000 },
		{ id: "b", startMs: 5000, endMs: 6000 },
	];

	it("clamps to neighbors and duration", () => {
		expect(clampWebcamLayoutSpan({ startMs: 1500, endMs: 5500 }, others, "x", 10000)).toEqual({
			startMs: 2000,
			endMs: 5000,
		});
		expect(clampWebcamLayoutSpan({ startMs: -50, endMs: 800 }, others, "x", 10000)).toEqual({
			startMs: 0,
			endMs: 800,
		});
		expect(clampWebcamLayoutSpan({ startMs: 9500, endMs: 12000 }, others, "x", 10000)).toEqual({
			startMs: 9500,
			endMs: 10000,
		});
	});

	it("ignores the region's own id and enforces minimum length", () => {
		expect(clampWebcamLayoutSpan({ startMs: 1000, endMs: 1010 }, others, "a", 10000)).toEqual({
			startMs: 1000,
			endMs: 1100,
		});
		expect(clampWebcamLayoutSpan({ startMs: 3000, endMs: 3010 }, others, "x", 10000)).toEqual({
			startMs: 3000,
			endMs: 3100,
		});
	});

	it("returns null when no valid placement exists", () => {
		expect(
			clampWebcamLayoutSpan({ startMs: 1200, endMs: 1300 }, others, "x", 10000),
		).toBeNull();
	});
});

describe("expandRectToAspect", () => {
	const source = { width: 1920, height: 1080 };

	it("widens a square bubble crop to the full 16:9 frame on a 16:9 camera", () => {
		// Max centered square crop (the crop panel always stores pixel-square
		// regions for the bubble): 1080x1080 at x=420.
		const expanded = expandRectToAspect({ x: 420, y: 0, width: 1080, height: 1080 }, source, {
			width: 1280,
			height: 720,
		});
		expect(expanded).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });
	});

	it("keeps the crop center when expansion fits inside the source", () => {
		// Small square crop near the left: 540x540 at (100, 270).
		const expanded = expandRectToAspect({ x: 100, y: 270, width: 540, height: 540 }, source, {
			width: 1280,
			height: 720,
		});
		// Target aspect 16:9 -> width = 540 * (16/9) = 960, height stays 540.
		expect(expanded.width).toBeCloseTo(960);
		expect(expanded.height).toBeCloseTo(540);
		// Centered on crop center x=370 -> ideal x=-110, clamped to 0.
		expect(expanded.x).toBeCloseTo(0);
		expect(expanded.y).toBeCloseTo(270);
	});

	it("contains a wide near-full crop by expanding to the frame aspect", () => {
		// Task hand-check input: crop {x:0.05, y:0, w:0.9, h:1} of 1920x1080.
		const expanded = expandRectToAspect({ x: 96, y: 0, width: 1728, height: 1080 }, source, {
			width: 1280,
			height: 720,
		});
		// 1728x1080 has aspect 1.6 < 16/9: width grows to 1920 (clamped) and the
		// whole source is shown -> fill barely crops.
		expect(expanded).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });
	});

	it("shrinks the off-axis when the source cannot contain the expansion", () => {
		// Square crop on a square source going to a 16:9 frame: width cannot
		// exceed the source, so height shrinks to keep the frame aspect.
		const expanded = expandRectToAspect(
			{ x: 0, y: 0, width: 1000, height: 1000 },
			{ width: 1000, height: 1000 },
			{ width: 1280, height: 720 },
		);
		expect(expanded.width).toBeCloseTo(1000);
		expect(expanded.height).toBeCloseTo(562.5);
		expect(expanded.x).toBeCloseTo(0);
		// Centered on crop center y=500.
		expect(expanded.y).toBeCloseTo(500 - 562.5 / 2);
	});

	it("expands vertically for crops wider than the frame aspect", () => {
		// 4:1 ultra-wide crop into a 16:9 frame: height grows.
		const expanded = expandRectToAspect({ x: 0, y: 400, width: 1600, height: 400 }, source, {
			width: 1280,
			height: 720,
		});
		expect(expanded.width).toBeCloseTo(1600);
		expect(expanded.height).toBeCloseTo(900);
		expect(expanded.y).toBeCloseTo(600 - 450);
	});

	it("returns the rect unchanged for degenerate frames or sources", () => {
		const rect = { x: 10, y: 10, width: 100, height: 100 };
		expect(expandRectToAspect(rect, source, { width: 0, height: 0 })).toEqual(rect);
		expect(
			expandRectToAspect(rect, { width: 0, height: 0 }, { width: 1280, height: 720 }),
		).toEqual(rect);
		expect(
			expandRectToAspect({ x: 0, y: 0, width: 0, height: 0 }, source, {
				width: 1280,
				height: 720,
			}),
		).toEqual({ x: 0, y: 0, width: 0, height: 0 });
	});
});

describe("normalizeWebcamLayoutStyle", () => {
	it("accepts fit/fill and falls back to fit", () => {
		expect(normalizeWebcamLayoutStyle("fill")).toBe("fill");
		expect(normalizeWebcamLayoutStyle("fit")).toBe("fit");
		expect(normalizeWebcamLayoutStyle("bogus")).toBe("fit");
		expect(normalizeWebcamLayoutStyle(undefined)).toBe("fit");
	});
});
