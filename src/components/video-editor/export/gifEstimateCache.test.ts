import { afterEach, describe, expect, it, vi } from "vitest";
import {
	cacheGifSizeEstimate,
	getCachedGifSizeEstimate,
	gifEstimateTelemetryKey,
	runGifSizeEstimate,
	stopGifSizeEstimates,
} from "./gifEstimateCache";

const estimate = {
	originalBytes: 100,
	optimizedBytes: 40,
	reductionPercent: 60,
	sampleFrames: 60,
	totalFrames: 300,
};
afterEach(() => vi.useRealTimers());
describe("GIF estimate scheduling and cache", () => {
	it("expires measured results after five minutes without extending their lifetime on access", () => {
		vi.useFakeTimers();
		cacheGifSizeEstimate("ttl", estimate);
		vi.advanceTimersByTime(299_999);
		expect(getCachedGifSizeEstimate("ttl")).toEqual(estimate);
		vi.advanceTimersByTime(1);
		expect(getCachedGifSizeEstimate("ttl")).toBeUndefined();
	});
	it("keeps a bounded LRU cache", () => {
		for (let i = 0; i < 8; i++) cacheGifSizeEstimate(`lru-${i}`, estimate);
		expect(getCachedGifSizeEstimate("lru-0")).toEqual(estimate);
		cacheGifSizeEstimate("lru-8", estimate);
		expect(getCachedGifSizeEstimate("lru-1")).toBeUndefined();
		expect(getCachedGifSizeEstimate("lru-0")).toEqual(estimate);
	});
	it("distinguishes telemetry arrays without serializing their contents", () => {
		const telemetry = [];
		expect(gifEstimateTelemetryKey(telemetry)).toBe(gifEstimateTelemetryKey(telemetry));
		expect(gifEstimateTelemetryKey([])).not.toBe(gifEstimateTelemetryKey(telemetry));
	});
	it("serializes jobs and recovers after failures", async () => {
		let release!: () => void;
		const first = runGifSizeEstimate(
			new AbortController().signal,
			() =>
				new Promise<void>((resolve) => {
					release = resolve;
				}),
		);
		const next = vi.fn(async () => {
			throw new Error("failed");
		});
		const second = runGifSizeEstimate(new AbortController().signal, next);
		const rejected = expect(second).rejects.toThrow("failed");
		await Promise.resolve();
		expect(next).not.toHaveBeenCalled();
		release();
		await first;
		await rejected;
		await expect(
			runGifSizeEstimate(new AbortController().signal, async () => 42),
		).resolves.toBe(42);
	});
	it("export cancellation drains active cleanup and skips queued samples", async () => {
		let finishCleanup!: () => void;
		let activeSignal!: AbortSignal;
		const first = runGifSizeEstimate(new AbortController().signal, (signal) => {
			activeSignal = signal;
			return new Promise<void>((resolve) => {
				finishCleanup = resolve;
			});
		});
		const next = vi.fn(async () => 1);
		const second = runGifSizeEstimate(new AbortController().signal, next);
		const rejected = expect(second).rejects.toMatchObject({ name: "AbortError" });
		await Promise.resolve();
		let drained = false;
		const stopped = stopGifSizeEstimates().then(() => {
			drained = true;
		});
		expect(activeSignal.aborted).toBe(true);
		await Promise.resolve();
		expect(drained).toBe(false);
		finishCleanup();
		await first;
		await rejected;
		await stopped;
		expect(next).not.toHaveBeenCalled();
		expect(drained).toBe(true);
	});
});
