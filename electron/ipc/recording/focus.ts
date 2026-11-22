import { createRecordingFocusController } from "../../recordingFocus";
import { hideRecordingFocus, showRecordingFocus } from "../../windows";
import { resolveLinuxWindowBounds, resolveMacWindowBounds } from "../cursor/bounds";
import { getSourceArea } from "../sourceArea";
import { isCursorCaptureActive, selectedWindowBounds } from "../state";
import { resolveWindowsWindowBounds } from "../windowsWindowControl";
import { getDisplayBoundsForSource } from "./ffmpeg";

export const recordingFocus = createRecordingFocusController({
	async resolve(source) {
		const area = getSourceArea(source);
		if (area) return area;
		if (source.id?.startsWith("window:")) {
			// Windows bounds queries are shared with telemetry. Keep resolving the
			// actual HWND across the transition instead of hiding the mask when
			// recording clears or temporarily misses its telemetry bounds cache.
			if (process.platform === "win32") return resolveWindowsWindowBounds(source);
			if (isCursorCaptureActive && selectedWindowBounds) return selectedWindowBounds;
			if (process.platform === "darwin") return resolveMacWindowBounds(source);
			if (process.platform === "linux") return resolveLinuxWindowBounds(source);
			return null;
		}
		// A portal target is unknown until the system chooser opens; never dim blindly.
		if (!source.id?.startsWith("screen:") || source.id === "screen:linux-portal") return null;
		return getDisplayBoundsForSource(source);
	},
	show: (bounds) => showRecordingFocus(bounds),
	hide: () => hideRecordingFocus(),
});
