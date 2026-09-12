import { describe, expect, it, vi } from "vitest";

import { isWaylandSession } from "./hudOverlaySession";
import {
	decideHudOverlayRestoreStrategy,
	hideHudOverlayWindow,
} from "./hudOverlayWindowActions";

function createHudStub() {
	return {
		hide: vi.fn(),
		minimize: vi.fn(),
	};
}

describe("hideHudOverlayWindow", () => {
	it("hides instead of minimizing on Linux Wayland (compositors ignore minimize and there is no taskbar)", () => {
		const hud = createHudStub();

		hideHudOverlayWindow(hud, "linux", true);

		expect(hud.hide).toHaveBeenCalledOnce();
		expect(hud.minimize).not.toHaveBeenCalled();
	});

	it("minimizes on Linux X11 so the taskbar entry restores the HUD, matching main", () => {
		const hud = createHudStub();

		hideHudOverlayWindow(hud, "linux", false);

		expect(hud.minimize).toHaveBeenCalledOnce();
		expect(hud.hide).not.toHaveBeenCalled();
	});

	it("minimizes on Windows so the taskbar entry restores the HUD", () => {
		const hud = createHudStub();

		hideHudOverlayWindow(hud, "win32", false);

		expect(hud.minimize).toHaveBeenCalledOnce();
		expect(hud.hide).not.toHaveBeenCalled();
	});

	it("minimizes on macOS so the Dock restores the HUD", () => {
		const hud = createHudStub();

		hideHudOverlayWindow(hud, "darwin", false);

		expect(hud.minimize).toHaveBeenCalledOnce();
		expect(hud.hide).not.toHaveBeenCalled();
	});

	it("ignores the Wayland flag outside Linux (win32 sessions are never Wayland)", () => {
		const hud = createHudStub();

		hideHudOverlayWindow(hud, "win32", true);

		expect(hud.minimize).toHaveBeenCalledOnce();
		expect(hud.hide).not.toHaveBeenCalled();
	});

	it("defaults to the current process platform and session", () => {
		const hud = createHudStub();

		hideHudOverlayWindow(hud);

		if (process.platform === "linux" && isWaylandSession()) {
			expect(hud.hide).toHaveBeenCalledOnce();
			expect(hud.minimize).not.toHaveBeenCalled();
		} else {
			expect(hud.minimize).toHaveBeenCalledOnce();
			expect(hud.hide).not.toHaveBeenCalled();
		}
	});
});

describe("decideHudOverlayRestoreStrategy", () => {
	it("shows a hidden HUD instead of recreating it (recording survives tray restore on Wayland)", () => {
		// Regression: hidden window is never focused, so the old condition
		// destroyed+recreated it, killing the renderer and its in-flight
		// MediaRecorder while main kept recording=true in the tray.
		expect(
			decideHudOverlayRestoreStrategy({
				platform: "linux",
				isFocused: false,
				isVisible: false,
				isMinimized: false,
				isEditor: false,
				recordingActive: true,
			}),
		).toBe("show-existing");
	});

	it("shows a minimized HUD instead of recreating it (X11 minimize path)", () => {
		expect(
			decideHudOverlayRestoreStrategy({
				platform: "linux",
				isFocused: false,
				isVisible: true,
				isMinimized: true,
				isEditor: false,
				recordingActive: true,
			}),
		).toBe("show-existing");
	});

	it("shows a visible but unfocused HUD during active recording instead of recreating it", () => {
		// Regression (P1): during recording the HUD stays visible while
		// unfocused (windows.ts keeps it shown while recording), so the
		// recreate workaround destroyed the window and silently killed the
		// MediaRecorder living in the HUD renderer — main kept
		// recording=true in the tray with no window left to stop it.
		expect(
			decideHudOverlayRestoreStrategy({
				platform: "linux",
				isFocused: false,
				isVisible: true,
				isMinimized: false,
				isEditor: false,
				recordingActive: true,
			}),
		).toBe("show-existing");
	});

	it("keeps the recreate workaround for a visible but unfocused HUD on Linux while not recording", () => {
		expect(
			decideHudOverlayRestoreStrategy({
				platform: "linux",
				isFocused: false,
				isVisible: true,
				isMinimized: false,
				isEditor: false,
				recordingActive: false,
			}),
		).toBe("recreate");
	});

	it("never recreates an already focused HUD on Linux", () => {
		expect(
			decideHudOverlayRestoreStrategy({
				platform: "linux",
				isFocused: true,
				isVisible: true,
				isMinimized: false,
				isEditor: false,
				recordingActive: false,
			}),
		).toBe("show-existing");
	});

	it("never recreates editor windows on Linux", () => {
		expect(
			decideHudOverlayRestoreStrategy({
				platform: "linux",
				isFocused: false,
				isVisible: true,
				isMinimized: false,
				isEditor: true,
				recordingActive: false,
			}),
		).toBe("show-existing");
	});

	it("shows the existing window on Windows and macOS regardless of focus", () => {
		for (const platform of ["win32", "darwin"] as const) {
			expect(
				decideHudOverlayRestoreStrategy({
					platform,
					isFocused: false,
					isVisible: false,
					isMinimized: false,
					isEditor: false,
					recordingActive: false,
				}),
			).toBe("show-existing");
		}
	});
});
