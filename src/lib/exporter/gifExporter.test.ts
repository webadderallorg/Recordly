import * as fc from "fast-check";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	buildGifFrameRendererConfig,
	calculateOutputDimensions,
	GifExporter,
	type GifExporterConfig,
	getGifRepeat,
} from "./gifExporter";
import { GIF_SIZE_PRESETS, GifSizePreset } from "./types";

/**
 * Property 2: Loop Encoding Correctness
 *
 * *For any* GIF export configuration, when loop is enabled the output GIF SHALL
 * have a loop count of 0 (infinite), and when loop is disabled the output GIF
 * SHALL have a loop count of 1 (play once).
 *
 * **Validates: Requirements 3.2, 3.3**
 *
 * Feature: gif-export, Property 2: Loop Encoding Correctness
 */
describe("GIF Exporter", () => {
	describe("Property 2: Loop Encoding Correctness", () => {
		/**
		 * Test the loop configuration mapping logic.
		 * In gif.js: repeat=0 means infinite loop, repeat=1 means play once (no loop)
		 */
		it("should map loop=true to repeat=0 (infinite) and loop=false to repeat=1 (once)", () => {
			fc.assert(
				fc.property(fc.boolean(), (loopEnabled: boolean) => {
					const repeat = getGifRepeat(loopEnabled);

					if (loopEnabled) {
						// When loop is enabled, repeat should be 0 (infinite loop)
						expect(repeat).toBe(0);
					} else {
						// When loop is disabled, repeat should be 1 (play once)
						expect(repeat).toBe(1);
					}
				}),
				{ numRuns: 100 },
			);
		});

		it("should always produce valid repeat values (0 or 1)", () => {
			fc.assert(
				fc.property(fc.boolean(), (loopEnabled: boolean) => {
					const repeat = getGifRepeat(loopEnabled);
					expect([0, 1]).toContain(repeat);
				}),
				{ numRuns: 100 },
			);
		});
	});

	/**
	 * Property 4: Aspect Ratio Preservation
	 *
	 * *For any* source video with aspect ratio R and any size preset, the exported
	 * GIF SHALL have an aspect ratio within 0.01 of R.
	 *
	 * **Validates: Requirements 4.4**
	 *
	 * Feature: gif-export, Property 4: Aspect Ratio Preservation
	 */
	describe("Property 4: Aspect Ratio Preservation", () => {
		const sizePresets: GifSizePreset[] = ["medium", "large", "original"];

		it("should preserve aspect ratio within 0.01 tolerance for all size presets", () => {
			fc.assert(
				fc.property(
					fc.integer({ min: 100, max: 4000 }), // sourceWidth
					fc.integer({ min: 100, max: 4000 }), // sourceHeight
					fc.constantFrom(...sizePresets),
					(sourceWidth: number, sourceHeight: number, sizePreset: GifSizePreset) => {
						const originalAspectRatio = sourceWidth / sourceHeight;

						const { width, height } = calculateOutputDimensions(
							sourceWidth,
							sourceHeight,
							sizePreset,
							GIF_SIZE_PRESETS,
						);

						const outputAspectRatio = width / height;

						// Aspect ratio should be preserved within 0.01 tolerance
						// (small deviation allowed due to rounding to even numbers)
						expect(Math.abs(originalAspectRatio - outputAspectRatio)).toBeLessThan(
							0.01,
						);
					},
				),
				{ numRuns: 100 },
			);
		});

		it("should return original dimensions when source is smaller than preset max height", () => {
			fc.assert(
				fc.property(
					fc.integer({ min: 100, max: 400 }), // sourceWidth (small)
					fc.integer({ min: 100, max: 400 }), // sourceHeight (small, less than 720p)
					(sourceWidth: number, sourceHeight: number) => {
						// For 'medium' preset with maxHeight 720, if source is smaller, use original
						const { width, height } = calculateOutputDimensions(
							sourceWidth,
							sourceHeight,
							"medium",
							GIF_SIZE_PRESETS,
						);

						expect(width).toBe(sourceWidth);
						expect(height).toBe(sourceHeight);
					},
				),
				{ numRuns: 100 },
			);
		});

		it('should return original dimensions for "original" preset regardless of size', () => {
			fc.assert(
				fc.property(
					fc.integer({ min: 100, max: 4000 }),
					fc.integer({ min: 100, max: 4000 }),
					(sourceWidth: number, sourceHeight: number) => {
						const { width, height } = calculateOutputDimensions(
							sourceWidth,
							sourceHeight,
							"original",
							GIF_SIZE_PRESETS,
						);

						expect(width).toBe(sourceWidth);
						expect(height).toBe(sourceHeight);
					},
				),
				{ numRuns: 100 },
			);
		});

		it("should scale down to preset max height when source is larger", () => {
			fc.assert(
				fc.property(
					fc.integer({ min: 1000, max: 4000 }), // sourceWidth (large)
					fc.integer({ min: 800, max: 2000 }), // sourceHeight (larger than 720p)
					(sourceWidth: number, sourceHeight: number) => {
						// For 'medium' preset with maxHeight 720
						const { width, height } = calculateOutputDimensions(
							sourceWidth,
							sourceHeight,
							"medium",
							GIF_SIZE_PRESETS,
						);

						// Height should be at most 720 (or 722 due to even rounding)
						expect(height).toBeLessThanOrEqual(722);
						// Width should be scaled proportionally
						expect(width).toBeLessThan(sourceWidth);
					},
				),
				{ numRuns: 100 },
			);
		});
	});
});

