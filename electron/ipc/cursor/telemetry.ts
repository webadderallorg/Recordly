import fs from "node:fs/promises";
import {
	CURSOR_SAMPLE_INTERVAL_MS,
	CURSOR_TELEMETRY_VERSION,
	MAX_CURSOR_SAMPLES,
} from "../constants";
import {
	activeCursorSamples,
	currentCursorVisualType,
	cursorCaptureInterval,
	cursorCaptureStartTimeMs,
	isCursorCaptureActive,
	linuxCursorScreenPoint,
	pendingCursorSamples,
	selectedSource,
	selectedWindowBounds,
	setCursorCaptureInterval,
	setPendingCursorSamples,
} from "../state";
import type { CursorInteractionType, CursorTelemetryPoint, CursorVisualType } from "../types";
import { getScreen, getTelemetryPathForVideo } from "../utils";

export function clamp(value: number, min: number, max: number) {
	return Math.min(max, Math.max(min, value));
}

export function stopCursorCapture() {
	if (cursorCaptureInterval) {
		clearTimeout(cursorCaptureInterval);
		setCursorCaptureInterval(null);
	}
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
	pushCursorSample(point.cx, point.cy, Date.now() - cursorCaptureStartTimeMs, "move");
}

export function captureManualZoomMarker() {
	if (!isCursorCaptureActive) {
		return false;
	}

	const point = getNormalizedCursorPoint();
	pushCursorSample(
		point.cx,
		point.cy,
		Date.now() - cursorCaptureStartTimeMs,
		"manual-zoom",
	);
	return true;
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
		if (isCursorCaptureActive) {
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
