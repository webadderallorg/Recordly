import { describe, expect, it } from "vitest";
import type { ExportProgress } from "@/lib/exporter/types";
import { createSmokeExportProgressSampler } from "./smokeExportProgress";

function progress(overrides: Partial<ExportProgress> = {}): ExportProgress {
	return {
		currentFrame: 1,
		totalFrames: 100,
		percentage: 1,
		estimatedTimeRemaining: 10,
		...overrides,
	};
}

describe("createSmokeExportProgressSampler", () => {
	it("does not sample when smoke export is disabled", () => {
		const sampler = createSmokeExportProgressSampler({
			enabled: false,
			startedAtMs: 100,
			now: () => 200,
		});

		sampler.record(progress());

		expect(sampler.samples).toEqual([]);
	});

	it("does not sample before the smoke export start time is known", () => {
		const sampler = createSmokeExportProgressSampler({
			enabled: true,
			startedAtMs: null,
			now: () => 200,
		});

		sampler.record(progress());

		expect(sampler.samples).toEqual([]);
	});

	it("records the first progress update with the default phase", () => {
		const sampler = createSmokeExportProgressSampler({
			enabled: true,
			startedAtMs: 100,
			now: () => 245.4,
		});

		sampler.record(
			progress({
				currentFrame: 4,
				totalFrames: 200,
				percentage: 2,
				estimatedTimeRemaining: 12,
				renderFps: 58,
				renderBackend: "webgpu",
				encodeBackend: "webcodecs",
				encoderName: "VideoEncoder",
			}),
		);

		expect(sampler.samples).toEqual([
			{
				elapsedMs: 145,
				phase: "extracting",
				currentFrame: 4,
				totalFrames: 200,
				percentage: 2,
				estimatedTimeRemaining: 12,
				renderFps: 58,
				renderBackend: "webgpu",
				encodeBackend: "webcodecs",
				encoderName: "VideoEncoder",
			},
		]);
	});

	it("skips same-phase updates inside the sampling interval", () => {
		const timestamps = [100, 500];
		const sampler = createSmokeExportProgressSampler({
			enabled: true,
			startedAtMs: 0,
			now: () => timestamps.shift() ?? 500,
		});

		sampler.record(progress({ currentFrame: 1, percentage: 1 }));
		sampler.record(progress({ currentFrame: 2, percentage: 2 }));

		expect(sampler.samples).toHaveLength(1);
		expect(sampler.samples[0]?.currentFrame).toBe(1);
	});

	it("samples phase changes and interval updates", () => {
		const timestamps = [100, 200, 1200];
		const sampler = createSmokeExportProgressSampler({
			enabled: true,
			startedAtMs: 0,
			now: () => timestamps.shift() ?? 1200,
		});

		sampler.record(progress({ currentFrame: 1, phase: "extracting" }));
		sampler.record(progress({ currentFrame: 2, phase: "finalizing" }));
		sampler.record(progress({ currentFrame: 3, phase: "finalizing" }));

		expect(sampler.samples.map((sample) => sample.currentFrame)).toEqual([1, 2, 3]);
	});

	it("samples final progress even inside the sampling interval", () => {
		const timestamps = [100, 250];
		const sampler = createSmokeExportProgressSampler({
			enabled: true,
			startedAtMs: 0,
			now: () => timestamps.shift() ?? 250,
		});

		sampler.record(progress({ currentFrame: 1, totalFrames: 10 }));
		sampler.record(progress({ currentFrame: 10, totalFrames: 10 }));

		expect(sampler.samples.map((sample) => sample.currentFrame)).toEqual([1, 10]);
	});
});
