import { afterEach, describe, expect, it, vi } from "vitest";
import { ForwardFrameSource } from "./forwardFrameSource";
import { StreamingVideoDecoder } from "./streamingDecoder";

vi.mock("web-demuxer", () => ({
	WebDemuxer: class {
		async load() {}
		destroy() {}
		async getDecoderConfig() {
			return { codec: "vp09", codedWidth: 1876, codedHeight: 954 };
		}
		async getMediaInfo() {
			return {
				duration: 1 / 60,
				streams: [
					{
						codec_type_string: "video",
						codec_string: "vp09",
						width: 1876,
						height: 954,
						avg_frame_rate: "60/1",
						profile: "unknown",
						pix_fmt: "",
						level: -99,
					},
				],
			};
		}
		async seekMediaPacket() {
			return { data: new Uint8Array([0x82, 0x49, 0x83, 0x42]) };
		}
		read() {
			return new ReadableStream({
				start(controller) {
					controller.enqueue({ type: "key", timestamp: 0 });
					controller.close();
				},
			});
		}
	},
}));

afterEach(() => vi.unstubAllGlobals());

describe("VP9 decoder configuration integration", () => {
	it.each([
		"streaming",
		"forward",
	])("recovers missing VP9 metadata before configuring the %s decoder", async (path) => {
		const configure = vi.fn();
		vi.stubGlobal("window", { location: { href: "http://localhost/" } });
		vi.stubGlobal(
			"VideoDecoder",
			class {
				state: CodecState = "unconfigured";
				decodeQueueSize = 0;
				constructor(private callbacks: VideoDecoderInit) {}
				configure(config: VideoDecoderConfig) {
					// Model Chromium rejecting the original ambiguous codec identifier.
					if (config.codec === "vp09")
						throw new DOMException(
							"Unknown or ambiguous codec name.",
							"NotSupportedError",
						);
					configure(config);
					this.state = "configured";
				}
				decode() {
					this.callbacks.output({ timestamp: 0, close() {} } as VideoFrame);
				}
				async flush() {}
				close() {
					this.state = "closed";
				}
			},
		);
		if (path === "streaming") {
			const decoder = new StreamingVideoDecoder();
			await decoder.loadMetadata("http://localhost/video.webm");
			const onFrame = vi.fn(async () => {});
			await decoder.decodeAll(60, undefined, undefined, onFrame);
			expect(onFrame).toHaveBeenCalledTimes(1);
			decoder.destroy();
		} else {
			const source = new ForwardFrameSource();
			await source.initialize("http://localhost/video.webm");
			source.destroy();
		}
		expect(configure).toHaveBeenCalledWith(expect.objectContaining({ codec: "vp09.00.41.08" }));
	});
});
