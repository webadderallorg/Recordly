import { describe, expect, it, vi } from "vitest";
import { getSquirclePathPoints } from "@/lib/geometry/squircle";
import {
	convertLegacyWebcamRadiusToRoundness,
	getCropMatchedWebcamHeightPercent,
	getWebcamClipPath,
	getWebcamCornerRadiusPx,
	getWebcamCropSourceRect,
	getWebcamOverlayDimensionsPx,
	getWebcamOverlayPosition,
	getWebcamShapeExponent,
	isWebcamCropRegionDefault,
	normalizeWebcamCropRegion,
	scaleWebcamOverlayPixels,
	WEBCAM_SQUIRCLE_EXPONENT,
} from "./webcamOverlay";

describe("webcam roundness", () => {
	it.each([
		25, 69, 100,
	])("softens camera corners at %s%% while retaining a squircle", (roundness) => {
		const radius = getWebcamCornerRadiusPx(roundness, 400, 400);
		const rect = { x: 0, y: 0, width: 400, height: 400, radius };
		const camera = getSquirclePathPoints({ ...rect, exponent: WEBCAM_SQUIRCLE_EXPONENT });
		const original = getSquirclePathPoints(rect);
		const circle = getSquirclePathPoints({ ...rect, exponent: 2 });
		// At the top-right diagonal, the tuned mask cuts further into the corner
		// than the old squircle, but retains a flatter shoulder than a circle.
		const diagonal = (points: typeof camera) =>
			points.find(
				(point) =>
					point.x > 400 - radius &&
					point.y < radius &&
					Math.abs(point.x - (400 - radius) - (radius - point.y)) < 0.001,
			)!;
		expect(diagonal(camera).y).toBeGreaterThan(diagonal(original).y);
		expect(diagonal(camera).y).toBeLessThan(diagonal(circle).y);
	});

	it("uses equal steps from sharp corners to maximum rounding for every shape", () => {
		expect(getWebcamCornerRadiusPx(10, 640, 360)).toBeCloseTo(18, 1);
		expect(getWebcamCornerRadiusPx(0, 640, 360)).toBe(0);
		expect(getWebcamCornerRadiusPx(25, 640, 360)).toBeCloseTo(45, 1);
		expect(getWebcamCornerRadiusPx(50, 640, 360)).toBeCloseTo(90, 1);
		expect(getWebcamCornerRadiusPx(100, 640, 360)).toBe(180);
	});

	it("converts legacy reference pixels without changing the approximate shape", () => {
		expect(convertLegacyWebcamRadiusToRoundness(90, 40, 40)).toBeCloseTo(41.67, 2);
	});
});

describe("scaleWebcamOverlayPixels", () => {
	it("keeps webcam pixel controls proportional between preview and export", () => {
		expect(scaleWebcamOverlayPixels(24, 960)).toBe(12);
		expect(scaleWebcamOverlayPixels(24, 1920)).toBe(24);
		expect(scaleWebcamOverlayPixels(24, 3840)).toBe(48);
	});
});

describe("normalizeWebcamCropRegion", () => {
	it("defaults to the full webcam frame", () => {
		expect(normalizeWebcamCropRegion()).toEqual({ x: 0, y: 0, width: 1, height: 1 });
		expect(isWebcamCropRegionDefault()).toBe(true);
	});

	it("clamps crop dimensions inside the source frame", () => {
		const crop = normalizeWebcamCropRegion({ x: 0.8, y: -1, width: 0.5, height: 2 });
		expect(crop.x).toBe(0.8);
		expect(crop.y).toBe(0);
		expect(crop.width).toBeCloseTo(0.2);
		expect(crop.height).toBe(1);
	});
});

