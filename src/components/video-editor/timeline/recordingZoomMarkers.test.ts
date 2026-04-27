import { describe, expect, it } from "vitest";
import { buildManualRecordingZoomRegions } from "./recordingZoomMarkers";

describe("buildManualRecordingZoomRegions", () => {
	it("places a manual zoom at the shortcut timestamp with the cursor focus", () => {
		const regions = buildManualRecordingZoomRegions({
			cursorTelemetry: [{ timeMs: 1200, cx: 0.25, cy: 0.75, interactionType: "manual-zoom" }],
			totalMs: 5000,
			defaultDurationMs: 1000,
		});

		expect(regions).toEqual([{ start: 1200, end: 2200, focus: { cx: 0.25, cy: 0.75 } }]);
	});

	it("skips markers that would start inside an existing zoom span", () => {
		const regions = buildManualRecordingZoomRegions({
			cursorTelemetry: [
				{ timeMs: 1500, cx: 0.25, cy: 0.75, interactionType: "manual-zoom" },
				{ timeMs: 2500, cx: 0.4, cy: 0.6, interactionType: "manual-zoom" },
			],
			totalMs: 5000,
			defaultDurationMs: 1000,
			reservedSpans: [{ start: 1000, end: 2000 }],
		});

		expect(regions).toEqual([{ start: 2500, end: 3500, focus: { cx: 0.4, cy: 0.6 } }]);
	});

	it("clips a manual zoom before the next reserved span", () => {
		const regions = buildManualRecordingZoomRegions({
			cursorTelemetry: [{ timeMs: 2100, cx: 2, cy: -1, interactionType: "manual-zoom" }],
			totalMs: 5000,
			defaultDurationMs: 1000,
			reservedSpans: [{ start: 2600, end: 3400 }],
		});

		expect(regions).toEqual([{ start: 2100, end: 2600, focus: { cx: 1, cy: 0 } }]);
	});
});
