import { BrowserWindow } from "electron";
import { showCursor } from "../../../cursorHider";
import { hideAreaRecordingBorder, showAreaRecordingBorder } from "../../../windows";
import { startWindowBoundsCapture, stopWindowBoundsCapture } from "../../cursor/bounds";
import { startInteractionCapture, stopInteractionCapture } from "../../cursor/interaction";
import { startNativeCursorMonitor, stopNativeCursorMonitor } from "../../cursor/monitor";
import {
	clearActiveCursorTelemetry,
	resetCursorCaptureClock,
	sampleCursorPoint,
	snapshotCursorTelemetryForPersistence,
	startCursorSampling,
	stopCursorCapture,
} from "../../cursor/telemetry";
import { getSourceArea } from "../../sourceArea";
import {
	isCursorCaptureActive,
	selectedSource,
	setCursorCaptureStartTimeMs,
	setIsCursorCaptureActive,
	setLastLeftClick,
	setLinuxCursorScreenPoint,
	setPendingCursorSamples,
	windowsNativeCaptureActive,
} from "../../state";
import { recordingFocus } from "../focus";
import { setRecordingZoomShortcutActive } from "../zoomShortcut";

import type { RecordingHandlerContext } from "./handlerContext";

function startRecordingCursorCapture(recordingStartedAtMs?: number) {
	const now = Date.now();
	const startedAtMs =
		recordingStartedAtMs !== undefined &&
		Number.isSafeInteger(recordingStartedAtMs) &&
		recordingStartedAtMs > 0 &&
		recordingStartedAtMs <= now
			? recordingStartedAtMs
			: now;
	stopCursorCapture();
	stopInteractionCapture();
	startWindowBoundsCapture();
	void startNativeCursorMonitor();
	setIsCursorCaptureActive(true);
	clearActiveCursorTelemetry();
	setPendingCursorSamples([]);
	setCursorCaptureStartTimeMs(startedAtMs);
	resetCursorCaptureClock();
	setLinuxCursorScreenPoint(null);
	setLastLeftClick(null);
	sampleCursorPoint();
	startCursorSampling();
	void startInteractionCapture();
}

export function beginWindowsRecordingCursorCapture() {
	if (windowsNativeCaptureActive && !isCursorCaptureActive) startRecordingCursorCapture();
}

export function applyRecordingState(
	context: Pick<RecordingHandlerContext, "sessionLock" | "ownerRecovery">,
	recording: boolean,
	ownerId?: number,
	onRecordingStateChange?: (recording: boolean, sourceName: string) => void,
	recordingStartedAtMs?: number,
) {
	const { sessionLock, ownerRecovery } = context;

	sessionLock.setRecording(ownerId, recording);
	ownerRecovery.setUserRecording(recording, ownerId);
	if (recording) {
		void recordingFocus.start(selectedSource);
		if (!windowsNativeCaptureActive || !isCursorCaptureActive)
			startRecordingCursorCapture(recordingStartedAtMs);
	} else {
		setIsCursorCaptureActive(false);
		stopCursorCapture();
		stopInteractionCapture();
		stopWindowBoundsCapture();
		stopNativeCursorMonitor();
		showCursor();
		setLinuxCursorScreenPoint(null);
		resetCursorCaptureClock();
		snapshotCursorTelemetryForPersistence();
		clearActiveCursorTelemetry();
	}

	setRecordingZoomShortcutActive(recording);
	if (!recording) recordingFocus.stop();
	const source = selectedSource || { name: "Screen" };
	const recordingArea = recording ? getSourceArea(selectedSource) : null;
	if (recordingArea) {
		showAreaRecordingBorder(recordingArea);
	} else {
		hideAreaRecordingBorder();
	}
	BrowserWindow.getAllWindows().forEach((window) => {
		if (!window.isDestroyed()) {
			window.webContents.send("recording-state-changed", {
				recording,
				sourceName: source.name,
			});
		}
	});

	if (onRecordingStateChange) {
		onRecordingStateChange(recording, source.name);
	}
}
