import { afterEach, expect, it, vi } from "vitest";
import { ModernExportProgress } from "./modernExportProgress";
import { ModernExportSession } from "./modernExportSession";
import { encodeRenderedFrameNative } from "./modernNativeStreamFrames";

const create = (onProgress = vi.fn()) =>
	new ModernExportSession({
		videoUrl: "file:///source.mp4",
		width: 640,
		height: 360,
		frameRate: 60,
		bitrate: 8_000_000,
		onProgress,
	});
afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

it("keeps completed rendering FPS stable during finalization and clears it for a new attempt", () => {
	vi.spyOn(console, "log").mockImplementation(() => undefined);
	const onProgress = vi.fn();
	const session = create(onProgress);
	let now = 1000;
	const progress = new ModernExportProgress(session, () => now);
	progress.reportProgress(0, 60, "preparing");
	expect(onProgress.mock.lastCall?.[0].renderFps).toBeUndefined();
	progress.exportStartTimeMs = 1000;
	progress.lastProgressSampleTimeMs = 1000;
	now = 2000;
	session.metrics.processedFrameCount = 60;
	progress.reportProgress(60, 60);
	expect(onProgress.mock.lastCall?.[0].renderFps).toBe(60);
	for (now of [2000, 2000, 5000, 10000]) progress.reportProgress(60, 60, "finalizing", 99);
	expect(onProgress.mock.lastCall?.[0].renderFps).toBe(60);
	progress.reset();
	progress.exportStartTimeMs = 10000;
	progress.lastProgressSampleTimeMs = 10000;
	now = 11000;
	progress.reportProgress(30, 60);
	expect(onProgress.mock.lastCall?.[0].renderFps).toBe(30);
});

it("measures native H264 queue pressure and capacity wait time", async () => {
	let now = 100;
	vi.spyOn(performance, "now").mockImplementation(() => now);
	const session = create();
	const encoder = {
		encodeQueueSize: 64,
		encode: vi.fn(() => {
			encoder.encodeQueueSize++;
		}),
	};
	session.native.nativeExportSessionId = "session";
	session.native.nativeInputMode = "h264-stream";
	session.native.nativeH264Encoder = encoder as unknown as VideoEncoder;
	session.browser.renderer = { getCanvas: () => ({ width: 640, height: 360 }) } as never;
	vi.stubGlobal(
		"VideoFrame",
		class {
			close = vi.fn();
		},
	);
	vi.spyOn(session.flow, "waitForEncodeCapacity").mockImplementation(async () => {
		now += 25;
		encoder.encodeQueueSize = 63;
	});
	await encodeRenderedFrameNative(session, {}, 0, 16667, 0);
	expect(session.metrics.peakEncodeQueueSize).toBe(64);
	expect(session.flow.getCurrentEncodeBacklog()).toBe(64);
	expect(session.metrics.encodeWaitEvents).toBe(1);
	expect(session.metrics.encodeWaitTimeMs).toBe(25);
	expect(session.metrics.nativeCaptureTimeMs).toBe(0);
	expect(encoder.encode).toHaveBeenCalledTimes(1);
});

it("measures chunk-write IPC latency and ignores a reply belonging to a discarded session", async () => {
	let now = 100;
	vi.spyOn(performance, "now").mockImplementation(() => now);
	let reply: (result: { success: boolean }) => void = () => undefined;
	vi.stubGlobal("window", {
		electronAPI: {
			nativeVideoExportWriteFrames: vi.fn(
				() =>
					new Promise((resolve) => {
						reply = resolve;
					}),
			),
		},
	});
	const session = create();
	session.native.nativeExportSessionId = "first";
	session.flow.queueNativeWriteChunk("first", new Uint8Array([1]));
	session.flow.flushPendingNativeWriteBatch("first");
	now = 180;
	reply({ success: true });
	await Promise.all([...session.flow.nativeWritePromises]);
	expect(session.metrics.nativeWriteTimeMs).toBe(80);
	session.flow.queueNativeWriteChunk("first", new Uint8Array([2]));
	session.flow.flushPendingNativeWriteBatch("first");
	session.native.nativeExportSessionId = "second";
	now = 400;
	reply({ success: true });
	await Promise.all([...session.flow.nativeWritePromises]);
	expect(session.metrics.nativeWriteTimeMs).toBe(80);
});

it("records failed render/decode elapsed time without counting a failed frame or clearing its failure stage", async () => {
	const { renderExportFrames } = await import("./modernExportFrames");
	let now = 100;
	vi.spyOn(performance, "now").mockImplementation(() => now);
	const session = create();
	session.browser.renderer = {
		renderFrame: async () => {
			now += 25;
			throw new Error("render failed");
		},
	} as never;
	session.browser.streamingDecoder = {
		decodeAll: async (
			_fps: unknown,
			_trims: unknown,
			_speeds: unknown,
			onFrame: (...args: unknown[]) => Promise<void>,
		) => {
			now += 10;
			await onFrame(null, 0, 0, 0);
		},
	} as never;
	const control = {
		useFallbackMediaSource: false,
		retriedWithFallbackMediaSource: false,
		nativeFailure: null,
		retryWithWebgl: false,
		inNativeStage: false,
		inRendererStage: false,
	};
	await expect(
		renderExportFrames(
			session,
			{ encodeRenderedFrame: vi.fn(), encodeRenderedFrameNative: vi.fn() },
			control,
			{ useNativeEncoder: false, totalFrames: 1 } as never,
		),
	).rejects.toThrow("render failed");
	expect(session.metrics.decodeLoopTimeMs).toBe(35);
	expect(session.metrics.renderFrameTimeMs).toBe(25);
	expect(session.metrics.frameCallbackTimeMs).toBe(25);
	expect(session.metrics.processedFrameCount).toBe(0);
	expect(control.inRendererStage).toBe(true);
});
