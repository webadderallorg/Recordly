import { describe, expect, it } from "vitest";
import { resolveAudioPlacement } from "./timelineAudioPlacement";

describe("timelineAudioPlacement", () => {
	it("uses first available track when no preferred track is provided", () => {
		const placement = resolveAudioPlacement({
			audioRegions: [{ id: "a1", startMs: 0, endMs: 500, trackIndex: 0 }],
			startPos: 500,
			totalMs: 2000,
			audioDurationMs: 500,
		});
		expect(placement).toEqual({ trackIndex: 0, durationMs: 500 });
	});

	it("falls back to next track when preferred track is blocked", () => {
		const placement = resolveAudioPlacement({
			audioRegions: [{ id: "a1", startMs: 0, endMs: 1500, trackIndex: 0 }],
			startPos: 1000,
			totalMs: 3000,
			audioDurationMs: 800,
		});
		expect(placement).toEqual({ trackIndex: 1, durationMs: 800 });
	});

	it("returns null when no slot is available", () => {
		const placement = resolveAudioPlacement({
			audioRegions: [{ id: "a1", startMs: 0, endMs: 2000, trackIndex: 0 }],
			startPos: 1500,
			totalMs: 2000,
			audioDurationMs: 800,
			preferredTrackIndex: 0,
		});
		expect(placement).toBeNull();
	});
});
