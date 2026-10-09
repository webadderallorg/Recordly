import { describe, expect, it, vi } from "vitest";
import {
	parsePortalScreenCastVersionReply,
	probePortalScreenCastSupport,
	resolveSourcePickerVisibility,
} from "./linuxPortal";

describe("parsePortalScreenCastVersionReply", () => {
	it("parses gdbus replies", () => {
		expect(parsePortalScreenCastVersionReply("(uint32 4,)")).toBe(4);
	});

	it("parses dbus-send replies", () => {
		expect(
			parsePortalScreenCastVersionReply(
				"method return time=1696000000.123456 sender=:1.5 -> destination=:1.23 serial=7 reply_serial=2\n   variant uint32 3\n",
			),
		).toBe(3);
	});

	it("returns null when the interface is missing", () => {
		expect(
			parsePortalScreenCastVersionReply(
				"Error: GDBus.Error:org.freedesktop.DBus.Error.UnknownMethod",
			),
		).toBeNull();
		expect(parsePortalScreenCastVersionReply("")).toBeNull();
	});

	it("rejects non-positive versions", () => {
		expect(parsePortalScreenCastVersionReply("(uint32 0,)")).toBeNull();
	});
});

describe("probePortalScreenCastSupport", () => {
	it("returns true when gdbus reports a version", async () => {
		const runDbus = vi
			.fn()
			.mockResolvedValue({ stdout: "(uint32 4,)", stderr: "" });
		await expect(probePortalScreenCastSupport({ runDbus })).resolves.toBe(true);
		expect(runDbus).toHaveBeenCalledTimes(1);
		expect(runDbus.mock.calls[0][0][0]).toBe("gdbus");
	});

	it("falls back to dbus-send when gdbus is unavailable", async () => {
		const runDbus = vi
			.fn()
			.mockRejectedValueOnce(new Error("spawn gdbus ENOENT"))
			.mockResolvedValueOnce({ stdout: "   variant uint32 2", stderr: "" });
		await expect(probePortalScreenCastSupport({ runDbus })).resolves.toBe(true);
		expect(runDbus).toHaveBeenCalledTimes(2);
		expect(runDbus.mock.calls[1][0][0]).toBe("dbus-send");
	});

	it("returns false when no candidate tool can talk to a ScreenCast portal", async () => {
		const runDbus = vi.fn().mockRejectedValue(new Error("no such interface"));
		await expect(probePortalScreenCastSupport({ runDbus })).resolves.toBe(false);
		expect(runDbus).toHaveBeenCalledTimes(2);
	});

	it("returns false when replies carry no parseable version", async () => {
		const runDbus = vi.fn().mockResolvedValue({ stdout: "garbage", stderr: "" });
		await expect(probePortalScreenCastSupport({ runDbus })).resolves.toBe(false);
	});
});

describe("resolveSourcePickerVisibility", () => {
	const x11 = { DISPLAY: ":0", XDG_SESSION_TYPE: "x11" };
	const wayland = { DISPLAY: ":0", XDG_SESSION_TYPE: "wayland" };

	it("always shows the picker off Linux", () => {
		expect(
			resolveSourcePickerVisibility({
				platform: "win32",
				portalScreenCastSupported: false,
			}),
		).toEqual({ show: true, reason: "not-linux" });
	});

	it("never shows the picker on Wayland, even with a portal", () => {
		expect(
			resolveSourcePickerVisibility({
				platform: "linux",
				env: wayland,
				portalScreenCastSupported: true,
			}),
		).toEqual({ show: false, reason: "wayland-session" });
	});

	it("reports wayland-no-portal on Wayland without a ScreenCast portal (Cinnamon/muffin)", () => {
		expect(
			resolveSourcePickerVisibility({
				platform: "linux",
				env: wayland,
				portalScreenCastSupported: false,
			}),
		).toEqual({ show: false, reason: "wayland-no-portal" });
	});

	it("hides the picker on X11 when the portal has ScreenCast (GNOME/KDE)", () => {
		expect(
			resolveSourcePickerVisibility({
				platform: "linux",
				env: x11,
				portalScreenCastSupported: true,
			}),
		).toEqual({ show: false, reason: "portal-screencast" });
	});

	it("shows the picker on X11 without portal ScreenCast (or a failed probe)", () => {
		expect(
			resolveSourcePickerVisibility({
				platform: "linux",
				env: x11,
				portalScreenCastSupported: false,
			}),
		).toEqual({ show: true, reason: "no-portal-screencast" });
	});
});
