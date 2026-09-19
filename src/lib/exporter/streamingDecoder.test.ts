import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	buildVideoDecodeFailure,
	getDecodedFrameStartupOffsetUs,
	getDecodedFrameTimelineOffsetUs,
	getVideoDecodeFailureCode,
	preserveFirstVideoDecodeFailure,
	StreamingVideoDecoder,
} from "./streamingDecoder";

describe("buildVideoDecodeFailure", () => {
	it("assigns stable failure codes for common WebCodecs errors", () => {
		expect(getVideoDecodeFailureCode(new DOMException("bad frame", "EncodingError"))).toBe(
			"VIDEO_DECODE_ENCODING_ERROR",
		);
		expect(getVideoDecodeFailureCode(new DOMException("busy", "QuotaExceededError"))).toBe(
			"VIDEO_DECODER_RESOURCE_EXHAUSTED",
		);
		expect(getVideoDecodeFailureCode(new Error("demux read failed"))).toBe(
			"VIDEO_DECODE_FAILED",
		);
	});

	it("reports the original decoder error with codec and chunk context", () => {
		const originalError = new DOMException("Failed to decode frame", "EncodingError");
		const chunk = {
			type: "delta",
			timestamp: 1_500_000,
			duration: 16_667,
			byteLength: 4,
		} as EncodedVideoChunk;

		const error = buildVideoDecodeFailure(originalError, {
			decoderConfig: {
				codec: "avc1.640034",
				codedWidth: 1920,
				codedHeight: 1080,
				hardwareAcceleration: "prefer-hardware",
			},
			sourceMetadata: {
				width: 1920,
				height: 1080,
				duration: 61.25,
				frameRate: 60,
				codec: "avc1.640034",
				hasAudio: true,
			},
			chunkIndex: 42,
			chunk,
			decoderState: "closed",
			decodeQueueSize: 7,
		});

		expect(error.message).toContain("EncodingError: Failed to decode frame");
		expect(error.message).toContain("[VIDEO_DECODE_ENCODING_ERROR]");
		expect(error.message).toContain("codec=avc1.640034");
		expect(error.message).toContain("codedSize=1920x1080");
		expect(error.message).toContain("chunkIndex=42");
		expect(error.message).toContain("chunkType=delta");
		expect(error.message).toContain("chunkTimestampUs=1500000");
		expect(error.message).toContain("sourceTimeSec=1.500");
		expect(error.message).toContain("chunkDurationUs=16667");
		expect(error.message).toContain("chunkBytes=4");
		expect(error.message).toContain("sourceFps=60");
		expect(error.message).toContain("sourceDurationSec=61.25");
		expect(error.message).toContain("decoderState=closed");
		expect(error.cause).toBe(originalError);
	});

	it("does not replace the original failure with a later closed-codec exception", () => {
		const originalFailure = new Error("VideoDecoder failure: EncodingError: bad frame");
		const result = preserveFirstVideoDecodeFailure(
			originalFailure,
			new DOMException("Cannot call 'decode' on a closed codec.", "InvalidStateError"),
			{
				decoderConfig: {
					codec: "avc1.640034",
					codedWidth: 1920,
					codedHeight: 1080,
				},
				decoderState: "closed",
			},
		);

		expect(result).toBe(originalFailure);
	});
});

