import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
	app: {
		getPath: vi.fn(() => "/tmp"),
		isReady: vi.fn(() => true),
	},
}));

vi.mock("../utils", () => ({
	getScreen: () => ({
		getDisplayNearestPoint: () => ({ scaleFactor: 1.5 }),
	}),
	parseWindowId: (id?: string | null) => {
		const match = id?.match(/^window:(\d+):/);
		return match ? Number.parseInt(match[1], 10) : null;
	},
}));

import {
	alignWindowBoundsToWgcCaptureSize,
	normalizeWindowsWindowBoundsToElectronDip,
	parseWgcCaptureSize,
} from "./bounds";

describe("parseWgcCaptureSize", () => {
	it("parses capture dimensions from native helper output", () => {
		expect(
			parseWgcCaptureSize(
				"INFO: starting\nCAPTURE_SIZE:1920x1080\nRecording started\n",
			),
		).toEqual({ width: 1920, height: 1080 });
	});

	it("returns null when capture dimensions are missing", () => {
		expect(parseWgcCaptureSize("Recording started")).toBeNull();
	});
});

describe("normalizeWindowsWindowBoundsToElectronDip", () => {
	it("reconciles PowerShell bounds when DPI differs from Electron scale factor", () => {
		expect(
			normalizeWindowsWindowBoundsToElectronDip({
				x: 1440,
				y: 900,
				width: 1440,
				height: 900,
				dpi: 96,
			}),
		).toEqual({
			x: 960,
			y: 600,
			width: 960,
			height: 600,
		});
	});
});

describe("alignWindowBoundsToWgcCaptureSize", () => {
	it("keeps window origin and converts WGC physical size to DIP", () => {
		expect(
			alignWindowBoundsToWgcCaptureSize(
				{ x: 120, y: 80 },
				{ width: 1920, height: 1080 },
				1.5,
			),
		).toEqual({
			x: 120,
			y: 80,
			width: 1280,
			height: 720,
		});
	});
});
