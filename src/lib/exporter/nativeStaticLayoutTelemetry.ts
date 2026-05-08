import type { CropRegion, CursorTelemetryPoint } from "@/components/video-editor/types";
import { projectCursorPositionToViewport } from "@/components/video-editor/videoPlayback/cursorViewport";

export type NativeStaticLayoutCursorTelemetrySample = {
	timeMs: number;
	cx: number;
	cy: number;
	cursorType?: CursorTelemetryPoint["cursorType"];
	interactionType?: string;
	cursorTypeIndex?: number;
	bounceScale?: number;
	visible?: boolean;
};

export type NativeStaticLayoutCursorTelemetryOptions = {
	frameRate: number;
	durationSec: number;
	clickBounce?: number;
	clickBounceDurationMs?: number;
	sourceCrop?: CropRegion;
};

const CURSOR_POSITION_EPSILON = 0.00001;
const CURSOR_BOUNCE_EPSILON = 0.0005;
const DEFAULT_CLICK_BOUNCE = 1;
const DEFAULT_CLICK_BOUNCE_DURATION_MS = 350;

const CURSOR_TYPE_INDEX: Record<string, number> = {
	arrow: 0,
	text: 1,
	pointer: 2,
	crosshair: 3,
	"open-hand": 4,
	"closed-hand": 5,
	"resize-ew": 6,
	"resize-ns": 7,
	"not-allowed": 8,
};

function clampUnit(value: number) {
	return Math.min(1, Math.max(0, value));
}

function sanitizeCursorTelemetry(telemetry: NativeStaticLayoutCursorTelemetrySample[]) {
	return telemetry
		.filter((sample) => {
			return (
				Number.isFinite(sample.timeMs) &&
				Number.isFinite(sample.cx) &&
				Number.isFinite(sample.cy)
			);
		})
		.map((sample) => ({
			timeMs: Math.max(0, sample.timeMs),
			cx: clampUnit(sample.cx),
			cy: clampUnit(sample.cy),
			cursorType: sample.cursorType,
			interactionType: sample.interactionType,
		}))
		.sort((left, right) => left.timeMs - right.timeMs);
}

function interpolateCursorSample(
	samples: NativeStaticLayoutCursorTelemetrySample[],
	timeMs: number,
) {
	if (timeMs <= samples[0].timeMs) {
		return { timeMs, cx: samples[0].cx, cy: samples[0].cy };
	}

	const last = samples[samples.length - 1];
	if (timeMs >= last.timeMs) {
		return { timeMs, cx: last.cx, cy: last.cy };
	}

	let lo = 0;
	let hi = samples.length - 1;
	while (lo < hi - 1) {
		const mid = (lo + hi) >> 1;
		if (samples[mid].timeMs <= timeMs) {
			lo = mid;
		} else {
			hi = mid;
		}
	}

	const a = samples[lo];
	const b = samples[hi];
	const span = Math.max(1, b.timeMs - a.timeMs);
	const t = (timeMs - a.timeMs) / span;
	return {
		timeMs,
		cx: a.cx + (b.cx - a.cx) * t,
		cy: a.cy + (b.cy - a.cy) * t,
	};
}

function findLatestInteractionSample(
	samples: NativeStaticLayoutCursorTelemetrySample[],
	timeMs: number,
) {
	for (let index = samples.length - 1; index >= 0; index -= 1) {
		const sample = samples[index];
		if (sample.timeMs > timeMs) {
			continue;
		}

		if (
			sample.interactionType === "click" ||
			sample.interactionType === "double-click" ||
			sample.interactionType === "right-click" ||
			sample.interactionType === "middle-click"
		) {
			return sample;
		}
	}

	return null;
}

function findLatestStableCursorType(
	samples: NativeStaticLayoutCursorTelemetrySample[],
	timeMs: number,
) {
	let lo = 0;
	let hi = samples.length - 1;
	while (lo < hi) {
		const mid = Math.ceil((lo + hi) / 2);
		if (samples[mid].timeMs <= timeMs) {
			lo = mid;
		} else {
			hi = mid - 1;
		}
	}

	for (let index = lo; index >= 0; index -= 1) {
		const sample = samples[index];
		if (sample.timeMs > timeMs || !sample.cursorType) {
			continue;
		}

		if (
			sample.interactionType === "click" ||
			sample.interactionType === "double-click" ||
			sample.interactionType === "right-click" ||
			sample.interactionType === "middle-click"
		) {
			continue;
		}

		return sample.cursorType;
	}

	return samples[lo]?.cursorType ?? "arrow";
}

