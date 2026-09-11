import { describe, expect, it, vi } from "vitest";
import type { FreezeRegion } from "../types";
import {
	createFreezeHoldClock,
	findFreezeRegionAtTime,
	findFreezeRegionToHold,
	rearmCompletedFreezeIds,
} from "./freezeHold";

const freezes: FreezeRegion[] = [
	{ id: "freeze-1", sourceMs: 1_000, durationMs: 2_000 },
	{ id: "freeze-2", sourceMs: 4_000, durationMs: 500 },
];

function createFakeFrameScheduler() {
	let nowMs = 0;
	let nextHandle = 1;
	const callbacks = new Map<number, () => void>();

	return {
		now: () => nowMs,
		requestFrame: (callback: () => void) => {
			const handle = nextHandle++;
			callbacks.set(handle, callback);
			return handle;
		},
		cancelFrame: (handle: number) => {
			callbacks.delete(handle);
		},
		advance(ms: number) {
			nowMs += ms;
			const pending = [...callbacks.values()];
			callbacks.clear();
			for (const callback of pending) callback();
		},
		pendingCount: () => callbacks.size,
	};
}

describe("findFreezeRegionToHold", () => {
	it("holds when playback crosses or lands on a freeze frame", () => {
		expect(
			findFreezeRegionToHold({
				freezeRegions: freezes,
				previousTimeMs: 980,
				currentTimeMs: 1_010,
				completedFreezeIds: new Set(),
			})?.id,
		).toBe("freeze-1");
		expect(
			findFreezeRegionToHold({
				freezeRegions: freezes,
				previousTimeMs: 983,
				currentTimeMs: 1_000,
				completedFreezeIds: new Set(),
			})?.id,
		).toBe("freeze-1");
	});

	it("does not hold without a previous frame, after the freeze frame, or once completed", () => {
		expect(
			findFreezeRegionToHold({
				freezeRegions: freezes,
				previousTimeMs: null,
				currentTimeMs: 1_010,
				completedFreezeIds: new Set(),
			}),
		).toBeNull();
		expect(
			findFreezeRegionToHold({
				freezeRegions: freezes,
				previousTimeMs: 1_010,
				currentTimeMs: 1_040,
				completedFreezeIds: new Set(),
			}),
		).toBeNull();
		expect(
			findFreezeRegionToHold({
				freezeRegions: freezes,
				previousTimeMs: 980,
				currentTimeMs: 1_010,
				completedFreezeIds: new Set(["freeze-1"]),
			}),
		).toBeNull();
	});

	it("returns the earliest crossed freeze frame when a frame skips several", () => {
		expect(
			findFreezeRegionToHold({
				freezeRegions: [...freezes].reverse(),
				previousTimeMs: 900,
				currentTimeMs: 4_100,
				completedFreezeIds: new Set(),
			})?.id,
		).toBe("freeze-1");
	});
});

describe("findFreezeRegionAtTime", () => {
	it("finds a freeze frame that playback starts on", () => {
		expect(findFreezeRegionAtTime(freezes, 1_020, new Set())?.id).toBe("freeze-1");
	});

	it("ignores freeze frames that are too far away or already completed", () => {
		expect(findFreezeRegionAtTime(freezes, 1_100, new Set())).toBeNull();
		expect(findFreezeRegionAtTime(freezes, 1_000, new Set(["freeze-1"]))).toBeNull();
	});
});

describe("rearmCompletedFreezeIds", () => {
	it("forgets completed freeze frames once the playhead is back before them", () => {
		expect([
			...rearmCompletedFreezeIds(freezes, new Set(["freeze-1", "freeze-2"]), 3_000),
		]).toEqual(["freeze-1"]);
	});

	it("keeps a freeze frame completed when the resumed frame lands just before it", () => {
		expect([...rearmCompletedFreezeIds(freezes, new Set(["freeze-1"]), 967)]).toEqual([
			"freeze-1",
		]);
	});
});

describe("createFreezeHoldClock", () => {
	it("reports elapsed hold time and completes after the hold duration", () => {
		const frames = createFakeFrameScheduler();
		const onTick = vi.fn();
		const onComplete = vi.fn();
		const clock = createFreezeHoldClock({ ...frames, onTick, onComplete });

		clock.start(freezes[0]);
		expect(clock.getActiveFreeze()?.id).toBe("freeze-1");
		expect(clock.isRunning()).toBe(true);

		frames.advance(500);
		expect(onTick).toHaveBeenLastCalledWith(freezes[0], 500);
		expect(onComplete).not.toHaveBeenCalled();

		frames.advance(1_600);
		expect(onComplete).toHaveBeenCalledWith(freezes[0]);
		expect(clock.getActiveFreeze()).toBeNull();
		expect(frames.pendingCount()).toBe(0);
	});

	it("does not count paused time toward the hold", () => {
		const frames = createFakeFrameScheduler();
		const onTick = vi.fn();
		const onComplete = vi.fn();
		const clock = createFreezeHoldClock({ ...frames, onTick, onComplete });

		clock.start(freezes[0]);
		frames.advance(500);
		expect(clock.pause()).toBe(true);
		expect(clock.isRunning()).toBe(false);
		expect(clock.getElapsedMs()).toBe(500);

		frames.advance(5_000);
		expect(onComplete).not.toHaveBeenCalled();

		expect(clock.resume()).toBe(true);
		frames.advance(1_000);
		expect(onTick).toHaveBeenLastCalledWith(freezes[0], 1_500);
		frames.advance(600);
		expect(onComplete).toHaveBeenCalledTimes(1);
	});

	it("only pauses a running hold and only resumes a paused one", () => {
		const frames = createFakeFrameScheduler();
		const clock = createFreezeHoldClock({ ...frames, onTick: vi.fn(), onComplete: vi.fn() });

		expect(clock.pause()).toBe(false);
		expect(clock.resume()).toBe(false);
		clock.start(freezes[1]);
		expect(clock.resume()).toBe(false);
	});

	it("stops without completing when cancelled", () => {
		const frames = createFakeFrameScheduler();
		const onComplete = vi.fn();
		const clock = createFreezeHoldClock({ ...frames, onTick: vi.fn(), onComplete });

		clock.start(freezes[0]);
		frames.advance(100);
		clock.cancel();
		frames.advance(5_000);

		expect(onComplete).not.toHaveBeenCalled();
		expect(clock.getActiveFreeze()).toBeNull();
		expect(frames.pendingCount()).toBe(0);
	});

	it("can start partway through a hold", () => {
		const frames = createFakeFrameScheduler();
		const onComplete = vi.fn();
		const clock = createFreezeHoldClock({ ...frames, onTick: vi.fn(), onComplete });

		clock.start(freezes[1], 300);
		frames.advance(250);

		expect(onComplete).toHaveBeenCalledWith(freezes[1]);
	});
});
