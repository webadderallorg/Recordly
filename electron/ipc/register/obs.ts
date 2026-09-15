import { ipcMain } from "electron";
import { connectObs, disconnectObs, startObsRecording, stopObsRecording, setObsMode, getObsMode } from "../obs/obsClient";
import { 
    startInteractionCapture, 
    stopInteractionCapture 
} from "../cursor/interaction";
import {
    startCursorSampling,
    stopCursorCapture,
    writeCursorTelemetry,
    resetCursorCaptureClock,
} from "../cursor/telemetry";
import { setCursorCaptureStartTimeMs, setIsCursorCaptureActive } from "../state";
import { startNativeCursorMonitor, stopNativeCursorMonitor } from "../cursor/monitor";

export function registerObsHandlers(
    onRecordingStateChange?: (recording: boolean, sourceName: string) => void,
) {
    ipcMain.handle("obs-connect", async (_, password?: string) => {
        return await connectObs(password);
    });

    ipcMain.handle("obs-disconnect", async () => {
        await disconnectObs();
        return true;
    });

    ipcMain.handle("obs-set-mode", (_, enabled: boolean) => {
        setObsMode(enabled);
        return true;
    });

    ipcMain.handle("obs-get-mode", () => {
        return getObsMode();
    });

    ipcMain.handle("obs-start-recording", async () => {
        try {
            const success = await startObsRecording();
            if (!success) {
                return { success: false, message: "Failed to start OBS recording." };
            }

            // Start cursor tracking
            // We now wait precisely for the OBS_WEBSOCKET_OUTPUT_STARTED event
            // so we can start telemetry exactly when the video begins, no offset needed.
            setCursorCaptureStartTimeMs(Date.now());
            setIsCursorCaptureActive(true);
            resetCursorCaptureClock();
            startCursorSampling();
            await startInteractionCapture();
            if (process.platform === "darwin" || process.platform === "win32") {
                startNativeCursorMonitor();
            }

            if (onRecordingStateChange) {
                onRecordingStateChange(true, "OBS Studio");
            }
            return { success: true };
        } catch (error) {
            console.error("OBS start error", error);
            return { success: false, error: String(error) };
        }
    });

    ipcMain.handle("obs-stop-recording", async () => {
        try {
            const outputPath = await stopObsRecording();
            
            // Stop cursor tracking
            setIsCursorCaptureActive(false);
            stopCursorCapture();
            stopInteractionCapture();
            if (process.platform === "darwin" || process.platform === "win32") {
                stopNativeCursorMonitor();
            }

            if (onRecordingStateChange) {
                onRecordingStateChange(false, "OBS Studio");
            }

            if (!outputPath) {
                return { success: false, message: "OBS did not return an output path." };
            }
            
            // Wait a brief moment to ensure OBS flushes the file (sometimes WebSocket returns immediately but file is still being finalized)
            await new Promise((resolve) => setTimeout(resolve, 500));
            
            // Write telemetry file alongside the OBS output
            const { activeCursorSamples } = await import("../state");
            await writeCursorTelemetry(outputPath, activeCursorSamples);

            return { success: true, path: outputPath };
        } catch (error) {
            console.error("OBS stop error", error);
            return { success: false, error: String(error) };
        }
    });
}
