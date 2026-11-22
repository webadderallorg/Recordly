import { describe, expect, it } from "vitest";
import type { CursorTelemetryPoint } from "@/components/video-editor/types";
import { applyDefaultCursorShape } from "@/components/video-editor/videoPlayback/cursorShapeOverride";
import { buildNativeStaticLayoutCursorTelemetry } from "./nativeStaticLayoutTelemetry";

describe("buildNativeStaticLayoutCursorTelemetry", () => {
	it("passes default cursor shapes to the native exporter while preserving click feedback", () => {
		const source: CursorTelemetryPoint[] = [
			{ timeMs: 0, cx: 0.5, cy: 0.5, cursorType: "text" },
			{ timeMs: 600, cx: 0.7, cy: 0.5, cursorType: "pointer" },
			{ timeMs: 1000, cx: 0.7, cy: 0.5, interactionType: "click", mouseButton: 1 },
			{ timeMs: 1600, cx: 0.7, cy: 0.5, interactionType: "mouseup", mouseButton: 1 },
		];
		const options = { frameRate: 30, durationSec: 2, cursorStyle: "windows11" };
		const original = buildNativeStaticLayoutCursorTelemetry(source, options)!;
		const overridden = buildNativeStaticLayoutCursorTelemetry(
			applyDefaultCursorShape(source, true),
			options,
		)!;
		expect(original.some((sample) => sample.cursorType === "pointer")).toBe(true);
		expect(overridden.every((sample) => sample.cursorTypeIndex === 0)).toBe(true);
		expect(overridden.some((sample) => (sample.bounceScale ?? 1) < 1)).toBe(true);
		expect(source[0].cursorType).toBe("text");
		expect(applyDefaultCursorShape(source, false)).toBe(source);
	});

	it("keeps legacy cursor indexes and appends the Windows move and diagonal cursors", () => {
		const cursorTypes = [
			"resize-ew",
			"resize-ns",
			"not-allowed",
			"move",
			"resize-nwse",
			"resize-nesw",
		] as const;
		const samples = buildNativeStaticLayoutCursorTelemetry(
			cursorTypes.map((cursorType, i) => ({ timeMs: i * 250, cx: 0.5, cy: 0.5, cursorType })),
			{ frameRate: 24, durationSec: 2, cursorStyle: "windows11" },
		)!;
		expect(samples.map((sample) => sample.cursorTypeIndex)).toEqual([6, 7, 8, 9, 10, 11]);
	});

	it("exports a sustained press and releases after dragging", () => {
		const samples = buildNativeStaticLayoutCursorTelemetry(
			[
				{
					timeMs: 0,
					cx: 0.1,
					cy: 0.2,
					cursorType: "arrow",
					interactionType: "click",
					mouseButton: 1,
				},
				{ timeMs: 3000, cx: 0.8, cy: 0.7, interactionType: "move" },
				{ timeMs: 4000, cx: 0.9, cy: 0.8, interactionType: "mouseup", mouseButton: 1 },
			],
			{ frameRate: 30, durationSec: 5, cursorStyle: "pixel-hand" },
		)!;
		const held = samples.filter((sample) => sample.timeMs >= 1000 && sample.timeMs <= 3000);
		expect(held.length).toBeGreaterThan(0);
		expect(
			held.every(
				(sample) => sample.bounceScale === 0.92 && sample.cursorType === "closed-hand",
			),
		).toBe(true);
		expect(held.at(-1)!.cx).toBeGreaterThan(held[0].cx);
		expect(samples.at(-1)).toMatchObject({ bounceScale: 1, cursorType: "arrow" });
	});
	it("exports the pixel glove press pose and releases it, respecting bounce off", () => {
		const telemetry = [
			{ timeMs: 0, cx: 0.5, cy: 0.5, cursorType: "arrow" as const },
			{ timeMs: 100, cx: 0.5, cy: 0.5, interactionType: "click" },
		];
		const options = {
			frameRate: 60,
			durationSec: 0.5,
			cursorStyle: "pixel-hand",
			clickBounce: 1,
		};
		const samples = buildNativeStaticLayoutCursorTelemetry(telemetry, options)!;
		expect(samples.some((sample) => sample.cursorTypeIndex === 5)).toBe(true);
		expect(samples[samples.length - 1]?.cursorType).toBe("arrow");
		const disabled = buildNativeStaticLayoutCursorTelemetry(telemetry, {
			...options,
			clickBounce: 0,
		})!;
		expect(
			disabled.every((sample) => sample.cursorTypeIndex === 0 && sample.bounceScale === 1),
		).toBe(true);
	});
	it("filters invalid samples, clamps coordinates, and sorts by time", () => {
		expect(
			buildNativeStaticLayoutCursorTelemetry(
				[
					{ timeMs: 30, cx: 2, cy: -1 },
					{ timeMs: Number.NaN, cx: 0.5, cy: 0.5 },
					{ timeMs: 10, cx: 0.25, cy: 0.75 },
				],
				{ frameRate: 30, durationSec: 2 },
			),
		).toEqual([
			{
				timeMs: 0,
				cx: 0.25,
				cy: 0.75,
				cursorType: "arrow",
				cursorTypeIndex: 0,
				bounceScale: 1,
			},
			{
				timeMs: 2000,
				cx: 1,
				cy: 0,
				cursorType: "arrow",
				cursorTypeIndex: 0,
				bounceScale: 1,
			},
		]);
	});

	it("resamples high-frequency cursor telemetry to the export frame cadence", () => {
		const telemetry = Array.from({ length: 101 }, (_, index) => ({
			timeMs: index * 10,
			cx: index / 100,
			cy: 1 - index / 100,
		}));

		const resampled = buildNativeStaticLayoutCursorTelemetry(telemetry, {
			frameRate: 10,
			durationSec: 1,
		});

		expect(resampled).toBeDefined();
		expect(resampled).toHaveLength(11);
		expect(resampled?.[0]).toEqual({
			timeMs: 0,
			cx: 0,
			cy: 1,
			cursorType: "arrow",
			cursorTypeIndex: 0,
			bounceScale: 1,
		});
		expect(resampled?.[5]).toEqual({
			timeMs: 500,
			cx: 0.5,
			cy: 0.5,
			cursorType: "arrow",
			cursorTypeIndex: 0,
			bounceScale: 1,
		});
		expect(resampled?.[10]).toEqual({
			timeMs: 1000,
			cx: 1,
			cy: 0,
			cursorType: "arrow",
			cursorTypeIndex: 0,
			bounceScale: 1,
		});
	});

	it("collapses visually unchanged cursor positions", () => {
		const telemetry = Array.from({ length: 101 }, (_, index) => ({
			timeMs: index * 10,
			cx: 0.4,
			cy: 0.6,
		}));

		expect(
			buildNativeStaticLayoutCursorTelemetry(telemetry, {
				frameRate: 10,
				durationSec: 1,
			}),
		).toEqual([
			{
				timeMs: 1000,
				cx: 0.4,
				cy: 0.6,
				cursorType: "arrow",
				cursorTypeIndex: 0,
				bounceScale: 1,
			},
		]);
	});

	it("keeps cursor type transitions and click bounce samples for native parity", () => {
		const resampled = buildNativeStaticLayoutCursorTelemetry(
			[
				{ timeMs: 0, cx: 0.1, cy: 0.2, cursorType: "arrow" },
				{ timeMs: 100, cx: 0.1, cy: 0.2, interactionType: "click", cursorType: "pointer" },
				{ timeMs: 200, cx: 0.1, cy: 0.2, interactionType: "mouseup", cursorType: "text" },
			],
			{ frameRate: 10, durationSec: 0.4, clickBounce: 1, clickBounceDurationMs: 350 },
		);

		expect(resampled?.map((sample) => sample.cursorTypeIndex)).toContain(1);
		expect(resampled?.some((sample) => (sample.bounceScale ?? 1) < 1)).toBe(true);
	});

	it("projects cursor samples into the cropped viewport and marks out-of-crop samples hidden", () => {
		const resampled = buildNativeStaticLayoutCursorTelemetry(
			[
				{ timeMs: 0, cx: 0.25, cy: 0.5 },
				{ timeMs: 1000, cx: 0.75, cy: 0.5 },
			],
			{
				frameRate: 1,
				durationSec: 1,
				sourceCrop: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 },
			},
		);

		expect(resampled?.[0]).toMatchObject({ timeMs: 0, cx: 0, cy: 0.5, visible: true });
		expect(resampled?.[1]).toMatchObject({ timeMs: 1000, cx: 1, cy: 0.5, visible: true });

		const hidden = buildNativeStaticLayoutCursorTelemetry(
			[
				{ timeMs: 0, cx: 0.1, cy: 0.5 },
				{ timeMs: 1000, cx: 0.1, cy: 0.5 },
			],
			{
				frameRate: 1,
				durationSec: 1,
				sourceCrop: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 },
			},
		);

		expect(hidden).toEqual([
			expect.objectContaining({
				timeMs: 1000,
				visible: false,
			}),
		]);
	});
});
