import { windowsNativeCaptureActive } from "../../state";
import { isLinuxPortalCaptureActive, stopLinuxPortalCapture } from "../linuxPortal";
import { stopMacCapture } from "./stopMacCapture";
import { stopWindowsCapture } from "./stopWindowsCapture";

export async function stopNativeCapture() {
	const start = Date.now();
	console.log("[PERF:MAIN] Handler: stop-native-screen-recording: STARTED");
	try {
		if (process.platform === "win32" && windowsNativeCaptureActive)
			return await stopWindowsCapture();
		if (process.platform === "linux" && isLinuxPortalCaptureActive()) {
			try {
				return await stopLinuxPortalCapture();
			} catch (error) {
				return {
					success: false,
					message: "Failed to stop Linux portal capture",
					error: String(error),
				};
			}
		}
		return await stopMacCapture();
	} finally {
		console.log(
			`[PERF:MAIN] Handler: stop-native-screen-recording: COMPLETED in ${Date.now() - start}ms`,
		);
	}
}
