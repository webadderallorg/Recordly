import { globalShortcut } from "electron";
import { captureRecordingZoomMarker } from "../cursor/telemetry";
import { captureLinuxPortalZoomMarker, isLinuxPortalCaptureActive } from "./linuxPortal";

const accelerator = "CommandOrControl+Alt+Z";
let registered = false;
let lastMarkerAt = Number.NEGATIVE_INFINITY;

export function setRecordingZoomShortcutActive(active: boolean) {
	if (active === registered) return;
	if (!active) {
		globalShortcut.unregister(accelerator);
		registered = false;
		lastMarkerAt = Number.NEGATIVE_INFINITY;
		return;
	}

	try {
		registered = globalShortcut.register(accelerator, () => {
			if (isLinuxPortalCaptureActive()) {
				void captureLinuxPortalZoomMarker();
				return;
			}
			const now = Date.now();
			if (now - lastMarkerAt >= 500 && captureRecordingZoomMarker(now)) {
				lastMarkerAt = now;
			}
		});
		if (!registered) console.warn(`Could not register recording zoom shortcut ${accelerator}.`);
	} catch (error) {
		console.warn(`Could not register recording zoom shortcut ${accelerator}:`, error);
	}
}
