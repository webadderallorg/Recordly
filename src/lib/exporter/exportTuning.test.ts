import { describe, expect, it } from "vitest";

import {
	getExportBackpressureProfile,
	getNativeRawFrameBackpressureLimits,
	getNativeRawFrameByteSize,
	getPreferredWebCodecsLatencyModes,
	getWebCodecsEncodeQueueLimit,
	getWebCodecsKeyFrameInterval,
	NativeRawFrameBackpressureQueue,
} from "./exportTuning";

describe("exportTuning", () => {
	it("prefers realtime latency for fast and balanced exports", () => {
		expect(getPreferredWebCodecsLatencyModes("fast")).toEqual(["realtime", "quality"]);
		expect(getPreferredWebCodecsLatencyModes("balanced")).toEqual(["realtime", "quality"]);
		expect(getPreferredWebCodecsLatencyModes("quality")).toEqual(["quality", "realtime"]);
	});

	it("keeps queue depth bounded by encoding mode", () => {
		expect(getWebCodecsEncodeQueueLimit(60, "fast")).toBe(75);
		expect(getWebCodecsEncodeQueueLimit(60, "balanced")).toBe(120);
		expect(getWebCodecsEncodeQueueLimit(60, "quality")).toBe(144);
		expect(getWebCodecsEncodeQueueLimit(240, "fast")).toBe(96);
		expect(getWebCodecsEncodeQueueLimit(12, "balanced")).toBe(72);
	});

	it("widens keyframe spacing for faster modes", () => {
		expect(getWebCodecsKeyFrameInterval(60, "fast")).toBe(240);
		expect(getWebCodecsKeyFrameInterval(60, "balanced")).toBe(180);
		expect(getWebCodecsKeyFrameInterval(60, "quality")).toBe(150);
	});

	it("uses shallower decode buffers for Breeze than for WebCodecs", () => {
		const webCodecsProfile = getExportBackpressureProfile({
			encodeBackend: "webcodecs",
			width: 1280,
			height: 720,
			frameRate: 60,
			encodingMode: "balanced",
			hardwareConcurrency: 8,
		});
		const breezeProfile = getExportBackpressureProfile({
			encodeBackend: "ffmpeg",
			width: 1280,
			height: 720,
			frameRate: 60,
			encodingMode: "balanced",
			hardwareConcurrency: 8,
		});

		expect(webCodecsProfile.name).toBe("webcodecs-balanced-plus");
		expect(webCodecsProfile.maxDecodeQueue).toBe(12);
		expect(webCodecsProfile.maxPendingFrames).toBe(32);
		expect(breezeProfile.name).toBe("breeze-balanced-plus");
		expect(breezeProfile.maxDecodeQueue).toBe(14);
		expect(breezeProfile.maxPendingFrames).toBe(40);
		expect(breezeProfile.maxInFlightNativeWrites).toBe(8);
		expect(breezeProfile.maxInFlightNativeRawFrames).toBe(4);
		expect(breezeProfile.maxInFlightNativeRawBytes).toBe(1280 * 720 * 4 * 4);
	});

	it("falls back to conservative native settings on low-core or very heavy workloads", () => {
		const breezeLowCoreProfile = getExportBackpressureProfile({
			encodeBackend: "ffmpeg",
			width: 1280,
			height: 720,
			frameRate: 60,
			hardwareConcurrency: 4,
		});
		const breezeHeavyProfile = getExportBackpressureProfile({
			encodeBackend: "ffmpeg",
			width: 3840,
			height: 2160,
			frameRate: 60,
			hardwareConcurrency: 12,
		});

		expect(breezeLowCoreProfile.name).toBe("breeze-conservative");
		expect(breezeLowCoreProfile.maxDecodeQueue).toBe(8);
		expect(breezeLowCoreProfile.maxPendingFrames).toBe(16);
		expect(breezeLowCoreProfile.maxInFlightNativeWrites).toBe(2);

		expect(breezeHeavyProfile.name).toBe("breeze-conservative");
		expect(breezeHeavyProfile.maxDecodeQueue).toBe(8);
		expect(breezeHeavyProfile.maxPendingFrames).toBe(16);
	});
});

describe("native raw-frame backpressure", () => {
	it("keeps the transferable queue bounded by both frames and bytes", async () => {
		const frameSize = getNativeRawFrameByteSize(2, 2);
		const queue = new NativeRawFrameBackpressureQueue(frameSize * 2, 2);

		await queue.waitForCapacity(frameSize);
		queue.reserve(frameSize);
		queue.reserve(frameSize);
		const waiter = queue.waitForCapacity(frameSize);
		let waiterSettled = false;
		void waiter.then(() => {
			waiterSettled = true;
		});

		await Promise.resolve();
		expect(waiterSettled).toBe(false);
		expect(queue.currentInFlightBytes).toBe(frameSize * 2);
		queue.release(frameSize);
		await waiter;
		expect(queue.currentInFlightBytes).toBe(frameSize);
	});

	it("uses conservative frame and byte caps for cloned IPC", () => {
		const profile = getExportBackpressureProfile({
			encodeBackend: "ffmpeg",
			width: 1920,
			height: 1080,
			frameRate: 30,
			hardwareConcurrency: 8,
		});
		const limits = getNativeRawFrameBackpressureLimits({
			width: 1920,
			height: 1080,
			profile,
			transportMode: "cloned-ipc",
		});

		expect(limits.maxInFlightFrames).toBe(2);
		expect(limits.maxInFlightBytes).toBe(getNativeRawFrameByteSize(1920, 1080) * 2);
	});

	it("settles blocked waiters when the transport closes", async () => {
		const queue = new NativeRawFrameBackpressureQueue(8, 1);
		queue.reserve(8);
		const waiter = queue.waitForCapacity(8);
		const error = new Error("port closed");

		queue.fail(error);

		await expect(waiter).rejects.toBe(error);
		await expect(queue.waitForCapacity(8)).rejects.toBe(error);
	});
});
