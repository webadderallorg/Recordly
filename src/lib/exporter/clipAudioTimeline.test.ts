import { afterEach, describe, expect, it, vi } from "vitest";
import type { AudioRegion, SourceAudioTrackSettings } from "@/components/video-editor/types";
import { OfflineAudioProcessor } from "./offlineAudioProcessor";

const buffer = { duration: 12, numberOfChannels: 2 } as AudioBuffer;
class TestAudioProcessor extends OfflineAudioProcessor {
	prepare = this.prepareOfflineRender.bind(this);
	schedule = this.scheduleBufferThroughTimeline.bind(this);
	scheduleOverlay = this.scheduleRegionForChunk.bind(this);
	render = this.renderChunked.bind(this);
	protected decodeAudioFromUrl = vi.fn(async () => buffer);
	protected getMediaDurationSec = vi.fn(async () => 12);
	protected stretchAudioBuffer = vi.fn(() => buffer);
	get stretches() {
		return this.stretchAudioBuffer.mock.calls;
	}
}
const clips = [
	{ id: "a", startMs: 0, endMs: 1000, sourceStartMs: 0, speed: 3 },
	{ id: "b", startMs: 2000, endMs: 4000, sourceStartMs: 6000, speed: 3 },
];
function context() {
	const starts: ReturnType<typeof vi.fn>[] = [];
	const gains: Array<{ value: number }> = [];
	return {
		starts,
		gains,
		ctx: {
			destination: {},
			createGain: () => {
				const gain = { value: 1 };
				gains.push(gain);
				return { gain, connect: vi.fn() };
			},
			createBufferSource: () => {
				const start = vi.fn();
				starts.push(start);
				return { playbackRate: { value: 1 }, connect: vi.fn(), start };
			},
		} as unknown as OfflineAudioContext,
	};
}

