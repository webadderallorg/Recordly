import { describe, expect, it } from "vitest";
import { getCloudShareBitrate } from "./shareBitrate";

describe("cloud delivery bitrate", () => {
	it.each([
		[1280, 720, 30, 2_000_000],
		[1280, 720, 60, 3_000_000],
		[1920, 1080, 30, 4_000_000],
		[1920, 1080, 60, 6_000_000],
		[1080, 1920, 60, 6_000_000],
		[1920, 1080, 24, 4_000_000],
		[640, 360, 30, 1_000_000],
	] as const)("budgets %ix%i at %i FPS", (width, height, frameRate, expected) => {
		expect(getCloudShareBitrate({ width, height, frameRate })).toBe(expected);
	});
});
