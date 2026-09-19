import { describe, expect, it } from "vitest";
import {
	calculateMp4ExportDimensions,
	calculateMp4SourceDimensions,
	capExportCanvasDimensions,
	shouldDebounceMp4SupportProbe,
} from "./exportDimensions";

describe("calculateMp4SourceDimensions", () => {
	it("keeps native exports at the source dimensions", () => {
		expect(calculateMp4SourceDimensions(1920, 1080, "native")).toEqual({
			width: 1920,
			height: 1080,
		});
	});

	it("uses the cropped source bounds for native exports", () => {
		expect(
			calculateMp4SourceDimensions(320, 180, "native", {
				width: 1,
				height: 0.8,
			}),
		).toEqual({
			width: 320,
			height: 144,
		});
	});

	it("uses the rotated source bounds for 9:16 original exports", () => {
		expect(calculateMp4SourceDimensions(1920, 1080, "9:16")).toEqual({
			width: 1080,
			height: 1920,
		});
	});

	it("ignores crop bounds for fixed-aspect exports", () => {
		expect(
			calculateMp4SourceDimensions(1920, 1080, "9:16", {
				width: 0.5,
				height: 0.5,
			}),
		).toEqual({
			width: 1080,
			height: 1920,
		});
	});

	it("uses the rotated source bounds for portrait social ratios", () => {
		expect(calculateMp4SourceDimensions(1920, 1080, "4:5")).toEqual({
			width: 1080,
			height: 1350,
		});
	});

	it("keeps landscape aspect-ratio exports inside the source bounds", () => {
		expect(calculateMp4SourceDimensions(1920, 1080, "4:3")).toEqual({
			width: 1440,
			height: 1080,
		});
	});

	it("caps a 5K full-screen capture at 4K UHD for native exports", () => {
		expect(calculateMp4SourceDimensions(5120, 2880, "native")).toEqual({
			width: 3840,
			height: 2160,
		});
	});

	it("caps the portrait canvas from a 5K capture at 4K UHD", () => {
		expect(calculateMp4SourceDimensions(5120, 2880, "9:16")).toEqual({
			width: 2160,
			height: 3840,
		});
	});

	it("leaves a native crop of a 5K capture alone once it fits the budget", () => {
		expect(
			calculateMp4SourceDimensions(5120, 2880, "native", {
				width: 0.5,
				height: 1,
			}),
		).toEqual({
			width: 2560,
			height: 2880,
		});
	});

	it("scales a native crop of a 5K capture that still exceeds the budget", () => {
		expect(
			calculateMp4SourceDimensions(5120, 2880, "native", {
				width: 0.8,
				height: 1,
			}),
		).toEqual({
			width: 3434,
			height: 2414,
		});
	});

	it("leaves a 4K UHD source untouched", () => {
		expect(calculateMp4SourceDimensions(3840, 2160, "native")).toEqual({
			width: 3840,
			height: 2160,
		});
		expect(calculateMp4SourceDimensions(3840, 2160, "9:16")).toEqual({
			width: 2160,
			height: 3840,
		});
	});
});

describe("capExportCanvasDimensions", () => {
	it("returns dimensions inside the ceiling unchanged", () => {
		expect(capExportCanvasDimensions(1920, 1080)).toEqual({ width: 1920, height: 1080 });
		expect(capExportCanvasDimensions(2160, 3840)).toEqual({ width: 2160, height: 3840 });
	});

	it("leaves an ultrawide source inside the budget at its own size", () => {
		expect(capExportCanvasDimensions(5120, 1440)).toEqual({ width: 5120, height: 1440 });
	});

	it("scales an ultrawide source above the budget by area, keeping its shape", () => {
		expect(capExportCanvasDimensions(5120, 2160)).toEqual({ width: 4434, height: 1870 });
	});

	it("scales a 5K source down to the 4K UHD pixel budget", () => {
		expect(capExportCanvasDimensions(5120, 2880)).toEqual({ width: 3840, height: 2160 });
		expect(capExportCanvasDimensions(2880, 5120)).toEqual({ width: 2160, height: 3840 });
	});

	it("never exceeds the budget after rounding to even dimensions", () => {
		for (const [width, height] of [
			[5120, 2880],
			[6016, 3384],
			[5120, 2160],
			[7680, 4320],
			[2880, 5120],
			[3441, 1441],
		]) {
			const capped = capExportCanvasDimensions(width, height);
			expect(capped.width * capped.height).toBeLessThanOrEqual(3840 * 2160);
			expect(capped.width % 2).toBe(0);
			expect(capped.height % 2).toBe(0);
		}
	});

	it("honours a custom budget", () => {
		expect(capExportCanvasDimensions(2880, 5120, 2560 * 1440)).toEqual({
			width: 1440,
			height: 2560,
		});
	});
});

