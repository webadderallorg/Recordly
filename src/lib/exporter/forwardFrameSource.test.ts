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
