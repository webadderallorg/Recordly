import { describe, expect, it } from "vitest";
import { getMp4ExportBitrate, getSourceQualityBitrate } from "./exportBitrate";

describe("export bitrate policy", () => {
	it("reserves the extra per-frame detail budget for explicit Quality encoding", () => {
		expect(getSourceQualityBitrate(1280, 720)).toBe(8_000_000);
		expect(getSourceQualityBitrate(1920, 1080)).toBe(12_000_000);
		expect(getSourceQualityBitrate(3840, 2160)).toBe(45_000_000);
		expect(
			getMp4ExportBitrate({
				width: 1920,
				height: 1080,
				frameRate: 30,
				quality: "source",
				encodingMode: "quality",
			}),
		).toBe(18_662_400);
		expect(
			getMp4ExportBitrate({
				width: 1920,
				height: 1080,
				frameRate: 30,
				quality: "source",
				encodingMode: "balanced",
			}),
		).toBe(9_600_000);
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

		expect(thirtyFpsBitrate).toBe(33_177_600);
		expect(sixtyFpsBitrate).toBeGreaterThan(thirtyFpsBitrate);
		expect(sixtyFpsBitrate).toBe(66_355_200);
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
		).toBe(9_600_000);
		expect(
			getMp4ExportBitrate({
				width: 1920,
				height: 1080,
				frameRate: 30,
				quality: "source",
				encodingMode: "quality",
				useModernNativeStaticLayout: true,
			}),
		).toBe(18_662_400);
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

		expect(thirtyFpsBitrate).toBe(18_662_400);
		expect(sixtyFpsBitrate).toBeGreaterThan(thirtyFpsBitrate);
		expect(sixtyFpsBitrate).toBe(37_324_800);
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
		).toBe(6_000_000);
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
		).toBe(74_649_600);
	});
});

it("gives 4K/60 and larger originals a per-frame detail budget", () => {
	const settings = {
		frameRate: 60 as const,
		quality: "source" as const,
		encodingMode: "quality" as const,
	};
	expect(getMp4ExportBitrate({ ...settings, width: 3840, height: 2160 })).toBe(149_299_200);
	expect(getMp4ExportBitrate({ ...settings, width: 5120, height: 2880 })).toBe(265_420_800);
});

describe("Balanced delivery budgets", () => {
	const settings = {
		width: 1920,
		height: 1080,
		quality: "medium" as const,
		encodingMode: "balanced" as const,
	};
	it("does not force simple 1080p/60 exports up to the former 22 Mbps floor", () => {
		const bitrate = getMp4ExportBitrate({ ...settings, frameRate: 60 });
		expect(bitrate).toBe(9_050_967);
		expect(bitrate).toBeLessThan(22_394_880 / 2);
	});
	it("uses sublinear FPS scaling and identical budgets across encoder backends", () => {
		const thirty = getMp4ExportBitrate({ ...settings, frameRate: 30 });
		const sixty = getMp4ExportBitrate({ ...settings, frameRate: 60 });
		expect(thirty).toBe(6_400_000);
		expect(sixty / thirty).toBeCloseTo(Math.SQRT2, 6);
		expect(
			getMp4ExportBitrate({ ...settings, frameRate: 60, useModernNativeStaticLayout: true }),
		).toBe(sixty);
	});
	it("keeps Original dimensions on a larger source-quality budget without the Balanced floor", () => {
		expect(getMp4ExportBitrate({ ...settings, quality: "source", frameRate: 60 })).toBe(
			13_576_450,
		);
	});
	it.each([
		"fast",
		"balanced",
		"quality",
	] as const)("keeps a useful minimum for small %s exports", (encodingMode) => {
		expect(
			getMp4ExportBitrate({
				...settings,
				width: 320,
				height: 180,
				frameRate: 24,
				encodingMode,
			}),
		).toBeGreaterThanOrEqual(2_000_000);
	});
});
