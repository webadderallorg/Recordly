import fs from "node:fs/promises";
import { isCursorVisualType } from "../../../src/shared/cursorVisualTypes";
import {
	CURSOR_SAMPLE_INTERVAL_MS,
	CURSOR_TELEMETRY_VERSION,
	MAX_CURSOR_SAMPLES,
} from "../constants";
import { getSourceArea } from "../sourceArea";
import {
	activeCursorSamples,
	currentCursorVisualType,
	cursorCaptureAccumulatedPausedMs,
	cursorCaptureInterval,
	cursorCapturePauseStartedAtMs,
	cursorCaptureStartTimeMs,
	isCursorCaptureActive,
	linuxCursorScreenPoint,
	pendingCursorSamples,
	selectedSource,
	selectedWindowBounds,
	setActiveCursorSamples,
	setCursorCaptureAccumulatedPausedMs,
	setCursorCaptureInterval,
	setCursorCapturePauseStartedAtMs,
	setPendingCursorSamples,
	windowsNativeCaptureActive,
	windowsWindowCaptureSize,
} from "../state";
import type { CursorInteractionType, CursorTelemetryPoint, CursorVisualType } from "../types";
import { getScreen, getTelemetryPathForVideo } from "../utils";

let activeRecordingZoomMarkers: CursorTelemetryPoint[] = [];

export function clamp(value: number, min: number, max: number) {
	return Math.min(max, Math.max(min, value));
}

