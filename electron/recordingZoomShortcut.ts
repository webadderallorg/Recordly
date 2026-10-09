import { app, globalShortcut } from "electron";
import { captureManualZoomMarker } from "./ipc/cursor/telemetry";

const RECORDING_ZOOM_SHORTCUT = "CommandOrControl+Alt+Z";
const RECORDING_ZOOM_SHORTCUT_THROTTLE_MS = 500;

let recordingZoomShortcutRegistered = false;
let lastRecordingZoomShortcutAtMs = 0;
let beforeQuitHookInstalled = false;

function addRecordingZoomMarkerFromShortcut() {
	const now = Date.now();
	if (now - lastRecordingZoomShortcutAtMs < RECORDING_ZOOM_SHORTCUT_THROTTLE_MS) {
		return;
	}

	lastRecordingZoomShortcutAtMs = now;
	if (captureManualZoomMarker()) {
		console.log(`[recording-zoom] Added zoom marker via ${RECORDING_ZOOM_SHORTCUT}`);
	}
}

function ensureBeforeQuitHook() {
	if (beforeQuitHookInstalled) {
		return;
	}
	beforeQuitHookInstalled = true;
	app.on("before-quit", () => {
		unregisterRecordingZoomShortcut();
	});
}

export function registerRecordingZoomShortcut() {
	ensureBeforeQuitHook();
	if (recordingZoomShortcutRegistered) {
		return;
	}

	recordingZoomShortcutRegistered = globalShortcut.register(
		RECORDING_ZOOM_SHORTCUT,
		addRecordingZoomMarkerFromShortcut,
	);

	if (!recordingZoomShortcutRegistered) {
		console.warn(
			`[recording-zoom] Failed to register ${RECORDING_ZOOM_SHORTCUT}; another app may already be using it.`,
		);
	}
}

export function unregisterRecordingZoomShortcut() {
	if (!recordingZoomShortcutRegistered) {
		return;
	}

	globalShortcut.unregister(RECORDING_ZOOM_SHORTCUT);
	recordingZoomShortcutRegistered = false;
	lastRecordingZoomShortcutAtMs = 0;
}