function getCursorTypeIndex(cursorType: string | undefined) {
	return CURSOR_TYPE_INDEX[cursorType ?? "arrow"] ?? CURSOR_TYPE_INDEX.arrow;
}

function getCursorBounceScale(
	samples: NativeStaticLayoutCursorTelemetrySample[],
	timeMs: number,
	options: NativeStaticLayoutCursorTelemetryOptions,
) {
	const latestClick = findLatestInteractionSample(samples, timeMs);
	if (!latestClick) {
		return 1;
	}

	const clickBounceDurationMs = Math.max(
		1,
		options.clickBounceDurationMs ?? DEFAULT_CLICK_BOUNCE_DURATION_MS,
	);
	const ageMs = Math.max(0, timeMs - latestClick.timeMs);
	if (ageMs > clickBounceDurationMs) {
		return 1;
	}

	const clickBounce = Math.max(0, options.clickBounce ?? DEFAULT_CLICK_BOUNCE);
	const progress = 1 - ageMs / clickBounceDurationMs;
	return Math.max(0.72, 1 - Math.sin(progress * Math.PI) * (0.08 * clickBounce));
}

function buildCursorRenderSample(
	samples: NativeStaticLayoutCursorTelemetrySample[],
	timeMs: number,
	options: NativeStaticLayoutCursorTelemetryOptions,
): NativeStaticLayoutCursorTelemetrySample {
	const position = interpolateCursorSample(samples, timeMs);
	const cursorType = findLatestStableCursorType(samples, timeMs);
	const projectedPosition = projectCursorPositionToViewport(position, options.sourceCrop);

	return {
		...position,
		cx: projectedPosition.cx,
		cy: projectedPosition.cy,
		cursorType,
		cursorTypeIndex: getCursorTypeIndex(cursorType),
		bounceScale: getCursorBounceScale(samples, timeMs, options),
		...(options.sourceCrop ? { visible: projectedPosition.visible } : {}),
	};
}

function pushCursorSample(
	samples: NativeStaticLayoutCursorTelemetrySample[],
	sample: NativeStaticLayoutCursorTelemetrySample,
) {
	const previous = samples[samples.length - 1];
	if (
		previous &&
		Math.abs(previous.cx - sample.cx) <= CURSOR_POSITION_EPSILON &&
		Math.abs(previous.cy - sample.cy) <= CURSOR_POSITION_EPSILON &&
		previous.cursorTypeIndex === sample.cursorTypeIndex &&
		Math.abs((previous.bounceScale ?? 1) - (sample.bounceScale ?? 1)) <=
			CURSOR_BOUNCE_EPSILON &&
		(previous.visible ?? true) === (sample.visible ?? true)
	) {
		previous.timeMs = sample.timeMs;
		return;
	}

	samples.push(sample);
}

export function buildNativeStaticLayoutCursorTelemetry(
	telemetry: NativeStaticLayoutCursorTelemetrySample[],
	options: NativeStaticLayoutCursorTelemetryOptions,
) {
	const sanitized = sanitizeCursorTelemetry(telemetry);
	if (sanitized.length === 0) {
		return undefined;
	}

	const frameRate = Math.max(1, Math.round(options.frameRate));
	const durationMs = Number.isFinite(options.durationSec)
		? Math.max(0, options.durationSec * 1000)
		: sanitized[sanitized.length - 1].timeMs;
	const frameDurationMs = 1000 / frameRate;
	const targetFrames = Math.max(1, Math.floor(durationMs / frameDurationMs) + 1);
	const resampled: NativeStaticLayoutCursorTelemetrySample[] = [];
	for (let frameIndex = 0; frameIndex < targetFrames; frameIndex += 1) {
		const timeMs = Math.min(durationMs, frameIndex * frameDurationMs);
		pushCursorSample(resampled, buildCursorRenderSample(sanitized, timeMs, options));
	}

	const last = resampled[resampled.length - 1];
	if (!last || Math.abs(last.timeMs - durationMs) > 0.5) {
		pushCursorSample(resampled, buildCursorRenderSample(sanitized, durationMs, options));
	}

	return resampled;
}
