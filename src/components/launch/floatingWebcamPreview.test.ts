import { describe, expect, it } from "vitest";

import {
	canShowFloatingWebcamPreview,
	canToggleFloatingWebcamPreview,
} from "./floatingWebcamPreview";

describe("canShowFloatingWebcamPreview", () => {
	it("shows the floating preview only when it was requested and passthrough is supported", () => {
		expect(canShowFloatingWebcamPreview(true, true)).toBe(true);
		expect(canShowFloatingWebcamPreview(false, true)).toBe(false);
		expect(canShowFloatingWebcamPreview(true, false)).toBe(false);
		expect(canShowFloatingWebcamPreview(true, null)).toBe(false);
	});
});

describe("canToggleFloatingWebcamPreview", () => {
	it("keeps the toggle visible while support is unknown or available", () => {
		expect(canToggleFloatingWebcamPreview(null)).toBe(true);
		expect(canToggleFloatingWebcamPreview(true)).toBe(true);
	});

	it("hides the toggle when the platform cannot support the floating preview", () => {
		expect(canToggleFloatingWebcamPreview(false)).toBe(false);
	});
});
