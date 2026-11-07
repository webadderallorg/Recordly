import { describe, expect, it } from "vitest";
import { buildNativeAudioPlan } from "./nativeExportAudioPlan";
import { buildNativeAudioPlan as buildLegacyNativeAudioPlan } from "./legacyVideoAudioPlan";
import type { VideoExporterConfig } from "./modernVideoExporterConfig";
import type { LegacyVideoExporterContext } from "./legacyVideoExporterContext";
import type { DecodedVideoInfo } from "./streamingDecoder";

const info = {
	width: 320,
	height: 180,
	duration: 2,
	frameRate: 30,
	codec: "h264",
	hasAudio: true,
	audioCodec: "aac",
	audioSampleRate: 48000,
} as DecodedVideoInfo;
const base = {
	videoUrl: "file:///tmp/source.mp4",
	clipRegions: [{ id: "clip", startMs: 0, endMs: 2000, speed: 1 }],
} as VideoExporterConfig;

function legacy(config: VideoExporterConfig) {
	return buildLegacyNativeAudioPlan(
		{
			config,
			getNativeVideoSourcePath: () => "/tmp/source.mp4",
			buildNativeTrimSegments: () => [{ startMs: 0, endMs: 2000 }],
		} as LegacyVideoExporterContext,
		info,
	);
}

describe.each([
	["modern", (config: VideoExporterConfig) => buildNativeAudioPlan(config, info)],
	["legacy", legacy],
] as const)("%s native clip audio routing", (_name, plan) => {
	it("renders per-clip overrides instead of copying or filtergraphing unchanged audio", () => {
		const config = {
			...base,
			sourceAudioTrackSettingsByClip: { clip: { mixed: { volume: 0.2, normalize: true } } },
		};
		expect(plan(config)).toMatchObject({
			audioMode: "edited-track",
			strategy: "offline-render-fallback",
		});
		// A speed edit must not select the filtergraph path, which cannot apply clip gains.
		expect(
			plan({ ...config, speedRegions: [{ id: "speed", startMs: 0, endMs: 2000, speed: 2 }] }),
		).toMatchObject({ audioMode: "edited-track", strategy: "offline-render-fallback" });
	});

	it("keeps passthrough for unchanged audio and ignores removed clips' settings", () => {
		expect(plan(base).audioMode).toBe("copy-source");
		expect(
			plan({
				...base,
				sourceAudioTrackSettingsByClip: {
					removed: { mixed: { volume: 0, normalize: true } },
				},
			}).audioMode,
		).toBe("copy-source");
	});
	it("mixes one supplemental microphone with embedded source audio even at zero delay", () => {
		expect(plan({ ...base, sourceAudioFallbackPaths: ["/tmp/source.mic.webm"] })).toMatchObject(
			{ audioMode: "edited-track", strategy: "offline-render-fallback" },
		);
	});
	it("does not mistake an embedded-source alias for an additional microphone", () => {
		expect(
			plan({ ...base, sourceAudioFallbackPaths: ["file:///tmp/source.mp4"] }).audioMode,
		).toBe("copy-source");
	});
});