describe("getWebcamOverlayDimensionsPx", () => {
	it("keeps independent width and height at their base size when zoom reaction is off", () => {
		expect(
			getWebcamOverlayDimensionsPx({
				containerWidth: 1000,
				containerHeight: 800,
				widthPercent: 50,
				heightPercent: 25,
				margin: 0,
				zoomScale: 2,
				reactToZoom: false,
			}),
		).toEqual({
			width: 400,
			height: 200,
		});
	});
	it("keeps shrinking below 56 preview pixels in portrait and preserves export proportions", () => {
		const dimensions = (scale: number, zoomScale: number) =>
			getWebcamOverlayDimensionsPx({
				containerWidth: 160 * scale,
				containerHeight: ((160 * 16) / 9) * scale,
				widthPercent: 50,
				heightPercent: 30,
				margin: 2 * scale,
				zoomScale,
				reactToZoom: true,
			});
		for (const [zoom, retainedScale] of [
			[1, 1],
			[1.25, 0.86],
			[2, 0.65],
			[3, 0.53333333],
		]) {
			const preview = dimensions(1, zoom);
			const exported = dimensions(6, zoom);
			expect(preview.width).toBeCloseTo(80 * retainedScale);
			expect(preview.height).toBeCloseTo(48 * retainedScale);
			expect(exported.width).toBeCloseTo(preview.width * 6);
			expect(exported.height).toBeCloseTo(preview.height * 6);
			expect(preview.width / preview.height).toBeCloseTo(5 / 3);
		}
	});
	it("fits the available frame even when it is smaller than the old minimum", () => {
		expect(
			getWebcamOverlayDimensionsPx({
				containerWidth: 40,
				containerHeight: 70,
				widthPercent: 100,
				heightPercent: 100,
				margin: 5,
				zoomScale: 1,
				reactToZoom: false,
			}),
		).toEqual({ width: 30, height: 30 });
	});
});

describe("getWebcamOverlayPosition", () => {
	it("uses rectangular dimensions when anchoring to a preset", () => {
		expect(
			getWebcamOverlayPosition({
				containerWidth: 1000,
				containerHeight: 800,
				width: 400,
				height: 200,
				margin: 20,
				positionPreset: "bottom-right",
				positionX: 1,
				positionY: 1,
				legacyCorner: "bottom-right",
			}),
		).toEqual({ x: 580, y: 580 });
	});
});

describe("getCropMatchedWebcamHeightPercent", () => {
	it("matches height to a non-default crop aspect when width and height are linked", () => {
		expect(
			getCropMatchedWebcamHeightPercent(60, 60, 1920, 1080, {
				x: 0.1,
				y: 0.2,
				width: 0.6,
				height: 0.4,
			}),
		).toBeCloseTo(22.5);
	});

	it("preserves manually separated width and height controls", () => {
		expect(
			getCropMatchedWebcamHeightPercent(60, 45, 1920, 1080, {
				x: 0.1,
				y: 0.2,
				width: 0.6,
				height: 0.4,
			}),
		).toBe(45);
	});

	it("keeps the default crop square-compatible", () => {
		expect(getCropMatchedWebcamHeightPercent(60, 60, 1920, 1080, undefined)).toBe(60);
	});
});

describe("getWebcamCropSourceRect", () => {
	it("converts normalized crop settings to source pixels", () => {
		expect(
			getWebcamCropSourceRect({ x: 0.25, y: 0.1, width: 0.5, height: 0.75 }, 1920, 1080),
		).toEqual({
			sx: 480,
			sy: 108,
			sw: 960,
			sh: 810,
		});
	});
});

describe("circle geometry", () => {
	it("keeps the camera circular despite rectangular crop or height settings", () => {
		const dimensions = getWebcamOverlayDimensionsPx({
			containerWidth: 1920,
			containerHeight: 1080,
			widthPercent: 40,
			heightPercent: 25,
			margin: 24,
			zoomScale: 2,
			reactToZoom: true,
			shape: "circle",
		});
		expect(dimensions).toEqual({ width: 280.8, height: 280.8 });
		expect(getWebcamCornerRadiusPx(0, dimensions.width, dimensions.height, "circle")).toBe(
			140.4,
		);
	});
});

