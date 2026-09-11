import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	getDecodedFrameStartupOffsetUs,
	getDecodedFrameTimelineOffsetUs,
	getHeldFreezeFrameMs,
	StreamingVideoDecoder,
	splitDecodeSegmentsAtFreezeFrames,
} from "./streamingDecoder";

const {
	mockDemuxerLoad,
	mockDemuxerGetMediaInfo,
	mockDemuxerDestroy,
	mockDemuxerGetDecoderConfig,
	mockDemuxerRead,
} = vi.hoisted(() => ({
	mockDemuxerRead: vi.fn(),
	mockDemuxerLoad: vi.fn(),
	mockDemuxerGetMediaInfo: vi.fn(async () => ({
		duration: 4,
		start_time: 0,
		streams: [
			{
				codec_type_string: "video",
				width: 1920,
				height: 1080,
				avg_frame_rate: "30/1",
				codec_string: "avc1.640034",
				start_time: 0,
				duration: 4,
			},
		],
	})),
	mockDemuxerDestroy: vi.fn(),
	mockDemuxerGetDecoderConfig: vi.fn(),
}));

vi.mock("web-demuxer", () => ({
	WebDemuxer: class MockWebDemuxer {
		load = mockDemuxerLoad;
		getMediaInfo = mockDemuxerGetMediaInfo;
		destroy = mockDemuxerDestroy;
		getDecoderConfig = mockDemuxerGetDecoderConfig;
		read = mockDemuxerRead;
	},
}));

const mockReadLocalFile = vi.fn();
const mockGetLocalMediaUrl = vi.fn(async (filePath: string) => ({
	success: true,
	url: `http://127.0.0.1:4321/video?path=${encodeURIComponent(filePath)}`,
}));

describe("StreamingVideoDecoder local media loading", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
		mockDemuxerLoad.mockReset();
		mockDemuxerGetMediaInfo.mockClear();
		mockDemuxerDestroy.mockClear();
		mockDemuxerGetDecoderConfig.mockClear();
		mockReadLocalFile.mockReset();
		mockGetLocalMediaUrl.mockReset();
		mockGetLocalMediaUrl.mockImplementation(async (filePath: string) => ({
			success: true,
			url: `http://127.0.0.1:4321/video?path=${encodeURIComponent(filePath)}`,
		}));
		Object.assign(globalThis, {
			window: {
				location: {
					href: "http://localhost:5173/",
				},
				electronAPI: {
					readLocalFile: mockReadLocalFile,
					getLocalMediaUrl: mockGetLocalMediaUrl,
				},
			},
		});
	});

	it("loads loopback media-server URLs directly into WebDemuxer", async () => {
		const decoder = new StreamingVideoDecoder();
		await decoder.loadMetadata("http://127.0.0.1:43123/video?path=%2Ftmp%2Fcapture.mp4");

		expect(window.electronAPI.readLocalFile).not.toHaveBeenCalled();
		expect(mockDemuxerLoad).toHaveBeenCalledWith(
			"http://127.0.0.1:43123/video?path=%2Ftmp%2Fcapture.mp4",
		);
	});

	it("resolves absolute local paths to range-streamed media URLs", async () => {
		const decoder = new StreamingVideoDecoder();
		await decoder.loadMetadata("/tmp/capture.mp4");

		expect(window.electronAPI.getLocalMediaUrl).toHaveBeenCalledWith("/tmp/capture.mp4");
		expect(mockDemuxerLoad).toHaveBeenCalledWith(
			"http://127.0.0.1:4321/video?path=%2Ftmp%2Fcapture.mp4",
		);
	});

	it("retries the range-streamed URL when direct local loading fails", async () => {
		mockDemuxerLoad.mockReset();
		mockDemuxerLoad
			.mockRejectedValueOnce(new Error("get_media_info failed: Failed after 3 attempts"))
			.mockResolvedValueOnce(undefined);
		const decoder = new StreamingVideoDecoder();
		await decoder.loadMetadata("/tmp/fallback.mp4");

		expect(mockDemuxerLoad).toHaveBeenNthCalledWith(
			2,
			"http://127.0.0.1:4321/video?path=%2Ftmp%2Ffallback.mp4",
		);
		expect(window.electronAPI.readLocalFile).not.toHaveBeenCalled();
	});

	it("keeps an explicit local retry on the range-streamed URL", async () => {
		const decoder = new StreamingVideoDecoder();
		await decoder.loadMetadata("/tmp/retry.mp4", {
			useFallbackMediaSource: true,
		});

		expect(mockDemuxerLoad).toHaveBeenCalledWith(
			"http://127.0.0.1:4321/video?path=%2Ftmp%2Fretry.mp4",
		);
		expect(window.electronAPI.readLocalFile).not.toHaveBeenCalled();
	});
});

