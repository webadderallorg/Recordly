import { describe, expect, it } from "vitest";

import {
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
