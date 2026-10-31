import { describe, expect, it, vi } from "vitest";

import {
	getScreenSourceIdForDisplay,
	LINUX_PORTAL_SCREEN_SOURCE_ID,
	resolveDisplayMediaSource,
} from "./sourceMapping";

describe("getScreenSourceIdForDisplay", () => {
	it("keeps the live Electron screen source when one is available", () => {
		expect(
			getScreenSourceIdForDisplay({
				displayId: "42",
				matchedSourceId: "screen:42:0",
				platform: "linux",
			}),
		).toBe("screen:42:0");
	});

	it("routes unmatched Linux Wayland screens through the portal sentinel", () => {
		expect(
			getScreenSourceIdForDisplay({
				displayId: "42",
				env: { XDG_SESSION_TYPE: "wayland", WAYLAND_DISPLAY: "wayland-0" },
				matchedSourceId: null,
				platform: "linux",
			}),
		).toBe(LINUX_PORTAL_SCREEN_SOURCE_ID);
	});

	it("keeps unmatched Linux X11 screens on the explicit fallback id", () => {
		expect(
			getScreenSourceIdForDisplay({
				displayId: "42",
				env: { XDG_SESSION_TYPE: "x11", DISPLAY: ":0" },
				matchedSourceId: null,
				platform: "linux",
			}),
		).toBe("screen:fallback:42");
	});

	it("keeps non-Linux unmatched screens on the explicit fallback id", () => {
		expect(
			getScreenSourceIdForDisplay({
				displayId: "42",
				matchedSourceId: undefined,
				platform: "win32",
			}),
		).toBe("screen:fallback:42");
	});
});

describe("display media source resolution", () => {
	for (const selectedSourceId of [null, "window:101:0", LINUX_PORTAL_SCREEN_SOURCE_ID]) {
		it(`opens Wayland through Chromium without pre-enumeration (${selectedSourceId})`, async () => {
			const getSources = vi.fn();
			expect(
				await resolveDisplayMediaSource({
					platform: "linux",
					env: { XDG_SESSION_TYPE: "wayland" },
					selectedSourceId,
					getSources,
				}),
			).toEqual({ id: "screen:0:0", name: "Entire screen" });
			expect(getSources).not.toHaveBeenCalled();
		});
	}
	it("returns only the requested X11 source and excludes preview pixels", async () => {
		const getSources = vi.fn().mockResolvedValue([
			{ id: "screen:1:0", name: "Screen" },
			{ id: "window:101:0", name: "Document", thumbnail: "pixels" },
		]);
		expect(
			await resolveDisplayMediaSource({
				platform: "linux",
				env: { XDG_SESSION_TYPE: "x11" },
				selectedSourceId: "window:101:0",
				getSources,
			}),
		).toEqual({ id: "window:101:0", name: "Document" });
	});
	it("does not record a different source if the selected window closes", async () => {
		const getSources = vi.fn().mockResolvedValue([{ id: "screen:1:0", name: "Screen" }]);
		expect(
			await resolveDisplayMediaSource({
				platform: "linux",
				env: { XDG_SESSION_TYPE: "x11" },
				selectedSourceId: "window:101:0",
				getSources,
			}),
		).toBeNull();
	});
	for (const selectedSourceId of [null, LINUX_PORTAL_SCREEN_SOURCE_ID]) {
		it(`does not open a portal or pick a default on X11 (${selectedSourceId})`, async () => {
			const getSources = vi.fn();
			expect(
				await resolveDisplayMediaSource({
					platform: "linux",
					env: { XDG_SESSION_TYPE: "x11", WAYLAND_DISPLAY: "wayland-0" },
					selectedSourceId,
					getSources,
				}),
			).toBeNull();
			expect(getSources).not.toHaveBeenCalled();
		});
	}
});
