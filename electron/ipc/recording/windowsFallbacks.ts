const WINDOWS_MIC_CAPTURE_INIT_WARNING = "WARNING: Failed to initialize WASAPI mic capture";
export const WINDOWS_MIC_CAPTURE_MODE_ENV = "RECORDLY_WINDOWS_MIC_CAPTURE";

export function shouldStartWindowsBrowserMicrophoneFallback(
	options?: { capturesMicrophone?: boolean },
	env: NodeJS.ProcessEnv = process.env,
) {
	if (!options?.capturesMicrophone) {
		return false;
	}

	const mode = env[WINDOWS_MIC_CAPTURE_MODE_ENV]?.trim().toLowerCase();
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
			captureOutput.includes(WINDOWS_MIC_CAPTURE_INIT_WARNING))
	);
}
