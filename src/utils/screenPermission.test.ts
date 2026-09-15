import { describe, expect, it } from "vitest";
import { isScreenPermissionDeniedError, waitForScreenPermission } from "./screenPermission";

function createFakeTrack(readyState: "live" | "ended") {
	const state = { readyState };
	const listeners = new Set<() => void>();
	return {
		get readyState() {
			return state.readyState;
		},
		addEventListener: (_type: string, listener: () => void) => {
			listeners.add(listener);
		},
		removeEventListener: (_type: string, listener: () => void) => {
			listeners.delete(listener);
		},
		emitEnded: () => {
			state.readyState = "ended";
			for (const listener of listeners) listener();
		},
		 listenerCount: () => listeners.size,
	};
}

function createFakeFrameProbe() {
	let onFirstFrame: (() => void) | null = null;
	const state = { disposed: false };
	return {
		listen: (callback: () => void) => {
			onFirstFrame = callback;
		},
		dispose: () => {
			state.disposed = true;
		},
		emitFirstFrame: () => {
			onFirstFrame?.();
		},
		wasDisposed: () => state.disposed,
	};
}

describe("waitForScreenPermission", () => {
	it("resolves denied immediately when the track is already ended (user denied before wait)", async () => {
		const track = createFakeTrack("ended");

		await expect(waitForScreenPermission(track, createFakeFrameProbe())).resolves.toBe("denied");
	});

	it("stays pending while the portal dialog is open (no frame, no denial)", async () => {
		const track = createFakeTrack("live");
		const outcomes: string[] = [];

		const promise = waitForScreenPermission(track, createFakeFrameProbe());
		void promise.then((outcome) => {
			outcomes.push(outcome);
		});

		await Promise.resolve();
		await Promise.resolve();
		expect(outcomes).toEqual([]);
	});

	it("resolves granted when the first video frame arrives (user accepted)", async () => {
		const track = createFakeTrack("live");
		const probe = createFakeFrameProbe();

		const promise = waitForScreenPermission(track, probe);

		probe.emitFirstFrame();
		await expect(promise).resolves.toBe("granted");
	});

	it("resolves denied when the track ends while waiting (user denied)", async () => {
		const track = createFakeTrack("live");

		const promise = waitForScreenPermission(track, createFakeFrameProbe());

		track.emitEnded();
		await expect(promise).resolves.toBe("denied");
	});

	it("stops listening and disposes the probe after settlement", async () => {
		const track = createFakeTrack("live");
		const probe = createFakeFrameProbe();

		const promise = waitForScreenPermission(track, probe);
		track.emitEnded();
		await expect(promise).resolves.toBe("denied");

		expect(track.listenerCount()).toBe(0);
		expect(probe.wasDisposed()).toBe(true);

		// Late frame after denial must not change the settled outcome.
		probe.emitFirstFrame();
		await expect(promise).resolves.toBe("denied");
	});

	it("frames win over a later ended event (accept followed by stop)", async () => {
		const track = createFakeTrack("live");
		const probe = createFakeFrameProbe();

		const promise = waitForScreenPermission(track, probe);
		probe.emitFirstFrame();
		track.emitEnded();

		await expect(promise).resolves.toBe("granted");
	});
});

describe("isScreenPermissionDeniedError", () => {
	it("recognizes portal denial error shapes", () => {
		expect(isScreenPermissionDeniedError(new DOMException("denied", "NotAllowedError"))).toBe(
			true,
		);
		expect(isScreenPermissionDeniedError(new DOMException("closed", "AbortError"))).toBe(true);
		expect(isScreenPermissionDeniedError(new DOMException("blocked", "SecurityError"))).toBe(
			true,
		);
	});

	it("rejects unrelated failures", () => {
		expect(isScreenPermissionDeniedError(new DOMException("hardware", "NotReadableError"))).toBe(
			false,
		);
		expect(isScreenPermissionDeniedError(new Error("plain failure"))).toBe(false);
		expect(isScreenPermissionDeniedError(undefined)).toBe(false);
	});
});