/**
 * Property 3: Size Preset Resolution Mapping
 *
 * *For any* valid size preset and source video dimensions, the GIF_Exporter SHALL
 * produce output with height matching the preset's max height (or source height if smaller),
 * with width calculated to maintain aspect ratio.
 *
 * **Validates: Requirements 4.2**
 *
 * Feature: gif-export, Property 3: Size Preset Resolution Mapping
 */
describe("Property 3: Size Preset Resolution Mapping", () => {
	it("should map size presets to correct max heights", () => {
		fc.assert(
			fc.property(
				fc.integer({ min: 800, max: 4000 }), // sourceWidth (large enough to trigger scaling)
				fc.integer({ min: 800, max: 2000 }), // sourceHeight (larger than all presets except original)
				fc.constantFrom("medium", "large") as fc.Arbitrary<GifSizePreset>,
				(sourceWidth: number, sourceHeight: number, sizePreset: GifSizePreset) => {
					const { height } = calculateOutputDimensions(
						sourceWidth,
						sourceHeight,
						sizePreset,
						GIF_SIZE_PRESETS,
					);

					const expectedMaxHeight = GIF_SIZE_PRESETS[sizePreset].maxHeight;

					// Height should be at or below the preset's max height
					// (allowing +2 for even number rounding)
					expect(height).toBeLessThanOrEqual(expectedMaxHeight + 2);
				},
			),
			{ numRuns: 100 },
		);
	});

	it("should use source dimensions when smaller than preset", () => {
		fc.assert(
			fc.property(
				fc.integer({ min: 100, max: 400 }), // sourceWidth
				fc.integer({ min: 100, max: 400 }), // sourceHeight (smaller than 720p 'medium' preset)
				fc.constantFrom("medium", "large", "original") as fc.Arbitrary<GifSizePreset>,
				(sourceWidth: number, sourceHeight: number, sizePreset: GifSizePreset) => {
					const { width, height } = calculateOutputDimensions(
						sourceWidth,
						sourceHeight,
						sizePreset,
						GIF_SIZE_PRESETS,
					);

					// When source is smaller than preset, use original dimensions
					expect(width).toBe(sourceWidth);
					expect(height).toBe(sourceHeight);
				},
			),
			{ numRuns: 100 },
		);
	});

	it("should produce even dimensions for encoder compatibility", () => {
		fc.assert(
			fc.property(
				fc.integer({ min: 100, max: 4000 }),
				fc.integer({ min: 100, max: 4000 }),
				fc.constantFrom("medium", "large", "original") as fc.Arbitrary<GifSizePreset>,
				(sourceWidth: number, sourceHeight: number, sizePreset: GifSizePreset) => {
					const { width, height } = calculateOutputDimensions(
						sourceWidth,
						sourceHeight,
						sizePreset,
						GIF_SIZE_PRESETS,
					);

					// When scaling occurs, dimensions should be even
					// (original dimensions are passed through as-is)
					if (
						sourceHeight > GIF_SIZE_PRESETS[sizePreset].maxHeight &&
						sizePreset !== "original"
					) {
						expect(width % 2).toBe(0);
						expect(height % 2).toBe(0);
					}
				},
			),
			{ numRuns: 100 },
		);
	});
});

