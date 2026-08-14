import { describe, expect, it } from "vitest";
import {
	isConstantFrameRateSource,
	parseRationalFps,
	resolveSourcePtsPlan,
	shouldProbeSourcePts,
	shouldSynthesizeCfrSourcePts,
} from "./sourcePtsPlan.mjs";

describe("shouldProbeSourcePts", () => {
	it("synthesizes (not probes) when a timeline map is present on a CFR source", () => {
		// CFR + timeline: synthetic PTS are exactly the real packet PTS, so the
		// scan is unnecessary. The plan selects synthesize-cfr, not probe.
		expect(
			shouldProbeSourcePts({
				hasTimelineSegments: true,
				videoOnly: true,
				forceSourcePts: undefined,
				muxAudioInline: false,
				isConstantFrameRateSource: true,
				hasSourceFrameRate: true,
			}),
		).toBe(false);
	});

	it("probes when a timeline map is present on a VFR source", () => {
		expect(
			shouldProbeSourcePts({
				hasTimelineSegments: true,
				videoOnly: true,
				forceSourcePts: undefined,
				muxAudioInline: false,
				isConstantFrameRateSource: false,
				hasSourceFrameRate: true,
			}),
		).toBe(true);
	});

	it("probes when a timeline map is present on an unknown-rate source", () => {
		expect(
			shouldProbeSourcePts({
				hasTimelineSegments: true,
				videoOnly: true,
				forceSourcePts: undefined,
				muxAudioInline: false,
				isConstantFrameRateSource: false,
				hasSourceFrameRate: false,
			}),
		).toBe(true);
	});

	it("probes when a timeline map is present and the force override is set", () => {
		expect(
			shouldProbeSourcePts({
				hasTimelineSegments: true,
				videoOnly: true,
				forceSourcePts: "1",
				muxAudioInline: false,
				isConstantFrameRateSource: true,
				hasSourceFrameRate: true,
			}),
		).toBe(true);
	});

	it("probes when the force override is set for diagnostics", () => {
		expect(
			shouldProbeSourcePts({
				hasTimelineSegments: false,
				videoOnly: true,
				forceSourcePts: "1",
				muxAudioInline: false,
				isConstantFrameRateSource: true,
				hasSourceFrameRate: true,
			}),
		).toBe(true);
	});

	it("skips the probe for plain video-only exports without a timeline", () => {
		expect(
			shouldProbeSourcePts({
				hasTimelineSegments: false,
				videoOnly: true,
				forceSourcePts: undefined,
				muxAudioInline: false,
				isConstantFrameRateSource: true,
				hasSourceFrameRate: true,
			}),
		).toBe(false);
	});

	it("skips the probe for plain copy-source audio from a CFR source", () => {
		expect(
			shouldProbeSourcePts({
				hasTimelineSegments: false,
				videoOnly: false,
				forceSourcePts: undefined,
				muxAudioInline: true,
				isConstantFrameRateSource: true,
				hasSourceFrameRate: true,
			}),
		).toBe(false);
	});

	it("probes for inline-mux audio when the source is VFR (alignment depends on packet PTS)", () => {
		expect(
			shouldProbeSourcePts({
				hasTimelineSegments: false,
				videoOnly: false,
				forceSourcePts: undefined,
				muxAudioInline: true,
				isConstantFrameRateSource: false,
				hasSourceFrameRate: true,
			}),
		).toBe(true);
	});

	it("probes for inline-mux audio when the source frame rate is unknown", () => {
		expect(
			shouldProbeSourcePts({
				hasTimelineSegments: false,
				videoOnly: false,
				forceSourcePts: undefined,
				muxAudioInline: true,
				isConstantFrameRateSource: false,
				hasSourceFrameRate: false,
			}),
		).toBe(true);
	});

	it("does not probe a CFR timeline export just because the wrapper is video-only", () => {
		// CFR + timeline + video-only: synthetic sidecar is correct, no probe.
		expect(
			shouldProbeSourcePts({
				hasTimelineSegments: true,
				videoOnly: true,
				forceSourcePts: undefined,
				muxAudioInline: false,
				isConstantFrameRateSource: true,
				hasSourceFrameRate: true,
			}),
		).toBe(false);
	});
});

