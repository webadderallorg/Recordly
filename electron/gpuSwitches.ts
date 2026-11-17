export interface GpuSwitches {
	useAngle?: string;
	useGl?: string;
	enableFeatures?: string[];
	disableFeatures?: string[];
	extraSwitches?: string[];
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
			// macOS can register Chromium's media workers as separate Dock apps.
			// In-process video capture requires shared-memory camera frames.
			enableFeatures: ["RunVideoCaptureServiceInBrowserProcess"],
			disableFeatures: ["MacCatapLoopbackAudioForScreenShare", "AudioServiceOutOfProcess"],
			extraSwitches: ["disable-video-capture-use-gpu-memory-buffer"],
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
