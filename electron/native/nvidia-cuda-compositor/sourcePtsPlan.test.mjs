import { describe, expect, it } from "vitest";
import { shouldProbeSourcePts } from "./sourcePtsPlan.mjs";

describe("shouldProbeSourcePts", () => {
	it("probes when a timeline map is present (mapped-callback needs source PTS)", () => {
		expect(
			shouldProbeSourcePts({
				hasTimelineSegments: true,
				videoOnly: true,
				forceSourcePts: undefined,
			}),
		).toBe(true);
	});

	it("probes when the wrapper will inline-mux audio (non-video-only)", () => {
		expect(
			shouldProbeSourcePts({
				hasTimelineSegments: false,
				videoOnly: false,
				forceSourcePts: undefined,
			}),
		).toBe(true);
	});

	it("skips the probe for plain video-only exports without a timeline", () => {
		expect(
			shouldProbeSourcePts({
				hasTimelineSegments: false,
				videoOnly: true,
				forceSourcePts: undefined,
			}),
		).toBe(false);
	});

	it("honors the force override for diagnostics", () => {
		expect(
			shouldProbeSourcePts({
				hasTimelineSegments: false,
				videoOnly: true,
				forceSourcePts: "1",
			}),
		).toBe(true);
	});
});
