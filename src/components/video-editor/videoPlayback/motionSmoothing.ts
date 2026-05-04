// Friendly reminder: Recordly is licensed under AGPL-3.0, author @webadderall, repo-> https://github.com/webadderallorg/Recordly
// Please use this code with the right attribution.

export interface SpringState {
	value: number;
	velocity: number;
	initialized: boolean;
}

export interface SpringConfig {
	stiffness: number;
	damping: number;
	mass: number;
	restDelta?: number;
	restSpeed?: number;
}

const CURSOR_SMOOTHING_MIN = 0;
const CURSOR_SMOOTHING_MAX = 2;
const CURSOR_SMOOTHING_LEGACY_MAX = 0.5;

export function createSpringState(initialValue = 0): SpringState {
	return {
		value: initialValue,
		velocity: 0,
		initialized: false,
	};
}

export function resetSpringState(state: SpringState, initialValue?: number) {
	if (typeof initialValue === "number") {
		state.value = initialValue;
	}

	state.velocity = 0;
	state.initialized = false;
}

export function clampDeltaMs(deltaMs: number, fallbackMs = 1000 / 60) {
	if (!Number.isFinite(deltaMs) || deltaMs <= 0) {
		return fallbackMs;
	}

	return Math.min(80, Math.max(1, deltaMs));
}

/**
 * Damped harmonic oscillator spring solver.
 *
 * Implements Hooke's law  F = −kx − cv  (stiffness k, damping c, mass m)
 * with the closed-form analytic solution for the three damping regimes:
 *   ζ < 1  →  underdamped  (oscillates then settles)
 *   ζ = 1  →  critically damped  (fastest non-oscillating convergence)
 *   ζ > 1  →  overdamped  (exponential decay, no oscillation)
 *
 * where  ζ = c / (2√(km))  and  ω₀ = √(k/m).
 *
 * All time inputs are in seconds internally.
 */

function msToSec(ms: number) {
	return ms / 1000;
}

function resolveSpringPosition(
	t: number,
	target: number,
	initialDelta: number,
	initialVelocity: number,
	dampingRatio: number,
	undampedAngularFreq: number,
): number {
	if (dampingRatio < 1) {
		// Underdamped — oscillatory envelope
		const dampedFreq = undampedAngularFreq * Math.sqrt(1 - dampingRatio * dampingRatio);
		const envelope = Math.exp(-dampingRatio * undampedAngularFreq * t);
		return (
			target -
			envelope *
				(((initialVelocity + dampingRatio * undampedAngularFreq * initialDelta) /
					dampedFreq) *
					Math.sin(dampedFreq * t) +
					initialDelta * Math.cos(dampedFreq * t))
		);
	}

	if (dampingRatio === 1) {
		// Critically damped — no oscillation, fastest convergence
		return (
			target -
			Math.exp(-undampedAngularFreq * t) *
				(initialDelta + (initialVelocity + undampedAngularFreq * initialDelta) * t)
		);
	}

	// Overdamped — exponential decay, no oscillation
	const dampedFreq = undampedAngularFreq * Math.sqrt(dampingRatio * dampingRatio - 1);
	const envelope = Math.exp(-dampingRatio * undampedAngularFreq * t);
	const freqT = Math.min(dampedFreq * t, 300); // cap to avoid Infinity in sinh/cosh
	return (
		target -
		(envelope *
			((initialVelocity + dampingRatio * undampedAngularFreq * initialDelta) *
				Math.sinh(freqT) +
				dampedFreq * initialDelta * Math.cosh(freqT))) /
			dampedFreq
	);
}

