import type { FreezeRegion } from "../types";

/**
 * After a hold completes, the video resumes on (or just before) the held frame. A freeze frame
 * becomes holdable again only once the playhead has moved back more than this far before it.
 */
export const FREEZE_HOLD_REARM_DISTANCE_MS = 120;

/** How close playback must start to a freeze frame for that hold to begin immediately. */
export const FREEZE_HOLD_START_TOLERANCE_MS = 40;

/** Returns a not-yet-completed freeze frame that playback is starting on, if any. */
export function findFreezeRegionAtTime(
	freezeRegions: FreezeRegion[],
	timeMs: number,
	completedFreezeIds: ReadonlySet<string>,
): FreezeRegion | null {
	return (
		freezeRegions.find(
			(freezeRegion) =>
				!completedFreezeIds.has(freezeRegion.id) &&
				Math.abs(freezeRegion.sourceMs - timeMs) <= FREEZE_HOLD_START_TOLERANCE_MS,
		) ?? null
	);
}

/** Returns the earliest not-yet-completed freeze frame that playback crossed between two frames. */
export function findFreezeRegionToHold({
	freezeRegions,
	previousTimeMs,
	currentTimeMs,
	completedFreezeIds,
}: {
	freezeRegions: FreezeRegion[];
	previousTimeMs: number | null;
	currentTimeMs: number;
	completedFreezeIds: ReadonlySet<string>;
}): FreezeRegion | null {
	if (previousTimeMs === null) {
		return null;
	}

	let earliestCrossed: FreezeRegion | null = null;
	for (const freezeRegion of freezeRegions) {
		const crossed =
			previousTimeMs < freezeRegion.sourceMs && freezeRegion.sourceMs <= currentTimeMs;
		if (
			crossed &&
			!completedFreezeIds.has(freezeRegion.id) &&
			(!earliestCrossed || freezeRegion.sourceMs < earliestCrossed.sourceMs)
		) {
			earliestCrossed = freezeRegion;
		}
	}

	return earliestCrossed;
}

/** Keeps completed freeze frames completed until the playhead moves back before them. */
export function rearmCompletedFreezeIds(
	freezeRegions: FreezeRegion[],
	completedFreezeIds: ReadonlySet<string>,
	currentTimeMs: number,
): Set<string> {
	const sourceMsById = new Map(
		freezeRegions.map((freezeRegion) => [freezeRegion.id, freezeRegion.sourceMs]),
	);
	const stillCompleted = new Set<string>();
	for (const freezeId of completedFreezeIds) {
		const sourceMs = sourceMsById.get(freezeId);
		if (sourceMs !== undefined && currentTimeMs >= sourceMs - FREEZE_HOLD_REARM_DISTANCE_MS) {
			stillCompleted.add(freezeId);
		}
	}

	return stillCompleted;
}

export interface FreezeHoldClock {
	start(freezeRegion: FreezeRegion, elapsedMs?: number): void;
	/** Pauses a running hold. Returns false when no hold is running. */
	pause(): boolean;
	/** Resumes a paused hold. Returns false when no hold is paused. */
	resume(): boolean;
	cancel(): void;
	isRunning(): boolean;
	getActiveFreeze(): FreezeRegion | null;
	getElapsedMs(): number;
}

interface FreezeHoldClockOptions {
	now: () => number;
	requestFrame: (callback: () => void) => number;
	cancelFrame: (handle: number) => void;
	onTick: (freezeRegion: FreezeRegion, elapsedMs: number) => void;
	onComplete: (freezeRegion: FreezeRegion) => void;
}

/** Wall-clock timer for how long a held frame has been on screen, excluding paused time. */
export function createFreezeHoldClock({
	now,
	requestFrame,
	cancelFrame,
	onTick,
	onComplete,
}: FreezeHoldClockOptions): FreezeHoldClock {
	let activeFreeze: FreezeRegion | null = null;
	let elapsedBeforeRunMs = 0;
	let runStartedAtMs: number | null = null;
	let frameHandle: number | null = null;

	const cancelScheduledFrame = () => {
		if (frameHandle !== null) {
			cancelFrame(frameHandle);
			frameHandle = null;
		}
	};

	const getElapsedMs = () =>
		runStartedAtMs === null ? elapsedBeforeRunMs : elapsedBeforeRunMs + now() - runStartedAtMs;

	const reset = () => {
		cancelScheduledFrame();
		activeFreeze = null;
		elapsedBeforeRunMs = 0;
		runStartedAtMs = null;
	};

	const tick = () => {
		frameHandle = null;
		const freezeRegion = activeFreeze;
		if (!freezeRegion || runStartedAtMs === null) {
			return;
		}

		const elapsedMs = getElapsedMs();
		if (elapsedMs >= freezeRegion.durationMs) {
			reset();
			onComplete(freezeRegion);
			return;
		}

		onTick(freezeRegion, elapsedMs);
		frameHandle = requestFrame(tick);
	};

	return {
		start(freezeRegion, elapsedMs = 0) {
			reset();
			activeFreeze = freezeRegion;
			elapsedBeforeRunMs = Math.max(0, elapsedMs);
			runStartedAtMs = now();
			frameHandle = requestFrame(tick);
		},
		pause() {
			if (!activeFreeze || runStartedAtMs === null) {
				return false;
			}

			elapsedBeforeRunMs = getElapsedMs();
			runStartedAtMs = null;
			cancelScheduledFrame();
			return true;
		},
		resume() {
			if (!activeFreeze || runStartedAtMs !== null) {
				return false;
			}

			runStartedAtMs = now();
			frameHandle = requestFrame(tick);
			return true;
		},
		cancel: reset,
		isRunning: () => activeFreeze !== null && runStartedAtMs !== null,
		getActiveFreeze: () => activeFreeze,
		getElapsedMs,
	};
}
