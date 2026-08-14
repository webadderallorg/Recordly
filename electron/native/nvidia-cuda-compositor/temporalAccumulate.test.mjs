import { describe, expect, it } from "vitest";

// Contract test for the fused temporal composite + accumulate in main.cu
// (compositeStaticNv12Kernel temporalWeightFixed/temporalAccumulateMode). The
// native kernel replaced the two-pass fill/composite/accumulate pipeline with a
// single fused pass: sample 0 replaces the target with (w0 * v + 128) >> 8 and
// later samples saturate-accumulate (w * v + 128) >> 8. This JS mirror verifies
// the fused order reproduces the previous zero-fill + saturating adds exactly,
// including the fixed-point weight plan used by buildTemporalSamplePlan.
//
// Module 3 contracts (constants synchronized with current CUDA math in
// electron/native/nvidia-cuda-compositor/src/main.cu):
// - stationary-transform fixed-point accumulation equivalence: with an
//   invariant per-sample transform, the fused full-frame path, the legacy
//   zero-fill path, and the background-precompose path (accumulateBackgroundNv12Kernel
//   one-pass term chain + region re-composite) are bit-identical.
// - sample-count-aware precompose threshold: the cost-model break-even region
//   ratio is (sampleCount - 1) / sampleCount, while the CUDA decision keeps a
//   fixed 19/20 region gate (regionPixels * 20 < framePixels * 19) plus the
//   empty-sample and shadowIntensityPct == 0 gates.
// - a stationary-window predicate mirror for the invariant-transform property
//   the compositor exploits implicitly (per-sample content rects collapse to
//   one rect, so the UV-expanded region is identical every sample).

function buildTemporalSamplePlan(sampleCount, shutterFraction, weightCurvePower, frameDurationUs) {
	const safeSampleCount = Math.max(1, sampleCount);
	if (safeSampleCount <= 1) {
		return [{ offsetUs: 0.0, weight: 1.0 }];
	}
	const shutterWindowUs =
		Math.max(1.0, frameDurationUs) * Math.max(0.0, Math.min(3.0, shutterFraction));
	const startOffsetUs = -shutterWindowUs / 2.0;
	const stepUs = shutterWindowUs / (safeSampleCount - 1);
	const offsetsUs = [];
	for (let index = 0; index < safeSampleCount; index += 1) {
		offsetsUs.push(startOffsetUs + stepUs * index);
	}
	const kWeightFloor = 0.22;
	const centerIndex = (safeSampleCount - 1) / 2;
	const rawWeights = [];
	let totalWeight = 0;
	for (let index = 0; index < safeSampleCount; index += 1) {
		const normalizedDistance = Math.abs(index - centerIndex) / Math.max(1, centerIndex);
		const taperedWeight = Math.cos(normalizedDistance * (Math.PI / 2));
		const rawWeight =
			kWeightFloor +
			(1 - kWeightFloor) * Math.pow(Math.max(0, taperedWeight), weightCurvePower);
		rawWeights.push(rawWeight);
		totalWeight += rawWeight;
	}
	return offsetsUs.map((offsetUs, index) => ({
		offsetUs,
		weight: totalWeight > 0 ? rawWeights[index] / totalWeight : 1 / safeSampleCount,
	}));
}

function temporalAccumulateByte(current, value, weightFixed, mode) {
	if (mode === 0) {
		return value;
	}
	const weighted = (weightFixed * value + 128) >> 8;
	if (mode === 1) {
		return Math.min(255, weighted);
	}
	return Math.min(255, current + weighted);
}

// Old two-pass: zero-fill target, then per sample add (w * scratch + 128) >> 8.
function oldAccumulate(values, weights) {
	let target = 0;
	for (let index = 0; index < values.length; index += 1) {
		const weightFixed = Math.round(weights[index] * 256);
		target = Math.min(255, target + ((weightFixed * values[index] + 128) >> 8));
	}
	return target;
}

// New fused: sample 0 replaces with (w0 * v + 128) >> 8, rest saturate-accumulate.
function fusedAccumulate(values, weights) {
	let target = 0;
	for (let index = 0; index < values.length; index += 1) {
		const weightFixed = Math.round(weights[index] * 256);
		target = temporalAccumulateByte(target, values[index], weightFixed, index === 0 ? 1 : 2);
	}
	return target;
}

