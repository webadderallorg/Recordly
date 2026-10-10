import { describe, expect, it, vi } from "vitest";
import { type FirstVideoFrame, waitForFirstVideoFrame } from "./waitForFirstVideoFrame";

function createTrack(readyState: MediaStreamTrackState = "live") {
	const target = new EventTarget();
	return Object.assign(target, { readyState }) as unknown as MediaStreamTrack;
}

function createProbe() {
	let resolveFrame: (frame: FirstVideoFrame) => void = () => undefined;
	const dispose = vi.fn();
	const probe = {
		read: () =>
			new Promise<FirstVideoFrame>((resolve) => {
				resolveFrame = resolve;
			}),
		dispose,
	};
	return { probe, dispose, deliver: (frame: FirstVideoFrame) => resolveFrame(frame) };
}

describe("waitForFirstVideoFrame", () => {
	it("resolves with the dimensions of the first real frame", async () => {
		const { probe, dispose, deliver } = createProbe();
		const pending = waitForFirstVideoFrame(createTrack(), { createProbe: () => probe });

		deliver({ width: 1920, height: 1080 });

		await expect(pending).resolves.toEqual({ width: 1920, height: 1080 });
		expect(dispose).toHaveBeenCalledTimes(1);
	});

	it("rejects when the track ends before a frame arrives", async () => {
		const { probe, dispose } = createProbe();
		const track = createTrack();
		const pending = waitForFirstVideoFrame(track, { createProbe: () => probe });

		track.dispatchEvent(new Event("ended"));

		await expect(pending).rejects.toThrow(/cancelled/i);
		expect(dispose).toHaveBeenCalledTimes(1);
	});

	it("rejects immediately when the track is already ended", async () => {
		const { probe } = createProbe();

		await expect(
			waitForFirstVideoFrame(createTrack("ended"), { createProbe: () => probe }),
		).rejects.toThrow(/cancelled/i);
	});

	it("rejects when no frame arrives before the timeout", async () => {
		vi.useFakeTimers();
		try {
			const { probe, dispose } = createProbe();
			const pending = waitForFirstVideoFrame(createTrack(), {
				createProbe: () => probe,
				timeoutMs: 5000,
			});
			const assertion = expect(pending).rejects.toThrow(/no screen frames/i);

			await vi.advanceTimersByTimeAsync(5000);

			await assertion;
			expect(dispose).toHaveBeenCalledTimes(1);
		} finally {
			vi.useRealTimers();
		}
	});
});
