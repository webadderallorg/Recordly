import { beforeAll, describe, expect, it, vi } from "vitest";
import type { ModernVideoExporter as ModernVideoExporterClass } from "./modernVideoExporter";
import type { ExportProgress } from "./types";

describe("ModernVideoExporter reportProgress preparing dedup", () => {
	let ModernVideoExporter: typeof ModernVideoExporterClass;

	beforeAll(async () => {
		({ ModernVideoExporter } = await import("./modernVideoExporter"));
	}, 30_000);

	it("delivers the first preparing signal and suppresses identical repeats for one export", async () => {
		const emitted: ExportProgress[] = [];
		const exporter = new ModernVideoExporter({
			onProgress: (progress) => emitted.push(progress),
		} as never) as unknown as {
			reportProgress: (
				currentFrame: number,
				totalFrames: number,
				phase: "preparing" | "extracting" | "finalizing" | "saving",
				renderProgress?: number,
				audioProgress?: number,
			) => void;
		};

		const reporter = exporter.reportProgress.bind(exporter);
		reporter(0, 100, "preparing");
		reporter(0, 100, "preparing");
		reporter(0, 100, "preparing");

		expect(emitted).toHaveLength(1);
		expect(emitted[0]).toMatchObject({
			currentFrame: 0,
			totalFrames: 100,
			phase: "preparing",
			percentage: 0,
		});
	});

	it("does not suppress progress that carries render or audio progress", async () => {
		const emitted: ExportProgress[] = [];
		const exporter = new ModernVideoExporter({
			onProgress: (progress) => emitted.push(progress),
		} as never) as unknown as {
			reportProgress: (
				currentFrame: number,
				totalFrames: number,
				phase: "preparing" | "extracting" | "finalizing" | "saving",
				renderProgress?: number,
				audioProgress?: number,
			) => void;
		};

		const reporter = exporter.reportProgress.bind(exporter);
		reporter(0, 100, "preparing");
		reporter(0, 100, "preparing", undefined, 0.5);
		reporter(0, 100, "preparing", undefined, 0.6);

		// The first plain preparing is suppressed for the second, but the two
		// audio-progress-bearing signals each still carry their distinct values.
		expect(emitted).toHaveLength(3);
		expect(emitted.map((p) => p.audioProgress)).toEqual([undefined, 0.5, 0.6]);
	});

	it("emits again once the export moves on and a different total frame count starts", async () => {
		const emitted: ExportProgress[] = [];
		const exporter = new ModernVideoExporter({
			onProgress: (progress) => emitted.push(progress),
		} as never) as unknown as {
			reportProgress: (
				currentFrame: number,
				totalFrames: number,
				phase: "preparing" | "extracting" | "finalizing" | "saving",
				renderProgress?: number,
				audioProgress?: number,
			) => void;
		};

		const reporter = exporter.reportProgress.bind(exporter);
		reporter(0, 100, "preparing");
		reporter(0, 100, "preparing");
		reporter(50, 100, "extracting");
		reporter(0, 120, "preparing");

		expect(emitted).toHaveLength(3);
		expect(emitted.map((p) => [p.currentFrame, p.totalFrames, p.phase])).toEqual([
			[0, 100, "preparing"],
			[50, 100, "extracting"],
			[0, 120, "preparing"],
		]);
	});

	it("re-delivers the preparing signal after a non-preparing phase reuses the same total frame count", async () => {
		const emitted: ExportProgress[] = [];
		const exporter = new ModernVideoExporter({
			onProgress: (progress) => emitted.push(progress),
		} as never) as unknown as {
			reportProgress: (
				currentFrame: number,
				totalFrames: number,
				phase: "preparing" | "extracting" | "finalizing" | "saving",
				renderProgress?: number,
				audioProgress?: number,
			) => void;
		};

		const reporter = exporter.reportProgress.bind(exporter);
		reporter(0, 100, "preparing");
		reporter(0, 100, "preparing");
		// A non-preparing event ends the preparing phase, so the watermark must not
		// suppress a later preparing phase that reuses the same total frame count.
		reporter(50, 100, "extracting");
		reporter(0, 100, "preparing");

		expect(emitted).toHaveLength(3);
		expect(emitted.map((p) => [p.currentFrame, p.totalFrames, p.phase])).toEqual([
			[0, 100, "preparing"],
			[50, 100, "extracting"],
			[0, 100, "preparing"],
		]);
	});

	it("keeps distributing later phase progress after the preparing signal", async () => {
		const emitted: ExportProgress[] = [];
		const exporter = new ModernVideoExporter({
			onProgress: (progress) => emitted.push(progress),
		} as never) as unknown as {
			reportProgress: (
				currentFrame: number,
				totalFrames: number,
				phase: "preparing" | "extracting" | "finalizing" | "saving",
				renderProgress?: number,
				audioProgress?: number,
			) => void;
		};

		const reporter = exporter.reportProgress.bind(exporter);
		reporter(0, 100, "preparing");
		reporter(0, 100, "preparing");
		reporter(10, 100, "extracting");
		reporter(20, 100, "extracting");

		expect(emitted).toHaveLength(3);
		expect(emitted.map((p) => [p.currentFrame, p.phase])).toEqual([
			[0, "preparing"],
			[10, "extracting"],
			[20, "extracting"],
		]);
	});
});
