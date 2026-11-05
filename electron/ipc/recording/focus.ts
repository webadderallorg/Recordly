import { createRecordingFocusController } from "../../recordingFocus";
import { hideRecordingFocus, showRecordingFocus } from "../../windows";
import { resolveLinuxWindowBounds, resolveMacWindowBounds } from "../cursor/bounds";
import { isCursorCaptureActive, selectedWindowBounds } from "../state";
import { getSourceArea } from "../sourceArea";
import { resolveWindowsWindowBounds } from "../windowsWindowControl";
import { getDisplayBoundsForSource } from "./ffmpeg";

export const recordingFocus = createRecordingFocusController({
	async resolve(source) {
		const area = getSourceArea(source);
		if (area) return area;
		if (source.id?.startsWith("window:")) {
			if (isCursorCaptureActive) return selectedWindowBounds;
			if (process.platform === "darwin") return resolveMacWindowBounds(source);
			if (process.platform === "win32") return resolveWindowsWindowBounds(source);
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
