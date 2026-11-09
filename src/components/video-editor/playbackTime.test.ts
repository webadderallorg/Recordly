import { describe, expect, it } from "vitest";
import { formatPlaybackTime } from "./playbackTime";

describe("playback timestamp precision", () => {
	it.each([
		[2.027, "0:02.027"],
		[59.9996, "1:00.000"],
		[62.001, "1:02.001"],
		[-1, "0:00.000"],
		[Number.NaN, "0:00.000"],
	])("formats %s seconds as %s", (seconds, expected) => {
		expect(formatPlaybackTime(seconds)).toBe(expected);
	});
});
