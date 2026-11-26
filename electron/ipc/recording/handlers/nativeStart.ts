import { ipcMain } from "electron";
import { isTrustedRenderer } from "../../../trustedRenderer";
import { beginHudCaptureProtection } from "../../../windows";
import { bringSelectedWindowForward } from "../../register/sources";
import { type NativeMacRecordingOptions, type SelectedSource } from "../../types";
import { isLinuxPortalCaptureEnabled, startLinuxPortalCapture } from "../linuxPortal";
import type { RecordingHandlerContext } from "./handlerContext";
import { startMacCapture } from "./startMacCapture";
import { startWindowsCapture } from "./startWindowsCapture";
export function registerNativeStart(context: RecordingHandlerContext) {
	const { recordingProcessGuard, ownerRecovery } = context;
	ipcMain.handle(
		"start-native-screen-recording",
		(
			event: Electron.IpcMainInvokeEvent,
			source: SelectedSource,
			options?: NativeMacRecordingOptions,
		) => {
			if (!isTrustedRenderer(event)) throw new Error("Untrusted recording caller");
			return ownerRecovery.start(event.sender, () =>
				startNativeCapture(event, source, options),
			);
		},
	);
	const startNativeCapture = recordingProcessGuard.wrap(
		async (
			_: Electron.IpcMainInvokeEvent,
			source: SelectedSource,
			options?: NativeMacRecordingOptions,
		) => {
			beginHudCaptureProtection();
			const visibleWindowBounds = source.id?.startsWith("window:")
				? await bringSelectedWindowForward(source)
				: null;
			if (process.platform === "win32")
				return await startWindowsCapture(context, source, options);
			if (process.platform === "linux" && isLinuxPortalCaptureEnabled()) {
				const capturesSystemAudio = options?.capturesSystemAudio;
				if (capturesSystemAudio !== undefined && typeof capturesSystemAudio !== "boolean") {
					return {
						success: false,
						message: "Invalid capturesSystemAudio option for Linux portal capture",
					};
				}
				const ownerSession = ownerRecovery.sessionToken;
				try {
					await startLinuxPortalCapture({
						systemAudio: capturesSystemAudio === true,
						trackProcess: (child) => recordingProcessGuard.track(child),
						onUnexpectedExit: () => {
							if (ownerRecovery.sessionToken === ownerSession) {
								ownerRecovery.captureExited();
							}
						},
					});
					return {
						success: true,
						microphoneFallbackRequired: Boolean(options?.capturesMicrophone),
					};
				} catch (error) {
					return {
						success: false,
						message: "Failed to start Linux portal capture",
						error: String(error),
					};
				}
			}
			return await startMacCapture(context, source, options, visibleWindowBounds);
		},
	);
}
