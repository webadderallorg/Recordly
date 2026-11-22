import {
	buildGifFrameRendererConfig,
	type GifExporterConfig,
	type GifSizeEstimate,
	getGifRepeat,
} from "./gifExporterConfig";

export {
	buildGifFrameRendererConfig,
	calculateOutputDimensions,
	type GifExporterConfig,
	type GifSizeEstimate,
	getGifRepeat,
} from "./gifExporterConfig";

import { FrameRenderer } from "./frameRenderer";

import { optimizeGif } from "./gifOptimization";

import { StreamingVideoDecoder } from "./streamingDecoder";

import { StreamingGifEncoder } from "./streamingGifEncoder";

import type { ExportResult } from "./types";

const GIF_WORKER_URL = new URL("gif.js/dist/gif.worker.js", import.meta.url).toString();

const PROGRESS_SAMPLE_WINDOW_MS = 1_000;

function createGifEncoder(config: GifExporterConfig): StreamingGifEncoder {
	return new StreamingGifEncoder({
		width: config.width,
		height: config.height,
		workerScript: GIF_WORKER_URL,
		repeat: getGifRepeat(config.loop),
	});
}

export class GifExporter {
	private config: GifExporterConfig;
	private streamingDecoder: StreamingVideoDecoder | null = null;
	private renderer: FrameRenderer | null = null;
	private encoder: StreamingGifEncoder | null = null;
	private cancelled = false;
	private cancelEstimate: (() => void) | undefined;
	private estimateCleanup: Promise<void> = Promise.resolve();
	private exportStartTimeMs = 0;
	private progressSampleStartTimeMs = 0;
	private progressSampleStartFrame = 0;
	private lastRenderFps: number | undefined;

	constructor(config: GifExporterConfig) {
		this.config = config;
	}

	/** Wait for cancelled preflight rendering to release its resources before exporting. */
	waitForEstimateCleanup(): Promise<void> {
		return this.estimateCleanup;
	}

	/** Encode and optimize a centered 60-frame sample, then extrapolate to the edited duration. */
	async estimateSize(signal?: AbortSignal): Promise<GifSizeEstimate> {
		this.cancelEstimate?.();
		const controller = new AbortController();
		const decoder = new StreamingVideoDecoder({
			maxDecodeQueue: this.config.maxDecodeQueue ?? 4,
			maxPendingFrames: this.config.maxPendingFrames ?? 4,
		});
		let renderer: FrameRenderer | undefined;
		let gif: StreamingGifEncoder | undefined;
		const abortError = () => new DOMException("GIF size estimate cancelled", "AbortError");
		const checkAbort = () => {
			if (controller.signal.aborted) throw abortError();
		};
		const cancel = () => {
			controller.abort();
			decoder.cancel();
			renderer?.cancelPendingMedia();
			gif?.abort();
		};
		this.cancelEstimate = cancel;
		const abort = () => cancel();
		const timeout = setTimeout(cancel, 45_000);
		signal?.addEventListener("abort", abort, { once: true });
		if (signal?.aborted) cancel();

		const work = async (): Promise<GifSizeEstimate> => {
			try {
				checkAbort();
				const videoInfo = await decoder.loadMetadata(this.config.videoUrl);
				checkAbort();
				const totalFrames = Math.ceil(
					decoder.getEffectiveDuration(
						this.config.trimRegions,
						this.config.speedRegions,
						this.config.clipRegions,
					) * this.config.frameRate,
				);
				if (totalFrames <= 0) throw new Error("No frames available to estimate");
				const sampleLimit = Math.min(totalFrames, 60);
				const sampleStart = Math.floor((totalFrames - sampleLimit) / 2);
				renderer = new FrameRenderer({
					...buildGifFrameRendererConfig(this.config, videoInfo),
					preferMediaElementSampling: true,
				});
				await renderer.initialize();
				checkAbort();
				gif = createGifEncoder(this.config);
				let sampleFrames = 0;
				const frameDurationUs = 1_000_000 / this.config.frameRate;
				await decoder.decodeSampleWindow(
					this.config.frameRate,
					this.config.trimRegions,
					this.config.speedRegions,
					async (frame, timestamp, sourceMs, cursorMs) => {
						checkAbort();
						if (sampleFrames >= sampleLimit) return;
						await renderer!.renderFrame(
							frame,
							sourceMs * 1000,
							cursorMs * 1000,
							frameDurationUs,
							timestamp,
						);
						checkAbort();
						await gif!.addFrame(
							renderer!.getCanvas(),
							Math.round(1000 / this.config.frameRate),
						);
						sampleFrames++;
					},
					this.config.clipRegions,
					sampleStart,
					sampleLimit,
				);
				checkAbort();
				if (sampleFrames !== sampleLimit) throw new Error("Incomplete GIF size sample");
				const blob = await gif.finish();
				checkAbort();
				const optimized = await optimizeGif(blob, controller.signal);
				checkAbort();
				if (optimized.status === "failed") throw new Error("GIF size estimation failed");
				const scale = totalFrames / sampleFrames;
				return {
					originalBytes: Math.round(blob.size * scale),
					optimizedBytes: Math.round(optimized.blob.size * scale),
					reductionPercent: optimized.reductionPercent,
					sampleFrames,
					totalFrames,
				};
			} finally {
				// Await in-flight rendering before destroying its resources.
				gif?.abort();
				renderer?.destroy();
				decoder.destroy();
			}
		};
		let onAbort: (() => void) | undefined;
		const interrupted = new Promise<never>((_resolve, reject) => {
			onAbort = () => reject(abortError());
			controller.signal.addEventListener("abort", onAbort, { once: true });
			if (controller.signal.aborted) onAbort();
		});
		try {
			const estimation = work();
			this.estimateCleanup = estimation.then(
				() => undefined,
				() => undefined,
			);
			return await Promise.race([estimation, interrupted]);
		} finally {
			clearTimeout(timeout);
			signal?.removeEventListener("abort", abort);
			if (onAbort) controller.signal.removeEventListener("abort", onAbort);
			if (this.cancelEstimate === cancel) this.cancelEstimate = undefined;
		}
	}