describe("rectangle camera geometry", () => {
	it("retains independent dimensions and square corners through zoom", () => {
		const dimensions = getWebcamOverlayDimensionsPx({
			containerWidth: 1920,
			containerHeight: 1080,
			widthPercent: 40,
			heightPercent: 25,
			margin: 24,
			zoomScale: 2,
			reactToZoom: true,
			shape: "rectangle",
		});
		expect(dimensions).toEqual({ width: 280.8, height: 175.5 });
		expect(getWebcamCornerRadiusPx(0, dimensions.width, dimensions.height, "rectangle")).toBe(
			0,
		);
		expect(getWebcamClipPath(0, dimensions.width, dimensions.height, "rectangle")).toBe(
			"inset(0 round 0px)",
		);
		expect(getWebcamShapeExponent("rectangle")).toBe(2);
	});
	it("uses the same radius for Square and Rectangle", () => {
		expect(getWebcamCornerRadiusPx(50, 640, 360, "rectangle")).toBe(90);
		expect(getWebcamCornerRadiusPx(50, 640, 360, "squircle")).toBe(90);
	});
});

it("keeps a Square camera square when its source crop has a different aspect", () => {
	const crop = { x: 0, y: 0, width: 0.5, height: 1 };
	expect(getCropMatchedWebcamHeightPercent(40, 40, 1920, 1080, crop, "squircle")).toBe(40);
	expect(getCropMatchedWebcamHeightPercent(40, 40, 1920, 1080, crop, "rectangle")).toBe(45);
});

import { usePlaybackWebcamLayout } from "./videoPlayback/usePlaybackWebcamLayout";

const previewMemo = vi.hoisted(() => ({
	ref: null as { current: unknown } | null,
	dependencies: null as readonly unknown[] | null,
	value: undefined as unknown,
}));
vi.mock("react", async (importOriginal) => ({
	...(await importOriginal<typeof import("react")>()),
	useCallback: <T>(callback: T) => callback,
	useEffect: () => undefined,
	useRef: (value: unknown) => {
		previewMemo.ref ??= { current: value };
		return previewMemo.ref;
	},
	useMemo: (factory: () => unknown, dependencies: readonly unknown[]) => {
		if (
			!previewMemo.dependencies ||
			dependencies.some(
				(value, index) => !Object.is(value, previewMemo.dependencies?.[index]),
			)
		) {
			previewMemo.value = factory();
			previewMemo.dependencies = [...dependencies];
		}
		return previewMemo.value;
	},
}));

function previewWebcamFixture(shape?: "circle" | "rectangle" | "squircle") {
	previewMemo.dependencies = null;
	previewMemo.ref = null;
	const bubble = { style: {} as Record<string, string> };
	const rimAttributes = new Map<string, string>();
	const pathAttributes = new Map<string, string>();
	const rimPath = {
		getAttribute: (name: string) => pathAttributes.get(name) ?? null,
		setAttribute: vi.fn((name: string, value: string) => pathAttributes.set(name, value)),
	};
	const rim = {
		getAttribute: (name: string) => rimAttributes.get(name) ?? null,
		setAttribute: vi.fn((name: string, value: string) => rimAttributes.set(name, value)),
		querySelector: vi.fn(() => rimPath),
	};
	const input = {
		webcam: {
			enabled: true,
			shape,
			width: 30,
			height: 30,
			cropRegion: { x: 0, y: 0, width: 0.5, height: 1 },
		},
		webcamVideoDimensions: { width: 1920, height: 1080 },
		webcamBubbleRef: { current: bubble },
		webcamBlurCanvasRef: { current: null },
		webcamBubbleInnerRef: {
			current: { style: { setProperty: vi.fn() }, querySelector: vi.fn(() => rim) },
		},
		overlayRef: { current: { clientWidth: 1920, clientHeight: 1080 } },
		webcamVideoPath: "/camera.webm",
		timelineTimeRef: { current: 0 },
		clipRegionsRef: { current: [{ id: "clip", startMs: 0, endMs: 1000, speed: 1 }] },
		currentTimeRef: { current: 0 },
		webcamMotionBlurRef: { current: { reset: vi.fn(), destroy: vi.fn() } },
		webcamVideoRef: { current: null },
		webcamMediaSynchronized: false,
		isPlayingRef: { current: false },
		isSeekingRef: { current: false },
		zoomMotionBlurRef: { current: 0 },
		animationStateRef: { current: { appliedScale: 1 } },
		isPlaying: false,
	} as unknown as Parameters<typeof usePlaybackWebcamLayout>[0];
	// This harness evaluates geometry with mocked hooks, including dependency-aware memoization.
	const useLayout = () => usePlaybackWebcamLayout(input);
	return { input, bubble, rim, rimPath, rimAttributes, pathAttributes, layout: useLayout };
}

