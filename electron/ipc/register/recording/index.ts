import { registerFfmpegRecordingHandlers } from "./ffmpegHandlers"
import { registerNativeRecordingControlHandlers } from "./nativeControlHandlers"
import { registerNativeRecordingStartHandlers } from "./nativeStartHandlers"
import { registerNativeRecordingStopHandlers } from "./nativeStopHandlers"
import { registerRecordingStorageHandlers } from "./storageHandlers"
import { registerRecordingTelemetryHandlers } from "./telemetryHandlers"

export function registerRecordingHandlers(
	onRecordingStateChange?: (recording: boolean, sourceName: string) => void,
) {
	registerNativeRecordingStartHandlers()
	registerNativeRecordingStopHandlers()
	registerNativeRecordingControlHandlers()
	registerFfmpegRecordingHandlers()
	registerRecordingStorageHandlers()
	registerRecordingTelemetryHandlers(onRecordingStateChange)
}