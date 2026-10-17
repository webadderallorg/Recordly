import { describe, expect, it } from "vitest";
import { buildResolvedAudioPlan, getSourceTrackIdFromPath } from "./audioRoutingEngine";

describe("getSourceTrackIdFromPath", () => {
	it.each([
		["/recordings/recording-mic.wav", "mic"],
		["/recordings/recording-system.wav", "system"],
		["/recordings/system.mp4", "system"],
		["/recordings/mic.wav", "mic"],
		["mic.wav", "mic"],
		["system.m4a", "system"],
		["/recordings/recording_mic.wav", "mic"],
		["C:\\Recordings\\recording.SYSTEM.m4a", "system"],
		["/recordings/recording_mic_take.wav", "mic"],
	])("classifies companion path %s as %s", (path, trackId) => {
		expect(getSourceTrackIdFromPath(path)).toBe(trackId);
	});

	it.each([
		"atomic.wav",
		"dynamic.mp4",
		"ecosystem.m4a",
	])("keeps ordinary filename %s on the mixed track", (filename) => {
		expect(getSourceTrackIdFromPath(`/recordings/${filename}`)).toBe("mixed");
	});

	it("does not suppress the mixed track when another filename ends with mic.wav", () => {
		const plan = buildResolvedAudioPlan({
			videoResource: "/recordings/recording.mp4",
			sourceAudioFallbackPaths: ["/recordings/mix.wav", "/recordings/atomic.wav"],
		});

		expect(plan.pathsByTrack).toEqual({ mixed: "/recordings/mix.wav" });
		expect(plan.playbackPaths).toEqual(["/recordings/mix.wav"]);
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