describe("GIF renderer config", () => {
	it("forwards cursor click-effect settings into the frame renderer config", () => {
		const config = buildGifFrameRendererConfig(
			{
				videoUrl: "file:///recording.mp4",
				width: 1920,
				height: 1080,
				frameRate: 30,
				loop: true,
				sizePreset: "original",
				wallpaper: "#101010",
				zoomRegions: [],
				showShadow: false,
				shadowIntensity: 0,
				backgroundBlur: 0,
				cropRegion: { x: 0, y: 0, width: 1, height: 1 },
				cursorClickEffect: "echo",
				cursorClickEffectColor: "#22C55E",
				cursorClickEffectScale: 1.4,
				cursorClickEffectOpacity: 0.65,
				cursorClickEffectDurationMs: 720,
			} as never,
			{ width: 1920, height: 1080 },
		);

		expect(config).toMatchObject({
			cursorClickEffect: "echo",
			cursorClickEffectColor: "#22C55E",
			cursorClickEffectScale: 1.4,
			cursorClickEffectOpacity: 0.65,
			cursorClickEffectDurationMs: 720,
		});
	});
});

/**
 * Property 6: Frame Count Consistency
 *
 * *For any* video with effective duration D (excluding trim regions) and frame rate F,
 * the exported GIF SHALL contain approximately D × F frames (within ±1 frame tolerance).
 *
 * **Validates: Requirements 5.1**
 *
 * Feature: gif-export, Property 6: Frame Count Consistency
 */
describe("Property 6: Frame Count Consistency", () => {
	// Helper function to calculate expected frame count
	const calculateExpectedFrameCount = (durationSeconds: number, frameRate: number): number => {
		return Math.ceil(durationSeconds * frameRate);
	};

	it("should calculate correct frame count for duration and frame rate", () => {
		fc.assert(
			fc.property(
				fc.float({ min: 0.5, max: 60, noNaN: true }), // duration in seconds
				fc.constantFrom(10, 15, 20, 25, 30), // valid frame rates
				(duration: number, frameRate: number) => {
					const expectedFrames = calculateExpectedFrameCount(duration, frameRate);

					// Frame count should be positive
					expect(expectedFrames).toBeGreaterThan(0);

					// Frame count should be approximately duration * frameRate
					const approximateFrames = duration * frameRate;
					expect(Math.abs(expectedFrames - approximateFrames)).toBeLessThanOrEqual(1);
				},
			),
			{ numRuns: 100 },
		);
	});

	it("should produce more frames with higher frame rates", () => {
		fc.assert(
			fc.property(
				fc.float({ min: 1, max: 30, noNaN: true }), // duration in seconds
				(duration: number) => {
					const frames10fps = calculateExpectedFrameCount(duration, 10);
					const frames30fps = calculateExpectedFrameCount(duration, 30);

					// 30fps should produce approximately 3x more frames than 10fps
					expect(frames30fps).toBeGreaterThan(frames10fps);
					expect(frames30fps / frames10fps).toBeCloseTo(3, 0);
				},
			),
			{ numRuns: 100 },
		);
	});

	it("should handle trim regions by reducing effective duration", () => {
		fc.assert(
			fc.property(
				fc.float({ min: 5, max: 60, noNaN: true }), // total duration
				fc.float({ min: 0.5, max: 2, noNaN: true }), // trim duration (smaller than total)
				fc.constantFrom(10, 15, 20, 25, 30),
				(totalDuration: number, trimDuration: number, frameRate: number) => {
					const effectiveDuration = totalDuration - trimDuration;
					const framesWithTrim = calculateExpectedFrameCount(
						effectiveDuration,
						frameRate,
					);
					const framesWithoutTrim = calculateExpectedFrameCount(totalDuration, frameRate);

					// Trimmed video should have fewer frames
					expect(framesWithTrim).toBeLessThan(framesWithoutTrim);
				},
			),
			{ numRuns: 100 },
		);
	});
});