	async export(): Promise<ExportResult> {
		try {
			this.cleanup();
			this.cancelled = false;
			this.exportStartTimeMs = this.getNowMs();
			this.progressSampleStartTimeMs = this.exportStartTimeMs;
			this.progressSampleStartFrame = 0;
			this.lastRenderFps = undefined;

			// Initialize streaming decoder and load video metadata
			this.streamingDecoder = new StreamingVideoDecoder({
				maxDecodeQueue: this.config.maxDecodeQueue ?? 4,
				maxPendingFrames: this.config.maxPendingFrames ?? 4,
			});
			const videoInfo = await this.streamingDecoder.loadMetadata(this.config.videoUrl);
			if (this.cancelled) throw new Error("Export cancelled");

			// Initialize frame renderer
			this.renderer = new FrameRenderer(buildGifFrameRendererConfig(this.config, videoInfo));
			await this.renderer.initialize();
			if (this.cancelled) throw new Error("Export cancelled");

			// Calculate effective duration and frame count (excluding trim regions)
			const effectiveDuration = this.streamingDecoder.getEffectiveDuration(
				this.config.trimRegions,
				this.config.speedRegions,
				this.config.clipRegions,
			);
			const totalFrames = Math.ceil(effectiveDuration * this.config.frameRate);

			// Calculate frame delay in milliseconds (gif.js uses ms)
			const frameDelay = Math.round(1000 / this.config.frameRate);
			let draining = false;
			this.encoder = new StreamingGifEncoder({
				width: this.config.width,
				height: this.config.height,
				repeat: getGifRepeat(this.config.loop),
				workerScript: GIF_WORKER_URL,
				onFrameEncoded: (completed) => {
					if (!draining && !this.cancelled) this.reportProgress(completed, totalFrames);
				},
			});

			console.log("[GifExporter] Original duration:", videoInfo.duration, "s");
			console.log("[GifExporter] Effective duration:", effectiveDuration, "s");
			console.log("[GifExporter] Total frames to export:", totalFrames);
			console.log("[GifExporter] Frame rate:", this.config.frameRate, "FPS");
			console.log("[GifExporter] Frame delay:", frameDelay, "ms");
			console.log("[GifExporter] Loop:", this.config.loop ? "infinite" : "once");
			console.log("[GifExporter] Using streaming decode (web-demuxer + VideoDecoder)");

			let frameIndex = 0;
			const frameDurationUs = 1_000_000 / this.config.frameRate;

			// Stream decode and process frames — no seeking!
			await this.streamingDecoder.decodeAll(
				this.config.frameRate,
				this.config.trimRegions,
				this.config.speedRegions,
				async (videoFrame, _exportTimestampUs, sourceTimestampMs, cursorTimestampMs) => {
					if (this.cancelled) {
						return;
					}

					const sourceTimestampUs = sourceTimestampMs * 1000;
					const cursorTimestampUs = cursorTimestampMs * 1000;
					await this.renderer!.renderFrame(
						videoFrame,
						sourceTimestampUs,
						cursorTimestampUs,
						frameDurationUs,
						frameIndex * frameDurationUs,
					);

					if (this.cancelled) throw new Error("Export cancelled");
					await this.encoder!.addFrame(this.renderer!.getCanvas(), frameDelay);
					frameIndex++;
				},
				this.config.clipRegions,
			);

			if (this.cancelled) {
				return { success: false, error: "Export cancelled" };
			}

			// Raw frames have already been encoded alongside rendering. Only the
			// bounded tail of worker jobs remains; duration is unknown until it drains.
			draining = true;
			this.config.onProgress?.({
				currentFrame: frameIndex,
				totalFrames: frameIndex,
				percentage: 95,
				estimatedTimeRemaining: Number.POSITIVE_INFINITY,
				phase: "finalizing",
				renderFps: this.lastRenderFps,
			});
			const blob = await this.encoder.finish();

			return { success: true, blob };
		} catch (error) {
			console.error("GIF Export error:", error);
			return {
				success: false,
				error: error instanceof Error ? error.message : String(error),
			};
		} finally {
			this.cleanup();
		}
	}