describe("calculateMp4ExportDimensions", () => {
	it("normalizes odd source dimensions to even export dimensions", () => {
		const sourceDimensions = calculateMp4SourceDimensions(1919, 1079, "native");

		expect(sourceDimensions).toEqual({
			width: 1918,
			height: 1078,
		});
		expect(
			calculateMp4ExportDimensions(sourceDimensions.width, sourceDimensions.height, "source"),
		).toEqual({
			width: 1918,
			height: 1078,
		});
		expect(
			calculateMp4ExportDimensions(sourceDimensions.width, sourceDimensions.height, "high"),
		).toEqual({
			width: 1726,
			height: 970,
		});
	});

	it("scales every tier from the capped canvas on a 5K portrait export", () => {
		const sourceDimensions = calculateMp4SourceDimensions(5120, 2880, "9:16");

		expect(
			calculateMp4ExportDimensions(sourceDimensions.width, sourceDimensions.height, "source"),
		).toEqual({
			width: 2160,
			height: 3840,
		});
		expect(
			calculateMp4ExportDimensions(sourceDimensions.width, sourceDimensions.height, "good"),
		).toEqual({
			width: 1620,
			height: 2880,
		});
		expect(
			calculateMp4ExportDimensions(sourceDimensions.width, sourceDimensions.height, "medium"),
		).toEqual({
			width: 1296,
			height: 2304,
		});
	});

	it("scales portrait output dimensions from the aspect target", () => {
		const sourceDimensions = calculateMp4SourceDimensions(1920, 1080, "9:16");

		expect(
			calculateMp4ExportDimensions(sourceDimensions.width, sourceDimensions.height, "source"),
		).toEqual({
			width: 1080,
			height: 1920,
		});
		expect(
			calculateMp4ExportDimensions(sourceDimensions.width, sourceDimensions.height, "high"),
		).toEqual({
			width: 972,
			height: 1728,
		});
	});
});

describe("shouldDebounceMp4SupportProbe", () => {
	const baseSnapshot = {
		sourceWidth: 1920,
		sourceHeight: 1080,
		targetWidth: 1920,
		targetHeight: 1080,
		aspectRatio: "native" as const,
		frameRate: 30 as const,
	};

	it("debounces only native crop-driven target changes", () => {
		expect(
			shouldDebounceMp4SupportProbe(baseSnapshot, {
				...baseSnapshot,
				targetHeight: 864,
			}),
		).toBe(true);
	});

	it("keeps non-crop probe changes immediate", () => {
		expect(shouldDebounceMp4SupportProbe(null, baseSnapshot)).toBe(false);
		expect(
			shouldDebounceMp4SupportProbe(baseSnapshot, {
				...baseSnapshot,
				frameRate: 60,
			}),
		).toBe(false);
		expect(
			shouldDebounceMp4SupportProbe(baseSnapshot, {
				...baseSnapshot,
				sourceWidth: 1280,
				sourceHeight: 720,
				targetWidth: 1280,
				targetHeight: 720,
			}),
		).toBe(false);
		expect(
			shouldDebounceMp4SupportProbe(baseSnapshot, {
				...baseSnapshot,
				aspectRatio: "16:9",
			}),
		).toBe(false);
	});
});
