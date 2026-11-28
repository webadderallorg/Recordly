import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ForwardFrameSource } from "./forwardFrameSource";
import { getVideoDecoderConfig } from "./videoDecoderConfig";
import { loadVideoDemuxerMetadata } from "./videoDemuxerMetadata";

vi.mock("./videoDecoderConfig", () => ({ getVideoDecoderConfig: vi.fn() }));
vi.mock("./videoDemuxerMetadata", () => ({ loadVideoDemuxerMetadata: vi.fn() }));

function stubStalledReader() {
	const noReply = () => new Promise<void>(() => {});
	const cancel = vi.fn(noReply);
	const demuxer = {
		wasmWorker: new EventTarget(),
		read: vi.fn(() => new ReadableStream({ pull: noReply, cancel })),
		destroy: vi.fn(),
	};
	vi.mocked(loadVideoDemuxerMetadata).mockResolvedValue({
		demuxer,
		mediaInfo: { duration: 6, streams: [{ codec_type_string: "video", codec_string: "avc" }] },
	} as unknown as Awaited<ReturnType<typeof loadVideoDemuxerMetadata>>);
	return { demuxer, cancel };
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.stubGlobal(
		"VideoDecoder",
		class {
			state = "configured";
			configure() {}
			close() {
				this.state = "closed";
			}
		},
	);
	vi.mocked(getVideoDecoderConfig).mockResolvedValue({ codec: "avc1.42001e" });
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe("forward-only renderer media", () => {
	it("times out waiting for frame one and terminates a reader that won't acknowledge cancellation", async () => {
		const { demuxer, cancel } = stubStalledReader();
		const source = new ForwardFrameSource();
		await source.initialize("/tmp/webcam.mp4");
		const frame = expect(source.getFrameAtTime(0)).rejects.toMatchObject({
			name: "TimeoutError",
			message: "Timed out waiting for the first decoded frame",
		});
		await vi.advanceTimersByTimeAsync(8_000);
		await frame;
		source.destroy();
		expect(cancel).toHaveBeenCalledOnce();
		expect(demuxer.destroy).toHaveBeenCalledOnce();
		expect(vi.getTimerCount()).toBe(0);
	});

	it("leaves a pending frame wait immediately when the renderer cancels", async () => {
		const { demuxer } = stubStalledReader();
		const renderer = new AbortController();
		const source = new ForwardFrameSource(renderer.signal);
		await source.initialize("/tmp/wallpaper.mp4");
		const frame = expect(source.getFrameAtTime(0)).rejects.toMatchObject({
			name: "AbortError",
		});
		renderer.abort();
		await frame;
		source.destroy();
		expect(demuxer.destroy).toHaveBeenCalledOnce();
		expect(vi.getTimerCount()).toBe(0);
	});

	it("surfaces a worker crash during the frame wait without waiting for the timeout", async () => {
		const { demuxer } = stubStalledReader();
		const source = new ForwardFrameSource();
		await source.initialize("/tmp/wallpaper.mp4");
		const frame = expect(source.getFrameAtTime(0)).rejects.toThrow("VIDEO_READER_WORKER_ERROR");
		demuxer.wasmWorker.dispatchEvent(new Event("error"));
		await frame;
		source.destroy();
		expect(vi.getTimerCount()).toBe(0);
	});
});

describe("forward-only decode backpressure", () => {
	// A hardware decoder that accepts its whole queue later and needs 20 chunks before frame one.
	function stubBufferingDecoder({ dequeueEvents }: { dequeueEvents: boolean }) {
		vi.stubGlobal(
			"VideoDecoder",
			class {
				state = "configured";
				decodeQueueSize = 0;
				ondequeue: (() => void) | null = null;
				private accepted = 0;
				private readonly output: (frame: unknown) => void;
				constructor(init: { output: (frame: unknown) => void }) {
					this.output = init.output;
				}
				configure() {}
				decode() {
					this.decodeQueueSize++;
					setTimeout(() => {
						if (this.state !== "configured" || this.decodeQueueSize === 0) return;
						this.accepted += this.decodeQueueSize;
						this.decodeQueueSize = 0;
						if (dequeueEvents) this.ondequeue?.();
						if (this.accepted >= 20) this.output({ timestamp: 0, close() {} });
					}, 1);
				}
				flush() {
					return Promise.resolve();
				}
				close() {
					this.state = "closed";
				}
			},
		);
		vi.stubGlobal(
			"VideoFrame",
			class {
				constructor(readonly source: { timestamp: number }) {}
				close() {}
			},
		);
		let sent = 0;
		const demuxer = {
			wasmWorker: new EventTarget(),
			read: vi.fn(
				() =>
					new ReadableStream({
						pull(controller) {
							if (sent++ < 60) controller.enqueue({ byteLength: 1 });
							else controller.close();
						},
					}),
			),
			destroy: vi.fn(),
		};
		vi.mocked(loadVideoDemuxerMetadata).mockResolvedValue({
			demuxer,
			mediaInfo: {
				duration: 6,
				streams: [{ codec_type_string: "video", codec_string: "avc" }],
			},
		} as unknown as Awaited<ReturnType<typeof loadVideoDemuxerMetadata>>);
	}

	it.each([
		["dequeue events", true],
		["no dequeue events", false],
	])("keeps feeding a decoder that drains its queue before frame one (%s)", async (_, events) => {
		stubBufferingDecoder({ dequeueEvents: events });
		const source = new ForwardFrameSource();
		await source.initialize("/tmp/webcam.mp4");
		const frame = source.getFrameAtTime(0).then(
			() => "frame",
			() => "error",
		);
		// Well before the 8 s first-frame deadline that the old feed loop always hit.
		await vi.advanceTimersByTimeAsync(1_000);
		await expect(frame).resolves.toBe("frame");
		source.destroy();
		expect(vi.getTimerCount()).toBe(0);
	});
});
