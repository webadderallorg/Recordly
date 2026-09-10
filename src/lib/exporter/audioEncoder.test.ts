import { describe, expect, it, vi } from "vitest";

import { AudioProcessor, softLimitOfflineMixPeaksInPlace } from "./audioEncoder";

interface TimelineSliceForTest {
	sourceStartMs: number;
	sourceEndMs: number;
	speed: number;
	holdBeforeMs: number;
}

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
		mainBufferEntry: { buffer: AudioBuffer; gain: number } | null;
		companionEntries: Array<{ buffer: AudioBuffer; startDelaySec: number; gain: number }>;
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
	buildTimelineSlices(
		sourceDurationMs: number,
		trimRegions: Array<{ id: string; startMs: number; endMs: number }>,
		speedRegions: never[],
		freezeRegions: Array<{ id: string; sourceMs: number; durationMs: number }>,
	): TimelineSliceForTest[];
	sourceTimeToOutputTime(sourceMs: number, slices: TimelineSliceForTest[]): number;
	scheduleBufferThroughTimeline(
		ctx: OfflineAudioContext,
		buffer: AudioBuffer,
		slices: TimelineSliceForTest[],
		sourceStartDelaySec: number,
	): void;
	stretchAudioBuffer(
		originalBuffer: AudioBuffer,
		speed: number,
		sourceOffsetSec: number,
		sourceDurationSec: number,
		outputDurationSec: number,
		ctx: OfflineAudioContext,
	): AudioBuffer;
	renderChunked(
		prepared: {
			mainBufferEntry: null;
			companionEntries: [];
			regionEntries: [];
			mutedSourceOutputRangesSec: [];
			slices: [];
			outputDurationMs: number;
			numChannels: number;
		},
		totalOutputSec: number,
		onChunk: (
			rendered: AudioBuffer,
			outputOffsetSec: number,
			chunkIndex: number,
		) => Promise<void>,
	): Promise<void>;
};

function fakeAudioBuffer(channels: Float32Array[]): AudioBuffer {
	return {
		numberOfChannels: channels.length,
		getChannelData: (channel: number) => channels[channel],
	} as AudioBuffer;
}

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

		expect(prepared.mainBufferEntry?.buffer).toBe(mainBuffer);
		expect(prepared.mainBufferEntry?.gain).toBe(1);
		expect(prepared.companionEntries).toHaveLength(1);
		expect(prepared.companionEntries[0]?.buffer).toBe(micBuffer);
		expect(prepared.companionEntries[0]?.gain).toBe(1);
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

	it("avoids the single-sidecar fast path for legacy mac mic sidecars that still need embedded audio", async () => {
		const processor = new AudioProcessor() as unknown as OfflineRenderTestHarness;
		const loadAudioFileDemuxer = vi.spyOn(processor, "loadAudioFileDemuxer");
		const renderAndMuxOfflineAudio = vi
			.spyOn(processor, "renderAndMuxOfflineAudio")
			.mockResolvedValue();

		await processor.process(
			{} as never,
			{} as never,
			"file:///tmp/recording.mp4",
			[],
			[],
			undefined,
			[],
			["/tmp/recording.mic.m4a"],
		);

		expect(loadAudioFileDemuxer).not.toHaveBeenCalled();
		expect(renderAndMuxOfflineAudio).toHaveBeenCalled();
	});

	it("soft-limits mixed peaks before encoding or WAV conversion", () => {
		const samples = new Float32Array([
			-1.6,
			-0.5,
			Number.NEGATIVE_INFINITY,
			Number.NaN,
			0,
			0.5,
			0.95,
			Number.POSITIVE_INFINITY,
			1.6,
		]);
		const changed = softLimitOfflineMixPeaksInPlace(fakeAudioBuffer([samples]));

		expect(changed).toBe(true);
		expect(samples[0]).toBeGreaterThanOrEqual(-0.986);
		expect(samples[1]).toBe(-0.5);
		expect(samples[2]).toBe(0);
		expect(samples[3]).toBe(0);
		expect(samples[5]).toBe(0.5);
		expect(samples[6]).toBeLessThan(0.95);
		expect(samples[6]).toBeGreaterThan(0.9);
		expect(samples[7]).toBe(0);
		expect(samples[8]).toBeLessThanOrEqual(0.986);
	});

	it("runs the offline mix limiter for every rendered chunk", async () => {
		const processor = new AudioProcessor() as unknown as OfflineRenderTestHarness;
		const renderedSamples = new Float32Array([1.4]);
		const renderedBuffer = fakeAudioBuffer([renderedSamples]);
		const originalOfflineAudioContext = globalThis.OfflineAudioContext;
		(
			globalThis as unknown as { OfflineAudioContext: typeof OfflineAudioContext }
		).OfflineAudioContext = class {
			constructor() {}

			startRendering() {
				return Promise.resolve(renderedBuffer);
			}
		} as unknown as typeof OfflineAudioContext;

		try {
			let observedPeak = Number.POSITIVE_INFINITY;
			await processor.renderChunked(
				{
					mainBufferEntry: null,
					companionEntries: [],
					regionEntries: [],
					mutedSourceOutputRangesSec: [],
					slices: [],
					outputDurationMs: 100,
					numChannels: 1,
				},
				0.1,
				async (rendered) => {
					observedPeak = rendered.getChannelData(0)[0] ?? 0;
				},
			);

			expect(observedPeak).toBeLessThanOrEqual(0.986);
		} finally {
			(
				globalThis as unknown as { OfflineAudioContext: typeof OfflineAudioContext }
			).OfflineAudioContext = originalOfflineAudioContext;
		}
	});
});

