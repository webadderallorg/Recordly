import { describe, expect, it } from "vitest";
import { getMp4ExportBitrate } from "./exportBitrate";
import { estimateMp4FileBytes, getEditedExportDurationSeconds } from "./exportSizeEstimate";

const settings = {
	width: 1920,
	height: 1080,
	frameRate: 30 as const,
	quality: "high" as const,
	encodingMode: "balanced" as const,
	durationSeconds: 10,
};

describe("estimateMp4FileBytes", () => {
	it("uses the exporter's actual target video bitrate and edited duration", () => {
		expect(estimateMp4FileBytes(settings)).toBe((getMp4ExportBitrate(settings) * 10) / 8);
		expect(estimateMp4FileBytes({ ...settings, durationSeconds: 20 })).toBe(
			(estimateMp4FileBytes(settings) as number) * 2,
		);
	});

	it("accounts for FPS, resolution, source quality, and encoding mode", () => {
		const baseline = estimateMp4FileBytes(settings) as number;
		expect(estimateMp4FileBytes({ ...settings, frameRate: 60 })).toBeGreaterThan(baseline);
		expect(estimateMp4FileBytes({ ...settings, width: 3840, height: 2160 })).toBeGreaterThan(
			baseline,
		);
		expect(estimateMp4FileBytes({ ...settings, encodingMode: "fast" })).toBeLessThan(baseline);
		expect(estimateMp4FileBytes({ ...settings, encodingMode: "quality" })).toBeGreaterThan(
			baseline,
		);
		expect(
			estimateMp4FileBytes({ ...settings, quality: "source", encodingMode: "fast" }),
		).toBeGreaterThan(estimateMp4FileBytes({ ...settings, encodingMode: "fast" }) as number);
	});

	it("adds configured 128 kbps AAC only when audio is included", () => {
		expect(estimateMp4FileBytes({ ...settings, includeAudio: true })).toBe(
			(estimateMp4FileBytes(settings) as number) + (128_000 * settings.durationSeconds) / 8,
		);
		expect(estimateMp4FileBytes({ ...settings, includeAudio: false })).toBe(
			estimateMp4FileBytes(settings),
		);
	});

	it.each([
		0,
		-1,
		Number.NaN,
		Number.POSITIVE_INFINITY,
	])("hides unavailable or invalid numeric inputs: %s", (invalid) => {
		for (const field of ["width", "height", "frameRate", "durationSeconds"]) {
			expect(estimateMp4FileBytes({ ...settings, [field]: invalid })).toBeNull();
		}
	});
});

describe("getEditedExportDurationSeconds", () => {
	it("returns the source duration for unchanged videos and empty clip lists", () => {
		expect(getEditedExportDurationSeconds({ durationSeconds: 10 })).toBe(10);
		expect(getEditedExportDurationSeconds({ durationSeconds: 10, clipRegions: [] })).toBe(10);
	});

	it("removes trimmed ranges before applying source-time playback speeds", () => {
		expect(
			getEditedExportDurationSeconds({
				durationSeconds: 10,
				trimRegions: [{ id: "trim", startMs: 2000, endMs: 4000 }],
				speedRegions: [{ id: "speed", startMs: 0, endMs: 6000, speed: 2 }],
			}),
		).toBe(6);
	});

	it("deduplicates overlapping trims and supports slowed regions", () => {
		expect(
			getEditedExportDurationSeconds({
				durationSeconds: 10,
				trimRegions: [
					{ id: "a", startMs: 2000, endMs: 4000 },
					{ id: "b", startMs: 3000, endMs: 5000 },
				],
				speedRegions: [{ id: "slow", startMs: 5000, endMs: 10000, speed: 0.5 }],
			}),
		).toBe(12);
	});

	it("uses positioned clips' end times, with gaps and speeds already reflected", () => {
		expect(
			getEditedExportDurationSeconds({
				durationSeconds: 30,
				clipRegions: [
					{ id: "later", startMs: 7000, endMs: 9000, sourceStartMs: 20000, speed: 2 },
					{ id: "first", startMs: 0, endMs: 2000, sourceStartMs: 0, speed: 1 },
				],
				trimRegions: [{ id: "old-trim", startMs: 0, endMs: 30000 }],
				speedRegions: [{ id: "old-speed", startMs: 0, endMs: 30000, speed: 2 }],
			}),
		).toBe(9);
	});

	it("handles a fully trimmed export without inventing a duration", () => {
		expect(
			getEditedExportDurationSeconds({
				durationSeconds: 10,
				trimRegions: [{ id: "all", startMs: 0, endMs: 10000 }],
			}),
		).toBe(0);
	});

	it.each([
		-1,
		Number.NaN,
		Number.POSITIVE_INFINITY,
	])("rejects invalid source duration: %s", (durationSeconds) => {
		expect(getEditedExportDurationSeconds({ durationSeconds })).toBeNull();
	});
});

it("estimates regular 1080p/60 Balanced delivery using the smaller real export budget", () => {
	const bytes = estimateMp4FileBytes({
		...settings,
		quality: "medium",
		frameRate: 60,
		durationSeconds: 30,
		includeAudio: false,
	});
	expect(bytes).toBe(33_941_126);
	expect(bytes).toBeLessThan(84_000_000 / 2);
});

it("uses the actual cloud resolution and bitrate budget instead of local quality", () => {
	const source = {
		...settings,
		width: 3840,
		height: 2160,
		frameRate: 60 as const,
		durationSeconds: 30,
	};
	expect(estimateMp4FileBytes({ ...source, cloudResolution: 720 })).toBe(11_250_000);
	expect(estimateMp4FileBytes({ ...source, cloudResolution: 1080 })).toBe(22_500_000);
	expect(
		estimateMp4FileBytes({ ...source, cloudResolution: 1080, encodingMode: "quality" }),
	).toBe(22_500_000);
	expect(estimateMp4FileBytes({ ...source, cloudResolution: 1080, includeAudio: true })).toBe(
		22_980_000,
	);
});

it("does not predict an upscale for smaller cloud sources or change regular estimates", () => {
	const source = {
		...settings,
		width: 640,
		height: 360,
		frameRate: 30 as const,
		durationSeconds: 30,
	};
	expect(estimateMp4FileBytes({ ...source, cloudResolution: 1080 })).toBe(3_750_000);
	expect(estimateMp4FileBytes(source)).toBe((getMp4ExportBitrate(source) * 30) / 8);
});
