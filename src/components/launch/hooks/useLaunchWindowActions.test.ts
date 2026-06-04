import { describe, expect, it } from "vitest";
import { getDefaultLaunchSource } from "./useLaunchWindowActions";
import type { DesktopSource } from "../popovers/launchPopoverTypes";

describe("getDefaultLaunchSource", () => {
	it("prefers the first available screen source", () => {
		const sources: DesktopSource[] = [
			{
				id: "window:1",
				name: "Browser",
				thumbnail: null,
				display_id: "1",
				appIcon: null,
				sourceType: "window",
			},
			{
				id: "screen:2",
				name: "Screen 2",
				thumbnail: null,
				display_id: "2",
				appIcon: null,
				sourceType: "screen",
			},
		];

		expect(getDefaultLaunchSource(sources)?.id).toBe("screen:2");
	});

	it("returns null when no screens are available", () => {
		const sources: DesktopSource[] = [
			{
				id: "window:1",
				name: "Browser",
				thumbnail: null,
				display_id: "1",
				appIcon: null,
				sourceType: "window",
			},
		];

		expect(getDefaultLaunchSource(sources)).toBeNull();
	});
});
