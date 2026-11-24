import { EncodedVideoPacketSource } from "mediabunny";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type MuxerTargetMode, VideoMuxer } from "./muxer";
import type { ExportConfig } from "./types";

vi.mock("mediabunny", () => {
	class FakeBufferTarget {
		onwrite: ((start: number, end: number) => unknown) | null = null;
		buffer: ArrayBuffer | null = null;
	}
	class FakeStreamTarget {
		onwrite: ((start: number, end: number) => unknown) | null = null;
		readonly writable: WritableStream<{
			type: "write";
			data: Uint8Array;
			position: number;
		}>;
		constructor(
			writable: WritableStream<{ type: "write"; data: Uint8Array; position: number }>,
		) {
			this.writable = writable;
		}
	}

	const addedVideoTracks: unknown[] = [];
	const addedAudioTracks: unknown[] = [];
	const startedOutputs: unknown[] = [];

	class FakeOutput {
		readonly target: FakeBufferTarget | FakeStreamTarget;
		constructor(options: {
			format: unknown;
			target: FakeBufferTarget | FakeStreamTarget;
		}) {
			this.target = options.target;
		}
		addVideoTrack(source: unknown, opts: unknown) {
			addedVideoTracks.push({ source, opts });
		}
		addAudioTrack(source: unknown) {
			addedAudioTracks.push(source);
		}
		async start() {
			startedOutputs.push(this);
		}
		async finalize() {
			if (this.target instanceof FakeBufferTarget) {
				this.target.buffer = new ArrayBuffer(4);
				return;
			}
			const writer = (this.target as FakeStreamTarget).writable.getWriter();
			await writer.write({
				type: "write",
				data: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]),
				position: 0,
			});
			await writer.close();
		}
	}

	class FakeMp4OutputFormat {
		constructor(public options: unknown) {}
	}

	class FakeEncodedVideoPacketSource {
		constructor(public codec: string) {}
		async add() {}
	}

	class FakeEncodedAudioPacketSource {
		constructor(public codec: string) {}
		async add() {}
	}

	const EncodedPacket = {
		fromEncodedChunk: (chunk: unknown) => ({ chunk }),
	};

	return {
		BufferTarget: FakeBufferTarget,
		StreamTarget: FakeStreamTarget,
		Output: FakeOutput,
		Mp4OutputFormat: FakeMp4OutputFormat,
		EncodedVideoPacketSource: FakeEncodedVideoPacketSource,
		EncodedAudioPacketSource: FakeEncodedAudioPacketSource,
		EncodedPacket,
	};
});

const baseConfig: ExportConfig = {
	width: 1920,
	height: 1080,
	frameRate: 30,
	bitrate: 10_000_000,
};

describe("VideoMuxer target selection", () => {
	const originalWindow = globalThis.window;

	afterEach(() => {
		// biome-ignore lint/suspicious/noExplicitAny: restoring the test globals.
		(globalThis as any).window = originalWindow;
	});

	it("writes the canvas transfer while preserving the encoder’s matrix and range", async () => {
		const addPacket = vi.spyOn(EncodedVideoPacketSource.prototype, "add");
		try {
			const muxer = new VideoMuxer(baseConfig, false, "buffer");
			await muxer.initialize();
			await muxer.addVideoChunk({} as EncodedVideoChunk, {
				decoderConfig: {
					codec: "avc1.640033",
					colorSpace: {
						primaries: "smpte170m",
						matrix: "smpte170m",
						transfer: "bt709",
						fullRange: true,
					},
				},
			});
			expect(addPacket.mock.calls[0]?.[1]?.decoderConfig?.colorSpace).toEqual({
				primaries: "smpte170m",
				matrix: "smpte170m",
				transfer: "iec61966-2-1",
				fullRange: true,
			});
		} finally {
			addPacket.mockRestore();
		}
	});

	it("defaults to BufferTarget when no electronAPI stream IPC is available", async () => {
		// biome-ignore lint/suspicious/noExplicitAny: isolating the muxer from Electron.
		(globalThis as any).window = undefined;
		const muxer = new VideoMuxer(baseConfig);
		expect(muxer.getTargetMode()).toBe<MuxerTargetMode>("buffer");
		await muxer.initialize();
		const result = await muxer.finalize();
		expect(result.mode).toBe("buffer");
		if (result.mode === "buffer") {
			expect(result.blob.type).toBe("video/mp4");
		}
	});

	it("uses StreamTarget and routes chunks through the renderer IPC when available", async () => {
		const chunkCalls: Array<{
			streamId: string;
			position: number;
			bytes: number;
		}> = [];
		const fakeApi = {
			openExportStream: vi.fn(async () => ({
				success: true,
				streamId: "stream-1",
				tempPath: "/tmp/muxer-stream.mp4",
			})),
			writeExportStreamChunk: vi.fn(
				async (streamId: string, position: number, chunk: Uint8Array) => {
					chunkCalls.push({ streamId, position, bytes: chunk.byteLength });
					return { success: true };
				},
			),
			closeExportStream: vi.fn(async (streamId: string) => ({
				success: true,
				tempPath: "/tmp/muxer-stream.mp4",
				bytesWritten: 8,
			})),
		};

		// biome-ignore lint/suspicious/noExplicitAny: mocking the Electron bridge.
		(globalThis as any).window = { electronAPI: fakeApi } as any;

		const muxer = new VideoMuxer(baseConfig);
		expect(muxer.getTargetMode()).toBe<MuxerTargetMode>("stream");

		await muxer.initialize();
		const result = await muxer.finalize();

		expect(fakeApi.openExportStream).toHaveBeenCalledTimes(1);
		expect(fakeApi.writeExportStreamChunk).toHaveBeenCalledTimes(1);
		expect(fakeApi.closeExportStream).toHaveBeenCalledWith("stream-1", undefined);
		expect(chunkCalls).toEqual([{ streamId: "stream-1", position: 0, bytes: 8 }]);
		expect(result.mode).toBe("stream");
		if (result.mode === "stream") {
			expect(result.tempFilePath).toBe("/tmp/muxer-stream.mp4");
			expect(result.bytesWritten).toBe(8);
		}
	});

	it("aborts the stream session when the muxer is destroyed mid-flight", async () => {
		const closeSpy = vi.fn(async () => ({
			success: true,
			tempPath: "/tmp/abort.mp4",
			bytesWritten: 0,
		}));
		const fakeApi = {
			openExportStream: vi.fn(async () => ({
				success: true,
				streamId: "stream-abort",
				tempPath: "/tmp/abort.mp4",
			})),
			writeExportStreamChunk: vi.fn(async () => ({ success: true })),
			closeExportStream: closeSpy,
		};
		// biome-ignore lint/suspicious/noExplicitAny: mocking the Electron bridge.
		(globalThis as any).window = { electronAPI: fakeApi } as any;

		const muxer = new VideoMuxer(baseConfig);
		await muxer.initialize();
		await muxer.abortStream();

		expect(closeSpy).toHaveBeenCalledWith("stream-abort", { abort: true });
	});
});
