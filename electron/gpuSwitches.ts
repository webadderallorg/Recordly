export interface GpuSwitches {
	useAngle?: string;
	useGl?: string;
	disableFeatures?: string[];
}

// Let Chromium select its supported ANGLE/GL implementation by default. Forcing
// native EGL on X11 can make the GPU process exit before preview or export starts.
export function shouldForceLinuxEgl(env: NodeJS.ProcessEnv): boolean {
	const requested = env.RECORDLY_FORCE_EGL?.trim().toLowerCase();
	return requested === "1" || requested === "true";
}

/**
 * Chromium switches that override its GPU driver blocklist. They stay off by
 * default so known-bad drivers fall back to software rendering instead of
 * crashing; set RECORDLY_IGNORE_GPU_BLOCKLIST=1 to force them for diagnosis.
 * Headless smoke-export runs (RECORDLY_SMOKE_EXPORT=1), which these switches were
 * first added for, keep them so benchmarks measure the GPU path.
 */
export function getGpuBlocklistOverrideSwitches(env: NodeJS.ProcessEnv = process.env): string[] {
	const requested = env.RECORDLY_IGNORE_GPU_BLOCKLIST?.trim().toLowerCase();
	return requested === "1" || requested === "true" || env.RECORDLY_SMOKE_EXPORT === "1"
		? ["ignore-gpu-blocklist", "enable-unsafe-webgpu", "enable-gpu-rasterization"]
		: [];
}

export function getGpuSwitches(
	platform: NodeJS.Platform,
	env: NodeJS.ProcessEnv = process.env,
): GpuSwitches {
	if (platform === "darwin") {
		return {
			useAngle: "metal",
			// Electron 43's separate audio service registers as a foreground app on
			// macOS, adding a Dock icon whenever audio starts. Keep audio in-process
			// until the upstream helper activation policy is fixed.
			disableFeatures: ["MacCatapLoopbackAudioForScreenShare", "AudioServiceOutOfProcess"],
		};
	}

	if (platform === "win32") {
		return { useAngle: "d3d11" };
	}

	if (platform === "linux") {
		return {
			useGl: shouldForceLinuxEgl(env) ? "egl" : undefined,
			disableFeatures: ["VaapiVideoDecoder", "VaapiVideoEncoder"],
		};
	}

	return {};
}
