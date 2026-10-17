import { describe, expect, it } from "vitest";
import { countPrimingFrames } from "./audioProcessorShared";

describe("countPrimingFrames", () => {
	it("drops the AAC priming that an iTunSMPB tag puts before the start time", () => {
		expect(countPrimingFrames(0.044, 0, 48_000)).toBe(2112);
	});

	it("drops the AAC priming that an edit list gives negative timestamps", () => {
		expect(countPrimingFrames(0, -44_000, 48_000)).toBe(2112);
	});

	it("keeps everything when the stream starts at its first packet or is unknown", () => {
		expect(countPrimingFrames(0, 0, 48_000)).toBe(0);
		expect(countPrimingFrames(2.5, 2_500_000, 48_000)).toBe(0);
		expect(countPrimingFrames(undefined, 0, 48_000)).toBe(0);
		expect(countPrimingFrames(0.044, null, 48_000)).toBe(0);
	});
});
