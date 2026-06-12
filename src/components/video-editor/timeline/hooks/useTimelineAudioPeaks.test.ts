import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/exporter/localMediaSource", () => ({
	resolveMediaResourceUrl: vi.fn(async (resource: string) => resource),
}));

vi.mock("../../audio/waveform/WaveformGenerator", () => ({
	waveformGenerator: {
		generate: vi.fn(),
	},
}));

import { getTimelineAudioPeaksCacheKey } from "./useTimelineAudioPeaks";

describe("getTimelineAudioPeaksCacheKey", () => {
	it("changes when sidecar media info changes for the same resource", () => {
		const resource = "C:\\Recordly\\recording.mic.wav";

		expect(getTimelineAudioPeaksCacheKey(resource, 75_000)).not.toBe(
			getTimelineAudioPeaksCacheKey(resource, 122_100),
		);
	});

	it("keeps the cache key stable when media info has not changed", () => {
		const resource = "C:\\Recordly\\recording.mic.wav";

		expect(getTimelineAudioPeaksCacheKey(resource, 122_100)).toBe(
			getTimelineAudioPeaksCacheKey(resource, 122_100),
		);
	});
});
