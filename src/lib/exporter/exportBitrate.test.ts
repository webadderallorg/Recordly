import { describe, expect, it } from "vitest";
import {
	clampCustomBitrateMbps,
	customBitrateMbpsToBps,
	getMp4ExportBitrate,
	getSourceQualityBitrate,
	resolveExportBitrate,
} from "./exportBitrate";

describe("export bitrate policy", () => {
	it("keeps source-quality exports at a fuller screen-recording bitrate", () => {
		expect(getSourceQualityBitrate(1920, 1080)).toBe(30_000_000);
		expect(
			getMp4ExportBitrate({
				width: 1920,
				height: 1080,
				frameRate: 30,
				quality: "source",
				encodingMode: "quality",
			}),
		).toBe(30_000_000);
		expect(
			getMp4ExportBitrate({
				width: 1920,
				height: 1080,
				frameRate: 30,
				quality: "source",
				encodingMode: "balanced",
			}),
		).toBe(22_500_000);
	});

	it("raises high-resolution 60fps source-quality exports above the 30fps budget", () => {
		const sharedOptions = {
			width: 2560,
			height: 1440,
			quality: "source" as const,
			encodingMode: "quality" as const,
		};

		const thirtyFpsBitrate = getMp4ExportBitrate({
			...sharedOptions,
			frameRate: 30,
		});
		const sixtyFpsBitrate = getMp4ExportBitrate({
			...sharedOptions,
			frameRate: 60,
		});

		expect(thirtyFpsBitrate).toBe(50_000_000);
		expect(sixtyFpsBitrate).toBeGreaterThan(thirtyFpsBitrate);
		expect(sixtyFpsBitrate).toBe(70_710_678);
	});

	it("keeps modern native static-layout source exports high enough for screen text", () => {
		expect(
			getMp4ExportBitrate({
				width: 1920,
				height: 1080,
				frameRate: 30,
				quality: "source",
				encodingMode: "balanced",
				useModernNativeStaticLayout: true,
			}),
		).toBe(22_500_000);
		expect(
			getMp4ExportBitrate({
				width: 1920,
				height: 1080,
				frameRate: 30,
				quality: "source",
				encodingMode: "quality",
				useModernNativeStaticLayout: true,
			}),
		).toBe(30_000_000);
	});

	it("scales modern native static-layout source exports at 60fps", () => {
		const sharedOptions = {
			width: 1920,
			height: 1080,
			quality: "source" as const,
			encodingMode: "quality" as const,
			useModernNativeStaticLayout: true,
		};

		const thirtyFpsBitrate = getMp4ExportBitrate({
			...sharedOptions,
			frameRate: 30,
		});
		const sixtyFpsBitrate = getMp4ExportBitrate({
			...sharedOptions,
			frameRate: 60,
		});

		expect(thirtyFpsBitrate).toBe(30_000_000);
		expect(sixtyFpsBitrate).toBeGreaterThan(thirtyFpsBitrate);
		expect(sixtyFpsBitrate).toBe(42_426_407);
	});

	it("does not raise fast exports when the requested bitrate is already lower than the cap", () => {
		expect(
			getMp4ExportBitrate({
				width: 1920,
				height: 1080,
				frameRate: 30,
				quality: "source",
				encodingMode: "fast",
				useModernNativeStaticLayout: true,
			}),
		).toBe(3_000_000);
	});

	it("scales the modern native cap with output pixel rate", () => {
		expect(
			getMp4ExportBitrate({
				width: 3840,
				height: 2160,
				frameRate: 30,
				quality: "source",
				encodingMode: "quality",
				useModernNativeStaticLayout: true,
			}),
		).toBe(72_000_000);
	});
});

describe("export bitrate resolver", () => {
	it("auto mode delegates identically to getMp4ExportBitrate", () => {
		const first = {
			width: 1920,
			height: 1080,
			frameRate: 30,
			quality: "source" as const,
			encodingMode: "quality" as const,
		};
		expect(
			resolveExportBitrate({
				mode: "auto",
				customMbps: 20,
				...first,
			}),
		).toBe(getMp4ExportBitrate(first));

		const second = {
			width: 1280,
			height: 720,
			frameRate: 24,
			quality: "good" as const,
			encodingMode: "fast" as const,
			useModernNativeStaticLayout: true,
		};
		expect(
			resolveExportBitrate({
				mode: "auto",
				customMbps: 20,
				...second,
			}),
		).toBe(getMp4ExportBitrate(second));
	});

	it("custom mode converts Mbps to whole-number bps", () => {
		expect(customBitrateMbpsToBps(20)).toBe(20_000_000);
		expect(customBitrateMbpsToBps(12.5)).toBe(12_500_000);
	});

	it("custom mode clamps to the supported range and defaults non-finite input", () => {
		expect(
			resolveExportBitrate({
				mode: "custom",
				customMbps: 0.5,
				width: 1920,
				height: 1080,
				frameRate: 30,
				quality: "source",
				encodingMode: "quality",
			}),
		).toBe(1_000_000);
		expect(
			resolveExportBitrate({
				mode: "custom",
				customMbps: 500,
				width: 1920,
				height: 1080,
				frameRate: 30,
				quality: "source",
				encodingMode: "quality",
			}),
		).toBe(200_000_000);
		expect(
			resolveExportBitrate({
				mode: "custom",
				customMbps: NaN,
				width: 1920,
				height: 1080,
				frameRate: 30,
				quality: "source",
				encodingMode: "quality",
			}),
		).toBe(20_000_000);
		expect(
			resolveExportBitrate({
				mode: "custom",
				customMbps: -5,
				width: 1920,
				height: 1080,
				frameRate: 30,
				quality: "source",
				encodingMode: "quality",
			}),
		).toBe(1_000_000);
	});

	it("custom mode bypasses the native static-layout floor entirely", () => {
		expect(
			resolveExportBitrate({
				mode: "custom",
				customMbps: 2,
				width: 1920,
				height: 1080,
				frameRate: 30,
				quality: "source",
				encodingMode: "quality",
				useModernNativeStaticLayout: true,
			}),
		).toBe(2_000_000);
		expect(customBitrateMbpsToBps(2)).toBe(2_000_000);
	});

	it("clampCustomBitrateMbps preserves fractional values within range", () => {
		expect(clampCustomBitrateMbps(12.5)).toBe(12.5);
		expect(clampCustomBitrateMbps(0.5)).toBe(1);
		expect(clampCustomBitrateMbps(500)).toBe(200);
		expect(clampCustomBitrateMbps(NaN)).toBe(20);
	});
});
