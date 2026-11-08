import { afterEach, describe, expect, it, vi } from "vitest";
import { isWebCodecsEncoderFailure } from "./modernExportEncoderFailure";
import { finalizeExportAttempt } from "./modernExportFinalize";
import { selectMp4Recovery } from "./modernExportRecovery";
import { ModernExportSession } from "./modernExportSession";
import { encodeRenderedFrame, initializeEncoder } from "./modernWebCodecsBackend";

afterEach(() => vi.unstubAllGlobals());

function session() {
	return new ModernExportSession({
		videoUrl: "file:///source.mp4",
		width: 320,
		height: 180,
		frameRate: 30,
		bitrate: 1_000_000,
		wallpaper: "#000000",
		zoomRegions: [],
		showShadow: false,
		shadowIntensity: 0,
		backgroundBlur: 0,
		cropRegion: { x: 0, y: 0, width: 1, height: 1 },
	});
}

describe("hardware encoder recovery classification", () => {
	it("marks the real encoder callback and preserves the configured hardware path for recovery", async () => {
		let callbacks!: VideoEncoderInit;
		vi.stubGlobal(
			"VideoEncoder",
			class {
				constructor(init: VideoEncoderInit) {
					callbacks = init;
				}
				static async isConfigSupported(config: VideoEncoderConfig) {
					return { supported: true, config };
				}
				configure() {}
			},
		);
		const state = session();
		await initializeEncoder(state, {});
		const failure = new DOMException("Hardware encoder stopped", "EncodingError");
		callbacks.error(failure);
		expect(state.browser.encoderError).toBe(failure);
		expect(isWebCodecsEncoderFailure(state.browser.encoderError)).toBe(true);
		expect(state.cancelled).toBe(true);
		expect(
			selectMp4Recovery({
				success: false,
				error: failure.message,
				failureStage: "encoder",
				metrics: state.metrics.buildExportMetrics(),
			})?.route,
		).toBe("software");
	});
	it("classifies a supported hardware encoder configure failure for one software retry", async () => {
		const failure = new DOMException("Hardware encoder configure failed", "OperationError");
		vi.stubGlobal(
			"VideoEncoder",
			class {
				static async isConfigSupported(config: VideoEncoderConfig) {
					return { supported: true, config };
				}
				configure() {
					throw failure;
				}
			},
		);
		const state = session();
		await expect(initializeEncoder(state, {})).rejects.toBe(failure);
		expect(isWebCodecsEncoderFailure(failure)).toBe(true);
		expect(
			selectMp4Recovery({
				success: false,
				error: failure.message,
				failureStage: "encoder",
				metrics: state.metrics.buildExportMetrics(),
			})?.route,
		).toBe("software");
	});
	it("marks synchronous encode failures while closing the frame exactly once", async () => {
		const close = vi.fn();
		vi.stubGlobal(
			"VideoFrame",
			class {
				close = close;
			},
		);
		const state = session();
		const failure = new DOMException("Hardware encoder rejected frame", "EncodingError");
		state.flow.webCodecsEncodeQueueLimit = 2;
		state.browser.renderer = { getCanvas: () => ({}) } as unknown as NonNullable<
			typeof state.browser.renderer
		>;
		state.browser.encoder = {
			state: "configured",
			encodeQueueSize: 0,
			encode: () => {
				throw failure;
			},
		} as unknown as VideoEncoder;
		await expect(encodeRenderedFrame(state, {}, 0, 33_333, 0)).rejects.toBe(failure);
		expect(isWebCodecsEncoderFailure(failure)).toBe(true);
		expect(close).toHaveBeenCalledOnce();
	});
	it("marks a rejected hardware flush before any queued muxing or audio is finalized", async () => {
		const state = session();
		const failure = new DOMException("Hardware encoder could not flush", "EncodingError");
		state.browser.encoder = {
			state: "configured",
			flush: async () => {
				throw failure;
			},
		} as unknown as VideoEncoder;
		const finalizeAudio = vi.fn(async () => ({ success: false }));
		await expect(
			finalizeExportAttempt(
				state,
				{
					buildLightningExportError: String,
					finalizeExportWithFfmpegAudio: finalizeAudio,
					finishNativeVideoExport: finalizeAudio,
				},
				{
					useFallbackMediaSource: false,
					retriedWithFallbackMediaSource: false,
					nativeFailure: null,
					retryWithWebgl: false,
					inNativeStage: false,
					inRendererStage: false,
				},
				{
					useNativeEncoder: false,
					nativeAudioPlan: { audioMode: "none" },
					totalFrames: 90,
					shouldUseFfmpegAudioFallback: false,
					shouldUsePitchPreservingFfmpegAudio: false,
				},
			),
		).rejects.toBe(failure);
		expect(isWebCodecsEncoderFailure(failure)).toBe(true);
		expect(finalizeAudio).not.toHaveBeenCalled();
	});
});
