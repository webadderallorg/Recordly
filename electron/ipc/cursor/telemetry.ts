import fs from "node:fs/promises";
import { getTelemetryPathForVideo, getScreen } from "../utils";
import {
	CURSOR_TELEMETRY_VERSION,
	MAX_CURSOR_SAMPLES,
	CURSOR_SAMPLE_INTERVAL_MS,
} from "../constants";
import type { CursorVisualType, CursorInteractionType, CursorTelemetryPoint } from "../types";
import {
	cursorCaptureInterval,
	setCursorCaptureInterval,
	cursorCaptureAccumulatedPausedMs,
	cursorCapturePauseStartedAtMs,
	cursorCaptureStartTimeMs,
	activeCursorSamples,
	pendingCursorSamples,
	setPendingCursorSamples,
	isCursorCaptureActive,
	currentCursorVisualType,
	linuxCursorScreenPoint,
	selectedSource,
	selectedWindowBounds,
	setCursorCaptureAccumulatedPausedMs,
	setCursorCapturePauseStartedAtMs,
} from "../state";

export function clamp(value: number, min: number, max: number) {
	return Math.min(max, Math.max(min, value));
}

export function normalizeCursorTelemetrySamples(rawSamples: unknown): CursorTelemetryPoint[] {
	const samples = Array.isArray(rawSamples)
		? rawSamples
		: Array.isArray((rawSamples as { samples?: unknown[] } | null | undefined)?.samples)
			? ((rawSamples as { samples: unknown[] }).samples ?? [])
			: [];
	const boundedSamples = samples.slice(0, MAX_CURSOR_SAMPLES);

	return boundedSamples
		.filter((sample: unknown) => Boolean(sample && typeof sample === "object"))
		.map((sample: unknown) => {
			const point = sample as Partial<CursorTelemetryPoint>;
			return {
				timeMs:
					typeof point.timeMs === "number" && Number.isFinite(point.timeMs)
						? Math.max(0, point.timeMs)
						: 0,
				cx:
					typeof point.cx === "number" && Number.isFinite(point.cx)
						? clamp(point.cx, 0, 1)
						: 0.5,
				cy:
					typeof point.cy === "number" && Number.isFinite(point.cy)
						? clamp(point.cy, 0, 1)
						: 0.5,
				interactionType:
					point.interactionType === "click" ||
					point.interactionType === "double-click" ||
					point.interactionType === "right-click" ||
					point.interactionType === "middle-click" ||
					point.interactionType === "move" ||
					point.interactionType === "mouseup"
						? point.interactionType
						: undefined,
				cursorType:
					point.cursorType === "arrow" ||
					point.cursorType === "text" ||
					point.cursorType === "pointer" ||
					point.cursorType === "crosshair" ||
					point.cursorType === "open-hand" ||
					point.cursorType === "closed-hand" ||
					point.cursorType === "resize-ew" ||
					point.cursorType === "resize-ns" ||
					point.cursorType === "not-allowed"
						? point.cursorType
						: undefined,
			};
		})
		.sort((a, b) => a.timeMs - b.timeMs);
}

export async function writeCursorTelemetry(videoPath: string, samples: unknown) {
	const telemetryPath = getTelemetryPathForVideo(videoPath);
	const normalizedSamples = normalizeCursorTelemetrySamples(samples);

	if (normalizedSamples.length === 0) {
		await fs.rm(telemetryPath, { force: true });
		return normalizedSamples;
	}

	await fs.writeFile(
		telemetryPath,
		JSON.stringify(
			{ version: CURSOR_TELEMETRY_VERSION, samples: normalizedSamples },
			null,
			2,
		),
		"utf-8",
	);

	return normalizedSamples;
}

export function stopCursorCapture() {
	if (cursorCaptureInterval) {
		clearTimeout(cursorCaptureInterval);
		setCursorCaptureInterval(null);
	}
}

export function resetCursorCaptureClock() {
	setCursorCaptureAccumulatedPausedMs(0);
	setCursorCapturePauseStartedAtMs(null);
}

export function isCursorCapturePaused() {
	return cursorCapturePauseStartedAtMs !== null;
}

export function pauseCursorCapture(pausedAtMs: number) {
	if (cursorCapturePauseStartedAtMs !== null) {
		return;
	}

	setCursorCapturePauseStartedAtMs(pausedAtMs);
}

export function resumeCursorCapture(resumedAtMs: number) {
	if (cursorCapturePauseStartedAtMs === null) {
		return;
	}

	const pauseDurationMs = Math.max(0, resumedAtMs - cursorCapturePauseStartedAtMs);
	setCursorCaptureAccumulatedPausedMs(
		cursorCaptureAccumulatedPausedMs + pauseDurationMs,
	);
	setCursorCapturePauseStartedAtMs(null);
}

export function getCursorCaptureElapsedMs(nowMs = Date.now()) {
	if (!Number.isFinite(cursorCaptureStartTimeMs) || cursorCaptureStartTimeMs <= 0) {
		return 0;
	}

	const safeNowMs = Math.max(cursorCaptureStartTimeMs, nowMs);
	const activePauseDurationMs =
		cursorCapturePauseStartedAtMs === null
			? 0
			: Math.max(0, safeNowMs - cursorCapturePauseStartedAtMs);

	return Math.max(
		0,
		safeNowMs -
			cursorCaptureStartTimeMs -
			Math.max(0, cursorCaptureAccumulatedPausedMs) -
			activePauseDurationMs,
	);
}

