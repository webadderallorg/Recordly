import { describe, expect, it, vi } from "vitest";
import type { AudioRegion } from "@/components/video-editor/types";
import { OfflineAudioProcessor } from "./offlineAudioProcessor";

const buffer = { duration: 12, numberOfChannels: 2 } as AudioBuffer;
class TestAudioProcessor extends OfflineAudioProcessor {
	prepare = this.prepareOfflineRender.bind(this);
	schedule = this.scheduleBufferThroughTimeline.bind(this);
	scheduleOverlay = this.scheduleRegionForChunk.bind(this);
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
	return {
		starts,
		ctx: {
			destination: {},
			createGain: () => ({ gain: { value: 1 }, connect: vi.fn() }),
			createBufferSource: () => {
				const start = vi.fn();
				starts.push(start);
				return { playbackRate: { value: 1 }, connect: vi.fn(), start };
			},
		} as unknown as OfflineAudioContext,
	};
}

describe("clip audio timeline", () => {
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