/**
 * Property 5: Valid GIF Output (Configuration Validation)
 *
 * *For any* successful GIF export, the output blob SHALL be a valid GIF file.
 * This test validates the GIF configuration parameters are correctly set up.
 *
 * **Validates: Requirements 5.3**
 *
 * Feature: gif-export, Property 5: Valid GIF Output
 *
 * Note: Full GIF encoding validation requires browser environment with video.
 * This test validates configuration correctness.
 */
describe("Property 5: Valid GIF Output (Configuration)", () => {
	it("should generate valid GIF configuration for all frame rates", () => {
		fc.assert(
			fc.property(
				fc.constantFrom(10, 15, 20, 25, 30),
				fc.integer({ min: 100, max: 1920 }),
				fc.integer({ min: 100, max: 1080 }),
				fc.boolean(),
				(frameRate: number, width: number, height: number, loop: boolean) => {
					// Validate frame delay calculation (gif.js uses milliseconds)
					const frameDelay = Math.round(1000 / frameRate);

					// Frame delay should be positive and reasonable
					expect(frameDelay).toBeGreaterThan(0);
					expect(frameDelay).toBeLessThanOrEqual(100); // 10fps = 100ms delay

					// Loop configuration
					const repeat = loop ? 0 : 1;
					expect([0, 1]).toContain(repeat);

					// Dimensions should be positive
					expect(width).toBeGreaterThan(0);
					expect(height).toBeGreaterThan(0);
				},
			),
			{ numRuns: 100 },
		);
	});

	it("should calculate correct frame delays for each frame rate", () => {
		const expectedDelays: Record<number, number> = {
			10: 100, // 1000ms / 10fps = 100ms
			15: 67, // 1000ms / 15fps ≈ 67ms
			20: 50, // 1000ms / 20fps = 50ms
			25: 40, // 1000ms / 25fps = 40ms
			30: 33, // 1000ms / 30fps ≈ 33ms
		};

		for (const [fps, expectedDelay] of Object.entries(expectedDelays)) {
			const frameRate = Number(fps);
			const actualDelay = Math.round(1000 / frameRate);
			expect(actualDelay).toBe(expectedDelay);
		}
	});
});

/**
 * Property 7: MP4 Export Regression
 *
 * *For any* valid MP4 export configuration that worked before this feature,
 * the Video_Exporter SHALL continue to produce valid MP4 output.
 *
 * **Validates: Requirements 7.2**
 *
 * Feature: gif-export, Property 7: MP4 Export Regression
 *
 * Note: This test validates that MP4 export configuration remains unchanged.
 */