describe("shouldSynthesizeCfrSourcePts", () => {
	it("synthesizes the sidecar for plain copy-source audio from a CFR source", () => {
		expect(
			shouldSynthesizeCfrSourcePts({
				hasTimelineSegments: false,
				videoOnly: false,
				forceSourcePts: undefined,
				muxAudioInline: true,
				isConstantFrameRateSource: true,
				hasSourceFrameRate: true,
			}),
		).toBe(true);
	});

	it("synthesizes when a timeline map is present on a CFR source", () => {
		expect(
			shouldSynthesizeCfrSourcePts({
				hasTimelineSegments: true,
				videoOnly: false,
				forceSourcePts: undefined,
				muxAudioInline: true,
				isConstantFrameRateSource: true,
				hasSourceFrameRate: true,
			}),
		).toBe(true);
	});

	it("does not synthesize when a timeline map is present on a VFR source", () => {
		expect(
			shouldSynthesizeCfrSourcePts({
				hasTimelineSegments: true,
				videoOnly: false,
				forceSourcePts: undefined,
				muxAudioInline: true,
				isConstantFrameRateSource: false,
				hasSourceFrameRate: true,
			}),
		).toBe(false);
	});

	it("never synthesizes for video-only exports without a timeline", () => {
		expect(
			shouldSynthesizeCfrSourcePts({
				hasTimelineSegments: false,
				videoOnly: true,
				forceSourcePts: undefined,
				muxAudioInline: false,
				isConstantFrameRateSource: true,
				hasSourceFrameRate: true,
			}),
		).toBe(false);
	});

	it("synthesizes for video-only exports with a timeline on a CFR source", () => {
		expect(
			shouldSynthesizeCfrSourcePts({
				hasTimelineSegments: true,
				videoOnly: true,
				forceSourcePts: undefined,
				muxAudioInline: false,
				isConstantFrameRateSource: true,
				hasSourceFrameRate: true,
			}),
		).toBe(true);
	});

	it("never synthesizes when the force override is set", () => {
		expect(
			shouldSynthesizeCfrSourcePts({
				hasTimelineSegments: false,
				videoOnly: false,
				forceSourcePts: "1",
				muxAudioInline: true,
				isConstantFrameRateSource: true,
				hasSourceFrameRate: true,
			}),
		).toBe(false);
	});

	it("never synthesizes when the source is not provably CFR", () => {
		expect(
			shouldSynthesizeCfrSourcePts({
				hasTimelineSegments: false,
				videoOnly: false,
				forceSourcePts: undefined,
				muxAudioInline: true,
				isConstantFrameRateSource: false,
				hasSourceFrameRate: true,
			}),
		).toBe(false);
	});
});

describe("resolveSourcePtsPlan", () => {
	it("is the single source of truth: probe/synthesize/skip are mutually exclusive", () => {
		const options = {
			hasTimelineSegments: false,
			videoOnly: false,
			forceSourcePts: undefined,
			muxAudioInline: true,
			isConstantFrameRateSource: true,
			hasSourceFrameRate: true,
		};
		const plan = resolveSourcePtsPlan(options);
		expect(["probe", "synthesize-cfr", "skip"]).toContain(plan.mode);
		expect(plan.reason).toBe("plain-cfr-copy-source");
		expect(shouldProbeSourcePts(options)).toBe(false);
		expect(shouldSynthesizeCfrSourcePts(options)).toBe(true);
	});

	it("returns synthesize-cfr for CFR + timeline", () => {
		const plan = resolveSourcePtsPlan({
			hasTimelineSegments: true,
			videoOnly: true,
			forceSourcePts: undefined,
			muxAudioInline: false,
			isConstantFrameRateSource: true,
			hasSourceFrameRate: true,
		});
		expect(plan.mode).toBe("synthesize-cfr");
		expect(plan.reason).toBe("cfr-timeline");
	});

	it("returns probe for VFR + timeline", () => {
		const plan = resolveSourcePtsPlan({
			hasTimelineSegments: true,
			videoOnly: true,
			forceSourcePts: undefined,
			muxAudioInline: false,
			isConstantFrameRateSource: false,
			hasSourceFrameRate: true,
		});
		expect(plan.mode).toBe("probe");
		expect(plan.reason).toBe("timeline-map-vfr");
	});

	it("returns probe for force + timeline (force wins over CFR)", () => {
		const plan = resolveSourcePtsPlan({
			hasTimelineSegments: true,
			videoOnly: true,
			forceSourcePts: "1",
			muxAudioInline: false,
			isConstantFrameRateSource: true,
			hasSourceFrameRate: true,
		});
		expect(plan.mode).toBe("probe");
		expect(plan.reason).toBe("force-flag");
	});

	it("returns skip for video-only without timeline", () => {
		const plan = resolveSourcePtsPlan({
			hasTimelineSegments: false,
			videoOnly: true,
			forceSourcePts: undefined,
			muxAudioInline: false,
			isConstantFrameRateSource: true,
			hasSourceFrameRate: true,
		});
		expect(plan.mode).toBe("skip");
		expect(plan.reason).toBe("video-only");
	});
});

