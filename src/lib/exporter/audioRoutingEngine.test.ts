import { describe, expect, it } from "vitest";
import { buildResolvedAudioPlan, getSourceTrackIdFromPath } from "./audioRoutingEngine";

describe("getSourceTrackIdFromPath", () => {
	it.each([
		["/recordings/recording-mic.wav", "mic"],
		["/recordings/recording-system.wav", "system"],
		["/recordings/system.mp4", "system"],
		["/recordings/mic.wav", "mic"],
	])("classifies companion path %s as %s", (path, trackId) => {
		expect(getSourceTrackIdFromPath(path)).toBe(trackId);
	});

	it("routes mic and system companions onto their dedicated playback tracks", () => {
		const plan = buildResolvedAudioPlan({
			videoResource: "/recordings/recording.mp4",
			sourceAudioFallbackPaths: [
				"/recordings/recording.mp4",
				"/recordings/recording-mic.wav",
				"/recordings/system.mp4",
			],
		});

		expect(plan.pathsByTrack).toEqual({
			mic: "/recordings/recording-mic.wav",
			system: "/recordings/system.mp4",
		});
		expect(plan.playbackPaths).toEqual([
			"/recordings/system.mp4",
			"/recordings/recording-mic.wav",
		]);
	});
});