export function getNormalizedCursorPoint() {
	const fallbackCursor = getScreen().getCursorScreenPoint();
	const linuxCursorCache = process.platform === "linux" ? linuxCursorScreenPoint : null;
	const isLinuxCacheFresh = !!linuxCursorCache && Date.now() - linuxCursorCache.updatedAt <= 1000;

	const primarySf =
		process.platform !== "darwin" ? getScreen().getPrimaryDisplay().scaleFactor || 1 : 1;

	const cursor = isLinuxCacheFresh
		? { x: linuxCursorCache.x / primarySf, y: linuxCursorCache.y / primarySf }
		: fallbackCursor;

	const windowBounds = selectedSource?.id?.startsWith("window:") ? selectedWindowBounds : null;
	if (windowBounds) {
		const sf =
			process.platform !== "darwin"
				? getScreen().getDisplayNearestPoint({
						x: windowBounds.x / primarySf,
						y: windowBounds.y / primarySf,
					}).scaleFactor || 1
				: 1;
		const width = Math.max(1, windowBounds.width / sf);
		const height = Math.max(1, windowBounds.height / sf);

		return {
			cx: clamp((cursor.x - windowBounds.x / sf) / width, 0, 1),
			cy: clamp((cursor.y - windowBounds.y / sf) / height, 0, 1),
		};
	}

	const sourceDisplayId = Number(selectedSource?.display_id);
	const sourceDisplay = Number.isFinite(sourceDisplayId)
		? (getScreen()
				.getAllDisplays()
				.find((display) => display.id === sourceDisplayId) ?? null)
		: null;
	const display = sourceDisplay ?? getScreen().getDisplayNearestPoint(cursor);
	const bounds = display.bounds;
	const width = Math.max(1, bounds.width);
	const height = Math.max(1, bounds.height);

	const cx = clamp((cursor.x - bounds.x) / width, 0, 1);
	const cy = clamp((cursor.y - bounds.y) / height, 0, 1);
	return { cx, cy };
}

export function getHookCursorScreenPoint(
	event: { x?: number; y?: number; data?: { x?: number; y?: number; screenX?: number; screenY?: number }; screenX?: number; screenY?: number } | null | undefined,
): { x: number; y: number } | null {
	const rawX = event?.x ?? event?.data?.x ?? event?.screenX ?? event?.data?.screenX;
	const rawY = event?.y ?? event?.data?.y ?? event?.screenY ?? event?.data?.screenY;

	if (
		typeof rawX !== "number" ||
		!Number.isFinite(rawX) ||
		typeof rawY !== "number" ||
		!Number.isFinite(rawY)
	) {
		return null;
	}

	return { x: rawX, y: rawY };
}

export function pushCursorSample(
	cx: number,
	cy: number,
	timeMs: number,
	interactionType: CursorInteractionType = "move",
	cursorType?: CursorVisualType,
) {
	activeCursorSamples.push({
		timeMs: Math.max(0, timeMs),
		cx,
		cy,
		interactionType,
		cursorType: cursorType ?? currentCursorVisualType,
	} as CursorTelemetryPoint);

	if (activeCursorSamples.length > MAX_CURSOR_SAMPLES) {
		activeCursorSamples.shift();
	}
}

export function sampleCursorPoint() {
	const point = getNormalizedCursorPoint();
	pushCursorSample(point.cx, point.cy, getCursorCaptureElapsedMs(), "move");
}

export async function persistPendingCursorTelemetry(videoPath: string) {
	const telemetryPath = getTelemetryPathForVideo(videoPath);
	if (pendingCursorSamples.length > 0) {
		await fs.writeFile(
			telemetryPath,
			JSON.stringify(
				{ version: CURSOR_TELEMETRY_VERSION, samples: pendingCursorSamples },
				null,
				2,
			),
			"utf-8",
		);
	}
	setPendingCursorSamples([]);
}

export function snapshotCursorTelemetryForPersistence() {
	if (activeCursorSamples.length === 0) {
		return;
	}

	if (pendingCursorSamples.length === 0) {
		setPendingCursorSamples([...activeCursorSamples]);
		return;
	}

	const lastPendingTimeMs = pendingCursorSamples[pendingCursorSamples.length - 1]?.timeMs ?? -1;
	setPendingCursorSamples([
		...pendingCursorSamples,
		...activeCursorSamples.filter((sample) => sample.timeMs > lastPendingTimeMs),
	]);
}

export function startCursorSampling() {
	stopCursorCapture();

	// Use recursive setTimeout with drift compensation instead of setInterval.
	// Under CPU load setInterval bunches or skips callbacks, creating large gaps
	// in telemetry data.  This approach measures wall-clock drift each tick and
	// adjusts the next delay so samples stay close to the target interval.
	let nextExpectedMs = Date.now() + CURSOR_SAMPLE_INTERVAL_MS;

	const tick = () => {
		if (isCursorCaptureActive && !isCursorCapturePaused()) {
			sampleCursorPoint();
		}

		const now = Date.now();
		const drift = now - nextExpectedMs;
		nextExpectedMs += CURSOR_SAMPLE_INTERVAL_MS;

		// If we fell behind by more than one full interval, reset the baseline
		// so we don't try to "catch up" with a burst of rapid samples.
		if (drift > CURSOR_SAMPLE_INTERVAL_MS) {
			nextExpectedMs = now + CURSOR_SAMPLE_INTERVAL_MS;
		}

		const delay = Math.max(1, nextExpectedMs - now);
		setCursorCaptureInterval(setTimeout(tick, delay));
	};

	setCursorCaptureInterval(setTimeout(tick, CURSOR_SAMPLE_INTERVAL_MS));
}

// Re-export for consumers that use it from this module
export { getTelemetryPathForVideo } from "../utils";
export { CURSOR_SAMPLE_INTERVAL_MS } from "../constants";
