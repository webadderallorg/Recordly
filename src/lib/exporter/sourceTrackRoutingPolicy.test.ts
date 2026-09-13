import { describe, expect, it } from "vitest";
import { resolveSourceTrackRoutingPolicy } from "./sourceTrackRoutingPolicy";

describe("resolveSourceTrackRoutingPolicy", () => {
	it("prioritizes system+mic sidecars and mutes embedded preview", () => {
		const policy = resolveSourceTrackRoutingPolicy("/tmp/recording.mp4", [
			"/tmp/recording.mp4",
			"/tmp/recording.system.wav",
			"/tmp/recording.mic.wav",
			"/tmp/recording.mixed.wav",
		]);

		expect(policy.playbackPaths).toEqual([
			"/tmp/recording.system.wav",
			"/tmp/recording.mic.wav",
		]);
		expect(policy.muteEmbeddedPreview).toBe(true);
		expect(policy.includeEmbeddedInExport).toBe(false);
	});

	it("falls back to mixed when dedicated tracks are absent", () => {
		const policy = resolveSourceTrackRoutingPolicy("/tmp/recording.mp4", [
			"/tmp/recording.mixed.wav",
		]);

		expect(policy.playbackPaths).toEqual(["/tmp/recording.mixed.wav"]);
		expect(policy.muteEmbeddedPreview).toBe(false);
		expect(policy.includeEmbeddedInExport).toBe(false);
	});

	it("keeps embedded audio when only mic sidecar is present", () => {
		const policy = resolveSourceTrackRoutingPolicy("/tmp/recording.mp4", [
			"/tmp/recording.mp4",
			"/tmp/recording.mic.wav",
		]);

		expect(policy.playbackPaths).toEqual(["/tmp/recording.mic.wav"]);
		expect(policy.muteEmbeddedPreview).toBe(false);
		expect(policy.includeEmbeddedInExport).toBe(true);
	});
	it.each([
		"m4a",
		"webm",
		"wav",
	])("uses a selected mic companion as replacement audio (%s)", (extension) => {
		const micPath = `/tmp/recording.mic.${extension}`;
		const policy = resolveSourceTrackRoutingPolicy("/tmp/recording.mp4", [micPath]);
		expect(policy.playbackPaths).toEqual([micPath]);
		expect(policy.muteEmbeddedPreview).toBe(true);
		expect(policy.includeEmbeddedInExport).toBe(false);
	});

	it("keeps embedded-only playback when no companion was selected", () => {
		const policy = resolveSourceTrackRoutingPolicy("/tmp/recording.mp4", []);
		expect(policy.muteEmbeddedPreview).toBe(false);
		expect(policy.includeEmbeddedInExport).toBe(true);
	});
});
