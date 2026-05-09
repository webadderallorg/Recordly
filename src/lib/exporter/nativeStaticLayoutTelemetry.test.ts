import { describe, expect, it } from "vitest";
import { buildNativeStaticLayoutCursorTelemetry } from "./nativeStaticLayoutTelemetry";

describe("buildNativeStaticLayoutCursorTelemetry", () => {
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