	private reportProgress(currentFrame: number, totalFrames: number) {
		const nowMs = this.getNowMs();
		const elapsedSeconds = Math.max((nowMs - this.exportStartTimeMs) / 1000, 0.001);
		const averageRenderFps = currentFrame / elapsedSeconds;
		const sampleElapsedMs = Math.max(nowMs - this.progressSampleStartTimeMs, 1);
		const sampleFrameDelta = Math.max(currentFrame - this.progressSampleStartFrame, 0);
		const renderFps = (sampleFrameDelta * 1000) / sampleElapsedMs;
		const remainingFrames = Math.max(totalFrames - currentFrame, 0);
		const estimatedTimeRemaining =
			averageRenderFps > 0 && remainingFrames > 0
				? remainingFrames / averageRenderFps
				: Number.POSITIVE_INFINITY;
		this.lastRenderFps = renderFps;

		if (sampleElapsedMs >= PROGRESS_SAMPLE_WINDOW_MS) {
			this.progressSampleStartTimeMs = nowMs;
			this.progressSampleStartFrame = currentFrame;
		}

		if (this.config.onProgress) {
			this.config.onProgress({
				currentFrame,
				totalFrames,
				percentage: totalFrames > 0 ? Math.min(95, (currentFrame / totalFrames) * 95) : 0,
				estimatedTimeRemaining,
				renderFps,
			});
		}
	}

	private getNowMs(): number {
		return typeof performance !== "undefined" ? performance.now() : Date.now();
	}

	cancel(): void {
		this.cancelEstimate?.();
		this.cancelled = true;
		if (this.streamingDecoder) {
			this.streamingDecoder.cancel();
		}
		this.encoder?.abort();
		// Cleanup belongs to export() finally, after any in-flight render settles.
	}

	private cleanup(): void {
		if (this.streamingDecoder) {
			try {
				this.streamingDecoder.destroy();
			} catch (e) {
				console.warn("Error destroying streaming decoder:", e);
			}
			this.streamingDecoder = null;
		}

		if (this.renderer) {
			try {
				this.renderer.destroy();
			} catch (e) {
				console.warn("Error destroying renderer:", e);
			}
			this.renderer = null;
		}

		this.encoder?.abort();
		this.encoder = null;
	}
}
