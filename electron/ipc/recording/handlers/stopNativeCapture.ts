import { windowsNativeCaptureActive } from "../../state";
import { stopMacCapture } from "./stopMacCapture";
import { stopWindowsCapture } from "./stopWindowsCapture";

export async function stopNativeCapture() {
	const start = Date.now();
	console.log("[PERF:MAIN] Handler: stop-native-screen-recording: STARTED");
	try {
		if (process.platform === "win32" && windowsNativeCaptureActive)
			return await stopWindowsCapture();
		return await stopMacCapture();
	} finally {
		console.log(
			`[PERF:MAIN] Handler: stop-native-screen-recording: COMPLETED in ${Date.now() - start}ms`,
		);
	}
}
