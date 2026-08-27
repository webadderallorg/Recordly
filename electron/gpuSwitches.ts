export interface GpuSwitches {
	useAngle?: string;
	useGl?: string;
	disableFeatures?: string[];
}

function normalizeLinuxWindowSystem(value: string | undefined): "wayland" | "x11" | null {
	const normalized = value?.trim().toLowerCase();
	if (normalized === "wayland" || normalized === "x11") {
		return normalized;
	}

	return null;
}

function getForcedLinuxWindowSystem(env: NodeJS.ProcessEnv): "wayland" | "x11" | null {
	return (
		normalizeLinuxWindowSystem(env.OZONE_PLATFORM) ??
		normalizeLinuxWindowSystem(env.ELECTRON_OZONE_PLATFORM_HINT)
	);
}

export function shouldForceLinuxEgl(env: NodeJS.ProcessEnv): boolean {
	const forcedWindowSystem = getForcedLinuxWindowSystem(env);
	if (forcedWindowSystem === "wayland") {
		return false;
	}
	if (forcedWindowSystem === "x11") {
		return true;
	}

	const sessionType = env.XDG_SESSION_TYPE?.toLowerCase();
	if (sessionType === "wayland") {
		return false;
	}
	if (sessionType === "x11") {
		return true;
	}

	return !env.WAYLAND_DISPLAY;
}

export function getGpuSwitches(
	platform: NodeJS.Platform,
	_env: NodeJS.ProcessEnv = process.env,
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
		// Electron 43 (Chromium 14x) only allows the ANGLE GL implementation on
		// Linux; forcing `--use-gl=egl` makes the GPU process exit during
		// initialization ("Requested GL implementation (gl=egl-gles2,angle=none)
		// not found in allowed implementations"), which leaves the editor without
		// WebGL. Let Chromium pick its default (egl-angle) on both X11 and Wayland.
		return {
			useGl: undefined,
			disableFeatures: ["VaapiVideoDecoder", "VaapiVideoEncoder"],
		};
	}

	return {};
}
