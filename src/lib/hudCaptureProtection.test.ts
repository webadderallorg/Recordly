import { describe, expect, it } from "vitest";

import {
	getHudCaptureExcludedProcessIds,
	supportsHudCaptureProtection,
} from "./hudCaptureProtection";

describe("supportsHudCaptureProtection", () => {
	it.each([
		["win32", true],
		["darwin", true],
		["linux", false],
		["freebsd", false],
	])("reports support for %s as %s", (platform, expected) => {
		expect(supportsHudCaptureProtection(platform)).toBe(expected);
	});
});

describe("getHudCaptureExcludedProcessIds", () => {
	it("passes the current process to macOS capture when protection is enabled", () => {
		expect(getHudCaptureExcludedProcessIds("darwin", true, 4512)).toEqual([4512]);
	});

	it.each([
		["darwin", false, 4512],
		["win32", true, 4512],
		["linux", true, 4512],
		["darwin", true, 0],
		["darwin", true, Number.NaN],
	])("returns no native exclusions for %s, enabled=%s, pid=%s", (platform, enabled, pid) => {
		expect(getHudCaptureExcludedProcessIds(platform, enabled, pid as number)).toEqual([]);
	});
});
