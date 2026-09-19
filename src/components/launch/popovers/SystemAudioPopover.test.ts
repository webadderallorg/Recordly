import { describe, expect, it } from "vitest";
import { getSystemAudioLevel } from "./SystemAudioPopover";

describe("system audio popover meter lookup", () => {
	it("returns the device level and falls back to zero", () => {
		expect(getSystemAudioLevel({ "speaker-1": 72 }, "speaker-1")).toBe(72);
		expect(getSystemAudioLevel({ "speaker-1": 72 }, "speaker-2")).toBe(0);
	});
});