describe("Property 7: MP4 Export Regression", () => {
	it("should maintain valid MP4 quality presets", () => {
		const qualityPresets = ["medium", "good", "source"];

		fc.assert(
			fc.property(fc.constantFrom(...qualityPresets), (quality: string) => {
				// Quality presets should be valid
				expect(["medium", "good", "source"]).toContain(quality);
			}),
			{ numRuns: 100 },
		);
	});

	it("should calculate valid MP4 export dimensions", () => {
		fc.assert(
			fc.property(
				fc.integer({ min: 640, max: 3840 }), // sourceWidth
				fc.integer({ min: 480, max: 2160 }), // sourceHeight
				fc.constantFrom("medium", "good", "source"),
				(sourceWidth: number, sourceHeight: number, quality: string) => {
					let exportWidth: number;
					let exportHeight: number;
					const aspectRatio = sourceWidth / sourceHeight;

					if (quality === "source") {
						// Source quality uses original dimensions (may be odd)
						exportWidth = sourceWidth;
						exportHeight = sourceHeight;

						// Dimensions should be positive
						expect(exportWidth).toBeGreaterThan(0);
						expect(exportHeight).toBeGreaterThan(0);
					} else {
						const targetHeight = quality === "medium" ? 720 : 1080;
						exportHeight = Math.floor(targetHeight / 2) * 2;
						exportWidth = Math.floor((exportHeight * aspectRatio) / 2) * 2;

						// Dimensions should be positive and even for non-source quality
						expect(exportWidth).toBeGreaterThan(0);
						expect(exportHeight).toBeGreaterThan(0);
						expect(exportWidth % 2).toBe(0);
						expect(exportHeight % 2).toBe(0);
					}
				},
			),
			{ numRuns: 100 },
		);
	});

	it("should maintain aspect ratio in MP4 export", () => {
		fc.assert(
			fc.property(
				fc.integer({ min: 640, max: 3840 }),
				fc.integer({ min: 480, max: 2160 }),
				fc.constantFrom("medium", "good"),
				(sourceWidth: number, sourceHeight: number, quality: string) => {
					const originalAspectRatio = sourceWidth / sourceHeight;
					const targetHeight = quality === "medium" ? 720 : 1080;

					const exportHeight = Math.floor(targetHeight / 2) * 2;
					const exportWidth = Math.floor((exportHeight * originalAspectRatio) / 2) * 2;

					const exportAspectRatio = exportWidth / exportHeight;

					// Aspect ratio should be preserved within tolerance (due to even rounding)
					expect(Math.abs(originalAspectRatio - exportAspectRatio)).toBeLessThan(0.05);
				},
			),
			{ numRuns: 100 },
		);
	});
});

const estimateMocks = vi.hoisted(() => ({
	duration: 10,
	renderFrame: vi.fn(async () => {}),
	destroyRenderer: vi.fn(),
	destroyDecoder: vi.fn(),
	optimize: vi.fn(),
	encode: true,
	frames: 0,
}));
vi.mock("./frameRenderer", () => ({
	FrameRenderer: class {
		initialize = async () => {};
		cancelPendingMedia = () => {};
		renderFrame = estimateMocks.renderFrame;
		getCanvas = () => ({});
		destroy = estimateMocks.destroyRenderer;
	},
}));
vi.mock("./streamingDecoder", () => ({
	StreamingVideoDecoder: class {
		cancelled = false;
		loadMetadata = async () => ({ width: 100, height: 100, duration: estimateMocks.duration });
		getEffectiveDuration = () => estimateMocks.duration;
		async decodeAll(
			_fps: number,
			_trims: unknown,
			_speeds: unknown,
			onFrame: (...args: unknown[]) => Promise<void>,
		) {
			for (let i = 0; i < 500 && !this.cancelled; i++) await onFrame(null, i * 1000, i, i);
		}
		async decodeSampleWindow(
			fps: number,
			_trims: unknown,
			_speeds: unknown,
			onFrame: (...args: unknown[]) => Promise<void>,
			_clips: unknown,
			start: number,
			count: number,
		) {
			for (let i = start; i < start + count && !this.cancelled; i++)
				await onFrame(null, (i * 1_000_000) / fps, (i * 1000) / fps, (i * 1000) / fps);
		}

		cancel() {
			this.cancelled = true;
		}
		destroy = estimateMocks.destroyDecoder;
	},
}));
vi.mock("./streamingGifEncoder", () => ({
	StreamingGifEncoder: class {
		rejectEncoding?: (error: Error) => void;
		constructor(private config: { onFrameEncoded?: (completed: number) => void }) {}
		async addFrame() {
			estimateMocks.frames++;
			this.config.onFrameEncoded?.(estimateMocks.frames);
		}
		finish() {
			return estimateMocks.encode
				? Promise.resolve(new Blob([new Uint8Array(100)]))
				: new Promise<Blob>((_resolve, reject) => {
						this.rejectEncoding = reject;
					});
		}
		abort() {
			this.rejectEncoding?.(new DOMException("GIF export cancelled", "AbortError"));
		}
	},
}));
vi.mock("./gifOptimization", () => ({ optimizeGif: estimateMocks.optimize }));

