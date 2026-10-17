/**
 * Lines the macOS capture helper prints about native webcam capture (WebcamRecorder in
 * ScreenCaptureKitRecorder.swift):
 *
 *   WEBCAM_CAPTURE_STARTED <camera name>
 *   WEBCAM_CAPTURE_UNAVAILABLE <reason>     the app records the webcam the old way
 *   WEBCAM_OUTPUT <path> OFFSET_MS <n>       on stop: the file and where it starts
 *   WEBCAM_OUTPUT_FAILED                     on stop: nothing usable was written
 */
export type NativeWebcamStatus = {
	started: boolean;
	unavailableReason: string | null;
	webcamPath: string | null;
	/** Where the webcam file's first frame sits on the screen recording, in ms. */
	timeOffsetMs: number;
};

export function parseNativeWebcamOutput(output: string): NativeWebcamStatus {
	const unavailable = /^WEBCAM_CAPTURE_UNAVAILABLE ?(.*)$/m.exec(output);
	const written = /^WEBCAM_OUTPUT (.+) OFFSET_MS (-?\d+)\s*$/m.exec(output);
	return {
		started: /^WEBCAM_CAPTURE_STARTED\b/m.test(output) && !unavailable,
		unavailableReason: unavailable ? unavailable[1].trim() || "unknown" : null,
		webcamPath: written ? written[1].trim() : null,
		timeOffsetMs: written ? Number(written[2]) : 0,
	};
}

/**
 * `stored` with the webcam file the helper finished, if it printed one. Used on every path
 * that hands a native recording to the renderer (stop, stop-failure fallback, recovery), so
 * the webcam layer never goes missing while its file sits on disk.
 */
export function withNativeWebcam<T extends object>(
	stored: T,
	output: string,
): T | (T & { webcamPath: string; webcamTimeOffsetMs: number }) {
	const webcam = parseNativeWebcamOutput(output);
	return webcam.webcamPath
		? { ...stored, webcamPath: webcam.webcamPath, webcamTimeOffsetMs: webcam.timeOffsetMs }
		: stored;
}
