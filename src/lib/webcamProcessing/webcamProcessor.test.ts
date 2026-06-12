import { describe, expect, it } from "vitest";
import {
	DEFAULT_WEBCAM_COLOR,
	DEFAULT_WEBCAM_GREENSCREEN,
	DEFAULT_WEBCAM_MASK,
} from "@/components/video-editor/types";
import { isProcessingActive, resolveProcessingSettings } from "./webcamProcessor";

describe("isProcessingActive", () => {
	it("is inactive for undefined webcam or all-default settings", () => {
		expect(isProcessingActive(undefined)).toBe(false);
		expect(isProcessingActive(null)).toBe(false);
		expect(isProcessingActive({})).toBe(false);
		expect(
			isProcessingActive({
				greenscreen: DEFAULT_WEBCAM_GREENSCREEN,
				mask: DEFAULT_WEBCAM_MASK,
				color: DEFAULT_WEBCAM_COLOR,
			}),
		).toBe(false);
	});

	it("activates per group", () => {
		expect(
			isProcessingActive({ greenscreen: { ...DEFAULT_WEBCAM_GREENSCREEN, enabled: true } }),
		).toBe(true);
		expect(isProcessingActive({ mask: { ...DEFAULT_WEBCAM_MASK, enabled: true } })).toBe(true);
		expect(isProcessingActive({ color: { ...DEFAULT_WEBCAM_COLOR, contrast: 0.1 } })).toBe(
			true,
		);
	});

	it("a disabled greenscreen with a chosen image stays inactive", () => {
		expect(
			isProcessingActive({
				greenscreen: {
					...DEFAULT_WEBCAM_GREENSCREEN,
					enabled: false,
					backgroundImagePath: "assets/bg.png",
				},
			}),
		).toBe(false);
	});
});

describe("resolveProcessingSettings", () => {
	it("fills missing groups with defaults", () => {
		const resolved = resolveProcessingSettings({});
		expect(resolved.greenscreen).toEqual(DEFAULT_WEBCAM_GREENSCREEN);
		expect(resolved.mask).toEqual(DEFAULT_WEBCAM_MASK);
		expect(resolved.color).toEqual(DEFAULT_WEBCAM_COLOR);
	});

	it("passes through provided groups", () => {
		const greenscreen = {
			enabled: true,
			backgroundImagePath: "x.png",
			keyStrength: 0.9,
			edgeSoftness: 0.1,
		};
		expect(resolveProcessingSettings({ greenscreen }).greenscreen).toBe(greenscreen);
	});
});
