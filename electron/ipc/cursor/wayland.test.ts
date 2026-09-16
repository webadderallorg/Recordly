import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
	app: {
		getPath: vi.fn(() => "/tmp"),
	},
}));
import {
	getHyprlandSocketPath,
	hasMouseButtonCapability,
	isWaylandSession,
	parseEvdevButtonEvents,
	parseHyprlandCursorPos,
} from "./wayland";

function inputEvent(type: number, code: number, value: number): Buffer {
	const buffer = Buffer.alloc(24);
	buffer.writeUInt16LE(type, 16);
	buffer.writeUInt16LE(code, 18);
	buffer.writeInt32LE(value, 20);
	return buffer;
}

describe("wayland cursor capture", () => {
	it("detects wayland sessions from the environment", () => {
		expect(isWaylandSession({ XDG_SESSION_TYPE: "wayland" })).toBe(true);
		expect(isWaylandSession({ WAYLAND_DISPLAY: "wayland-1" })).toBe(true);
		expect(isWaylandSession({ XDG_SESSION_TYPE: "x11" })).toBe(false);
	});

	it("builds the hyprland socket path", () => {
		expect(
			getHyprlandSocketPath({
				XDG_RUNTIME_DIR: "/run/user/1000",
				HYPRLAND_INSTANCE_SIGNATURE: "abc",
			}),
		).toBe("/run/user/1000/hypr/abc/.socket.sock");
		expect(getHyprlandSocketPath({ XDG_RUNTIME_DIR: "/run/user/1000" })).toBeNull();
	});

	it("parses hyprland cursorpos replies", () => {
		expect(parseHyprlandCursorPos('{"x": 960, "y": 553}')).toEqual({ x: 960, y: 553 });
		expect(parseHyprlandCursorPos("unknown request")).toBeNull();
	});

	it("reads BTN_LEFT from sysfs key capabilities", () => {
		expect(hasMouseButtonCapability("1f0000 0 0 0 0")).toBe(true);
		expect(hasMouseButtonCapability("ffffffff 0 0 0 0 0 0 0")).toBe(false);
		expect(hasMouseButtonCapability("")).toBe(false);
	});

	it("extracts mouse button presses from evdev packets", () => {
		const packet = Buffer.concat([
			inputEvent(2, 0, 5),
			inputEvent(1, 0x110, 1),
			inputEvent(0, 0, 0),
			inputEvent(1, 0x111, 0),
			inputEvent(1, 0x110, 2),
			inputEvent(1, 30, 1),
		]);
		expect(parseEvdevButtonEvents(packet)).toEqual([
			{ button: 1, pressed: true },
			{ button: 2, pressed: false },
		]);
	});
});