describe("clip audio timeline", () => {
	afterEach(() => vi.unstubAllGlobals());

	it.each<{
		mic: boolean;
		defaults: SourceAudioTrackSettings;
		overrides: SourceAudioTrackSettings;
		expected: number[];
	}>([
		{
			mic: true,
			defaults: {
				mixed: { volume: 0.1, normalize: false },
				system: { volume: 0.8, normalize: false },
			},
			overrides: {
				mixed: { volume: 0.2, normalize: false },
				system: { volume: 0.4, normalize: false },
			},
			expected: [0.4, 0.8],
		},
		{
			mic: false,
			defaults: {
				mixed: { volume: 0.8, normalize: false },
				system: { volume: 0.1, normalize: false },
			},
			overrides: {
				mixed: { volume: 0.4, normalize: false },
				system: { volume: 0.2, normalize: false },
			},
			expected: [0.4, 0.8],
		},
		{
			mic: true,
			defaults: { mixed: { volume: 0.1, normalize: false } },
			overrides: { mixed: { volume: 0.2, normalize: false } },
			expected: [1, 1],
		},
		{
			mic: false,
			defaults: { system: { volume: 0.1, normalize: false } },
			overrides: { system: { volume: 0.2, normalize: false } },
			expected: [1, 1],
		},
	])("uses the actual embedded track with mic=$mic despite stale settings", async ({
		mic,
		defaults,
		overrides,
		expected,
	}) => {
		const processor = new TestAudioProcessor();
		const prepared = await processor.prepare(
			"file:///tmp/source.mp4",
			[],
			[],
			[],
			mic ? ["/tmp/source.mic.wav"] : [],
			undefined,
			defaults,
			[
				{ id: "override", startMs: 0, endMs: 1000, sourceStartMs: 0, speed: 1 },
				{ id: "default", startMs: 1000, endMs: 2000, sourceStartMs: 1000, speed: 1 },
			],
			{ override: overrides },
		);
		const { ctx, gains } = context();
		Object.assign(ctx, { startRendering: vi.fn(async () => ({ numberOfChannels: 0 })) });
		vi.stubGlobal(
			"OfflineAudioContext",
			class {
				constructor() {
					return ctx;
				}
			},
		);
		await processor.render(prepared, 2, vi.fn());
		expect(prepared.mainBufferEntry?.gain).toBe(expected[1]);
		expect(gains.slice(0, 2).map((gain) => gain.value)).toEqual(expected);
	});

	it("renders each retained clip with its own volume, normalization, speed and project defaults", async () => {
		const processor = new TestAudioProcessor();
		const retainedClips = [
			{ id: "a", startMs: 0, endMs: 1000, sourceStartMs: 4000, speed: 2 },
			{ id: "b", startMs: 1000, endMs: 2000, sourceStartMs: 0, speed: 1 },
			{ id: "muted", startMs: 2000, endMs: 3000, sourceStartMs: 1000, speed: 1, muted: true },
			{ id: "default", startMs: 3000, endMs: 4000, sourceStartMs: 2000, speed: 1 },
		];
		const prepared = await processor.prepare(
			"file:///tmp/source.mp4",
			[],
			[],
			[],
			[],
			undefined,
			{ mixed: { volume: 0.8, normalize: false } },
			retainedClips,
			{
				a: { mixed: { volume: 0.2, normalize: false } },
				b: { mixed: { volume: 0.5, normalize: true } },
			},
		);
		const { ctx, gains, starts } = context();
		Object.assign(ctx, { startRendering: vi.fn(async () => ({ numberOfChannels: 0 })) });
		vi.stubGlobal(
			"OfflineAudioContext",
			class {
				constructor() {
					return ctx;
				}
			},
		);
		await processor.render(prepared, 4, vi.fn());
		expect(gains.map((gain) => gain.value)).toEqual([0.2, 0.675, 0.8]);
		expect(starts.map((start) => start.mock.calls[0][0])).toEqual([0, 1, 3]);
		expect(processor.stretches.map((call) => call.slice(1, 5))).toEqual([
			[2, 4, 2, 1],
			[1, 0, 1, 1],
			[1, 2, 1, 1],
		]);
	});

	it("applies system overrides to embedded audio and independent microphone gains to sidecars", async () => {
		const processor = new TestAudioProcessor();
		const prepared = await processor.prepare(
			"file:///tmp/source.mp4",
			[],
			[],
			[],
			["/tmp/source.mic.wav"],
			undefined,
			{ system: { volume: 0.8, normalize: false }, mic: { volume: 0.3, normalize: false } },
			[{ id: "clip", startMs: 0, endMs: 1000, sourceStartMs: 1000, speed: 1 }],
			{
				clip: {
					system: { volume: 0.4, normalize: false },
					mic: { volume: 0.5, normalize: true },
				},
			},
		);
		const { ctx, gains } = context();
		Object.assign(ctx, { startRendering: vi.fn(async () => ({ numberOfChannels: 0 })) });
		vi.stubGlobal(
			"OfflineAudioContext",
			class {
				constructor() {
					return ctx;
				}
			},
		);
		await processor.render(prepared, 1, vi.fn());
		expect(gains.map((gain) => gain.value)).toEqual([0.4, 0.675]);
	});

	it("keeps the silent middle interval and schedules retained source at its timeline position", async () => {
		const processor = new TestAudioProcessor();
		const prepared = await processor.prepare(
			"file:///tmp/source.mp4",
			[],
			[],
			[],
			[],
			undefined,
			undefined,
			clips,
		);
		expect(prepared.outputDurationMs).toBe(4000);
		expect(prepared.slices).toEqual([
			{ sourceStartMs: 0, sourceEndMs: 3000, speed: 3, outputStartMs: 0 },
			{ sourceStartMs: 6000, sourceEndMs: 12000, speed: 3, outputStartMs: 2000 },
		]);
		const { starts, ctx } = context();
		processor.schedule(ctx, buffer, prepared.slices, 0);
		expect(starts.map((start) => start.mock.calls[0][0])).toEqual([0, 2]);
	});
	it("keeps independently placed music at 1x across the video gap", () => {
		const processor = new TestAudioProcessor();
		const { starts, ctx } = context();
		processor.scheduleOverlay(
			ctx,
			buffer,
			{ startMs: 500, endMs: 3500, volume: 1 } as AudioRegion,
			[],
			0,
			4,
			true,
		);
		expect(starts[0]).toHaveBeenCalledWith(0.5, 0, 3);
	});
	it("schedules a clip correctly when its audio straddles an offline chunk boundary", async () => {
		const processor = new TestAudioProcessor();
		const prepared = await processor.prepare(
			"file:///tmp/source.mp4",
			[],
			[],
			[],
			[],
			undefined,
			undefined,
			clips,
		);
		const { starts, ctx } = context();
		processor.schedule(ctx, buffer, prepared.slices, 0, 1, 2.5, 1);
		expect(starts).toHaveLength(1);
		expect(starts[0]).toHaveBeenCalledWith(0);
	});
	it("an explicitly empty clip list schedules no source audio", async () => {
		const processor = new TestAudioProcessor();
		const prepared = await processor.prepare(
			"file:///tmp/source.mp4",
			[],
			[],
			[],
			[],
			undefined,
			undefined,
			[],
		);
		expect(prepared.slices).toEqual([]);
		expect(prepared.outputDurationMs).toBe(12000);
	});
});
