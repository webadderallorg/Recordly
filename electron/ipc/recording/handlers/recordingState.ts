import { BrowserWindow } from "electron";
import { showCursor } from "../../../cursorHider";
import { hideAreaRecordingBorder, showAreaRecordingBorder } from "../../../windows";
import { startWindowBoundsCapture, stopWindowBoundsCapture } from "../../cursor/bounds";
import { startInteractionCapture, stopInteractionCapture } from "../../cursor/interaction";
import { startNativeCursorMonitor, stopNativeCursorMonitor } from "../../cursor/monitor";
import {
	resetCursorCaptureClock,
	sampleCursorPoint,
	snapshotCursorTelemetryForPersistence,
	startCursorSampling,
	stopCursorCapture,
} from "../../cursor/telemetry";
import { getSourceArea } from "../../sourceArea";
import {
	selectedSource,
	setActiveCursorSamples,
	setCursorCaptureStartTimeMs,
	setIsCursorCaptureActive,
	setLastLeftClick,
	setLinuxCursorScreenPoint,
	setPendingCursorSamples,
} from "../../state";
import { recordingFocus } from "../focus";

import type { RecordingHandlerContext } from "./handlerContext";

export function applyRecordingState(
	context: Pick<RecordingHandlerContext, "sessionLock" | "ownerRecovery">,
	recording: boolean,
	ownerId?: number,
	onRecordingStateChange?: (recording: boolean, sourceName: string) => void,
) {
	const { sessionLock, ownerRecovery } = context;

	sessionLock.setRecording(ownerId, recording);
	ownerRecovery.setUserRecording(recording, ownerId);
	if (recording) {
		void recordingFocus.start(selectedSource);
		stopCursorCapture();
		stopInteractionCapture();
		startWindowBoundsCapture();
		void startNativeCursorMonitor();
		setIsCursorCaptureActive(true);
		setActiveCursorSamples([]);
		setPendingCursorSamples([]);
		setCursorCaptureStartTimeMs(Date.now());
		resetCursorCaptureClock();
		setLinuxCursorScreenPoint(null);
		setLastLeftClick(null);
		sampleCursorPoint();
		startCursorSampling();
		void startInteractionCapture();
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
		setActiveCursorSamples([]);
	}

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
