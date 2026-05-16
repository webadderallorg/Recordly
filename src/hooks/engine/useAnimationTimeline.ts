import { useCallback, useEffect, useRef, useState } from "react";
import { sheet } from "@/engine/theatreSetup";
import { type Keyframe, type EasingCurve, keyframeStore } from "@/engine/claudeBridge";

// ─── Bezier interpolation ─────────────────────────────────────────────────────

function cubicBezier(t: number, [p1x, p1y, p2x, p2y]: EasingCurve): number {
	// Newton-Raphson solve for cubic bezier y(t) given x(t)=t
	const cx = 3 * p1x;
	const bx = 3 * (p2x - p1x) - cx;
	const ax = 1 - cx - bx;
	const cy = 3 * p1y;
	const by = 3 * (p2y - p1y) - cy;
	const ay = 1 - cy - by;

	function sampleX(t: number) {
		return ((ax * t + bx) * t + cx) * t;
	}
	function sampleY(t: number) {
		return ((ay * t + by) * t + cy) * t;
	}
	function sampleDerivX(t: number) {
		return (3 * ax * t + 2 * bx) * t + cx;
	}

	let u = t;
	for (let i = 0; i < 8; i++) {
		const x = sampleX(u) - t;
		if (Math.abs(x) < 1e-7) break;
		u -= x / sampleDerivX(u);
	}
	return sampleY(u);
}

function lerp(a: number, b: number, t: number) {
	return a + (b - a) * t;
}

function interpolateValue(
	from: number,
	to: number,
	progress: number,
	easing: EasingCurve,
): number {
	return lerp(from, to, cubicBezier(progress, easing));
}

// ─── Flat value interpolation across a keyframe track ────────────────────────

export type FlatValues = Record<string, number>;

function flattenValue(value: Record<string, unknown>, prefix = ""): FlatValues {
	const result: FlatValues = {};
	for (const [k, v] of Object.entries(value)) {
		if (v === undefined || v === null) continue;
		const key = prefix ? `${prefix}.${k}` : k;
		if (typeof v === "number") {
			result[key] = v;
		} else if (typeof v === "object") {
			Object.assign(result, flattenValue(v as Record<string, unknown>, key));
		}
	}
	return result;
}

function interpolateAtTime(keyframes: Keyframe[], time: number): FlatValues {
	if (keyframes.length === 0) return {};
	if (keyframes.length === 1) return flattenValue(keyframes[0].value);

	// Clamp to range
	if (time <= keyframes[0].time) return flattenValue(keyframes[0].value);
	if (time >= keyframes[keyframes.length - 1].time)
		return flattenValue(keyframes[keyframes.length - 1].value);

	// Find surrounding keyframes
	let fromIdx = 0;
	for (let i = 0; i < keyframes.length - 1; i++) {
		if (keyframes[i].time <= time && keyframes[i + 1].time >= time) {
			fromIdx = i;
			break;
		}
	}

	const from = keyframes[fromIdx];
	const to = keyframes[fromIdx + 1];
	const progress = (time - from.time) / (to.time - from.time);

	const fromFlat = flattenValue(from.value);
	const toFlat = flattenValue(to.value);
	const result: FlatValues = { ...fromFlat };

	for (const key of Object.keys(toFlat)) {
		if (key in fromFlat) {
			result[key] = interpolateValue(fromFlat[key], toFlat[key], progress, to.easing);
		}
	}
	return result;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export interface TimelineState {
	position: number;
	duration: number;
	isPlaying: boolean;
	cameraValues: FlatValues;
	deviceValues: FlatValues;
}

export interface TimelineControls {
	play: () => void;
	pause: () => void;
	seek: (time: number) => void;
	setDuration: (d: number) => void;
}

export function useAnimationTimeline(initialDuration = 5): [TimelineState, TimelineControls] {
	const [position, setPosition] = useState(0);
	const [duration, setDuration] = useState(initialDuration);
	const [isPlaying, setIsPlaying] = useState(false);
	const rafRef = useRef<number | null>(null);
	const startClockRef = useRef<number>(0);
	const startPositionRef = useRef<number>(0);

	const [cameraValues, setCameraValues] = useState<FlatValues>({});
	const [deviceValues, setDeviceValues] = useState<FlatValues>({});

	// Re-evaluate values whenever position changes
	useEffect(() => {
		setCameraValues(interpolateAtTime(keyframeStore.camera, position));
		setDeviceValues(interpolateAtTime(keyframeStore.device, position));
		// Sync Theatre.js sequence position (drives R3F editable objects if used)
		sheet.sequence.position = position;
	}, [position]);

	const seek = useCallback((time: number) => {
		const clamped = Math.max(0, Math.min(time, duration));
		setPosition(clamped);
		startPositionRef.current = clamped;
		startClockRef.current = performance.now();
	}, [duration]);

	const pause = useCallback(() => {
		setIsPlaying(false);
		if (rafRef.current !== null) {
			cancelAnimationFrame(rafRef.current);
			rafRef.current = null;
		}
	}, []);

	const play = useCallback(() => {
		startClockRef.current = performance.now();
		startPositionRef.current = position >= duration ? 0 : position;
		setIsPlaying(true);

		const tick = () => {
			const elapsed = (performance.now() - startClockRef.current) / 1000;
			const newPos = startPositionRef.current + elapsed;
			if (newPos >= duration) {
				setPosition(duration);
				setIsPlaying(false);
				return;
			}
			setPosition(newPos);
			rafRef.current = requestAnimationFrame(tick);
		};
		rafRef.current = requestAnimationFrame(tick);
	}, [position, duration]);

	useEffect(() => () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); }, []);

	return [
		{ position, duration, isPlaying, cameraValues, deviceValues },
		{ play, pause, seek, setDuration },
	];
}
