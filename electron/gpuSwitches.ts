export interface GpuSwitches {
	useAngle?: string;
	useGl?: string;
	disableFeatures?: string[];
}


/**
 * Determines whether the Linux EGL backend should be forced via environment flags.
 *
 * @param env - Process environment variables.
 * @returns True if RECORDLY_FORCE_EGL is set to "1" or "true", false otherwise.
 */
export function shouldForceLinuxEgl(env: NodeJS.ProcessEnv): boolean {
	const flag = env.RECORDLY_FORCE_EGL?.trim().toLowerCase();
	return flag === "1" || flag === "true";
}

/**
 * Computes platform-specific Chromium GPU switches and feature flags for hardware acceleration.
 *
 * @param platform - The host OS platform ("darwin", "win32", "linux").
 * @param env - Process environment variables.
 * @returns An object containing recommended GPU flags and disabled features.
 */
export function getGpuSwitches(
	platform: NodeJS.Platform,
	env: NodeJS.ProcessEnv = process.env,
): GpuSwitches {
	if (platform === "darwin") {
		return {
			useAngle: "metal",
			disableFeatures: ["MacCatapLoopbackAudioForScreenShare"],
		};
	}

	if (platform === "win32") {
		return { useAngle: "d3d11" };
	}

	if (platform === "linux") {
		const useGl = env.RECORDLY_USE_GL ?? (shouldForceLinuxEgl(env) ? "egl" : undefined);
		const useAngle = env.RECORDLY_USE_ANGLE;
		return {
			...(useGl ? { useGl } : {}),
			...(useAngle ? { useAngle } : {}),
			disableFeatures: ["VaapiVideoDecoder", "VaapiVideoEncoder"],
		};
	}

	return {};
}
