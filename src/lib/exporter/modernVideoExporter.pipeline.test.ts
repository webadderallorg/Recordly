import { afterEach, describe, expect, it, vi } from "vitest";
import type { FrameRenderer } from "./modernFrameRenderer";
import { startNativeVideoExport } from "./modernNativeStreamStart";
import { ModernVideoExporter } from "./modernVideoExporter";
import { exporterInternals } from "./modernVideoExporter.testSupport";

const mocks = vi.hoisted(() => ({
	render: vi.fn(async () => {}),
	initialize: vi.fn(async () => {}),
	backend: vi.fn(() => "webgpu"),
	decode: vi.fn(),
	construct: vi.fn(),
}));
vi.mock("./modernFrameRenderer", () => ({
	FrameRenderer: class {
		constructor(config: unknown) {
			mocks.construct(config);
		}
		initialize = mocks.initialize;
		renderFrame = mocks.render;
		getRendererBackend = mocks.backend;
		destroy() {}
	},
}));
vi.mock("./streamingDecoder", () => ({
	StreamingVideoDecoder: class {
		async loadMetadata() {
			return {
				width: 2,
				height: 2,
				duration: 1,
				streamDuration: 1,
				frameRate: 30,
				codec: "h264",
				hasAudio: false,
			};
		}
		getEffectiveDuration() {
			return 1;
		}
		decodeAll = mocks.decode;
		getDemuxer() {
			return null;
		}
		destroy() {}
		cancel() {}
	},
}));
vi.mock("./muxer", () => ({
	VideoMuxer: class {
		async initialize() {}
		async finalize() {
			return { mode: "buffer", blob: new Blob([], { type: "video/mp4" }) };
		}
		destroy() {}
	},
}));
const config = {
	videoUrl: "file:///source.mp4",
	width: 2,
	height: 2,
	frameRate: 30,
	bitrate: 1000000,
	wallpaper: "#000000",
	backendPreference: "webcodecs" as const,
};
function exporter() {
	const instance = new ModernVideoExporter(config as never);
	const probe = instance;
	exporterInternals(probe).session.browser.renderer = {
		getCanvas: () => ({ width: 2, height: 2 }) as HTMLCanvasElement,
		capturePixelsForNativeExport: () => new Uint8ClampedArray(16),
		destroy() {},
	} as unknown as FrameRenderer;
	return { instance, probe };
}
function browserEncoder() {
	const callbacks: Array<VideoEncoderInit> = [];
	const encoders: Encoder[] = [];
	const encode = vi.fn();
	class Encoder {
		static isConfigSupported = vi.fn(async () => ({ supported: true }));
		encodeQueueSize = 64;
		ondequeue: ((event: Event) => void) | null = null;
		state = "configured";
		constructor(init: VideoEncoderInit) {
			callbacks.push(init);
			encoders.push(this);
		}
		configure() {}
		encode = encode;
		close() {
			this.state = "closed";
		}
	}
	vi.stubGlobal("VideoEncoder", Encoder);
	const close = vi.fn();
	vi.stubGlobal(
		"VideoFrame",
		class {
			close = close;
		},
	);
	return { callbacks, encoders, encode, close, Encoder };
}
function bridge() {
	vi.stubGlobal("document", {
		createElement: () => ({
			width: 2,
			height: 2,
			getContext: () => ({
				drawImage() {},
				getImageData: () => ({ data: new Uint8ClampedArray(16) }),
			}),
		}),
	});
	const start = vi.fn(async (options: { inputMode: string }) => ({
		success: true,
		sessionId: options.inputMode,
		encoderName: "libx264",
	}));
	const write = vi.fn(async () => ({ success: true }));
	const cancel = vi.fn(async () => ({ success: true }));
	vi.stubGlobal("window", {
		electronAPI: {
			nativeVideoExportStart: start,
			nativeVideoExportWriteFrames: write,
			nativeVideoExportCancel: cancel,
		},
	});
	return { start, write, cancel };
}
afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
	vi.clearAllMocks();
	vi.unstubAllGlobals();
});
describe("native encoder capacity", () => {
	describe("cloud encoder selection", () => {
		it("retains the small cloud profile when browser hardware encoding is unavailable", async () => {
			const { Encoder } = browserEncoder();
			Encoder.isConfigSupported.mockResolvedValue({ supported: false });
			const { start } = bridge();
			const instance = new ModernVideoExporter({
				...config,
				deliveryProfile: "cloud",
			} as never);
			const internals = exporterInternals(instance);
			expect(await startNativeVideoExport(internals.session, internals.operations)).toBe(
				true,
			);
			expect(start).toHaveBeenCalledWith(
				expect.objectContaining({
					inputMode: "rawvideo",
					deliveryProfile: "cloud",
					bitrate: config.bitrate,
				}),
			);
			expect(internals.session.native.nativeInputMode).toBe("rawvideo");
			instance.cancel();
		});

		it("uses hardware H.264 with the smaller cloud VBR budget", async () => {
			const { Encoder } = browserEncoder();
			const { start } = bridge();
			const instance = new ModernVideoExporter({
				...config,
				deliveryProfile: "cloud",
			} as never);
			const internals = exporterInternals(instance);
			expect(await startNativeVideoExport(internals.session, internals.operations)).toBe(
				true,
			);
			expect(Encoder.isConfigSupported).toHaveBeenCalledWith(
				expect.objectContaining({
					bitrate: config.bitrate,
					bitrateMode: "variable",
					hardwareAcceleration: "prefer-hardware",
				}),
			);
			expect(start).toHaveBeenCalledWith(
				expect.objectContaining({ inputMode: "h264-stream", deliveryProfile: "cloud" }),
			);
			expect(internals.session.native.nativeInputMode).toBe("h264-stream");
			instance.cancel();
		});
	});

	it("resumes on dequeue without waiting for an output chunk or batch", async () => {
		const { encoders, encode, close } = browserEncoder();
		bridge();
		const { instance, probe } = exporter();
		await startNativeVideoExport(
			exporterInternals(probe).session,
			exporterInternals(probe).operations,
		);
		const pending = exporterInternals(probe).operations.encodeRenderedFrameNative(0, 33333, 0);
		expect(exporterInternals(probe).session.flow.encodeCapacityWaiters.size).toBe(1);
		encoders[0].encodeQueueSize = 0;
		encoders[0].ondequeue?.(new Event("dequeue"));
		await pending;
		expect(encode).toHaveBeenCalledOnce();
		expect(close).toHaveBeenCalledOnce();
		expect(exporterInternals(probe).session.flow.encodeCapacityWaiters.size).toBe(0);
		instance.cancel();
	});
	it("resumes on a partial output batch and flushes it while backpressured", async () => {
		const { callbacks, encoders, encode } = browserEncoder();
		const { write } = bridge();
		const { instance, probe } = exporter();
		await startNativeVideoExport(
			exporterInternals(probe).session,
			exporterInternals(probe).operations,
		);
		const pending = exporterInternals(probe).operations.encodeRenderedFrameNative(0, 33333, 0);
		callbacks[0].output({ byteLength: 4, copyTo() {} } as unknown as EncodedVideoChunk);
		await Promise.resolve();
		expect(write).toHaveBeenCalledWith("h264-stream", [expect.any(Uint8Array)]);
		encoders[0].encodeQueueSize = 0;
		encoders[0].ondequeue?.(new Event("dequeue"));
		await pending;
		expect(encode).toHaveBeenCalledOnce();
		instance.cancel();
	});
	it("cancellation wakes capacity waiters and does not allocate or encode a frame", async () => {
		const { encode, close } = browserEncoder();
		bridge();
		const { instance, probe } = exporter();
		await startNativeVideoExport(
			exporterInternals(probe).session,
			exporterInternals(probe).operations,
		);
		const pending = exporterInternals(probe).operations.encodeRenderedFrameNative(0, 33333, 0);
		instance.cancel();
		await pending;
		expect(encode).not.toHaveBeenCalled();
		expect(close).not.toHaveBeenCalled();
		expect(exporterInternals(probe).session.flow.encodeCapacityWaiters.size).toBe(0);
	});
	it("rechecks capacity when a browser omits dequeue and bounds a genuinely stalled queue", async () => {
		vi.useFakeTimers();
		const { encoders, encode } = browserEncoder();
		bridge();
		const { instance, probe } = exporter();
		await startNativeVideoExport(
			exporterInternals(probe).session,
			exporterInternals(probe).operations,
		);
		const pending = exporterInternals(probe).operations.encodeRenderedFrameNative(0, 33333, 0);
		encoders[0].encodeQueueSize = 0;
		await vi.advanceTimersByTimeAsync(50);
		await pending;
		expect(encode).toHaveBeenCalledOnce();
		encoders[0].encodeQueueSize = 64;
		const stalled = expect(
			exporterInternals(probe).operations.encodeRenderedFrameNative(0, 33333, 1),
		).rejects.toThrow("no progress");
		await vi.advanceTimersByTimeAsync(30100);
		await stalled;
		expect(exporterInternals(probe).session.flow.encodeCapacityWaiters.size).toBe(0);
		instance.cancel();
	});
});
describe("bundled FFmpeg fallback", () => {
	it.each([
		"unsupported",
		"absent",
		"configure-failed",
	])("uses raw RGBA when the browser encoder is %s", async (failure) => {
		const { Encoder } = browserEncoder();
		const { start, write, cancel } = bridge();
		if (failure === "unsupported")
			Encoder.isConfigSupported.mockResolvedValue({ supported: false });
		if (failure === "absent") vi.stubGlobal("VideoEncoder", undefined);
		if (failure === "configure-failed")
			vi.spyOn(Encoder.prototype, "configure").mockImplementation(() => {
				throw new Error("unsupported H264");
			});
		const { instance, probe } = exporter();
		expect(
			await startNativeVideoExport(
				exporterInternals(probe).session,
				exporterInternals(probe).operations,
			),
		).toBe(true);
		expect(start).toHaveBeenLastCalledWith(
			expect.objectContaining({ inputMode: "rawvideo", width: 2, height: 2, frameRate: 30 }),
		);
		if (failure === "configure-failed") expect(cancel).toHaveBeenCalledWith("h264-stream");
		expect(exporterInternals(probe).session.native.nativeInputMode).toBe("rawvideo");
		await exporterInternals(probe).operations.encodeRenderedFrameNative(0, 33333, 0);
		expect(exporterInternals(probe).session.flow.pendingNativeWriteChunks[0]).toEqual(
			new Uint8Array(16),
		);
		expect(write).not.toHaveBeenCalled();
		instance.cancel();
	});
	it("reports both browser support and raw FFmpeg failures", async () => {
		const { Encoder } = browserEncoder();
		const { start } = bridge();
		Encoder.isConfigSupported.mockResolvedValue({ supported: false });
		start.mockResolvedValue({ success: false, sessionId: "", encoderName: "" });
		const { probe } = exporter();
		expect(
			await startNativeVideoExport(
				exporterInternals(probe).session,
				exporterInternals(probe).operations,
			),
		).toBe(false);
		expect(exporterInternals(probe).session.native.lastNativeExportError).toContain("Annex B");
		expect(exporterInternals(probe).session.native.lastNativeExportError).toContain(
			"rawvideo fallback",
		);
	});
	it("cancels a late session instead of adopting it after cancellation", async () => {
		vi.stubGlobal("VideoEncoder", undefined);
		const { start, cancel } = bridge();
		let resolve: (result: {
			success: boolean;
			sessionId: string;
			encoderName: string;
		}) => void = () => {};
		start.mockImplementation(
			() =>
				new Promise((r) => {
					resolve = r;
				}),
		);
		const { instance, probe } = exporter();
		const pending = startNativeVideoExport(
			exporterInternals(probe).session,
			exporterInternals(probe).operations,
		);
		instance.cancel();
		resolve({ success: true, sessionId: "late", encoderName: "libx264" });
		expect(await pending).toBe(false);
		expect(cancel).toHaveBeenCalledWith("late");
		expect(exporterInternals(probe).session.native.nativeExportSessionId).toBeNull();
	});
});
it("restarts a WebGPU runtime rendering failure once using fresh WebGL resources", async () => {
	mocks.render.mockRejectedValueOnce(
		new Error("Cannot read properties of undefined (reading '_resourceType')"),
	);
	mocks.backend.mockReturnValueOnce("webgpu").mockReturnValueOnce("webgl");
	mocks.decode.mockImplementation(async (_fps, _trim, _speed, onFrame) => {
		await onFrame({ timestamp: 0, close() {} }, 0, 0, 0);
	});
	const { probe, instance } = exporter();
	vi.spyOn(exporterInternals(probe).operations, "initializeEncoder").mockResolvedValue({
		codec: "avc1.640033",
		hardwareAcceleration: "prefer-hardware",
	});
	vi.spyOn(exporterInternals(probe).operations, "encodeRenderedFrame").mockResolvedValue();
	const result = await instance.export();
	expect(result.success).toBe(true);
	expect(mocks.initialize).toHaveBeenCalledTimes(2);
	expect(mocks.construct).toHaveBeenNthCalledWith(
		2,
		expect.objectContaining({ preferredRenderBackend: "webgl", width: 2, height: 2 }),
	);
});
it("cancels a renderer waiting on an unresponsive native IPC frame write", async () => {
	browserEncoder();
	bridge();
	const { instance, probe } = exporter();
	await startNativeVideoExport(
		exporterInternals(probe).session,
		exporterInternals(probe).operations,
	);
	exporterInternals(probe).session.flow.trackNativeWritePromise(new Promise<void>(() => {}));
	const pending = exporterInternals(probe).operations.encodeRenderedFrameNative(0, 33333, 0);
	instance.cancel();
	await expect(pending).rejects.toThrow("Export cancelled");
	expect(exporterInternals(probe).session.flow.encodeCapacityWaiters.size).toBe(0);
});
it("retries a native browser encoding runtime failure once with raw FFmpeg and preserves output dimensions", async () => {
	browserEncoder();
	const { start } = bridge();
	vi.stubGlobal("navigator", { platform: "Linux" });
	vi.stubGlobal("window", {
		electronAPI: {
			nativeVideoExportStart: start,
			nativeVideoExportCancel: vi.fn(async () => ({ success: true })),
			nativeVideoExportFinish: vi.fn(async () => ({
				success: true,
				tempPath: "/tmp/export.mp4",
			})),
		},
	});
	mocks.render.mockResolvedValue();
	mocks.backend.mockReturnValue("webgl");
	mocks.decode.mockImplementation(async (_fps, _trim, _speed, onFrame) => {
		await onFrame({ timestamp: 0, close() {} }, 0, 0, 0);
	});
	const instance = new ModernVideoExporter({ ...config, backendPreference: "breeze" } as never);
	const probe = instance;
	vi.spyOn(exporterInternals(probe).operations, "tryExportNativeStaticLayout").mockResolvedValue(
		null,
	);
	const nativeEncode = vi
		.spyOn(exporterInternals(probe).operations, "encodeRenderedFrameNative")
		.mockRejectedValueOnce(new Error("hardware encoding failed"))
		.mockResolvedValue();
	const result = await instance.export();
	expect(result.success).toBe(true);
	expect(nativeEncode).toHaveBeenCalledTimes(2);
	expect(start).toHaveBeenNthCalledWith(
		1,
		expect.objectContaining({ inputMode: "h264-stream", width: 2, height: 2, frameRate: 30 }),
	);
	expect(start).toHaveBeenNthCalledWith(
		2,
		expect.objectContaining({ inputMode: "rawvideo", width: 2, height: 2, frameRate: 30 }),
	);
	expect(result.metrics?.diagnostics?.encoder?.api).toBe("ffmpeg");
});
it("reports failure after the single WebGL retry also fails", async () => {
	mocks.render.mockRejectedValue(new Error("renderer unavailable"));
	mocks.backend.mockReturnValueOnce("webgpu").mockReturnValueOnce("webgl");
	mocks.decode.mockImplementation(async (_fps, _trim, _speed, onFrame) => {
		await onFrame({ timestamp: 0, close() {} }, 0, 0, 0);
	});
	const { probe, instance } = exporter();
	vi.spyOn(exporterInternals(probe).operations, "initializeEncoder").mockResolvedValue({
		codec: "avc1.640033",
		hardwareAcceleration: "prefer-hardware",
	});
	const result = await instance.export();
	expect(result.success).toBe(false);
	expect(result.error).toContain("renderer unavailable");
	expect(mocks.initialize).toHaveBeenCalledTimes(2);
	expect(result.metrics?.diagnostics?.attempts).toContainEqual(
		expect.objectContaining({ route: "renderer", status: "retry" }),
	);
});
it("copies raw pixels before batching and rejects mismatched frame geometry", async () => {
	vi.stubGlobal("VideoEncoder", undefined);
	bridge();
	const { probe, instance } = exporter();
	await startNativeVideoExport(
		exporterInternals(probe).session,
		exporterInternals(probe).operations,
	);
	const pixels = new Uint8ClampedArray(16).fill(5);
	pixels.fill(7, 8);
	const drawImage = vi.fn();
	vi.stubGlobal("document", {
		createElement: () => ({
			width: 2,
			height: 2,
			getContext: () => ({ drawImage, getImageData: () => ({ data: pixels }) }),
		}),
	});
	await exporterInternals(probe).operations.encodeRenderedFrameNative(0, 33333, 0);
	pixels.fill(9);
	expect(exporterInternals(probe).session.flow.pendingNativeWriteChunks[0]).toEqual(
		new Uint8Array([7, 7, 7, 7, 7, 7, 7, 7, 5, 5, 5, 5, 5, 5, 5, 5]),
	);
	expect(drawImage).toHaveBeenCalledWith(expect.objectContaining({ width: 2, height: 2 }), 0, 0);
	exporterInternals(probe).session.browser.renderer!.getCanvas = () =>
		({ width: 1, height: 2 }) as HTMLCanvasElement;
	await expect(
		exporterInternals(probe).operations.encodeRenderedFrameNative(0, 33333, 1),
	).rejects.toThrow("requested export dimensions");
	instance.cancel();
});
it.each(
	["MacIntel", "Win32", "Linux x86_64"].flatMap((platform) => [
		{ platform, preferred: undefined, expected: "webgl" },
		{ platform, preferred: "webgpu", expected: "webgpu" },
		{ platform, preferred: "webgl", expected: "webgl" },
	]),
)("uses $expected on $platform with preference $preferred", async ({
	platform,
	preferred,
	expected,
}) => {
	vi.stubGlobal("navigator", { platform });
	mocks.render.mockResolvedValue();
	mocks.backend.mockReturnValue("webgl");
	mocks.decode.mockImplementation(async (_fps, _trim, _speed, onFrame) => {
		await onFrame({ timestamp: 0, close() {} }, 0, 0, 0);
	});
	const instance = new ModernVideoExporter({
		...config,
		preferredRenderBackend: preferred,
	} as never);
	const probe = instance;
	vi.spyOn(exporterInternals(probe).operations, "initializeEncoder").mockResolvedValue({
		codec: "avc1.640033",
		hardwareAcceleration: "prefer-hardware",
	});
	vi.spyOn(exporterInternals(probe).operations, "encodeRenderedFrame").mockResolvedValue();
	expect((await instance.export()).success).toBe(true);
	expect(mocks.construct).toHaveBeenCalledOnce();
	expect(mocks.construct).toHaveBeenCalledWith(
		expect.objectContaining({ preferredRenderBackend: expected, width: 2, height: 2 }),
	);
});
