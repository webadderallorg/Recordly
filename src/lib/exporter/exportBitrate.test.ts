import { describe, expect, it } from "vitest";
import { getMp4ExportBitrate, getSourceQualityBitrate } from "./exportBitrate";

describe("export bitrate policy", () => {
	it("keeps the legacy source-quality bitrate unchanged", () => {
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

	it("keeps fast exports above the visibly blurry floor for screen text", () => {
		expect(
			getMp4ExportBitrate({
				width: 1920,
				height: 1080,
				frameRate: 30,
				quality: "source",
				encodingMode: "fast",
				useModernNativeStaticLayout: true,
			}),
		).toBe(10_500_000);
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
