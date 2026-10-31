import { describe, expect, it } from "vitest";

import {
	getHudCaptureExcludedProcessIds,
	shouldProtectHudCapture,
	supportsHudCaptureProtection,
} from "../src/lib/hudCaptureProtection";

describe("HUD capture protection lifecycle", () => {
	it("uses window protection on Windows and macOS only", () => {
		expect(supportsHudCaptureProtection("win32")).toBe(true);
		expect(supportsHudCaptureProtection("darwin")).toBe(true);
		expect(supportsHudCaptureProtection("linux")).toBe(false);
	});

	it("only builds a macOS process exclusion when protection is enabled", () => {
		expect(getHudCaptureExcludedProcessIds("darwin", true, 734)).toEqual([734]);
		expect(getHudCaptureExcludedProcessIds("darwin", false, 734)).toEqual([]);
		expect(getHudCaptureExcludedProcessIds("win32", true, 734)).toEqual([]);
		expect(getHudCaptureExcludedProcessIds("linux", true, 734)).toEqual([]);
	});
});

it("protects initial capture frames while keeping idle and failed starts visible", () => {
	expect(shouldProtectHudCapture(true, false, false)).toBe(false);
	expect(shouldProtectHudCapture(true, false, true)).toBe(true);
	expect(shouldProtectHudCapture(true, true, false)).toBe(true);
	expect(shouldProtectHudCapture(true, false, false)).toBe(false);
	expect(shouldProtectHudCapture(false, true, true)).toBe(false);
});
