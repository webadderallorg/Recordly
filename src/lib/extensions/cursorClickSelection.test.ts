import { describe, expect, it } from "vitest";
import type { CursorTelemetryPoint } from "@/components/video-editor/types";
import { selectCursorClickForEmission } from "./cursorClickSelection";

describe("selectCursorClickForEmission", () => {
	it("returns a click behind a newer move in the frame window", () => {
		const telemetry: CursorTelemetryPoint[] = [
			{ timeMs: 1_000, cx: 0.5, cy: 0.5, interactionType: "click" },
			{ timeMs: 1_008, cx: 0.51, cy: 0.51, interactionType: "move" },
		];

		expect(selectCursorClickForEmission(telemetry, 1_015, -1)?.timeMs).toBe(1_000);
	});

	it("does not return an already emitted click behind a newer move", () => {
		const telemetry: CursorTelemetryPoint[] = [
			{ timeMs: 1_000, cx: 0.5, cy: 0.5, interactionType: "click" },
			{ timeMs: 1_008, cx: 0.51, cy: 0.51, interactionType: "move" },
		];

		expect(selectCursorClickForEmission(telemetry, 1_015, 1_000)).toBeNull();
	});

	it("ignores clicks outside the 100ms frame window", () => {
		const telemetry: CursorTelemetryPoint[] = [
			{ timeMs: 900, cx: 0.5, cy: 0.5, interactionType: "click" },
			{ timeMs: 1_015, cx: 0.51, cy: 0.51, interactionType: "move" },
		];

		expect(selectCursorClickForEmission(telemetry, 1_015, -1)).toBeNull();
	});

	it("ignores mouseup so one physical click doesn't fire multiple click-sound events", () => {
		const telemetry: CursorTelemetryPoint[] = [
			{ timeMs: 1_000, cx: 0.5, cy: 0.5, interactionType: "click" },
			{ timeMs: 1_008, cx: 0.51, cy: 0.51, interactionType: "mouseup" },
		];

		expect(selectCursorClickForEmission(telemetry, 1_015, -1)?.interactionType).toBe("click");
	});
});