// Mirrors ensureTemporalWeightsDevice in main.cu: weights are rounded to 8-bit
// fixed point once (std::lround(weight * 256.0)) and reused by every
// accumulate pass, so per-sample rounding is identical across paths.
function fixedWeights(weights) {
	return weights.map((weight) => Math.round(weight * 256));
}

// Mirrors accumulateBackgroundNv12Kernel in main.cu: sample 0 seeds the
// accumulator with (w0 * v + 128) >> 8 and every later sample saturate-adds
// (w * v + 128) >> 8 (min(255, acc + term)). This is the kernel's one-pass
// invariant-background accumulation; for a stationary transform it is exactly
// what the fused and legacy full-frame paths produce per pixel.
function saturatingAccumulate(value, weights) {
	if (weights.length === 0) {
		return 0;
	}
	const fixed = fixedWeights(weights);
	let acc = (fixed[0] * value + 128) >> 8;
	for (let index = 1; index < fixed.length; index += 1) {
		acc = Math.min(255, acc + ((fixed[index] * value + 128) >> 8));
	}
	return acc;
}

// Mirrors the useBackgroundPrecompose decision in compositeTemporalBlurSamples:
// precompose requires at least one sample, no shadow compositing
// (shadowIntensityPct == 0), and either no visible content or a positive
// UV-expanded region strictly smaller than 19/20 of the frame
// (regionPixels * 20 < framePixels * 19). The 20/19 constants are the current
// CUDA math; the sample-count-aware cost model is mirrored separately below.
function shouldUseBackgroundPrecompose({
	sampleCount,
	shadowIntensityPct,
	anyContentVisible,
	regionWidth,
	regionHeight,
	frameWidth,
	frameHeight,
}) {
	return (
		sampleCount > 0 &&
		shadowIntensityPct === 0 &&
		(!anyContentVisible ||
			(regionWidth > 0 &&
				regionHeight > 0 &&
				regionWidth * regionHeight * 20 < frameWidth * frameHeight * 19))
	);
}

// Cost model behind the precompose choice: the legacy path composites the full
// frame per sample (sampleCount * framePixels); precompose runs one full-frame
// background pass plus one region pass per sample
// (framePixels + sampleCount * regionPixels). Precompose wins strictly when
// regionPixels < framePixels * (sampleCount - 1) / sampleCount. The integer
// form keeps the strict-inequality boundary exact for every supported sample
// count (the CUDA option gate accepts 3..61 samples).
function precomposeWinsCostModel(sampleCount, regionPixels, framePixels) {
	return regionPixels * sampleCount < framePixels * (sampleCount - 1);
}

function precomposeBreakEvenRegionRatio(sampleCount) {
	return (sampleCount - 1) / sampleCount;
}

// Stationary-window predicate mirror. The CUDA compositor has no dedicated
// stationary predicate: invariance is implicit because every sample composites
// the same transform, so the per-sample content bounding boxes collapse to one
// rect and the UV-expanded region is identical for every sample. This mirror
// models that property (scale/x/y unchanged within epsilon) for the
// stationary-equivalence tests. blurStrength/blurCenter are intentionally
// ignored: the temporal path replaces spatial blur for those frames.
function isStationarySampleWindow(samples) {
	if (samples.length === 0) {
		return false;
	}
	const first = samples[0];
	if (
		!first ||
		typeof first.scale !== "number" ||
		typeof first.x !== "number" ||
		typeof first.y !== "number"
	) {
		return false;
	}
	const epsilon = 1e-9;
	return samples.every(
		(sample) =>
			Math.abs(sample.scale - first.scale) <= epsilon &&
			Math.abs(sample.x - first.x) <= epsilon &&
			Math.abs(sample.y - first.y) <= epsilon,
	);
}