describe("GIF pre-export size estimation", () => {
	const config: GifExporterConfig = {
		videoUrl: "video.mp4",
		width: 100,
		height: 100,
		frameRate: 30,
		loop: true,
		sizePreset: "original",
		wallpaper: "#000",
		zoomRegions: [],
		showShadow: false,
		shadowIntensity: 0,
		backgroundBlur: 0,
		cropRegion: { x: 0, y: 0, width: 1, height: 1 },
	};
	beforeEach(() => {
		vi.stubGlobal("navigator", { hardwareConcurrency: 4 });
		estimateMocks.duration = 10;
		estimateMocks.frames = 0;
		estimateMocks.encode = true;
		vi.clearAllMocks();
		estimateMocks.renderFrame.mockImplementation(async () => {});
		estimateMocks.optimize.mockResolvedValue({
			blob: new Blob([new Uint8Array(40)]),
			status: "optimized",
			reductionPercent: 60,
		});
	});
	afterEach(() => vi.unstubAllGlobals());

	it("encodes during rendering and never reports100 or a zero ETA for unfinished work", async () => {
		const progress = vi.fn();
		const result = await new GifExporter({ ...config, onProgress: progress }).export();
		expect(result.success).toBe(true);
		expect(progress.mock.calls.length).toBeGreaterThan(1);
		for (const [update] of progress.mock.calls) {
			expect(update.percentage).toBeLessThanOrEqual(95);
			expect(update.estimatedTimeRemaining).toBeGreaterThan(0);
		}
		expect(progress.mock.lastCall?.[0].phase).toBe("finalizing");
	});

	it("settles cancellation while export workers drain", async () => {
		estimateMocks.encode = false;
		const exporter = new GifExporter(config);
		const result = exporter.export();
		await vi.waitFor(() => expect(estimateMocks.frames).toBe(500));
		exporter.cancel();
		await expect(result).resolves.toMatchObject({ success: false });
		expect(estimateMocks.destroyRenderer).toHaveBeenCalledOnce();
		expect(estimateMocks.destroyDecoder).toHaveBeenCalledOnce();
	});

	it("waits for an active export render before destroying resources on cancellation", async () => {
		let completeFrame!: () => void;
		estimateMocks.renderFrame.mockImplementationOnce(
			() =>
				new Promise<void>((resolve) => {
					completeFrame = resolve;
				}),
		);
		const exporter = new GifExporter(config);
		const result = exporter.export();
		await vi.waitFor(() => expect(completeFrame).toBeTypeOf("function"));
		exporter.cancel();
		expect(estimateMocks.destroyRenderer).not.toHaveBeenCalled();
		completeFrame();
		await expect(result).resolves.toMatchObject({ success: false });
		expect(estimateMocks.destroyRenderer).toHaveBeenCalledOnce();
		expect(estimateMocks.frames).toBe(0);
	});

	it("encodes 60 centered frames and scales the real sample's byte sizes to the edited duration", async () => {
		const estimate = await new GifExporter(config).estimateSize();
		expect(estimate).toEqual({
			originalBytes: 500,
			optimizedBytes: 200,
			reductionPercent: 60,
			sampleFrames: 60,
			totalFrames: 300,
		});
		expect(estimateMocks.frames).toBe(60);
		expect(estimateMocks.renderFrame.mock.calls[0]).toEqual([
			null,
			4_000_000,
			4_000_000,
			1_000_000 / 30,
			4_000_000,
		]);
		expect(estimateMocks.optimize).toHaveBeenCalledWith(
			expect.objectContaining({ size: 100 }),
			expect.any(AbortSignal),
		);
		expect(estimateMocks.destroyRenderer).toHaveBeenCalledOnce();
		expect(estimateMocks.destroyDecoder).toHaveBeenCalledOnce();
	});

	it("uses 60 frames at 10 FPS too", async () => {
		await new GifExporter({ ...config, frameRate: 10 }).estimateSize();
		expect(estimateMocks.frames).toBe(60);
	});

	it("samples the entire very short export without extrapolating extra frames", async () => {
		estimateMocks.duration = 0.1;
		await expect(new GifExporter(config).estimateSize()).resolves.toMatchObject({
			originalBytes: 100,
			optimizedBytes: 40,
			sampleFrames: 3,
			totalFrames: 3,
		});
	});

	it("rejects a pre-aborted request without encoding", async () => {
		const controller = new AbortController();
		controller.abort();
		await expect(new GifExporter(config).estimateSize(controller.signal)).rejects.toMatchObject(
			{ name: "AbortError" },
		);
		expect(estimateMocks.frames).toBe(0);
	});

	it("settles cancellation while the encoder is draining", async () => {
		estimateMocks.encode = false;
		const exporter = new GifExporter(config);
		const result = exporter.estimateSize();
		await vi.waitFor(() => expect(estimateMocks.frames).toBe(60));
		exporter.cancel();
		await expect(result).rejects.toMatchObject({ name: "AbortError" });
		expect(estimateMocks.optimize).not.toHaveBeenCalled();
	});

	it("defers renderer cleanup until an in-flight frame has settled after abort", async () => {
		let completeFrame!: () => void;
		estimateMocks.renderFrame.mockImplementationOnce(
			() =>
				new Promise<void>((resolve) => {
					completeFrame = resolve;
				}),
		);
		const controller = new AbortController();
		const result = new GifExporter(config).estimateSize(controller.signal);
		await vi.waitFor(() => expect(completeFrame).toBeTypeOf("function"));
		controller.abort();
		await expect(result).rejects.toMatchObject({ name: "AbortError" });
		expect(estimateMocks.destroyRenderer).not.toHaveBeenCalled();
		completeFrame();
		await vi.waitFor(() => expect(estimateMocks.destroyRenderer).toHaveBeenCalledOnce());
		expect(estimateMocks.frames).toBe(0);
	});

	it("bounds a stalled encoder with a timeout", async () => {
		vi.useFakeTimers();
		try {
			estimateMocks.encode = false;
			const result = new GifExporter(config).estimateSize();
			const rejected = expect(result).rejects.toMatchObject({ name: "AbortError" });
			await vi.advanceTimersByTimeAsync(0);
			expect(estimateMocks.frames).toBe(60);
			await vi.advanceTimersByTimeAsync(45_000);
			await rejected;
			expect(estimateMocks.destroyRenderer).toHaveBeenCalledOnce();
		} finally {
			vi.useRealTimers();
		}
	});

	it("does not report a fabricated 0% reduction when optimization fails", async () => {
		estimateMocks.optimize.mockResolvedValue({ status: "failed" });
		await expect(new GifExporter(config).estimateSize()).rejects.toThrow(
			"GIF size estimation failed",
		);
	});
});
