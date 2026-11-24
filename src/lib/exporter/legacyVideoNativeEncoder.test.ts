import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encodeRenderedFrameNative } from "./legacyVideoNativeEncoder";

describe("encodeRenderedFrameNative watchdog and backpressure", () => {
	beforeEach(() => {
		vi.stubGlobal(
			"VideoFrame",
			class {
				close = vi.fn();
			},
		);
	});
	afterEach(() => vi.unstubAllGlobals());

	it("throws nativeEncoderError immediately if present", async () => {
		const error = new Error("Native encoder crashed");
		const state = {
			nativeH264Encoder: { encodeQueueSize: 0, encode: vi.fn() },
			nativeExportSessionId: "test-session",
			cancelled: false,
			nativeEncoderError: error,
			nativeWriteError: null,
			nativeWritePromises: new Set(),
			maxNativeWriteInFlight: 10,
			awaitOldestNativeWrite: vi.fn(),
			config: {},
			renderer: { getCanvas: () => ({}) },
		};
		await expect(encodeRenderedFrameNative(state as never, 0, 16667, 0)).rejects.toBe(error);
	});

	it("times out if native encoder queue makes no progress for 30s", async () => {
		vi.useFakeTimers();
		try {
			const state = {
				nativeH264Encoder: { encodeQueueSize: 250, encode: vi.fn() },
				nativeExportSessionId: "test-session",
				cancelled: false,
				nativeEncoderError: null,
				nativeWriteError: null,
				nativeWritePromises: new Set(),
				maxNativeWriteInFlight: 10,
				awaitOldestNativeWrite: vi.fn(),
				config: { maxEncodeQueue: 240 },
				renderer: { getCanvas: () => ({}) },
			};
			const assertion = expect(
				encodeRenderedFrameNative(state as never, 0, 16667, 0),
			).rejects.toThrow("Native H.264 encoder made no progress for 30 seconds");
			await vi.advanceTimersByTimeAsync(31_000);
			await assertion;
		} finally {
			vi.useRealTimers();
		}
	});

	it("encodes frame once queue capacity is available", async () => {
		const encode = vi.fn();
		const state = {
			nativeH264Encoder: { encodeQueueSize: 10, encode },
			nativeExportSessionId: "test-session",
			cancelled: false,
			nativeEncoderError: null,
			nativeWriteError: null,
			nativeWritePromises: new Set(),
			maxNativeWriteInFlight: 10,
			awaitOldestNativeWrite: vi.fn(),
			config: { maxEncodeQueue: 5 },
			renderer: { getCanvas: () => ({}) },
		};
		setTimeout(() => {
			state.nativeH264Encoder.encodeQueueSize = 2;
		}, 10);
		await encodeRenderedFrameNative(state as never, 0, 16667, 0);
		expect(encode).toHaveBeenCalledTimes(1);
	});
});
