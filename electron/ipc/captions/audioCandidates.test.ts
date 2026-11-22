import { describe, expect, it } from "vitest";
import { getCaptionCompanionAudioCandidates } from "./audioCandidates";

describe("getCaptionCompanionAudioCandidates", () => {
	it("prefers microphone audio and includes system audio when both sidecars exist", () => {
		expect(
			getCaptionCompanionAudioCandidates([
				{
					platform: "win",
					micPath: "recording.mic.wav",
					systemPath: "recording.system.wav",
					usablePaths: ["recording.system.wav", "recording.mic.wav"],
				},
			]),
		).toEqual([
			{ path: "recording.mic.wav", label: "microphone audio sidecar" },
			{ path: "recording.system.wav", label: "system audio sidecar" },
		]);
	});

	it("omits companion paths that were not found on disk", () => {
		expect(
			getCaptionCompanionAudioCandidates([
				{
					platform: "win",
					micPath: "recording.mic.wav",
					systemPath: "recording.system.wav",
					usablePaths: ["recording.mic.wav"],
				},
			]),
		).toEqual([{ path: "recording.mic.wav", label: "microphone audio sidecar" }]);
	});
});
