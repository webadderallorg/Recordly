import { afterEach, describe, expect, it, vi } from "vitest";
import { AudioProcessor } from "./audioEncoder";
import { ModernVideoExporter } from "./modernVideoExporter";
import type { MuxerFinalizeResult } from "./muxer";

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe("modern export audio cancellation", () => {
	it.each([
		"audio-render",
		"audio-buffer",
		"video-buffer",
	])("does not start FFmpeg after cancellation during %s", async (stage) => {
		const mux = vi.fn();
		vi.stubGlobal("window", { electronAPI: { muxExportedVideoAudio: mux } });
		const exporter = new ModernVideoExporter({
			videoUrl: "file:///source.mp4",
			width: 320,
			height: 180,
			frameRate: 30,
			bitrate: 1_000_000,
			wallpaper: "#000000",
			zoomRegions: [],
			showShadow: false,
			shadowIntensity: 0,
			backgroundBlur: 0,
			cropRegion: { x: 0, y: 0, width: 1, height: 1 },
		});
		const audio = new Blob([], { type: "audio/wav" });
		vi.spyOn(AudioProcessor.prototype, "renderEditedAudioTrack").mockImplementation(
			async () => {
				if (stage === "audio-render") exporter.cancel();
				return audio;
			},
		);
		vi.spyOn(audio, "arrayBuffer").mockImplementation(async () => {
			if (stage === "audio-buffer") exporter.cancel();
			return new ArrayBuffer(0);
		});
		const video = new Blob([], { type: "video/mp4" });
		vi.spyOn(video, "arrayBuffer").mockImplementation(async () => {
			if (stage === "video-buffer") exporter.cancel();
			return new ArrayBuffer(0);
		});
		const access = exporter as unknown as {
			finalizeExportWithFfmpegAudio(
				video: MuxerFinalizeResult,
				plan: unknown,
			): Promise<unknown>;
		};
		await expect(
			access.finalizeExportWithFfmpegAudio(
				{ mode: "buffer", blob: video },
				{ audioMode: "edited-track", strategy: "offline-render-fallback" },
			),
		).rejects.toThrow("Export cancelled");
		expect(mux).not.toHaveBeenCalled();
	});
});