// Models one NV12 plane (luma or chroma) for a stationary transform: every
// sample composites the same invariant per-pixel value (content inside the
// region, background outside), so the whole-frame fused path, the legacy
// zero-fill path, and the background-precompose path must agree bit-for-bit.
// Returns the three results as arrays indexed by y * width + x.
function stationaryPlaneEquivalence({
	width,
	height,
	regionWidth,
	regionHeight,
	contentValues,
	backgroundValue,
	weights,
}) {
	const fullFrameFused = [];
	const fullFrameOld = [];
	for (let y = 0; y < height; y += 1) {
		for (let x = 0; x < width; x += 1) {
			const invariantValue =
				x < regionWidth && y < regionHeight
					? contentValues[y * width + x]
					: backgroundValue;
			fullFrameFused.push(
				fusedAccumulate(new Array(weights.length).fill(invariantValue), weights),
			);
			fullFrameOld.push(
				oldAccumulate(new Array(weights.length).fill(invariantValue), weights),
			);
		}
	}

	// Background precompose: accumulate the invariant background once per pixel
	// over the full frame (the kernel mirror), then re-composite only the region
	// per sample: sample 0 replaces the precomposed background (the target is
	// not pre-zeroed) and later samples saturate-accumulate.
	const backgroundAcc = saturatingAccumulate(backgroundValue, weights);
	const backgroundPrecompose = new Array(width * height).fill(backgroundAcc);
	for (let y = 0; y < regionHeight; y += 1) {
		for (let x = 0; x < regionWidth; x += 1) {
			const index = y * width + x;
			backgroundPrecompose[index] = fusedAccumulate(
				new Array(weights.length).fill(contentValues[index]),
				weights,
			);
		}
	}

	return { fullFrameFused, fullFrameOld, backgroundPrecompose };
}

function planWeights(sampleCount, shutterFraction = 0.5, weightCurvePower = 2) {
	return buildTemporalSamplePlan(
		sampleCount,
		shutterFraction,
		weightCurvePower,
		1000000 / 30,
	).map((sample) => sample.weight);
}

describe("fused temporal accumulate contract", () => {
	it("fused replace-then-accumulate equals zero-fill + saturating adds", () => {
		const plan = buildTemporalSamplePlan(13, 0.5, 2, 1000000 / 30);
		const weights = plan.map((sample) => sample.weight);
		const fixedSum = weights.reduce((sum, w) => sum + Math.round(w * 256), 0);
		expect(fixedSum).toBeGreaterThan(250);

		// Deterministic pseudo-random values covering the full byte range.
		let seed = 12345;
		const values = [];
		for (let i = 0; i < 13; i += 1) {
			seed = (seed * 1664525 + 1013904223) >>> 0;
			values.push((seed >> 16) & 0xff);
		}
		expect(fusedAccumulate(values, weights)).toBe(oldAccumulate(values, weights));
	});

	it("constant luma/background values accumulate to the renderer result", () => {
		const plan = buildTemporalSamplePlan(13, 0.5, 2, 1000000 / 30);
		const weights = plan.map((sample) => sample.weight);
		// Constant 128 (neutral chroma) must land on the documented 131 for this plan.
		expect(fusedAccumulate(new Array(13).fill(128), weights)).toBe(131);
	});

	it("keeps saturating semantics per step (no wraparound near 255)", () => {
		const plan = buildTemporalSamplePlan(13, 0.5, 2, 1000000 / 30);
		const weights = plan.map((sample) => sample.weight);
		const result = fusedAccumulate(new Array(13).fill(255), weights);
		// Saturating adds must never wrap below 250 for an all-255 frame.
		expect(result).toBeGreaterThan(250);
		expect(result).toBe(oldAccumulate(new Array(13).fill(255), weights));
	});

	it("matches the old pipeline for a range of shutter fractions and sample counts", () => {
		for (const sampleCount of [3, 5, 9, 13, 17]) {
			for (const shutter of [0.25, 0.5, 1.0]) {
				const plan = buildTemporalSamplePlan(sampleCount, shutter, 2, 1000000 / 30);
				const weights = plan.map((sample) => sample.weight);
				for (const base of [0, 1, 16, 64, 128, 200, 254, 255]) {
					const values = new Array(sampleCount).fill(base);
					expect(fusedAccumulate(values, weights)).toBe(oldAccumulate(values, weights));
				}
			}
		}
	});
});

