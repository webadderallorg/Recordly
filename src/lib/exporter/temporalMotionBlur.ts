interface TemporalMotionBlurConfig {
	sampleCount: number;
	shutterFraction: number;
	weightCurvePower: number;
}

interface TemporalMotionBlurOverrides {
	sampleCount?: number | null;
	shutterFraction?: number | null;
}

interface TemporalMotionBlurSample {
	offsetUs: number;
	weight: number;
}

const MIN_BLUR_AMOUNT = 0.001;
export const TEMPORAL_MOTION_BLUR_MIN_SHUTTER_FRACTION = 0.18;
export const TEMPORAL_MOTION_BLUR_MAX_SHUTTER_FRACTION = 3;
export const TEMPORAL_MOTION_BLUR_MIN_SAMPLE_COUNT = 3;
export const TEMPORAL_MOTION_BLUR_MAX_SAMPLE_COUNT = 61;
export const TEMPORAL_MOTION_BLUR_DEFAULT_SAMPLE_COUNT = 13;
export const TEMPORAL_MOTION_BLUR_DEFAULT_SHUTTER_FRACTION = 0.94;
const TEMPORAL_MOTION_BLUR_AUTO_MIN_SHUTTER_FRACTION = 0.24;
const TEMPORAL_MOTION_BLUR_AUTO_MAX_SHUTTER_FRACTION = 0.62;
const TEMPORAL_MOTION_BLUR_AUTO_MAX_SAMPLE_COUNT = 5;
const TEMPORAL_MOTION_BLUR_WEIGHT_FLOOR = 0.22;
const MAX_BLUR_AMOUNT = 2;

function normalizeTemporalMotionBlurSampleCount(value: number | null | undefined): number | null {
	if (!Number.isFinite(value)) {
		return null;
	}

	const roundedValue = Math.round(value ?? 0);
	const clampedValue = Math.min(
		TEMPORAL_MOTION_BLUR_MAX_SAMPLE_COUNT,
		Math.max(TEMPORAL_MOTION_BLUR_MIN_SAMPLE_COUNT, roundedValue),
	);

	if (clampedValue % 2 === 1) {
		return clampedValue;
	}

	return clampedValue >= TEMPORAL_MOTION_BLUR_MAX_SAMPLE_COUNT
		? clampedValue - 1
		: clampedValue + 1;
}

export function getTemporalMotionBlurConfig(
	amount: number | null | undefined,
	overrides: TemporalMotionBlurOverrides = {},
): TemporalMotionBlurConfig | null {
	const resolvedAmount = Number.isFinite(amount) ? Math.max(0, amount ?? 0) : 0;
	if (resolvedAmount < MIN_BLUR_AMOUNT) {
		return null;
	}

	const normalizedAmount = Math.min(1, resolvedAmount / MAX_BLUR_AMOUNT);
	const sampleStepCount = Math.round(
		normalizedAmount *
			((TEMPORAL_MOTION_BLUR_AUTO_MAX_SAMPLE_COUNT - TEMPORAL_MOTION_BLUR_MIN_SAMPLE_COUNT) /
				2),
	);
	const defaultSampleCount = TEMPORAL_MOTION_BLUR_MIN_SAMPLE_COUNT + sampleStepCount * 2;
	const sampleCount =
		normalizeTemporalMotionBlurSampleCount(overrides.sampleCount) ?? defaultSampleCount;
	const shutterFraction = Number.isFinite(overrides.shutterFraction)
		? Math.min(
				TEMPORAL_MOTION_BLUR_MAX_SHUTTER_FRACTION,
				Math.max(
					TEMPORAL_MOTION_BLUR_MIN_SHUTTER_FRACTION,
					overrides.shutterFraction ?? TEMPORAL_MOTION_BLUR_AUTO_MIN_SHUTTER_FRACTION,
				),
			)
		: TEMPORAL_MOTION_BLUR_AUTO_MIN_SHUTTER_FRACTION +
			normalizedAmount *
				(TEMPORAL_MOTION_BLUR_AUTO_MAX_SHUTTER_FRACTION -
					TEMPORAL_MOTION_BLUR_AUTO_MIN_SHUTTER_FRACTION);

	return {
		sampleCount,
		shutterFraction,
		weightCurvePower: 1.2 + normalizedAmount * 0.9,
	};
}

export function buildTemporalSampleOffsetsUs(
	frameDurationUs: number,
	config: TemporalMotionBlurConfig,
): number[] {
	const safeFrameDurationUs = Math.max(1, frameDurationUs);
	const safeSampleCount = Math.max(1, Math.floor(config.sampleCount));
	if (safeSampleCount === 1) {
		return [0];
	}

	const shutterWindowUs =
		safeFrameDurationUs *
		Math.max(0, Math.min(TEMPORAL_MOTION_BLUR_MAX_SHUTTER_FRACTION, config.shutterFraction));
	const startOffsetUs = -shutterWindowUs / 2;
	const stepUs = shutterWindowUs / (safeSampleCount - 1);

	return Array.from({ length: safeSampleCount }, (_, index) => startOffsetUs + stepUs * index);
}

export function buildTemporalSamplePlanUs(
	frameDurationUs: number,
	config: TemporalMotionBlurConfig,
): TemporalMotionBlurSample[] {
	const offsetsUs = buildTemporalSampleOffsetsUs(frameDurationUs, config);
	if (offsetsUs.length === 1) {
		return [{ offsetUs: 0, weight: 1 }];
	}

	const centerIndex = (offsetsUs.length - 1) / 2;
	const rawWeights = offsetsUs.map((_offsetUs, index) => {
		const normalizedDistance = Math.abs(index - centerIndex) / Math.max(1, centerIndex);
		const taperedWeight = Math.cos(normalizedDistance * (Math.PI / 2));
		return (
			TEMPORAL_MOTION_BLUR_WEIGHT_FLOOR +
			(1 - TEMPORAL_MOTION_BLUR_WEIGHT_FLOOR) *
				Math.pow(Math.max(0, taperedWeight), config.weightCurvePower)
		);
	});
	const totalWeight = rawWeights.reduce((sum, weight) => sum + weight, 0) || 1;

	return offsetsUs.map((offsetUs, index) => ({
		offsetUs,
		weight: rawWeights[index]! / totalWeight,
	}));
}

export type { TemporalMotionBlurConfig, TemporalMotionBlurOverrides, TemporalMotionBlurSample };
