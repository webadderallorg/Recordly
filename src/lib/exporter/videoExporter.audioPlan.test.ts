import { describe, expect, it } from "vitest";
import { VideoExporter } from "./videoExporter";
import type { DecodedVideoInfo } from "./streamingDecoder";

const videoInfo: DecodedVideoInfo = {
	width: 1920,
	height: 1080,
	duration: 10,
	streamDuration: 10,
	frameRate: 30,
	codec: "h264",
	hasAudio: true,
	audioCodec: "aac",
	audioSampleRate: 48_000,
};

function audioPlan(paths: string[], info = videoInfo, delays: Record<string, number> = {}) {
	const exporter = new VideoExporter({
		videoUrl: "file:///recording.mp4",
		sourceAudioFallbackPaths: paths,
		sourceAudioFallbackStartDelayMsByPath: delays,
	} as never) as unknown as { buildNativeAudioPlan: (info: DecodedVideoInfo) => unknown };
	return exporter.buildNativeAudioPlan(info);
}

describe("VideoExporter native companion audio routing", () => {
	it.each([
		["/recording.system.m4a", "/recording.mic.m4a"],
		["/recording.system.m4a"],
		["/recording.mic.m4a"],
	])("renders sidecars through the shared routing policy: %j", (...paths) => {
		expect(audioPlan(paths)).toEqual({
			audioMode: "edited-track",
			strategy: "offline-render-fallback",
		});
	});

	it("preserves embedded-only recordings", () => {
		expect(audioPlan([])).toMatchObject({
			audioMode: "copy-source",
			audioSourcePath: "/recording.mp4",
		});
		expect(audioPlan(["/recording.mp4"])).toMatchObject({
			audioMode: "copy-source",
			audioSourcePath: "/recording.mp4",
		});
	});

	it("copies an untimed sidecar when there is no embedded audio", () => {
		expect(
			audioPlan(["/recording.system.m4a"], { ...videoInfo, hasAudio: false }),
		).toMatchObject({
			audioMode: "copy-source",
			audioSourcePath: "/recording.system.m4a",
		});
	});

	it("renders timed sidecars instead of losing their offset", () => {
		expect(
			audioPlan(
				["/recording.mic.m4a"],
				{ ...videoInfo, hasAudio: false },
				{ "/recording.mic.m4a": 125 },
			),
		).toEqual({
			audioMode: "edited-track",
			strategy: "offline-render-fallback",
		});
	});
});
