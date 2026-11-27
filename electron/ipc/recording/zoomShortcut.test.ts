import { globalShortcut } from "electron";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { captureRecordingZoomMarker } from "../cursor/telemetry";
import { captureLinuxPortalZoomMarker, isLinuxPortalCaptureActive } from "./linuxPortal";
import { setRecordingZoomShortcutActive } from "./zoomShortcut";

vi.mock("electron", () => ({ globalShortcut: { register: vi.fn(), unregister: vi.fn() } }));
vi.mock("../cursor/telemetry", () => ({ captureRecordingZoomMarker: vi.fn() }));
vi.mock("./linuxPortal", () => ({
	captureLinuxPortalZoomMarker: vi.fn(),
	isLinuxPortalCaptureActive: vi.fn(),
}));

beforeEach(() => {
	vi.mocked(globalShortcut.register).mockReturnValue(true);
});

afterEach(() => {
	setRecordingZoomShortcutActive(false);
	vi.restoreAllMocks();
	vi.clearAllMocks();
});

it("uses the Wayland helper to mark zooms during portal recording", () => {
	vi.mocked(isLinuxPortalCaptureActive).mockReturnValue(true);
	setRecordingZoomShortcutActive(true);

	vi.mocked(globalShortcut.register).mock.calls[0][1]();

	expect(captureLinuxPortalZoomMarker).toHaveBeenCalledOnce();
	expect(captureRecordingZoomMarker).not.toHaveBeenCalled();
});

it("keeps the existing telemetry and cooldown for other recorders", () => {
	vi.mocked(isLinuxPortalCaptureActive).mockReturnValue(false);
	vi.mocked(captureRecordingZoomMarker).mockReturnValue(true);
	const clock = vi.spyOn(Date, "now").mockReturnValue(1000);
	setRecordingZoomShortcutActive(true);
	const onPress = vi.mocked(globalShortcut.register).mock.calls[0][1];

	onPress();
	clock.mockReturnValue(1250);
	onPress();
	clock.mockReturnValue(1500);
	onPress();

	expect(captureLinuxPortalZoomMarker).not.toHaveBeenCalled();
	expect(vi.mocked(captureRecordingZoomMarker).mock.calls).toEqual([[1000], [1500]]);
});
