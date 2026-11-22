import { describe, expect, it } from "vitest";
import { formatPlaybackTime } from "./playbackTime";

describe("playback timestamp precision", () => {
	it.each([
		[2.027, "0:02.0"],
		[2.696, "0:02.7"],
		[59.9996, "1:00.0"],
		[62.001, "1:02.0"],
		[-1, "0:00.0"],
		[Number.NaN, "0:00.0"],
	])("formats %s seconds as %s", (seconds, expected) => {
		expect(formatPlaybackTime(seconds)).toBe(expected);
	});
});
