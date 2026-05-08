import { describe, expect, it } from "vitest";

import {
	BROWSER_MIC_SIDECAR_FILTERS,
	BROWSER_MIC_SIDECAR_NO_AGC_GAIN_FILTERS,
	getBrowserMicSidecarFilters,
	RECORDING_AUDIO_SIDECAR_DEBUG_ENV,
	shouldKeepRecordingAudioSidecars,
	WINDOWS_NATIVE_MIC_PRE_FILTERS,
} from "./audioFilters";

describe("Windows native mic pre-filter policy", () => {
	it("keeps repair filters without automatic gain or loudness normalization", () => {
		expect(WINDOWS_NATIVE_MIC_PRE_FILTERS).toContain("adeclip=threshold=1");
		expect(
			WINDOWS_NATIVE_MIC_PRE_FILTERS.some((filter) =>
				/(^|,)(loudnorm|dynaudnorm|volume)=/i.test(filter),
			),
		).toBe(false);
	});

	it("keeps native audio sidecars only when explicitly requested", () => {
		expect(shouldKeepRecordingAudioSidecars({})).toBe(false);
		expect(
			shouldKeepRecordingAudioSidecars({
				[RECORDING_AUDIO_SIDECAR_DEBUG_ENV]: "1",
			}),
		).toBe(true);
		expect(
			shouldKeepRecordingAudioSidecars({
				[RECORDING_AUDIO_SIDECAR_DEBUG_ENV]: "true",
			}),
		).toBe(true);
		expect(
			shouldKeepRecordingAudioSidecars({
				[RECORDING_AUDIO_SIDECAR_DEBUG_ENV]: "off",
			}),
		).toBe(false);
	});
});

describe("browser microphone sidecar post-processing", () => {
	it("keeps the browser fallback chain conservative and speech-oriented", () => {
		expect(BROWSER_MIC_SIDECAR_FILTERS).toEqual([
			"adeclip=threshold=1",
			"adeclick=w=40:o=75:t=3:b=2",
			"highpass=f=85",
			"lowpass=f=9500",
			"afftdn=nr=10:nf=-45:tn=1",
			"alimiter=limit=0.92:level=0",
		]);
		expect(
			BROWSER_MIC_SIDECAR_FILTERS.some((filter) =>
				/(^|,)(loudnorm|dynaudnorm|volume)=/i.test(filter),
			),
		).toBe(false);
	});

	it("adds bounded speech gain only for the no-AGC browser mic profile", () => {
		expect(getBrowserMicSidecarFilters("processed")).toEqual(BROWSER_MIC_SIDECAR_FILTERS);
		expect(getBrowserMicSidecarFilters("no-agc")).toEqual([
			"adeclip=threshold=1",
			"adeclick=w=40:o=75:t=3:b=2",
			"highpass=f=85",
			"lowpass=f=9500",
			"afftdn=nr=10:nf=-45:tn=1",
			...BROWSER_MIC_SIDECAR_NO_AGC_GAIN_FILTERS,
		]);
		expect(BROWSER_MIC_SIDECAR_NO_AGC_GAIN_FILTERS).toContain(
			"speechnorm=p=0.92:e=12:c=2:r=0.0005:f=0.001",
		);
		expect(BROWSER_MIC_SIDECAR_NO_AGC_GAIN_FILTERS).toContain("alimiter=limit=0.92:level=0");
	});
});