describe("AudioProcessor freeze frame timeline", () => {
	const freezeRegion = { id: "freeze-1", sourceMs: 2_000, durationMs: 1_500 };

	it("holds silence before the slice that starts on the held frame", () => {
		const processor = new AudioProcessor() as unknown as OfflineRenderTestHarness;

		expect(processor.buildTimelineSlices(6_000, [], [], [freezeRegion])).toEqual([
			{ sourceStartMs: 0, sourceEndMs: 2_000, speed: 1, holdBeforeMs: 0 },
			{ sourceStartMs: 2_000, sourceEndMs: 6_000, speed: 1, holdBeforeMs: 1_500 },
		]);
	});

	it("drops freeze frames inside trimmed footage", () => {
		const processor = new AudioProcessor() as unknown as OfflineRenderTestHarness;

		expect(
			processor.buildTimelineSlices(
				6_000,
				[{ id: "trim-1", startMs: 1_000, endMs: 3_000 }],
				[],
				[freezeRegion],
			),
		).toEqual([
			{ sourceStartMs: 0, sourceEndMs: 1_000, speed: 1, holdBeforeMs: 0 },
			{ sourceStartMs: 3_000, sourceEndMs: 6_000, speed: 1, holdBeforeMs: 0 },
		]);
	});

	it("maps source time after a hold later by the hold duration", () => {
		const processor = new AudioProcessor() as unknown as OfflineRenderTestHarness;
		const slices = processor.buildTimelineSlices(6_000, [], [], [freezeRegion]);

		expect(processor.sourceTimeToOutputTime(1_000, slices)).toBe(1_000);
		expect(processor.sourceTimeToOutputTime(2_000, slices)).toBe(2_000);
		expect(processor.sourceTimeToOutputTime(2_500, slices)).toBe(4_000);
	});

	it("schedules no source audio during a hold", () => {
		const processor = new AudioProcessor() as unknown as OfflineRenderTestHarness;
		const slices = processor.buildTimelineSlices(6_000, [], [], [freezeRegion]);
		vi.spyOn(processor, "stretchAudioBuffer").mockImplementation(
			(_buffer, _speed, _sourceOffsetSec, _sourceDurationSec, outputDurationSec) =>
				({ duration: outputDurationSec }) as AudioBuffer,
		);
		const scheduledSources: Array<{
			buffer: AudioBuffer | null;
			start: ReturnType<typeof vi.fn>;
		}> = [];
		const ctx = {
			destination: {},
			createBufferSource: () => {
				const source = {
					buffer: null,
					playbackRate: { value: 1 },
					connect: vi.fn(),
					start: vi.fn(),
				};
				scheduledSources.push(source);
				return source;
			},
			createGain: () => ({ gain: { value: 1 }, connect: vi.fn() }),
		} as unknown as OfflineAudioContext;

		processor.scheduleBufferThroughTimeline(
			ctx,
			{ duration: 6, numberOfChannels: 1 } as AudioBuffer,
			slices,
			0,
		);

		expect(
			scheduledSources.map((source) => ({
				startSec: source.start.mock.calls[0]?.[0],
				durationSec: source.buffer?.duration,
			})),
		).toEqual([
			{ startSec: 0, durationSec: 2 },
			{ startSec: 3.5, durationSec: 4 },
		]);
	});
});