const {
	mockDemuxerLoad,
	mockDemuxerGetMediaInfo,
	mockDemuxerDestroy,
	mockDemuxerGetDecoderConfig,
	mockDemuxerRead,
} = vi.hoisted(() => ({
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
	mockDemuxerRead: vi.fn(),
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

describe("StreamingVideoDecoder decode failures", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
		mockDemuxerLoad.mockResolvedValue(undefined);
		mockDemuxerGetDecoderConfig.mockResolvedValue({
			codec: "avc1.640034",
			codedWidth: 1920,
			codedHeight: 1080,
		});
		mockDemuxerRead.mockReturnValue(
			new ReadableStream({
				start(controller) {
					controller.enqueue({
						type: "key",
						timestamp: 0,
						duration: 33_333,
						byteLength: 4,
					});
					controller.close();
				},
			}),
		);
		Object.assign(globalThis, {
			window: {
				location: { href: "http://localhost:5173/" },
				electronAPI: {
					readLocalFile: mockReadLocalFile,
					getLocalMediaUrl: mockGetLocalMediaUrl,
				},
			},
		});
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("does not emit frozen remaining frames after a decoder error", async () => {
		const frame = { timestamp: 0, close: vi.fn() } as unknown as VideoFrame;
		class FailingVideoDecoder {
			state: CodecState = "unconfigured";
			decodeQueueSize = 0;
			constructor(
				private readonly callbacks: {
					output: (decodedFrame: VideoFrame) => void;
					error: (error: DOMException) => void;
				},
			) {}
			configure() {
				this.state = "configured";
			}
			decode() {
				this.callbacks.output(frame);
				this.callbacks.error(new DOMException("bad frame", "EncodingError"));
			}
			async flush() {}
			close() {
				this.state = "closed";
			}
		}
		vi.stubGlobal("VideoDecoder", FailingVideoDecoder);

		const decoder = new StreamingVideoDecoder();
		await decoder.loadMetadata("/tmp/failing.mp4");
		const onFrame = vi.fn(async () => {});

		await expect(decoder.decodeAll(30, undefined, undefined, onFrame)).rejects.toThrow(
			"[VIDEO_DECODE_ENCODING_ERROR]",
		);
		expect(onFrame).not.toHaveBeenCalled();
		expect(frame.close).toHaveBeenCalledTimes(1);
	});

	it.each([
		[false, 3, 0, 2400],
		[true, 3, 0, 2400],
		[false, 0.1, 5, 2405],
	])("emits real gap frames (reordered: %s, speed: %s)", async (reordered, speed, firstSource, secondSource) => {
		mockDemuxerRead.mockImplementation(
			() =>
				new ReadableStream({
					start(controller) {
						for (let i = 0; i < 120; i++)
							controller.enqueue({ timestamp: (i * 1_000_000) / 30 });
						controller.close();
					},
				}),
		);
		class TestDecoder {
			state = "unconfigured";
			decodeQueueSize = 0;
			constructor(private callbacks: { output: (frame: VideoFrame) => void }) {}
			configure() {
				this.state = "configured";
			}
			decode(chunk: EncodedVideoChunk) {
				this.callbacks.output({
					timestamp: chunk.timestamp,
					close: vi.fn(),
				} as unknown as VideoFrame);
			}
			async flush() {}
			close() {
				this.state = "closed";
			}
		}
		vi.stubGlobal("VideoDecoder", TestDecoder);
		const decoder = new StreamingVideoDecoder();
		await decoder.loadMetadata("/tmp/clip-timeline.mp4");
		const clips = [
			{
				id: "a",
				startMs: 0,
				endMs: 400,
				sourceStartMs: reordered ? secondSource : firstSource,
				speed,
			},
			{
				id: "b",
				startMs: 800,
				endMs: 1200,
				sourceStartMs: reordered ? firstSource : secondSource,
				speed,
			},
		];
		const frames: Array<{ gap: boolean; timestamp: number; source: number; decoded?: number }> =
			[];
		await decoder.decodeAll(
			30,
			undefined,
			undefined,
			async (frame, timestamp, source) => {
				frames.push({ gap: frame === null, timestamp, source, decoded: frame?.timestamp });
			},
			clips,
		);
		expect(frames).toHaveLength(36);
		expect(frames.filter((f) => f.gap)).toHaveLength(12);
		for (let i = 0; i < frames.length; i++) {
			expect(frames[i].timestamp).toBeCloseTo((i * 1_000_000) / 30, 5);
			expect(frames[i].gap).toBe(i >= 12 && i < 24);
		}
		expect(frames[24].source).toBeCloseTo(reordered ? firstSource : secondSource);
		expect(frames[0].decoded).toBeCloseTo(
			(Math.round(((reordered ? secondSource : firstSource) * 30) / 1000) * 1_000_000) / 30,
		);
		expect(decoder.getEffectiveDuration(undefined, undefined, clips)).toBe(1.2);
	});
});

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
