import { afterEach, expect, it, vi } from "vitest";
import { AudioMediaProcessor } from "./audioMediaProcessor";
import { DECODE_BACKPRESSURE_LIMIT } from "./audioProcessorShared";

const packetCount = DECODE_BACKPRESSURE_LIMIT + 2;
const closeFrame = vi.fn();
const destroyDemuxer = vi.fn();

vi.mock("web-demuxer", () => ({
	WebDemuxer: class {
		async load() {}

		async getDecoderConfig() {
			return { codec: "opus", numberOfChannels: 1, sampleRate: 48_000 };
		}

		read() {
			return new ReadableStream({
				start(controller) {
					for (let index = 0; index < packetCount; index++) {
						controller.enqueue({ timestamp: index * 20_000 });
					}
					controller.close();
				},
			});
		}

		destroy() {
			destroyDemuxer();
		}
	},
}));

class TestAudioMediaProcessor extends AudioMediaProcessor {
	streamDecode = this.streamDecodeFromUrl;
}

class BufferedAudioDecoder {
	state: CodecState = "unconfigured";
	decodeQueueSize = 0;
	ondequeue: (() => void) | null = null;
	private receivedPackets = 0;

	constructor(private readonly callbacks: AudioDecoderInit) {}

	configure() {
		this.state = "configured";
	}

	decode() {
		this.receivedPackets++;
		this.decodeQueueSize++;
		if (this.decodeQueueSize === DECODE_BACKPRESSURE_LIMIT + 1) {
			setTimeout(() => {
				this.decodeQueueSize = 0;
				this.ondequeue?.();
			}, 0);
		}
	}

	async flush() {
		this.callbacks.output({
			numberOfFrames: this.receivedPackets,
			numberOfChannels: 1,
			format: "f32-planar",
			allocationSize: () => this.receivedPackets * Float32Array.BYTES_PER_ELEMENT,
			copyTo: (bytes: ArrayBuffer) => new Float32Array(bytes).fill(0.25),
			close: closeFrame,
		} as unknown as AudioData);
	}

	close() {
		this.state = "closed";
	}
}

afterEach(() => vi.unstubAllGlobals());

it("drains the source audio decoder when input capacity changes before output", async () => {
	vi.stubGlobal("window", { location: { href: "https://recordly.example/editor" } });
	vi.stubGlobal("AudioDecoder", BufferedAudioDecoder);
	vi.stubGlobal(
		"AudioBuffer",
		class {
			private readonly samples: Float32Array;

			constructor({ length }: AudioBufferOptions) {
				this.samples = new Float32Array(length);
			}

			getChannelData() {
				return this.samples;
			}
		},
	);

	const result = await new TestAudioMediaProcessor().streamDecode(
		"https://recordly.example/source.opus",
	);

	expect(result?.getChannelData(0)).toEqual(new Float32Array(packetCount).fill(0.25));
	expect(closeFrame).toHaveBeenCalledOnce();
	expect(destroyDemuxer).toHaveBeenCalledOnce();
}, 1500);