describe("stationary-transform fixed-point accumulation equivalence", () => {
	it("fused full-frame, legacy zero-fill, and background precompose agree for a stationary window", () => {
		const width = 64;
		const height = 36;
		const regionWidth = 40;
		const regionHeight = 24;
		let seed = 987654321;
		const contentValues = [];
		for (let index = 0; index < regionWidth * regionHeight; index += 1) {
			seed = (seed * 1664525 + 1013904223) >>> 0;
			contentValues.push((seed >> 16) & 0xff);
		}
		for (const sampleCount of [3, 5, 13, 61]) {
			const weights = planWeights(sampleCount);
			const { fullFrameFused, fullFrameOld, backgroundPrecompose } =
				stationaryPlaneEquivalence({
					width,
					height,
					regionWidth,
					regionHeight,
					contentValues,
					backgroundValue: 16,
					weights,
				});
			expect(fullFrameFused).toEqual(fullFrameOld);
			expect(backgroundPrecompose).toEqual(fullFrameFused);
		}
	});

	it("the background accumulate kernel mirror equals the fused and legacy paths for any constant value", () => {
		for (const sampleCount of [3, 5, 13, 61]) {
			const weights = planWeights(sampleCount);
			for (const backgroundValue of [0, 1, 16, 64, 128, 200, 254, 255]) {
				expect(saturatingAccumulate(backgroundValue, weights)).toBe(
					fusedAccumulate(new Array(sampleCount).fill(backgroundValue), weights),
				);
				expect(saturatingAccumulate(backgroundValue, weights)).toBe(
					oldAccumulate(new Array(sampleCount).fill(backgroundValue), weights),
				);
			}
		}
	});

	it("matches on chroma planes and at saturation boundaries across sample counts", () => {
		const width = 32;
		const height = 18;
		const regionWidth = 20;
		const regionHeight = 12;
		for (const sampleCount of [3, 5, 13, 61]) {
			const weights = planWeights(sampleCount);
			const chroma = stationaryPlaneEquivalence({
				width,
				height,
				regionWidth,
				regionHeight,
				contentValues: new Array(regionWidth * regionHeight).fill(128),
				backgroundValue: 128,
				weights,
			});
			const luma = stationaryPlaneEquivalence({
				width,
				height,
				regionWidth,
				regionHeight,
				contentValues: new Array(regionWidth * regionHeight).fill(255),
				backgroundValue: 16,
				weights,
			});
			expect(chroma.backgroundPrecompose).toEqual(chroma.fullFrameFused);
			expect(luma.backgroundPrecompose).toEqual(luma.fullFrameOld);
			// Saturating adds must never wrap; neutral chroma stays <= 255.
			expect(Math.max(...chroma.fullFrameFused)).toBeLessThanOrEqual(255);
			expect(Math.max(...luma.backgroundPrecompose)).toBeLessThanOrEqual(255);
		}
	});
});

