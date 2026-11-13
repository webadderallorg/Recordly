import { BrowserWindow } from "electron";
import { type AuthFlowStorageHooks, registerAuthStorageHandlers } from "../authStorage";
import { registerAnnouncementHandlers } from "./register/announcements";
import { registerAssetHandlers } from "./register/assets";
import { registerCaptionHandlers } from "./register/captions";
import { registerCapturePickerHandlers } from "./register/capturePicker";
import { registerCloudBillingHandlers } from "./register/cloudBilling";
import { registerCloudShareHandlers } from "./register/cloudShare";
import { registerClipboardHandlers } from "./register/clipboard";
import { registerExportDiagnosticHandlers } from "./register/exportDiagnostics";
import { registerGifOptimizationHandlers } from "./register/gifOptimization";
import { registerExportHandlers } from "./register/export";
import { registerPermissionHandlers } from "./register/permissions";
import { registerProjectHandlers } from "./register/project";
import { registerRecordingHandlers } from "./register/recording";
import { registerSettingsHandlers } from "./register/settings";
import { registerSourceHandlers } from "./register/sources";
import { registerStorageLocationHandlers } from "./register/storageLocations";
import {
	selectedSource,
	setNativeScreenRecordingActive,
	setWindowsCapturePaused,
	setWindowsCaptureProcess,
	setWindowsCaptureStopRequested,
	setWindowsCaptureTargetPath,
	setWindowsMicAudioPath,
	setWindowsNativeCaptureActive,
	setWindowsOrphanedMicAudioPath,
	setWindowsPendingVideoPath,
	setWindowsSystemAudioPath,
	windowsCaptureProcess,
} from "./state";

export { cleanupAllExportStreams } from "./export/exportStream";
export { cleanupNativeVideoExportSessions } from "./export/native-video";

/** Returns the currently selected source ID for setDisplayMediaRequestHandler */
export function getSelectedSourceId(): string | null {
	return (selectedSource?.id as string | null) ?? null;
}

export function killWindowsCaptureProcess() {
	if (windowsCaptureProcess) {
		try {
			windowsCaptureProcess.kill();
		} catch {
			/* ignore */
		}
		setWindowsCaptureProcess(null);
		setWindowsCaptureTargetPath(null);
		setWindowsNativeCaptureActive(false);
		setNativeScreenRecordingActive(false);
		setWindowsCaptureStopRequested(false);
		setWindowsCapturePaused(false);
		setWindowsSystemAudioPath(null);
		setWindowsMicAudioPath(null);
		setWindowsOrphanedMicAudioPath(null);
		setWindowsPendingVideoPath(null);
	}
}

export function registerIpcHandlers(
	createEditorWindow: () => void,
	createSourceSelectorWindow: () => BrowserWindow,
	_getMainWindow: () => BrowserWindow | null,
	getSourceSelectorWindow: () => BrowserWindow | null,
	onRecordingStateChange?: (recording: boolean, sourceName: string) => void,
	authFlowStorageHooks?: AuthFlowStorageHooks,
) {
	const { pickSourceList } = registerSourceHandlers({
		createEditorWindow,
		createSourceSelectorWindow,
		getSourceSelectorWindow,
	});
	registerCapturePickerHandlers({ pickSourceList });
	registerRecordingHandlers(onRecordingStateChange);
	registerPermissionHandlers();
	registerAuthStorageHandlers(authFlowStorageHooks);
	registerClipboardHandlers();
	registerAnnouncementHandlers();
	registerAssetHandlers();
	registerExportHandlers();
	registerGifOptimizationHandlers();
	registerExportDiagnosticHandlers();
	registerCaptionHandlers();
	registerCloudShareHandlers();
	registerCloudBillingHandlers();
	registerProjectHandlers();
	registerSettingsHandlers();
	registerStorageLocationHandlers();
}
