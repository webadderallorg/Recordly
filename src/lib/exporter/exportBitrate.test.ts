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
		).toBe(27_000_000);
	});

	it("caps modern native static-layout source exports to avoid bitrate inflation", () => {
		expect(
			getMp4ExportBitrate({
				width: 1920,
				height: 1080,
				frameRate: 30,
				quality: "source",
				encodingMode: "quality",
				useModernNativeStaticLayout: true,
			}),
		).toBe(14_000_000);
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
		).toBe(28_000_000);
	});
});