export function normalizeCursorTelemetrySamples(rawSamples: unknown): CursorTelemetryPoint[] {
	const samples = Array.isArray(rawSamples)
		? rawSamples
		: Array.isArray((rawSamples as { samples?: unknown[] } | null | undefined)?.samples)
			? ((rawSamples as { samples: unknown[] }).samples ?? [])
			: [];
	let pointerCount = 0;

	return samples
		.filter(
			(sample: Partial<CursorTelemetryPoint> | null) =>
				sample?.interactionType === "manual-zoom" || pointerCount++ < MAX_CURSOR_SAMPLES,
		)
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
					point.interactionType === "mouseup" ||
					point.interactionType === "manual-zoom"
						? point.interactionType
						: undefined,
				...(point.mouseButton === 1 || point.mouseButton === 2 || point.mouseButton === 3
					? { mouseButton: point.mouseButton }
					: {}),
				cursorType: isCursorVisualType(point.cursorType) ? point.cursorType : undefined,
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
		JSON.stringify({ version: CURSOR_TELEMETRY_VERSION, samples: normalizedSamples }, null, 2),
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

export function clearActiveCursorTelemetry() {
	setActiveCursorSamples([]);
	activeRecordingZoomMarkers = [];
}

export function resetCursorCaptureClock() {
	setCursorCaptureAccumulatedPausedMs(0);
	setCursorCapturePauseStartedAtMs(null);
}

export function isCursorCapturePaused() {
	return cursorCapturePauseStartedAtMs !== null;
}

function releaseHeldCursorButtons(timeMs: number) {
	const held = new Set<1 | 2 | 3>();
	for (const sample of activeCursorSamples) {
		if (sample.interactionType === "mouseup") {
			if (sample.mouseButton) held.delete(sample.mouseButton);
			else held.clear();
		} else if (sample.mouseButton && sample.interactionType !== "move") {
			held.add(sample.mouseButton);
		}
	}
	const last = activeCursorSamples[activeCursorSamples.length - 1];
	if (last)
		for (const button of held) {
			pushCursorSample(last.cx, last.cy, timeMs, "mouseup", last.cursorType, button);
		}
}

export function pauseCursorCapture(pausedAtMs: number) {
	if (cursorCapturePauseStartedAtMs !== null) {
		return;
	}

	releaseHeldCursorButtons(getCursorCaptureElapsedMs(pausedAtMs));
	setCursorCapturePauseStartedAtMs(pausedAtMs);
}

export function pauseCursorCaptureAtBoundary(pausedAtMs: number) {
	if (cursorCapturePauseStartedAtMs !== null) {
		return;
	}

	const pausedElapsedMs = getCursorCaptureElapsedMs(pausedAtMs);
	setActiveCursorSamples(
		activeCursorSamples.filter((sample) => sample.timeMs <= pausedElapsedMs),
	);
	activeRecordingZoomMarkers = activeRecordingZoomMarkers.filter(
		(marker) => marker.timeMs <= pausedElapsedMs,
	);
	releaseHeldCursorButtons(getCursorCaptureElapsedMs(pausedAtMs));
	setCursorCapturePauseStartedAtMs(pausedAtMs);
}

export function resumeCursorCapture(resumedAtMs: number) {
	if (cursorCapturePauseStartedAtMs === null) {
		return;
	}

	const pauseDurationMs = Math.max(0, resumedAtMs - cursorCapturePauseStartedAtMs);
	setCursorCaptureAccumulatedPausedMs(cursorCaptureAccumulatedPausedMs + pauseDurationMs);
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
	const screen = getScreen();
	const screenCursor = screen.getCursorScreenPoint();
	const isWindowSource = selectedSource?.id?.startsWith("window:") === true;
	if (isWindowSource && process.platform === "win32" && windowsNativeCaptureActive) {
		if (!selectedWindowBounds) return null;
		const { physicalOrigin } = selectedWindowBounds;
		const captureSize = windowsWindowCaptureSize;
		if (physicalOrigin && captureSize && captureSize.sourceId === selectedSource?.id) {
			// WGC keeps the original encoded size when the window is resized.
			const pixel = screen.dipToScreenPoint(screenCursor);
			return {
				cx: clamp((pixel.x - physicalOrigin.x) / captureSize.width, 0, 1),
				cy: clamp((pixel.y - physicalOrigin.y) / captureSize.height, 0, 1),
			};
		}
	}

	// Areas are fixed rectangles, so they normalize like a window that never moves.
	const windowBounds = isWindowSource ? selectedWindowBounds : getSourceArea(selectedSource);
	if (windowBounds) {
		const primarySf =
			process.platform !== "darwin" ? screen.getPrimaryDisplay().scaleFactor || 1 : 1;
		const linuxCursorCache = process.platform === "linux" ? linuxCursorScreenPoint : null;
		const cursor =
			linuxCursorCache && Date.now() - linuxCursorCache.updatedAt <= 1000
				? { x: linuxCursorCache.x / primarySf, y: linuxCursorCache.y / primarySf }
				: screenCursor;
		const sf =
			process.platform === "win32" || process.platform === "darwin"
				? 1
				: getScreen().getDisplayNearestPoint({
						x: windowBounds.x / primarySf,
						y: windowBounds.y / primarySf,
					}).scaleFactor || 1;
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
	const display = sourceDisplay ?? screen.getDisplayNearestPoint(screenCursor);
	const bounds = display.bounds;
	const width = Math.max(1, bounds.width);
	const height = Math.max(1, bounds.height);

	const cx = clamp((screenCursor.x - bounds.x) / width, 0, 1);
	const cy = clamp((screenCursor.y - bounds.y) / height, 0, 1);
	return { cx, cy };
}

export function getHookCursorScreenPoint(
	event:
		| {
				x?: number;
				y?: number;
				data?: { x?: number; y?: number; screenX?: number; screenY?: number };
				screenX?: number;
				screenY?: number;
		  }
		| null
		| undefined,
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
	mouseButton?: 1 | 2 | 3,
) {
	activeCursorSamples.push({
		timeMs: Math.max(0, timeMs),
		cx,
		cy,
		interactionType,
		cursorType: cursorType ?? currentCursorVisualType,
		...(mouseButton ? { mouseButton } : {}),
	} as CursorTelemetryPoint);

	if (activeCursorSamples.length > MAX_CURSOR_SAMPLES) {
		activeCursorSamples.shift();
	}
}

export function sampleCursorPoint() {
	const point = getNormalizedCursorPoint();
	if (!point) return;
	pushCursorSample(point.cx, point.cy, getCursorCaptureElapsedMs(), "move");
}

export function captureRecordingZoomMarker(nowMs = Date.now()) {
	if (!isCursorCaptureActive || isCursorCapturePaused()) return false;
	const point = getNormalizedCursorPoint();
	if (!point) return false;
	activeRecordingZoomMarkers.push({
		...point,
		timeMs: getCursorCaptureElapsedMs(nowMs),
		interactionType: "manual-zoom",
	});
	return true;
}

export async function persistPendingCursorTelemetry(videoPath: string) {
	const telemetryPath = getTelemetryPathForVideo(videoPath);
	if (pendingCursorSamples.length > 0) {
		await fs.writeFile(
			telemetryPath,
			JSON.stringify(
				{
					version: CURSOR_TELEMETRY_VERSION,
					samples: [...pendingCursorSamples].sort((a, b) => a.timeMs - b.timeMs),
				},
				null,
				2,
			),
			"utf-8",
		);
	}
	setPendingCursorSamples([]);
}

export function snapshotCursorTelemetryForPersistence() {
	if (activeCursorSamples.length === 0 && activeRecordingZoomMarkers.length === 0) {
		return;
	}

	if (pendingCursorSamples.length === 0) {
		setPendingCursorSamples([...activeCursorSamples, ...activeRecordingZoomMarkers]);
		return;
	}

	let lastPendingPointerMs = -1;
	const pendingMarkers = new Set<CursorTelemetryPoint>();
	for (const sample of pendingCursorSamples) {
		if (sample.interactionType === "manual-zoom") pendingMarkers.add(sample);
		else lastPendingPointerMs = sample.timeMs;
	}
	setPendingCursorSamples([
		...pendingCursorSamples,
		...activeCursorSamples.filter((sample) => sample.timeMs > lastPendingPointerMs),
		...activeRecordingZoomMarkers.filter((marker) => !pendingMarkers.has(marker)),
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

export { CURSOR_SAMPLE_INTERVAL_MS } from "../constants";
// Re-export for consumers that use it from this module
export { getTelemetryPathForVideo } from "../utils";
