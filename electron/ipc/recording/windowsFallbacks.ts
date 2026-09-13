const WINDOWS_MIC_CAPTURE_UNAVAILABLE_MARKERS = [
	"MICROPHONE_CAPTURE_UNAVAILABLE",
	"WARNING: Failed to initialize WASAPI mic capture",
];
export const WINDOWS_MIC_CAPTURE_MODE_ENV = "RECORDLY_WINDOWS_MIC_CAPTURE";

export function shouldStartWindowsBrowserMicrophoneFallback(
	options?: { capturesMicrophone?: boolean },
	env: NodeJS.ProcessEnv = process.env,
) {
	if (!options?.capturesMicrophone) {
		return false;
	}

	const mode = env[WINDOWS_MIC_CAPTURE_MODE_ENV]?.trim().toLowerCase();
	// Native WASAPI is the normal Windows path. Keep the renderer path as an
	// explicit escape hatch and as an automatic fallback when WASAPI cannot start.
	return mode === "browser" || mode === "fallback" || mode === "renderer";
}

export function shouldUseWindowsBrowserMicrophoneFallback(
	captureOutput: string,
	options?: { capturesMicrophone?: boolean },
	env: NodeJS.ProcessEnv = process.env,
) {
	return (
		Boolean(options?.capturesMicrophone) &&
		(shouldStartWindowsBrowserMicrophoneFallback(options, env) ||
			WINDOWS_MIC_CAPTURE_UNAVAILABLE_MARKERS.some((marker) =>
				captureOutput.includes(marker),
			))
	);
}