describe("getDecodedFrameStartupOffsetUs", () => {
	it("ignores positive stream start metadata when the first decoded frame matches it", () => {
		expect(
			getDecodedFrameStartupOffsetUs(4_978_000, {
				streamStartTime: 4.978,
			}),
		).toBe(0);
	});

	it("returns only the startup gap beyond the stream start timestamp", () => {
		expect(
			getDecodedFrameStartupOffsetUs(5_128_000, {
				streamStartTime: 4.978,
			}),
		).toBe(150_000);
	});

	it("falls back to media start time and then zero when stream metadata is missing", () => {
		expect(
			getDecodedFrameStartupOffsetUs(250_000, {
				mediaStartTime: 0.1,
			}),
		).toBe(150_000);

		expect(getDecodedFrameStartupOffsetUs(250_000, {})).toBe(250_000);
	});
});

describe("getDecodedFrameTimelineOffsetUs", () => {
	it("preserves a non-zero stream start time when decoded timestamps match the stream start", () => {
		expect(
			getDecodedFrameTimelineOffsetUs(6_741_667, {
				mediaStartTime: 0,
				streamStartTime: 6.741667,
			}),
		).toBe(6_741_667);
	});

	it("includes both the stream start offset and any startup gap beyond it", () => {
		expect(
			getDecodedFrameTimelineOffsetUs(5_128_000, {
				mediaStartTime: 0,
				streamStartTime: 4.978,
			}),
		).toBe(5_128_000);
	});

	it("falls back to a media-relative startup gap when stream metadata is missing", () => {
		expect(
			getDecodedFrameTimelineOffsetUs(250_000, {
				mediaStartTime: 0.1,
			}),
		).toBe(150_000);
	});
});

describe("splitDecodeSegmentsAtFreezeFrames", () => {
	it("splits a segment at a freeze frame and holds the frame that starts the second part", () => {
		expect(
			splitDecodeSegmentsAtFreezeFrames(
				[{ startSec: 0, endSec: 4, speed: 1 }],
				[{ id: "freeze-1", sourceMs: 1_000, durationMs: 500 }],
				30,
			),
		).toEqual([
			{ startSec: 0, endSec: 1, speed: 1, holdFrameCount: 0 },
			{ startSec: 1, endSec: 4, speed: 1, holdFrameCount: 15 },
		]);
	});

	it("holds on a segment boundary and keeps each segment's speed", () => {
		expect(
			splitDecodeSegmentsAtFreezeFrames(
				[
					{ startSec: 0, endSec: 1, speed: 1 },
					{ startSec: 1, endSec: 3, speed: 2 },
				],
				[{ id: "freeze-1", sourceMs: 1_000, durationMs: 1_000 }],
				60,
			),
		).toEqual([
			{ startSec: 0, endSec: 1, speed: 1, holdFrameCount: 0 },
			{ startSec: 1, endSec: 3, speed: 2, holdFrameCount: 60 },
		]);
	});

	it("ignores freeze frames inside trimmed footage", () => {
		const segments = [
			{ startSec: 0, endSec: 1, speed: 1 },
			{ startSec: 2, endSec: 4, speed: 1 },
		];
		const freezeRegions = [
			{ id: "freeze-trimmed", sourceMs: 1_500, durationMs: 500 },
			{ id: "freeze-kept", sourceMs: 2_000, durationMs: 100 },
		];

		expect(splitDecodeSegmentsAtFreezeFrames(segments, freezeRegions, 30)).toEqual([
			{ startSec: 0, endSec: 1, speed: 1, holdFrameCount: 0 },
			{ startSec: 2, endSec: 4, speed: 1, holdFrameCount: 3 },
		]);
		expect(getHeldFreezeFrameMs(segments, freezeRegions)).toBe(100);
	});
});