describe("sample-count-aware precompose threshold", () => {
	it("break-even region ratio is (sampleCount - 1) / sampleCount", () => {
		expect(precomposeBreakEvenRegionRatio(3)).toBe(2 / 3);
		expect(precomposeBreakEvenRegionRatio(5)).toBe(4 / 5);
		expect(precomposeBreakEvenRegionRatio(13)).toBe(12 / 13);
		expect(precomposeBreakEvenRegionRatio(61)).toBe(60 / 61);
	});

	it("strictly favors precompose only below the break-even region for 3, 5, 13, and 61 samples", () => {
		const framePixels = 1920 * 1080;
		for (const sampleCount of [3, 5, 13, 61]) {
			// Largest integer region strictly below the real break-even
			// B = framePixels * (sampleCount - 1) / sampleCount is ceil(B) - 1;
			// floor(B) is one too large when B is not an integer.
			const largestBelow = Math.ceil((framePixels * (sampleCount - 1)) / sampleCount) - 1;
			expect(precomposeWinsCostModel(sampleCount, largestBelow, framePixels)).toBe(true);
			expect(precomposeWinsCostModel(sampleCount, largestBelow + 1, framePixels)).toBe(false);
			expect(precomposeWinsCostModel(sampleCount, 0, framePixels)).toBe(true);
			expect(precomposeWinsCostModel(sampleCount, framePixels, framePixels)).toBe(false);
		}
	});

	it("mirrors the current CUDA 20/19 fixed region threshold", () => {
		const base = {
			sampleCount: 13,
			shadowIntensityPct: 0,
			anyContentVisible: true,
			frameWidth: 1000,
			frameHeight: 1000,
		};
		// 949000 < 950000 (19/20 of 1000x1000): precompose.
		expect(
			shouldUseBackgroundPrecompose({ ...base, regionWidth: 949, regionHeight: 1000 }),
		).toBe(true);
		// Exactly 19/20 is not strictly smaller: legacy full-frame path.
		expect(
			shouldUseBackgroundPrecompose({ ...base, regionWidth: 950, regionHeight: 1000 }),
		).toBe(false);
		expect(
			shouldUseBackgroundPrecompose({ ...base, regionWidth: 951, regionHeight: 1000 }),
		).toBe(false);
	});

	it("keeps the empty-sample and shadow gates from the CUDA decision", () => {
		const base = {
			sampleCount: 13,
			shadowIntensityPct: 0,
			anyContentVisible: true,
			regionWidth: 100,
			regionHeight: 100,
			frameWidth: 1000,
			frameHeight: 1000,
		};
		expect(shouldUseBackgroundPrecompose({ ...base, sampleCount: 0 })).toBe(false);
		expect(shouldUseBackgroundPrecompose({ ...base, shadowIntensityPct: 40 })).toBe(false);
		expect(shouldUseBackgroundPrecompose(base)).toBe(true);
		// No visible content: precompose regardless of the region size.
		expect(
			shouldUseBackgroundPrecompose({
				...base,
				anyContentVisible: false,
				regionWidth: 0,
				regionHeight: 0,
			}),
		).toBe(true);
		// Degenerate region with visible content: legacy.
		expect(
			shouldUseBackgroundPrecompose({
				...base,
				anyContentVisible: true,
				regionWidth: 0,
				regionHeight: 0,
			}),
		).toBe(false);
	});

	it("applies the fixed threshold at every supported sample count", () => {
		for (const sampleCount of [3, 5, 13, 61]) {
			const base = {
				sampleCount,
				shadowIntensityPct: 0,
				anyContentVisible: true,
				frameWidth: 1920,
				frameHeight: 1080,
			};
			// 19/20 of 1920x1080 is exactly 1920x1026.
			expect(
				shouldUseBackgroundPrecompose({ ...base, regionWidth: 1920, regionHeight: 1026 }),
			).toBe(false);
			expect(
				shouldUseBackgroundPrecompose({ ...base, regionWidth: 1920, regionHeight: 1025 }),
			).toBe(true);
		}
	});

	it("pins the band where the fixed threshold and the cost model diverge by sample count", () => {
		const framePixels = 1920 * 1080;
		// 3 samples: break-even is 2/3. A 90%-of-frame region is cheaper via the
		// legacy path, but the current CUDA threshold still selects precompose
		// (exact output, just more region work than legacy).
		expect(precomposeWinsCostModel(3, 1920 * 972, framePixels)).toBe(false);
		expect(
			shouldUseBackgroundPrecompose({
				sampleCount: 3,
				shadowIntensityPct: 0,
				anyContentVisible: true,
				regionWidth: 1920,
				regionHeight: 972,
				frameWidth: 1920,
				frameHeight: 1080,
			}),
		).toBe(true);
		// 61 samples: break-even is 60/61 (~98.4%). A 96%-of-frame region is
		// cheaper via precompose, but the fixed threshold keeps the legacy path.
		expect(precomposeWinsCostModel(61, 1920 * 1037, framePixels)).toBe(true);
		expect(
			shouldUseBackgroundPrecompose({
				sampleCount: 61,
				shadowIntensityPct: 0,
				anyContentVisible: true,
				regionWidth: 1920,
				regionHeight: 1037,
				frameWidth: 1920,
				frameHeight: 1080,
			}),
		).toBe(false);
	});
});

describe("stationary-window predicate mirror", () => {
	it("accepts a window where every sample shares the same transform", () => {
		const samples = [
			{ offsetUs: -16666.666666666668, weight: 0.02918, scale: 1.25, x: 40, y: 20 },
			{ offsetUs: 0, weight: 0.081, scale: 1.25, x: 40, y: 20 },
			{ offsetUs: 16666.666666666668, weight: 0.02918, scale: 1.25, x: 40, y: 20 },
		];
		expect(isStationarySampleWindow(samples)).toBe(true);
	});

	it("rejects windows with zoom or pan motion between samples", () => {
		expect(
			isStationarySampleWindow([
				{ scale: 1.0, x: 0, y: 0 },
				{ scale: 1.1, x: 0, y: 0 },
			]),
		).toBe(false);
		expect(
			isStationarySampleWindow([
				{ scale: 1.0, x: 0, y: 0 },
				{ scale: 1.0, x: 3, y: 0 },
			]),
		).toBe(false);
		expect(
			isStationarySampleWindow([
				{ scale: 1.0, x: 0, y: 0 },
				{ scale: 1.0, x: 0, y: -2 },
			]),
		).toBe(false);
	});

	it("accepts a single-sample plan and rejects empty or malformed windows", () => {
		expect(isStationarySampleWindow([])).toBe(false);
		expect(isStationarySampleWindow([{ scale: 1.0, x: 0, y: 0 }])).toBe(true);
		expect(isStationarySampleWindow([{ weight: 1.0 }])).toBe(false);
	});
});