describe("isConstantFrameRateSource", () => {
	it("accepts equal avg/r frame-rate rationals", () => {
		expect(isConstantFrameRateSource({ avgFrameRate: "30/1", rFrameRate: "30/1" })).toBe(true);
	});

	it("accepts NTSC-style CFR rates", () => {
		expect(
			isConstantFrameRateSource({
				avgFrameRate: "30000/1001",
				rFrameRate: "30000/1001",
			}),
		).toBe(true);
	});

	it("accepts Recordly's micro-precision CFR avg_frame_rate (1000000/33333 vs 30/1)", () => {
		// Recordly's muxer writes avg_frame_rate at microsecond precision; this
		// is still constant-frame-rate and must not trigger the full-file scan.
		expect(
			isConstantFrameRateSource({ avgFrameRate: "1000000/33333", rFrameRate: "30/1" }),
		).toBe(true);
	});

	it("rejects VFR sources whose average differs from the max rate", () => {
		expect(isConstantFrameRateSource({ avgFrameRate: "30000/1001", rFrameRate: "60/1" })).toBe(
			false,
		);
		expect(isConstantFrameRateSource({ avgFrameRate: "30/1", rFrameRate: "60/1" })).toBe(false);
		expect(isConstantFrameRateSource({ avgFrameRate: "45/1", rFrameRate: "60/1" })).toBe(false);
	});

	it("rejects missing or unknown frame rates", () => {
		expect(isConstantFrameRateSource({ avgFrameRate: undefined, rFrameRate: "30/1" })).toBe(
			false,
		);
		expect(isConstantFrameRateSource({ avgFrameRate: "30/1", rFrameRate: undefined })).toBe(
			false,
		);
		expect(isConstantFrameRateSource({ avgFrameRate: "0/0", rFrameRate: "0/0" })).toBe(false);
	});

	it("rejects malformed rationals", () => {
		expect(isConstantFrameRateSource({ avgFrameRate: "30", rFrameRate: "30/1" })).toBe(false);
		expect(isConstantFrameRateSource({ avgFrameRate: "30/-1", rFrameRate: "30/1" })).toBe(
			false,
		);
	});
});

describe("parseRationalFps", () => {
	it("parses a simple rational", () => {
		expect(parseRationalFps("30/1")).toBe(30);
	});

	it("parses an NTSC-style rational", () => {
		expect(parseRationalFps("30000/1001")).toBeCloseTo(29.97002997002997, 9);
	});

	it("parses Recordly's micro-precision rational", () => {
		expect(parseRationalFps("1000000/33333")).toBeCloseTo(30.00030000300003, 9);
	});

	it("returns 0 for unknown or malformed rates", () => {
		expect(parseRationalFps("0/0")).toBe(0);
		expect(parseRationalFps(undefined)).toBe(0);
		expect(parseRationalFps("30")).toBe(0);
	});
});
