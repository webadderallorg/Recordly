import { describe, expect, it } from "vitest";
import {
	DEFAULT_WEBCAM_BACKGROUND_BLUR,
	normalizeWebcamBackgroundBlurSettings,
} from "./webcamBackgroundBlur";

describe("normalizeWebcamBackgroundBlurSettings", () => {
	it("defaults legacy and invalid values to blur off at the medium strength", () => {
		expect(normalizeWebcamBackgroundBlurSettings(undefined)).toEqual(
			DEFAULT_WEBCAM_BACKGROUND_BLUR,
		);
		expect(normalizeWebcamBackgroundBlurSettings({ enabled: "yes", amount: NaN })).toEqual(
			DEFAULT_WEBCAM_BACKGROUND_BLUR,
		);
	});

	it("rounds and clamps blur strength while preserving an explicit toggle", () => {
		expect(normalizeWebcamBackgroundBlurSettings({ enabled: true, amount: 0 })).toEqual({
			enabled: true,
			amount: 1,
		});
		expect(normalizeWebcamBackgroundBlurSettings({ enabled: false, amount: 20.6 })).toEqual({
			enabled: false,
			amount: 20,
		});
	});
});
