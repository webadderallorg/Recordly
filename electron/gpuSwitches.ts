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