it("keeps circle preview content proportional after switching from unequal rectangle dimensions", () => {
	const fixture = previewWebcamFixture("rectangle");
	fixture.input.webcam = { ...fixture.input.webcam!, width: 30, height: 20 };
	const rectangle = fixture.layout().webcamCropPreviewContentStyle;
	expect(
		(Number.parseFloat(String(rectangle.width)) / Number.parseFloat(String(rectangle.height))) *
			1.5,
	).toBeCloseTo(1920 / 1080);
	fixture.input.webcam = { ...fixture.input.webcam!, shape: "circle" };
	const circle = fixture.layout();
	circle.applyWebcamBubbleLayout(1);
	expect(fixture.bubble.style.width).toBe(fixture.bubble.style.height);
	expect(
		Number.parseFloat(String(circle.webcamCropPreviewContentStyle.width)) /
			Number.parseFloat(String(circle.webcamCropPreviewContentStyle.height)),
	).toBeCloseTo(1920 / 1080);
});

it("keeps direct preview inputs with an omitted shape square despite their source crop", () => {
	const fixture = previewWebcamFixture();
	const layout = fixture.layout();
	layout.applyWebcamBubbleLayout(1);
	expect(layout.webcamHeight).toBe(30);
	expect(fixture.bubble.style.width).toBe("324px");
	expect(fixture.bubble.style.height).toBe("324px");
});

for (const shape of ["circle", "squircle", "rectangle"] as const) {
	it(`updates a stable ${shape} preview rim with the camera without changing its footprint`, () => {
		const fixture = previewWebcamFixture(shape);
		fixture.layout().applyWebcamBubbleLayout(1);
		const initialPath = fixture.pathAttributes.get("d");
		expect(initialPath).toMatch(/^M/);
		expect(Number(fixture.pathAttributes.get("stroke-width"))).toBeCloseTo(
			Math.min(
				Number.parseFloat(fixture.bubble.style.width),
				Number.parseFloat(fixture.bubble.style.height),
			) * 0.005,
		);
		expect(fixture.rimAttributes.get("viewBox")).toBe(
			`0 0 ${Number.parseFloat(fixture.bubble.style.width)} ${Number.parseFloat(fixture.bubble.style.height)}`,
		);
		fixture.rim.setAttribute.mockClear();
		fixture.rimPath.setAttribute.mockClear();
		fixture.layout().applyWebcamBubbleLayout(1);
		expect(fixture.rim.setAttribute).not.toHaveBeenCalled();
		expect(fixture.rimPath.setAttribute).not.toHaveBeenCalled();
		fixture.input.webcam = { ...fixture.input.webcam!, width: 40, height: 40, roundness: 69 };
		fixture.layout().applyWebcamBubbleLayout(1);
		expect(fixture.pathAttributes.get("d")).not.toBe(initialPath);
		expect(Number(fixture.pathAttributes.get("stroke-width"))).toBeCloseTo(
			Math.min(
				Number.parseFloat(fixture.bubble.style.width),
				Number.parseFloat(fixture.bubble.style.height),
			) * 0.005,
		);
		expect(fixture.rimAttributes.get("viewBox")).toBe(
			`0 0 ${Number.parseFloat(fixture.bubble.style.width)} ${Number.parseFloat(fixture.bubble.style.height)}`,
		);
	});
}
