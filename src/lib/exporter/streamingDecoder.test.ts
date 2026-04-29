import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	getDecodedFrameStartupOffsetUs,
	getDecodedFrameTimelineOffsetUs,
	StreamingVideoDecoder,
	shouldKeepHeldFrameForTargetTime,
} from "./streamingDecoder";

type TestElectronApiWindow = Window &
	typeof globalThis & {
		electronAPI: {
			readLocalFile: ReturnType<typeof vi.fn>;
		};
	};

describe("StreamingVideoDecoder local media loading", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
		Object.assign(globalThis, {
			window: {
				electronAPI: {
					readLocalFile: vi.fn(),
				},
			},
		});
	});

	it("loads loopback media-server URLs through Electron IPC instead of fetch", async () => {
		const readLocalFile = vi.fn(async () => ({
			success: true,
			data: new Uint8Array([1, 2, 3]),
		}));
		const testWindow = globalThis.window as unknown as TestElectronApiWindow;
		testWindow.electronAPI.readLocalFile = readLocalFile;
		const fetchSpy = vi.fn();
		vi.stubGlobal("fetch", fetchSpy);

		const decoder = new StreamingVideoDecoder();
		const decoderHarness = decoder as StreamingVideoDecoder & {
			loadVideoFile(resourceUrl: string): Promise<File>;
		};
		const file = await decoderHarness.loadVideoFile(
			"http://127.0.0.1:43123/video?path=%2Ftmp%2Fcapture.mp4",
		);

		expect(readLocalFile).toHaveBeenCalledWith("/tmp/capture.mp4");
		expect(fetchSpy).not.toHaveBeenCalled();
		expect(file.name).toBe("capture.mp4");
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

describe("shouldKeepHeldFrameForTargetTime", () => {
	it("keeps a sparse VFR frame visible until the next frame timestamp", () => {
		expect(shouldKeepHeldFrameForTargetTime(0.75, 1)).toBe(true);
	});

	it("switches to the next frame once its presentation timestamp is reached", () => {
		expect(shouldKeepHeldFrameForTargetTime(1, 1)).toBe(false);
	});
});
