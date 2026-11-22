import { afterEach, describe, expect, it, vi } from "vitest";
import { ENCODE_BACKPRESSURE_LIMIT, resolveAudioTimestampOffsetUs } from "./audioProcessorShared";
import { AudioTranscodeProcessor } from "./audioTranscodeProcessor";

const audioConfig = { codec: "opus", sampleRate: 48_000, numberOfChannels: 2 };
const audioFrame = { close: vi.fn() } as unknown as AudioData;
const outputChunk = { timestamp: 0 } as EncodedAudioChunk;

class TestAudioProcessor extends AudioTranscodeProcessor {
	transcode = this.transcodeAudioStream;
}

class BufferedAudioDecoder {
	static isConfigSupported = async () => ({ supported: true });
	state: CodecState = "unconfigured";
	decodeQueueSize = 0;
	ondequeue: (() => void) | null = null;
	private receivedInput = false;

	constructor(protected readonly callbacks: AudioDecoderInit) {}

	configure() {
		this.state = "configured";
	}

	decode() {
		this.receivedInput = true;
		this.decodeQueueSize++;
		if (this.decodeQueueSize === 21) {
			setTimeout(() => {
				this.decodeQueueSize = 0;
				this.ondequeue?.();
			}, 0);
		}
	}

	async flush() {
		if (this.receivedInput) this.callbacks.output(audioFrame);
	}

	close() {
		this.state = "closed";
	}
}

class BurstAudioDecoder extends BufferedAudioDecoder {
	override async flush() {
		for (let frame = 0; frame <= ENCODE_BACKPRESSURE_LIMIT; frame++) {
			this.callbacks.output(audioFrame);
		}
	}
}

class BufferedAudioEncoder {
	static isConfigSupported = async () => ({ supported: true });
	state: CodecState = "unconfigured";
	encodeQueueSize = 0;
	ondequeue: (() => void) | null = null;
	private receivedInput = false;

	constructor(private readonly callbacks: AudioEncoderInit) {}

	configure() {
		this.state = "configured";
	}

	encode() {
		this.receivedInput = true;
		this.encodeQueueSize++;
		if (this.encodeQueueSize === ENCODE_BACKPRESSURE_LIMIT) {
			setTimeout(() => {
				this.encodeQueueSize = 0;
				this.ondequeue?.();
			}, 0);
		}
	}

	async flush() {
		if (this.receivedInput) this.callbacks.output(outputChunk);
		this.encodeQueueSize = 0;
	}

	close() {
		this.state = "closed";
	}
}

async function transcode(packetCount: number, decoder = BufferedAudioDecoder) {
	vi.stubGlobal("AudioDecoder", decoder);
	vi.stubGlobal("AudioEncoder", BufferedAudioEncoder);
	const addAudioChunk = vi.fn().mockResolvedValue(undefined);
	const stream = new ReadableStream<EncodedAudioChunk>({
		start(controller) {
			for (let packet = 0; packet < packetCount; packet++) {
				controller.enqueue({ timestamp: packet * 20_000 } as EncodedAudioChunk);
			}
			controller.close();
		},
	});
	const wroteAudio = await new TestAudioProcessor().transcode(stream, audioConfig, {
		addAudioChunk,
	} as never);
	return { wroteAudio, addAudioChunk };
}

describe("AudioTranscodeProcessor", () => {
	afterEach(() => vi.unstubAllGlobals());

	it("continues when the decode queue drains without output and flushes the encoder", async () => {
		const { wroteAudio, addAudioChunk } = await transcode(22);

		expect(wroteAudio).toBe(true);
		expect(addAudioChunk).toHaveBeenCalledExactlyOnceWith(outputChunk, undefined);
	}, 1500);

	it("continues when a full encode queue drains without emitting an audio packet", async () => {
		const { wroteAudio, addAudioChunk } = await transcode(1, BurstAudioDecoder);

		expect(wroteAudio).toBe(true);
		expect(addAudioChunk).toHaveBeenCalledExactlyOnceWith(outputChunk, undefined);
	}, 1500);

	it("reports when no audio packet reached the muxer", async () => {
		const { wroteAudio, addAudioChunk } = await transcode(0);

		expect(wroteAudio).toBe(false);
		expect(addAudioChunk).not.toHaveBeenCalled();
	});

	it("propagates a codec flush error before the muxer receives any audio", async () => {
		const flush = vi
			.spyOn(BufferedAudioEncoder.prototype, "flush")
			.mockRejectedValueOnce(new DOMException("Codec failed", "OperationError"));
		try {
			await expect(transcode(1)).rejects.toThrow("Codec failed");
		} finally {
			flush.mockRestore();
		}
	});

	it("preserves non-zero audio start timestamps instead of shifting to zero", async () => {
		class MockDemuxer {
			getDecoderConfig = vi.fn().mockResolvedValue({
				codec: "opus",
				sampleRate: 48_000,
				numberOfChannels: 2,
			});
			read = vi.fn().mockReturnValue(
				new ReadableStream<EncodedAudioChunk>({
					start(controller) {
						controller.enqueue({ timestamp: 2_000_000 } as EncodedAudioChunk);
						controller.close();
					},
				}),
			);
		}

		class TimestampRecordingDecoder extends BufferedAudioDecoder {
			override decode(chunk: EncodedAudioChunk) {
				super.decode();
				this.callbacks.output({
					timestamp: chunk.timestamp,
					close: vi.fn(),
				} as unknown as AudioData);
			}

			override async flush() {}
		}

		vi.stubGlobal("AudioDecoder", TimestampRecordingDecoder);
		vi.stubGlobal("AudioEncoder", BufferedAudioEncoder);

		class TestProcessorWithCloner extends AudioTranscodeProcessor {
			process = this.processTrimOnlyAudio;
			clonedTimestamps: number[] = [];
			protected override cloneWithTimestamp(src: AudioData, newTimestamp: number): AudioData {
				this.clonedTimestamps.push(newTimestamp);
				return src;
			}
		}

		const processor = new TestProcessorWithCloner();
		const demuxer = new MockDemuxer();
		const muxer = { addAudioChunk: vi.fn().mockResolvedValue(undefined) };

		await processor.process(demuxer as never, muxer as never, []);

		expect(processor.clonedTimestamps).toEqual([2_000_000]);
	});
});

describe("resolveAudioTimestampOffsetUs", () => {
	it("retains negative timestamps so priming offset shifts to zero", () => {
		expect(resolveAudioTimestampOffsetUs(-21_333)).toBe(-21_333);
	});

	it("normalizes small codec priming offsets under 45ms", () => {
		expect(resolveAudioTimestampOffsetUs(0)).toBe(0);
		expect(resolveAudioTimestampOffsetUs(21_333)).toBe(21_333);
		expect(resolveAudioTimestampOffsetUs(45_000)).toBe(45_000);
	});

	it("does not offset stream starts exceeding codec priming delay", () => {
		expect(resolveAudioTimestampOffsetUs(45_001)).toBe(0);
		expect(resolveAudioTimestampOffsetUs(500_000)).toBe(0);
		expect(resolveAudioTimestampOffsetUs(2_000_000)).toBe(0);
	});
});
