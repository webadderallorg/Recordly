import { describe, expect, it } from "vitest";
import {
	mergeAudioOutputLevel,
	normalizeAudioOutputLevelEvent,
} from "./useAudioOutputLevels";

describe("system audio level mapping", () => {
	it("normalizes a valid event under its exact device ID", () => {
		const event = normalizeAudioOutputLevelEvent({
			deviceId: "speaker-1",
			rms: 0.2,
			peak: 0.4,
			level: 40,
		});

		expect(event).toEqual({
			deviceId: "speaker-1",
			rms: 0.2,
			peak: 0.4,
			level: 40,
		});
		expect(mergeAudioOutputLevel({}, event!)).toEqual({ "speaker-1": 40 });
	});

	it("rejects malformed events and clamps out-of-range levels", () => {
		expect(normalizeAudioOutputLevelEvent({ deviceId: "", level: 40 })).toBeNull();
		expect(normalizeAudioOutputLevelEvent({ deviceId: "speaker-1", level: Number.NaN })).toBeNull();
		expect(
			normalizeAudioOutputLevelEvent({
				deviceId: "speaker-1",
				rms: 0,
				peak: 0,
				level: 150,
			}),
		).toMatchObject({ deviceId: "speaker-1", level: 100 });
	});

	it("does not mutate previous device entries", () => {
		const previous = { "speaker-1": 20 };
		const next = mergeAudioOutputLevel(previous, {
			deviceId: "speaker-2",
			rms: 0.1,
			peak: 0.1,
			level: 10,
		});

		expect(previous).toEqual({ "speaker-1": 20 });
		expect(next).toEqual({ "speaker-1": 20, "speaker-2": 10 });
	});
});
