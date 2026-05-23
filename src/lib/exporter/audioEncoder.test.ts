import { describe, expect, it, vi } from "vitest";

import { AudioProcessor } from "./audioEncoder";

type OfflineRenderTestHarness = AudioProcessor & {
	decodeAudioFromUrl(url: string): Promise<AudioBuffer | null>;
	getMediaDurationSec(url: string): Promise<number>;
	loadAudioFileDemuxer(audioPath: string): Promise<unknown>;
	prepareOfflineRender(
		videoUrl: string,
		trimRegions: never[],
		speedRegions: never[],
		audioRegions: never[],
		sourceAudioFallbackPaths: string[],
		sourceAudioFallbackStartDelayMsByPath?: Record<string, number>,
	): Promise<{
		mainBuffer: AudioBuffer | null;
		companionEntries: Array<{ buffer: AudioBuffer; startDelaySec: number }>;
	}>;
	renderAndMuxOfflineAudio(
		videoUrl: string,
		trimRegions: never[],
		speedRegions: never[],
		audioRegions: never[],
		sourceAudioFallbackPaths: string[],
		sourceAudioFallbackStartDelayMsByPath: Record<string, number> | undefined,
		muxer: unknown,
	): Promise<void>;
};

describe("AudioProcessor offline render preparation", () => {
	it("keeps embedded source audio separate from external companion sidecars", async () => {
		const processor = new AudioProcessor() as unknown as OfflineRenderTestHarness;
		const mainBuffer = { duration: 10, numberOfChannels: 2 } as AudioBuffer;
		const micBuffer = { duration: 9.5, numberOfChannels: 1 } as AudioBuffer;

		const decodeAudioFromUrl = vi
			.spyOn(processor, "decodeAudioFromUrl")
			.mockImplementation(async (url: string) => {
				if (url === "file:///tmp/recording.mp4") {
					return mainBuffer;
				}
				if (url === "/tmp/recording.mic.wav") {
					return micBuffer;
				}
				return null;
			});
		vi.spyOn(processor, "getMediaDurationSec").mockResolvedValue(10);

		const prepared = await processor.prepareOfflineRender(
			"file:///tmp/recording.mp4",
			[],
			[],
			[],
			["/tmp/recording.mp4", "/tmp/recording.mic.wav"],
		);

		expect(prepared.mainBuffer).toBe(mainBuffer);
		expect(prepared.companionEntries).toHaveLength(1);
		expect(prepared.companionEntries[0]?.buffer).toBe(micBuffer);
		expect(decodeAudioFromUrl).toHaveBeenCalledWith("file:///tmp/recording.mp4");
		expect(decodeAudioFromUrl).toHaveBeenCalledWith("/tmp/recording.mic.wav");
		expect(decodeAudioFromUrl).not.toHaveBeenCalledWith("/tmp/recording.mp4");
	});

	it("does not treat a single embedded fallback path as an external sidecar", async () => {
		const processor = new AudioProcessor() as unknown as OfflineRenderTestHarness;
		const loadAudioFileDemuxer = vi.spyOn(processor, "loadAudioFileDemuxer");
		const renderAndMuxOfflineAudio = vi
			.spyOn(processor, "renderAndMuxOfflineAudio")
			.mockResolvedValue();

		await processor.process(
			null,
			{} as never,
			"file:///tmp/recording.mp4",
			[],
			[],
			undefined,
			[],
			["/tmp/recording.mp4"],
		);

		expect(loadAudioFileDemuxer).not.toHaveBeenCalled();
		expect(renderAndMuxOfflineAudio).not.toHaveBeenCalled();
	});

	it("uses recorded companion start-delay metadata instead of inferring from duration gap", async () => {
		const processor = new AudioProcessor() as unknown as OfflineRenderTestHarness;
		const mainBuffer = { duration: 600, numberOfChannels: 2 } as AudioBuffer;
		const micBuffer = { duration: 565, numberOfChannels: 1 } as AudioBuffer;

		vi.spyOn(processor, "decodeAudioFromUrl").mockImplementation(async (url: string) => {
			if (url === "file:///tmp/recording.mp4") {
				return mainBuffer;
			}
			if (url === "/tmp/recording.mic.webm") {
				return micBuffer;
			}
			return null;
		});

		const prepared = await processor.prepareOfflineRender(
			"file:///tmp/recording.mp4",
			[],
			[],
			[],
			["/tmp/recording.mic.webm"],
			{ "/tmp/recording.mic.webm": 3_500 },
		);

		expect(prepared.companionEntries[0]?.startDelaySec).toBeCloseTo(3.5);
	});

	it("avoids the single-sidecar fast path when companion timing metadata is present", async () => {
		const processor = new AudioProcessor() as unknown as OfflineRenderTestHarness;
		const loadAudioFileDemuxer = vi.spyOn(processor, "loadAudioFileDemuxer");
		const renderAndMuxOfflineAudio = vi
			.spyOn(processor, "renderAndMuxOfflineAudio")
			.mockResolvedValue();

		await processor.process(
			null,
			{} as never,
			"file:///tmp/recording.mp4",
			[],
			[],
			undefined,
			[],
			["/tmp/recording.mic.webm"],
			{ "/tmp/recording.mic.webm": 2_000 },
		);

		expect(loadAudioFileDemuxer).not.toHaveBeenCalled();
		expect(renderAndMuxOfflineAudio).toHaveBeenCalled();
	});

	it("reuses decoded buffers for repeated overlay audio paths", async () => {
		const processor = new AudioProcessor() as unknown as OfflineRenderTestHarness;
		const mainBuffer = { duration: 10, numberOfChannels: 2 } as AudioBuffer;
		const clickBuffer = { duration: 0.2, numberOfChannels: 1 } as AudioBuffer;
		const decodeAudioFromUrl = vi
			.spyOn(processor, "decodeAudioFromUrl")
			.mockImplementation(async (url: string) => {
				if (url === "file:///tmp/recording.mp4") {
					return mainBuffer;
				}
				if (url === "file:///tmp/click.wav") {
					return clickBuffer;
				}
				return null;
			});
		vi.spyOn(processor, "getMediaDurationSec").mockResolvedValue(10);

		await processor.prepareOfflineRender(
			"file:///tmp/recording.mp4",
			[],
			[],
			[
				{
					id: "click-a",
					startMs: 1_000,
					endMs: 1_100,
					audioPath: "file:///tmp/click.wav",
					volume: 1,
				},
				{
					id: "click-b",
					startMs: 2_000,
					endMs: 2_100,
					audioPath: "file:///tmp/click.wav",
					volume: 0.8,
				},
			] as never[],
			["/tmp/recording.mp4"],
		);

		const clickDecodeCalls = decodeAudioFromUrl.mock.calls.filter(
			([url]) => url === "file:///tmp/click.wav",
		).length;
		expect(clickDecodeCalls).toBe(1);
	});

	it("caps cached overlay buffers to avoid unbounded growth", async () => {
		const processor = new AudioProcessor() as unknown as OfflineRenderTestHarness;
		const mainBuffer = { duration: 10, numberOfChannels: 2 } as AudioBuffer;
		const clickBuffer = { duration: 0.2, numberOfChannels: 1 } as AudioBuffer;
		const decodeAudioFromUrl = vi
			.spyOn(processor, "decodeAudioFromUrl")
			.mockImplementation(async (url: string) => {
				if (url === "file:///tmp/recording.mp4") {
					return mainBuffer;
				}
				if (url.startsWith("file:///tmp/click-")) {
					return clickBuffer;
				}
				return null;
			});
		vi.spyOn(processor, "getMediaDurationSec").mockResolvedValue(10);

		const audioRegions = Array.from({ length: 102 }, (_, index) => ({
			id: `click-${index}`,
			startMs: 1_000 + index * 10,
			endMs: 1_100 + index * 10,
			audioPath: `file:///tmp/click-${index < 101 ? index : 100}.wav`,
			volume: 1,
		}));

		await processor.prepareOfflineRender(
			"file:///tmp/recording.mp4",
			[],
			[],
			audioRegions as never[],
			["/tmp/recording.mp4"],
		);

		const cappedPathDecodeCalls = decodeAudioFromUrl.mock.calls.filter(
			([url]) => url === "file:///tmp/click-100.wav",
		).length;
		expect(cappedPathDecodeCalls).toBe(2);
	});
});