describe("StreamingVideoDecoder freeze frames", () => {
	const frameRate = 30;
	const freezeRegion = { id: "freeze-1", sourceMs: 500, durationMs: 200 };
	const createdFrames: Array<{ timestamp: number; close: ReturnType<typeof vi.fn> }> = [];

	class FakeVideoDecoder {
		state = "unconfigured";
		decodeQueueSize = 0;
		private readonly output: (frame: unknown) => void;

		constructor(init: { output: (frame: unknown) => void }) {
			this.output = init.output;
		}

		configure() {
			this.state = "configured";
		}

		decode(chunk: { timestamp: number }) {
			const frame = { timestamp: chunk.timestamp, close: vi.fn() };
			createdFrames.push(frame);
			this.output(frame);
		}

		async flush() {}

		close() {
			this.state = "closed";
		}
	}

	beforeEach(() => {
		createdFrames.length = 0;
		mockDemuxerLoad.mockReset();
		mockDemuxerGetMediaInfo.mockResolvedValueOnce({
			duration: 1,
			start_time: 0,
			streams: [
				{
					codec_type_string: "video",
					width: 640,
					height: 360,
					avg_frame_rate: "30/1",
					codec_string: "avc1.640034",
					start_time: 0,
					duration: 1,
				},
			],
		});
		mockDemuxerGetDecoderConfig.mockResolvedValue({ codec: "avc1.640034" });
		mockDemuxerRead.mockImplementation(() => {
			let chunkIndex = 0;
			return new ReadableStream<{ timestamp: number }>({
				pull(controller) {
					if (chunkIndex >= frameRate) {
						controller.close();
						return;
					}
					controller.enqueue({
						timestamp: Math.round((chunkIndex * 1_000_000) / frameRate),
					});
					chunkIndex++;
				},
			});
		});
		vi.stubGlobal("VideoDecoder", FakeVideoDecoder);
		vi.stubGlobal("window", { location: { href: "http://localhost:5173/" } });
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("repeats the held frame for the hold duration before playback continues", async () => {
		const decoder = new StreamingVideoDecoder();
		await decoder.loadMetadata("http://127.0.0.1:43123/video?path=%2Ftmp%2Ffreeze.mp4");
		const emitted: Array<{
			frame: unknown;
			exportTimestampUs: number;
			sourceTimestampMs: number;
		}> = [];

		await decoder.decodeAll(
			frameRate,
			[],
			[],
			async (frame, exportTimestampUs, sourceTimestampMs) => {
				emitted.push({ frame, exportTimestampUs, sourceTimestampMs });
			},
			[freezeRegion],
		);

		// 30 playback frames plus a 200ms hold at 30fps.
		expect(emitted).toHaveLength(36);
		const heldIndexes = emitted
			.map(({ sourceTimestampMs }, index) => (sourceTimestampMs === 500 ? index : -1))
			.filter((index) => index >= 0);
		expect(heldIndexes).toHaveLength(7);
		expect(heldIndexes[heldIndexes.length - 1] - heldIndexes[0]).toBe(6);
		expect(new Set(heldIndexes.map((index) => emitted[index].frame)).size).toBe(1);
		emitted.forEach(({ exportTimestampUs }, index) => {
			expect(exportTimestampUs).toBeCloseTo((index * 1_000_000) / frameRate, 3);
		});
		expect(createdFrames.every((frame) => frame.close.mock.calls.length > 0)).toBe(true);
		expect(decoder.getEffectiveDuration([], [], [freezeRegion])).toBeCloseTo(1.2, 5);
	});
});
