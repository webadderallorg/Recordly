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

function isCursorInteractionSample(sample: NativeStaticLayoutCursorTelemetrySample) {
	return (
		sample.interactionType === "click" ||
		sample.interactionType === "double-click" ||
		sample.interactionType === "right-click" ||
		sample.interactionType === "middle-click"
	);
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

function getCursorTypeIndex(cursorType: string | undefined) {
	return CURSOR_TYPE_INDEX[cursorType ?? "arrow"] ?? CURSOR_TYPE_INDEX.arrow;
}

function getCursorBounceScale(
	latestClick: NativeStaticLayoutCursorTelemetrySample | null,
	timeMs: number,
	options: NativeStaticLayoutCursorTelemetryOptions,
) {
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

function createMonotonicCursorRenderSampler(
	samples: NativeStaticLayoutCursorTelemetrySample[],
	options: NativeStaticLayoutCursorTelemetryOptions,
) {
	let interpolationIndex = 0;
	let metadataIndex = 0;
	let latestClick: NativeStaticLayoutCursorTelemetrySample | null = null;
	let latestStableCursorType: CursorTelemetryPoint["cursorType"] = "arrow";

	return (timeMs: number): NativeStaticLayoutCursorTelemetrySample => {
		while (
			interpolationIndex < samples.length - 2 &&
			samples[interpolationIndex + 1].timeMs <= timeMs
		) {
			interpolationIndex += 1;
		}

		while (metadataIndex < samples.length && samples[metadataIndex].timeMs <= timeMs) {
			const sample = samples[metadataIndex];
			if (isCursorInteractionSample(sample)) {
				latestClick = sample;
			} else if (sample.cursorType) {
				latestStableCursorType = sample.cursorType;
			}
			metadataIndex += 1;
		}

		let position: Pick<NativeStaticLayoutCursorTelemetrySample, "cx" | "cy" | "timeMs">;
		if (timeMs <= samples[0].timeMs) {
			position = { timeMs, cx: samples[0].cx, cy: samples[0].cy };
		} else {
			const last = samples[samples.length - 1];
			if (timeMs >= last.timeMs) {
				position = { timeMs, cx: last.cx, cy: last.cy };
			} else {
				const a = samples[interpolationIndex];
				const b = samples[Math.min(samples.length - 1, interpolationIndex + 1)];
				const span = b.timeMs - a.timeMs;
				const t = span > 0 ? (timeMs - a.timeMs) / span : 0;
				position = {
					timeMs,
					cx: a.cx + (b.cx - a.cx) * t,
					cy: a.cy + (b.cy - a.cy) * t,
				};
			}
		}

		const projectedPosition = projectCursorPositionToViewport(position, options.sourceCrop);
		return {
			...position,
			cx: projectedPosition.cx,
			cy: projectedPosition.cy,
			cursorType: latestStableCursorType,
			cursorTypeIndex: getCursorTypeIndex(latestStableCursorType),
			bounceScale: getCursorBounceScale(latestClick, timeMs, options),
			...(options.sourceCrop ? { visible: projectedPosition.visible } : {}),
		};
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
	const sampleCursorAt = createMonotonicCursorRenderSampler(sanitized, options);
	for (let frameIndex = 0; frameIndex < targetFrames; frameIndex += 1) {
		const timeMs = Math.min(durationMs, frameIndex * frameDurationMs);
		pushCursorSample(resampled, sampleCursorAt(timeMs));
	}

	const last = resampled[resampled.length - 1];
	if (!last || Math.abs(last.timeMs - durationMs) > 0.5) {
		pushCursorSample(resampled, sampleCursorAt(durationMs));
	}

	return resampled;
}
