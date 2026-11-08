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
		// restoreAllMocks restores spies; standalone vi.fn call histories need clearing.
		vi.clearAllMocks();
		mockDemuxerLoad.mockResolvedValue(undefined);
		mockDemuxerGetDecoderConfig.mockResolvedValue({
			codec: "avc1.640034",
			codedWidth: 1920,
			codedHeight: 1080,
		});
		mockDemuxerRead.mockImplementation(
			() =>
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

	it("distinguishes the source metadata FPS from the decoder fallback without changing decoding defaults", async () => {
		const known = await new StreamingVideoDecoder().loadMetadata("http://localhost/known.mp4");
		expect(known).toMatchObject({ frameRate: 30, frameRateSource: "metadata" });
		const info = await mockDemuxerGetMediaInfo();
		mockDemuxerGetMediaInfo.mockResolvedValueOnce({
			...info,
			streams: info.streams.map((stream) => ({ ...stream, avg_frame_rate: "0/0" })),
		});
		const fallback = await new StreamingVideoDecoder().loadMetadata(
			"http://localhost/unknown.mp4",
		);
		expect(fallback).toMatchObject({ frameRate: 60, frameRateSource: "fallback" });
		const failure = buildVideoDecodeFailure(new Error("failed"), {
			decoderConfig: { codec: "avc1.640034" },
			sourceMetadata: fallback,
		});
		expect(failure.message).toContain("sourceFps=unknown; decodeFallbackFps=60");
	});

	it("does not emit frozen remaining frames after a decoder error", async () => {
		const frames: Array<{ timestamp: number; close: ReturnType<typeof vi.fn> }> = [];
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
				const frame = { timestamp: 0, close: vi.fn() };
				frames.push(frame);
				this.callbacks.output(frame as unknown as VideoFrame);
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

		const failure = await decoder
			.decodeAll(30, undefined, undefined, onFrame)
			.catch((error) => error);
		expect(failure).toBeInstanceOf(Error);
		expect(failure.message).toContain("[VIDEO_DECODE_RECOVERY_FAILED]");
		expect(failure.message).toContain("Initial decoder failure: [VIDEO_DECODE_ENCODING_ERROR]");
		expect(failure.message).toContain(
			"Software decoder failure: [VIDEO_DECODE_ENCODING_ERROR]",
		);
		expect(failure.message).toContain("hardwareAcceleration=prefer-software");
		expect(onFrame).not.toHaveBeenCalled();
		expect(frames).toHaveLength(2);
		expect(mockDemuxerRead).toHaveBeenCalledTimes(2);
		for (const frame of frames) expect(frame.close).toHaveBeenCalledTimes(1);
	});

	it("preserves both failures when the software retry ends before a later kept segment", async () => {
		const configs: VideoDecoderConfig[] = [];
		const closeFrame = vi.fn();
		class EarlyEndDecoder {
			state: CodecState = "unconfigured";
			decodeQueueSize = 0;
			software = false;
			constructor(
				private callbacks: {
					output: (frame: VideoFrame) => void;
					error: (error: DOMException) => void;
				},
			) {}
			configure(config: VideoDecoderConfig) {
				configs.push(config);
				this.software = config.hardwareAcceleration === "prefer-software";
				this.state = "configured";
			}
			decode(chunk: EncodedVideoChunk) {
				if (!this.software) {
					this.callbacks.error(new DOMException("original bad frame", "EncodingError"));
					return;
				}
				this.callbacks.output({
					timestamp: chunk.timestamp,
					close: closeFrame,
				} as unknown as VideoFrame);
			}
			async flush() {}
			close() {
				this.state = "closed";
			}
		}
		vi.stubGlobal("VideoDecoder", EarlyEndDecoder);
		const decoder = new StreamingVideoDecoder();
		await decoder.loadMetadata("/tmp/early-end.mp4");
		const failure = await decoder
			.decodeAll(30, [{ id: "cut", startMs: 1000, endMs: 3000 }], undefined, vi.fn())
			.catch((error) => error);
		expect(failure).toBeInstanceOf(Error);
		expect(failure.message).toContain("[VIDEO_DECODE_RECOVERY_FAILED]");
		expect(failure.message).toContain("original bad frame");
		expect(failure.message).toContain("Software decoder failure: [VIDEO_DECODE_FAILED]");
		expect(failure.message).toContain("Video decode ended early");
		expect(failure.message).toContain("chunkIndex=0");
		expect(failure.message).toContain("hardwareAcceleration=prefer-software");
		expect(configs).toHaveLength(2);
		expect(closeFrame).toHaveBeenCalledTimes(1);
		decoder.destroy();
	});

	it.each([
		"EncodingError",
		"QuotaExceededError",
	])("replays %s in software without duplicating exported frames", async (errorName) => {
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
		const configs: VideoDecoderConfig[] = [];
		const timestamps: number[] = [];
		let framesBeforeRetry = 0;
		const closedFrames: ReturnType<typeof vi.fn>[] = [];
		class RecoveringDecoder {
			state: CodecState = "unconfigured";
			decodeQueueSize = 0;
			software = false;
			constructor(
				private callbacks: {
					output: (frame: VideoFrame) => void;
					error: (error: DOMException) => void;
				},
			) {}
			configure(config: VideoDecoderConfig) {
				configs.push(config);
				this.software = config.hardwareAcceleration === "prefer-software";
				if (this.software) framesBeforeRetry = timestamps.length;
				this.state = "configured";
			}
			decode(chunk: EncodedVideoChunk) {
				if (!this.software && chunk.timestamp >= 500_000) {
					this.state = "closed";
					this.callbacks.error(new DOMException("driver decode failed", errorName));
					return;
				}
				const close = vi.fn();
				closedFrames.push(close);
				this.callbacks.output({
					timestamp: chunk.timestamp,
					close,
				} as unknown as VideoFrame);
			}
			async flush() {}
			close() {
				this.state = "closed";
			}
		}
		vi.stubGlobal("VideoDecoder", RecoveringDecoder);
		const decoder = new StreamingVideoDecoder();
		await decoder.loadMetadata("/tmp/driver-failure.mp4");
		await decoder.decodeAll(30, undefined, undefined, async (_frame, timestamp) => {
			timestamps.push(timestamp);
		});
		expect(configs).toHaveLength(2);
		expect(configs[1].hardwareAcceleration).toBe("prefer-software");
		expect(framesBeforeRetry).toBeGreaterThan(0);
		expect(timestamps).toHaveLength(120);
		for (let i = 0; i < timestamps.length; i++)
			expect(timestamps[i]).toBeCloseTo((i * 1_000_000) / 30);
		expect(mockDemuxerRead).toHaveBeenCalledTimes(2);
		for (const close of closedFrames) expect(close).toHaveBeenCalledTimes(1);
	});

	it.each([
		{
			codec: "av01.0.04M.08",
			errorName: "EncodingError",
			cancelled: false,
			setupFailure: false,
		},
		{ codec: "avc1.640034", errorName: "DataError", cancelled: false, setupFailure: false },
		{ codec: "avc1.640034", errorName: "EncodingError", cancelled: true, setupFailure: false },
		{ codec: "avc1.640034", errorName: "EncodingError", cancelled: false, setupFailure: true },
	])("does not retry $codec / $errorName (cancelled: $cancelled, setup: $setupFailure)", async ({
		codec,
		errorName,
		cancelled,
		setupFailure,
	}) => {
		const info = await mockDemuxerGetMediaInfo();
		mockDemuxerGetMediaInfo.mockResolvedValueOnce({
			...info,
			streams: info.streams.map((stream: Record<string, unknown>) => ({
				...stream,
				codec_string: codec,
			})),
		});
		const configure = vi.fn();
		const decoder = new StreamingVideoDecoder();
		class NonRetryDecoder {
			state: CodecState = "unconfigured";
			decodeQueueSize = 0;
			constructor(private callbacks: { error: (error: DOMException) => void }) {}
			configure() {
				configure();
				if (setupFailure) throw new DOMException("setup failed", errorName);
				this.state = "configured";
			}
			decode() {
				if (cancelled) decoder.cancel();
				this.state = "closed";
				this.callbacks.error(new DOMException("decode failed", errorName));
			}
			async flush() {}
			close() {
				this.state = "closed";
			}
		}
		vi.stubGlobal("VideoDecoder", NonRetryDecoder);
		await decoder.loadMetadata("/tmp/no-retry.mp4");
		await expect(decoder.decodeAll(30, undefined, undefined, vi.fn())).rejects.toThrow(
			setupFailure ? "setup failed" : "decode failed",
		);
		expect(configure).toHaveBeenCalledTimes(1);
		decoder.destroy();
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
	it.each([
		false,
		true,
	])("stops each short clip run before decoding the source tail (reordered: %s)", async (reordered) => {
		const info = await mockDemuxerGetMediaInfo();
		mockDemuxerGetMediaInfo.mockResolvedValueOnce({
			...info,
			duration: 100,
			streams: info.streams.map((stream) => ({ ...stream, duration: 100 })),
		});
		const readerCancelled = vi.fn();
		mockDemuxerRead.mockImplementation(() => {
			let index = 0;
			return new ReadableStream({
				pull(controller) {
					if (index < 3000) controller.enqueue({ timestamp: (index++ * 1_000_000) / 30 });
					else controller.close();
				},
				cancel: readerCancelled,
			});
		});
		let decoded = 0;
		const closes: ReturnType<typeof vi.fn>[] = [];
		class ClipDecoder {
			state = "unconfigured";
			decodeQueueSize = 0;
			constructor(private callbacks: { output: (frame: VideoFrame) => void }) {}
			configure() {
				this.state = "configured";
			}
			decode(chunk: EncodedVideoChunk) {
				decoded++;
				const close = vi.fn();
				closes.push(close);
				this.callbacks.output({
					timestamp: chunk.timestamp,
					close,
				} as unknown as VideoFrame);
			}
			async flush() {}
			close() {
				this.state = "closed";
			}
		}
		vi.stubGlobal("VideoDecoder", ClipDecoder);
		const decoder = new StreamingVideoDecoder({ maxPendingFrames: 1 });
		await decoder.loadMetadata("/tmp/long-source.mp4");
		const frames: { timestamp: number; source: number; decoded: number }[] = [];
		await decoder.decodeAll(
			30,
			undefined,
			undefined,
			async (frame, timestamp, source) => {
				frames.push({ timestamp, source, decoded: frame!.timestamp });
			},
			[
				{
					id: "one",
					startMs: 0,
					endMs: 400,
					sourceStartMs: reordered ? 2000 : 0,
					speed: 1,
				},
				{
					id: "two",
					startMs: 400,
					endMs: 800,
					sourceStartMs: reordered ? 0 : 2000,
					speed: 1,
				},
			],
		);
		expect(frames).toHaveLength(24);
		for (let index = 0; index < frames.length; index++) {
			const start = index < 12 !== reordered ? 0 : 2000;
			expect(frames[index].timestamp).toBeCloseTo((index * 1_000_000) / 30);
			expect(frames[index].source).toBeCloseTo(start + ((index % 12) * 1000) / 30);
			expect(frames[index].decoded).toBeCloseTo(frames[index].source * 1000);
		}
		expect(decoded).toBeLessThan(120);
		expect(readerCancelled).toHaveBeenCalledTimes(reordered ? 2 : 1);
		for (const close of closes) expect(close).toHaveBeenCalledTimes(1);
	});

	it.each([
		false,
		true,
	])("wakes cancellation while waiting for %s (false: demux read, true: decoder backpressure)", async (backpressure) => {
		let readStarted!: () => void;
		const started = new Promise<void>((resolve) => {
			readStarted = resolve;
		});
		const readerCancelled = vi.fn();
		mockDemuxerRead.mockImplementation(
			() =>
				new ReadableStream({
					start(controller) {
						if (backpressure) {
							for (let i = 0; i < 100; i++)
								controller.enqueue({ timestamp: i * 33_333 });
						}
						readStarted();
					},
					cancel: readerCancelled,
				}),
		);
		const closed = vi.fn();
		class WaitingDecoder {
			state = "unconfigured";
			decodeQueueSize = 0;
			configure() {
				this.state = "configured";
			}
			decode() {
				this.decodeQueueSize++;
			}
			async flush() {}
			close() {
				this.state = "closed";
				closed();
			}
		}
		vi.stubGlobal("VideoDecoder", WaitingDecoder);
		const decoder = new StreamingVideoDecoder({ maxDecodeQueue: 1 });
		await decoder.loadMetadata("/tmp/stalled.mp4");
		const onFrame = vi.fn();
		const completion = decoder.decodeAll(30, undefined, undefined, onFrame);
		await started;
		// Let the producer reach its queue wait and the consumer await a frame.
		for (let i = 0; i < 10; i++) await Promise.resolve();
		decoder.cancel();
		await completion;
		expect(readerCancelled).toHaveBeenCalledTimes(1);
		expect(closed).toHaveBeenCalledTimes(1);
		expect(onFrame).not.toHaveBeenCalled();
	});

	it("retains a frame during an async consumer and closes late output after cancellation", async () => {
		mockDemuxerRead.mockImplementation(
			() =>
				new ReadableStream({
					start(controller) {
						for (let i = 0; i < 20; i++) controller.enqueue({ timestamp: i * 33_333 });
					},
				}),
		);
		let emitLate!: (frame: VideoFrame) => void;
		const closes: ReturnType<typeof vi.fn>[] = [];
		class AsyncDecoder {
			state = "unconfigured";
			decodeQueueSize = 0;
			constructor(private callbacks: { output: (frame: VideoFrame) => void }) {
				emitLate = callbacks.output;
			}
			configure() {
				this.state = "configured";
			}
			decode(chunk: EncodedVideoChunk) {
				const close = vi.fn();
				closes.push(close);
				this.callbacks.output({
					timestamp: chunk.timestamp,
					close,
				} as unknown as VideoFrame);
			}
			async flush() {}
			close() {
				this.state = "closed";
			}
		}
		vi.stubGlobal("VideoDecoder", AsyncDecoder);
		const decoder = new StreamingVideoDecoder({ maxPendingFrames: 1 });
		await decoder.loadMetadata("/tmp/async.mp4");
		let consumerStarted!: () => void;
		let finishConsumer!: () => void;
		const started = new Promise<void>((resolve) => {
			consumerStarted = resolve;
		});
		const consumer = new Promise<void>((resolve) => {
			finishConsumer = resolve;
		});
		let held!: VideoFrame;
		const completion = decoder.decodeAll(30, undefined, undefined, async (frame) => {
			held = frame!;
			consumerStarted();
			await consumer;
			expect(held.close).not.toHaveBeenCalled();
		});
		await started;
		decoder.cancel();
		expect(held.close).not.toHaveBeenCalled();
		const lateClose = vi.fn();
		emitLate({ timestamp: 900_000, close: lateClose } as unknown as VideoFrame);
		expect(lateClose).toHaveBeenCalledTimes(1);
		finishConsumer();
		await completion;
		for (const close of closes) expect(close).toHaveBeenCalledTimes(1);
	});

	it("cleans up consumer failure without replaying it as a decoder failure", async () => {
		mockDemuxerRead.mockImplementation(
			() =>
				new ReadableStream({
					start(controller) {
						for (let i = 0; i < 100; i++) controller.enqueue({ timestamp: i * 33_333 });
					},
				}),
		);
		const closes: ReturnType<typeof vi.fn>[] = [];
		const closed = vi.fn();
		class ConsumerDecoder {
			state = "unconfigured";
			decodeQueueSize = 0;
			constructor(private callbacks: { output: (frame: VideoFrame) => void }) {}
			configure() {
				this.state = "configured";
			}
			decode(chunk: EncodedVideoChunk) {
				const close = vi.fn();
				closes.push(close);
				this.callbacks.output({
					timestamp: chunk.timestamp,
					close,
				} as unknown as VideoFrame);
			}
			async flush() {}
			close() {
				this.state = "closed";
				closed();
			}
		}
		vi.stubGlobal("VideoDecoder", ConsumerDecoder);
		const decoder = new StreamingVideoDecoder({ maxPendingFrames: 1 });
		await decoder.loadMetadata("/tmp/consumer-failure.mp4");
		const failure = new Error("[VIDEO_DECODE_ENCODING_ERROR] consumer failed");
		await expect(
			decoder.decodeAll(30, undefined, undefined, async () => {
				throw failure;
			}),
		).rejects.toBe(failure);
		expect(mockDemuxerRead).toHaveBeenCalledTimes(1);
		expect(closed).toHaveBeenCalledTimes(1);
		for (const close of closes) expect(close).toHaveBeenCalledTimes(1);
	});

	it.each([
		0, 5,
	])("seeks a sample window without losing source PTS (media start %s)", async (mediaStart) => {
		const info = await mockDemuxerGetMediaInfo();
		mockDemuxerGetMediaInfo.mockResolvedValueOnce({
			...info,
			start_time: mediaStart,
			streams: info.streams.map((stream) => ({ ...stream, start_time: mediaStart })),
		});
		mockDemuxerRead.mockImplementation(
			(_type, start, end) =>
				new ReadableStream({
					start(controller) {
						// Model a backward keyframe seek; do not include the recording prefix.
						for (
							let i = Math.floor((start * 30) / 15) * 15;
							i <= Math.ceil(end * 30);
							i++
						) {
							controller.enqueue({ timestamp: Math.round((i * 1_000_000) / 30) });
						}
						controller.close();
					},
				}),
		);
		class SampleDecoder {
			state = "unconfigured";
			decodeQueueSize = 0;
			constructor(private callbacks: { output: (frame: VideoFrame) => void }) {}
			configure() {
				this.state = "configured";
			}
			decode(chunk: EncodedVideoChunk) {
				this.callbacks.output({ timestamp: chunk.timestamp, close() {} } as VideoFrame);
			}
			async flush() {}
			close() {
				this.state = "closed";
			}
		}
		vi.stubGlobal("VideoDecoder", SampleDecoder);
		const decoder = new StreamingVideoDecoder();
		await decoder.loadMetadata("/tmp/long.mp4");
		const frames: Array<{ timestamp: number; source: number; decoded: number | undefined }> =
			[];
		await decoder.decodeSampleWindow(
			30,
			undefined,
			undefined,
			async (frame, timestamp, source) => {
				frames.push({ timestamp, source, decoded: frame?.timestamp });
			},
			undefined,
			45,
			30,
		);
		expect(frames).toHaveLength(30);
		for (let i = 0; i < frames.length; i++) {
			expect(frames[i].timestamp).toBeCloseTo(((45 + i) * 1_000_000) / 30);
			expect(frames[i].source).toBeCloseTo(((45 + i) * 1000) / 30);
			expect(frames[i].decoded).toBeCloseTo(
				Math.round((mediaStart + (45 + i) / 30) * 1_000_000),
			);
		}
		expect(mockDemuxerRead.mock.calls.at(-1)?.[1]).toBeCloseTo(mediaStart + 1.5 - 1 / 30);
	});

	it("samples reordered clips and gaps with original timeline/source timestamps", async () => {
		mockDemuxerRead.mockImplementation(
			(_type, start, end) =>
				new ReadableStream({
					start(controller) {
						for (let i = Math.floor(start * 30); i <= Math.ceil(end * 30); i++)
							controller.enqueue({ timestamp: Math.round((i * 1_000_000) / 30) });
						controller.close();
					},
				}),
		);
		class SampleDecoder {
			state = "unconfigured";
			decodeQueueSize = 0;
			constructor(private callbacks: { output: (frame: VideoFrame) => void }) {}
			configure() {
				this.state = "configured";
			}
			decode(chunk: EncodedVideoChunk) {
				this.callbacks.output({ timestamp: chunk.timestamp, close() {} } as VideoFrame);
			}
			async flush() {}
			close() {
				this.state = "closed";
			}
		}
		vi.stubGlobal("VideoDecoder", SampleDecoder);
		const decoder = new StreamingVideoDecoder();
		await decoder.loadMetadata("/tmp/reordered.mp4");
		const frames: Array<{ gap: boolean; timestamp: number; source: number }> = [];
		await decoder.decodeSampleWindow(
			30,
			undefined,
			undefined,
			async (frame, timestamp, source) => {
				frames.push({ gap: frame === null, timestamp, source });
			},
			[
				{ id: "late", startMs: 0, endMs: 1800, sourceStartMs: 2000, speed: 0.5 },
				{ id: "early", startMs: 2400, endMs: 3600, sourceStartMs: 0, speed: 2 },
			],
			45,
			30,
		);
		expect(frames).toHaveLength(30);
		expect(frames.map((frame) => frame.gap)).toEqual([
			...Array(9).fill(false),
			...Array(18).fill(true),
			...Array(3).fill(false),
		]);
		expect(frames[0].source).toBeCloseTo(2750);
		expect(frames[27].source).toBeCloseTo(0);
		for (let i = 0; i < frames.length; i++)
			expect(frames[i].timestamp).toBeCloseTo(((45 + i) * 1_000_000) / 30);
	});
	it.each([
		false,
		true,
	])("matches full decoding for final 24fps source samples at 60fps (truncated tail: %s)", async (truncated) => {
		const info = await mockDemuxerGetMediaInfo();
		mockDemuxerGetMediaInfo.mockResolvedValueOnce({
			...info,
			duration: 1,
			streams: info.streams.map((stream) => ({
				...stream,
				duration: 1,
				avg_frame_rate: "24/1",
			})),
		});
		mockDemuxerRead.mockImplementation(
			(_type, start) =>
				new ReadableStream({
					start(controller) {
						// Seek backwards to a nearby keyframe, without inventing a frame at EOF.
						for (
							let index = Math.floor((start * 24) / 12) * 12;
							index < (truncated ? 23 : 24);
							index++
						) {
							controller.enqueue({ timestamp: Math.round((index * 1_000_000) / 24) });
						}
						controller.close();
					},
				}),
		);
		class SampleDecoder {
			state = "unconfigured";
			decodeQueueSize = 0;
			constructor(private callbacks: { output: (frame: VideoFrame) => void }) {}
			configure() {
				this.state = "configured";
			}
			decode(chunk: EncodedVideoChunk) {
				this.callbacks.output({ timestamp: chunk.timestamp, close() {} } as VideoFrame);
			}
			async flush() {}
			close() {
				this.state = "closed";
			}
		}
		vi.stubGlobal("VideoDecoder", SampleDecoder);
		const decoder = new StreamingVideoDecoder();
		await decoder.loadMetadata("/tmp/last-source-frame.mp4");
		const complete: number[] = [];
		await decoder.decodeAll(60, undefined, undefined, async (frame) => {
			complete.push(frame!.timestamp);
		});
		const sample: number[] = [];
		const sampling = decoder.decodeSampleWindow(
			60,
			undefined,
			undefined,
			async (frame) => {
				sample.push(frame!.timestamp);
			},
			undefined,
			59,
			1,
		);
		if (truncated) {
			// Do not conceal a missing tail longer than the eligible one-frame pre-roll.
			await expect(sampling).rejects.toThrow("Missing decoded sample frame");
		} else {
			await expect(sampling).resolves.toBeUndefined();
			expect(sample).toEqual(complete.slice(59, 60));
			expect(sample).toEqual([958333]);
			const beyondDuration: number[] = [];
			await decoder.decodeSampleWindow(
				60,
				undefined,
				undefined,
				async (frame) => {
					beyondDuration.push(frame!.timestamp);
				},
				undefined,
				60,
				1,
			);
			expect(beyondDuration).toEqual([]);
		}
	});
	it("matches full decoding at a low-FPS sample boundary without decoding the remaining clip", async () => {
		const info = await mockDemuxerGetMediaInfo();
		mockDemuxerGetMediaInfo.mockResolvedValueOnce({
			...info,
			duration: 120,
			streams: info.streams.map((stream) => ({
				...stream,
				duration: 120,
				avg_frame_rate: "1/1",
			})),
		});
		const readerCancelled = vi.fn();
		mockDemuxerRead.mockImplementation(() => {
			let index = 0;
			return new ReadableStream({
				pull(controller) {
					if (index < 120) controller.enqueue({ timestamp: index++ * 1_000_000 });
					else controller.close();
				},
				cancel: readerCancelled,
			});
		});
		let chunksDecoded = 0;
		class SampleDecoder {
			state = "unconfigured";
			decodeQueueSize = 0;
			constructor(private callbacks: { output: (frame: VideoFrame) => void }) {}
			configure() {
				this.state = "configured";
			}
			decode(chunk: EncodedVideoChunk) {
				chunksDecoded++;
				this.callbacks.output({ timestamp: chunk.timestamp, close() {} } as VideoFrame);
			}
			async flush() {}
			close() {
				this.state = "closed";
			}
		}
		vi.stubGlobal("VideoDecoder", SampleDecoder);
		const decoder = new StreamingVideoDecoder();
		await decoder.loadMetadata("/tmp/sparse.mp4");
		const complete: number[] = [];
		await decoder.decodeAll(3, undefined, undefined, async (frame) => {
			complete.push(frame!.timestamp);
		});
		chunksDecoded = 0;
		const sample: number[] = [];
		await decoder.decodeSampleWindow(
			3,
			undefined,
			undefined,
			async (frame) => {
				sample.push(frame!.timestamp);
			},
			undefined,
			2,
			1,
		);
		expect(sample).toEqual(complete.slice(2, 3));
		expect(sample).toEqual([1_000_000]);
		expect(chunksDecoded).toBeLessThan(40);
		expect(readerCancelled).toHaveBeenCalled();
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
			"http://127.0.0.1:4321/video?path=%2Ftmp%2Fcapture.mp4",
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