export function stepSpringValue(
	state: SpringState,
	target: number,
	deltaMs: number,
	config: SpringConfig,
) {
	const safeDeltaMs = clampDeltaMs(deltaMs);

	if (!state.initialized || !Number.isFinite(state.value)) {
		state.value = target;
		state.velocity = 0;
		state.initialized = true;
		return state.value;
	}

	const restDelta = config.restDelta ?? 0.0005;
	const restSpeed = config.restSpeed ?? 0.02;

	if (Math.abs(target - state.value) <= restDelta && Math.abs(state.velocity) <= restSpeed) {
		state.value = target;
		state.velocity = 0;
		return state.value;
	}

	const { stiffness, damping, mass } = config;
	const undampedAngularFreq = Math.sqrt(stiffness / mass);
	const dampingRatio = damping / (2 * Math.sqrt(stiffness * mass));
	const initialDelta = target - state.value;
	const initialVelocity = -state.velocity;
	const tSec = msToSec(safeDeltaMs);

	const current = resolveSpringPosition(
		tSec,
		target,
		initialDelta,
		initialVelocity,
		dampingRatio,
		undampedAngularFreq,
	);

	// Overshoot guard for overdamped / critically-damped springs (ζ ≥ 1).
	// With a fixed target an overdamped spring never overshoots, but when
	// the target moves every frame (zoom easing curve) carried-over velocity
	// can push the value past the new target → wobble on reversal.
	// Clamping to target keeps the original animation speed while preventing
	// the jelly-like counter-oscillation.
	if (dampingRatio >= 1) {
		const crossed =
			(state.value <= target && current > target) ||
			(state.value >= target && current < target);
		if (crossed) {
			state.value = target;
			state.velocity = 0;
			return state.value;
		}
	}

	// Analytical velocity via forward-difference on the closed-form solution.
	const epsilon = 0.0001;
	const ahead = resolveSpringPosition(
		tSec + epsilon,
		target,
		initialDelta,
		initialVelocity,
		dampingRatio,
		undampedAngularFreq,
	);
	const analyticalVelocity = (ahead - current) / epsilon; // value per second

	const isBelowVelocityThreshold = Math.abs(analyticalVelocity) <= restSpeed;
	const isBelowDisplacementThreshold = Math.abs(target - current) <= restDelta;
	const isDone = isBelowVelocityThreshold && isBelowDisplacementThreshold;

	if (isDone) {
		state.value = target;
		state.velocity = 0;
	} else {
		state.value = current;
		state.velocity = analyticalVelocity;
	}

	return state.value;
}

export function getCursorSpringConfig(smoothingFactor: number): SpringConfig {
	const clamped = Math.min(CURSOR_SMOOTHING_MAX, Math.max(CURSOR_SMOOTHING_MIN, smoothingFactor));

	if (clamped <= 0) {
		return {
			stiffness: 1000,
			damping: 100,
			mass: 1,
			restDelta: 0.0001,
			restSpeed: 0.001,
		};
	}

	if (clamped <= CURSOR_SMOOTHING_LEGACY_MAX) {
		const legacyNormalized = Math.min(
			1,
			Math.max(
				0,
				(clamped - CURSOR_SMOOTHING_MIN) /
					(CURSOR_SMOOTHING_LEGACY_MAX - CURSOR_SMOOTHING_MIN),
			),
		);

		return {
			stiffness: 760 - legacyNormalized * 420,
			damping: 34 + legacyNormalized * 24,
			mass: 0.55 + legacyNormalized * 0.45,
			restDelta: 0.0002,
			restSpeed: 0.01,
		};
	}

	const extendedNormalized = Math.min(
		1,
		Math.max(
			0,
			(clamped - CURSOR_SMOOTHING_LEGACY_MAX) /
				(CURSOR_SMOOTHING_MAX - CURSOR_SMOOTHING_LEGACY_MAX),
		),
	);

	return {
		stiffness: 340 - extendedNormalized * 180,
		damping: 58 + extendedNormalized * 22,
		mass: 1 + extendedNormalized * 0.35,
		restDelta: 0.0002,
		restSpeed: 0.01,
	};
}

export function getZoomSpringConfig(smoothnessFactor = 0.5): SpringConfig {
	const clamped = Math.max(0, Math.min(1, smoothnessFactor));

	if (clamped <= 0) {
		return {
			stiffness: 1000,
			damping: 100,
			mass: 1,
			restDelta: 0.0001,
			restSpeed: 0.001,
		};
	}

	// Map 0-1 slider to the internal 0-2 spring range so that
	// smoothness=1 gives the same feel as the old smoothness=2.
	const scaled = clamped * 2;

	// Hooke's law spring: F = -kx - cv
	// Damping ratio ζ = c / (2√(km)) ≈ 1.05 — barely overdamped.
	// The overshoot clamp in stepSpringValue prevents wobble even at
	// this low damping, so animations stay fast and responsive.
	// Higher scaled → lower stiffness + higher mass → slower, floatier settle.
	return {
		stiffness: 100 / scaled,
		damping: 21,
		mass: 1.0 * scaled,
		restDelta: 0.0005,
		restSpeed: 0.015,
	};
}
