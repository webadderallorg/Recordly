import { describe, expect, it } from "vitest";
import {
	buildKwinCursorScript,
	createDbusMonitorCursorParser,
	isKdeWaylandSession,
	KWIN_CURSOR_BRIDGE_INTERFACE,
	nextKwinObjectName,
} from "./kwinCursorBridge";

describe("isKdeWaylandSession", () => {
	it("accepts a KDE Plasma Wayland session", () => {
		expect(
			isKdeWaylandSession("linux", {
				XDG_SESSION_TYPE: "wayland",
				XDG_CURRENT_DESKTOP: "KDE",
			}),
		).toBe(true);
	});

	it("rejects X11, other desktops and other platforms", () => {
		expect(
			isKdeWaylandSession("linux", { XDG_SESSION_TYPE: "x11", XDG_CURRENT_DESKTOP: "KDE" }),
		).toBe(false);
		expect(
			isKdeWaylandSession("linux", {
				XDG_SESSION_TYPE: "wayland",
				XDG_CURRENT_DESKTOP: "GNOME",
			}),
		).toBe(false);
		expect(
			isKdeWaylandSession("darwin", {
				XDG_SESSION_TYPE: "wayland",
				XDG_CURRENT_DESKTOP: "KDE",
			}),
		).toBe(false);
	});
});

describe("buildKwinCursorScript", () => {
	it("reports cursor moves to the bridge interface", () => {
		const script = buildKwinCursorScript();
		expect(script).toContain("workspace.cursorPosChanged.connect");
		expect(script).toContain(`"${KWIN_CURSOR_BRIDGE_INTERFACE}"`);
	});
});

describe("createDbusMonitorCursorParser", () => {
	const header = `method call time=1791644726.85 sender=:1.16 -> destination=${KWIN_CURSOR_BRIDGE_INTERFACE} serial=5200 path=/; interface=${KWIN_CURSOR_BRIDGE_INTERFACE}; member=Pos`;

	it("emits a point for each Pos call, across chunk boundaries", () => {
		const points: Array<{ x: number; y: number }> = [];
		const parser = createDbusMonitorCursorParser((point) => points.push(point));

		parser(`${header}\n   int32 1896\n   int`);
		parser(`32 557\n${header}\n   int32 -4\n   int32 12\n`);

		expect(points).toEqual([
			{ x: 1896, y: 557 },
			{ x: -4, y: 12 },
		]);
	});

	it("ignores unrelated bus traffic and incomplete calls", () => {
		const points: Array<{ x: number; y: number }> = [];
		const parser = createDbusMonitorCursorParser((point) => points.push(point));

		parser("signal time=1 sender=org.freedesktop.DBus member=NameAcquired\n   int32 7\n");
		parser(`${header}\n   int32 5\n${header}\n   int32 1\n   int32 2\n`);

		expect(points).toEqual([{ x: 1, y: 2 }]);
	});
});

describe("nextKwinObjectName", () => {
	it("is unique per call so a late unload cannot hit the next capture", () => {
		const first = nextKwinObjectName("recordly-cursor-bridge");
		const second = nextKwinObjectName("recordly-cursor-bridge");
		expect(first).not.toBe(second);
		expect(first.startsWith("recordly-cursor-bridge-")).toBe(true);
		expect(nextKwinObjectName("recordly_click_bridge", "_")).toMatch(
			/^recordly_click_bridge_\d+_\d+$/,
		);
	});
});
