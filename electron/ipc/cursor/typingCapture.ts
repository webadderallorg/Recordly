import fs from "node:fs/promises";
import type { TypingTelemetryPoint } from "../types";
import { TYPING_TELEMETRY_VERSION } from "../constants";
import { getTypingTelemetryPathForVideo } from "../utils";
import { classifyTypingKey } from "./typing";
import {
	activeTypingSamples,
	isTypingCaptureActive,
	pendingTypingSamples,
	setActiveTypingSamples,
	setIsTypingCaptureActive,
	setPendingTypingSamples,
} from "../state";
import {
	getCursorCaptureElapsedMs,
	getNormalizedCursorPoint,
	isCursorCapturePaused,
} from "./telemetry";

/**
 * Typing capture buffer.
 *
 * Reuses the cursor capture clock and pause gate verbatim, so keystroke
 * timestamps share the same time base as cursor samples and no key is recorded
 * while the recording is paused. A recording that produced cursor samples
 * therefore always has a usable typing stream too.
 */

const MAX_TYPING_SAMPLES = 60 * 60 * 10; // 1 hour at a very generous 10 keys/sec

export function pushTypingSample(
	cx: number,
	cy: number,
	timeMs: number,
	keyClass: TypingTelemetryPoint["keyClass"],
) {
	if (activeTypingSamples.length >= MAX_TYPING_SAMPLES) {
		return;
	}
	setActiveTypingSamples([...activeTypingSamples, { timeMs, cx, cy, keyClass }]);
}

export function recordTypingKeydown(event: {
	keycode?: number;
	altKey?: boolean;
	ctrlKey?: boolean;
	metaKey?: boolean;
	shiftKey?: boolean;
	data?: {
		keycode?: number;
		altKey?: boolean;
		ctrlKey?: boolean;
		metaKey?: boolean;
		shiftKey?: boolean;
	};
}) {
	if (!isTypingCaptureActive || isCursorCapturePaused()) {
		return;
	}

	// The payload is flat in uiohook-napi 1.5.x, but the mouse path in this
	// codebase defensively unwraps a nested `data` shape, so accept both.
	const source = event?.data ?? event;
	const keycode = typeof source?.keycode === "number" ? source.keycode : -1;
	if (keycode < 0) {
		return;
	}

	const point = getNormalizedCursorPoint();
	if (!point) {
		return;
	}

	const keyClass = classifyTypingKey(keycode, {
		ctrlKey: Boolean(source?.ctrlKey),
		metaKey: Boolean(source?.metaKey),
		altKey: Boolean(source?.altKey),
		shiftKey: Boolean(source?.shiftKey),
	});

	pushTypingSample(point.cx, point.cy, getCursorCaptureElapsedMs(), keyClass);
}

export function startTypingCapture() {
	if (!isTypingCaptureActive) {
		return;
	}
	setActiveTypingSamples([]);
}

export function stopTypingCapture() {
	setIsTypingCaptureActive(false);
	setActiveTypingSamples([]);
}

export function resetTypingCaptureClock() {
	setActiveTypingSamples([]);
}

export function snapshotTypingTelemetryForPersistence() {
	if (activeTypingSamples.length === 0) {
		return;
	}

	if (pendingTypingSamples.length === 0) {
		setPendingTypingSamples([...activeTypingSamples]);
		return;
	}

	const lastPendingTimeMs = pendingTypingSamples[pendingTypingSamples.length - 1]?.timeMs ?? -1;
	setPendingTypingSamples([
		...pendingTypingSamples,
		...activeTypingSamples.filter((sample) => sample.timeMs > lastPendingTimeMs),
	]);
}

export async function persistPendingTypingTelemetry(videoPath: string) {
	if (pendingTypingSamples.length > 0) {
		await fs.writeFile(
			getTypingTelemetryPathForVideo(videoPath),
			JSON.stringify(
				{ version: TYPING_TELEMETRY_VERSION, samples: pendingTypingSamples },
				null,
				2,
			),
			"utf-8",
		);
	}
	setPendingTypingSamples([]);
}
