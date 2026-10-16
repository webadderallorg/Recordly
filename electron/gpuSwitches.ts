export interface GpuSwitches {
	useAngle?: string;
	useGl?: string;
	disableFeatures?: string[];
}

export type LinuxOzonePlatform = "wayland" | "x11";

function normalizeLinuxWindowSystem(value: string | undefined): LinuxOzonePlatform | null {
	const normalized = value?.trim().toLowerCase();
	if (normalized === "wayland" || normalized === "x11") {
		return normalized;
	}

	return null;
}

function getForcedLinuxWindowSystem(env: NodeJS.ProcessEnv): LinuxOzonePlatform | null {
	return normalizeLinuxWindowSystem(env.OZONE_PLATFORM);
}

export function isHyprlandSession(env: NodeJS.ProcessEnv): boolean {
	const currentDesktop = env.XDG_CURRENT_DESKTOP?.toLowerCase() ?? "";
	const desktopSession = env.DESKTOP_SESSION?.toLowerCase() ?? "";

	return Boolean(
		env.HYPRLAND_INSTANCE_SIGNATURE ||
			currentDesktop.split(":").includes("hyprland") ||
			desktopSession.includes("hyprland"),
	);
}

export function getLinuxOzonePlatformOverride(env: NodeJS.ProcessEnv): LinuxOzonePlatform | null {
	if (getForcedLinuxWindowSystem(env)) {
		return null;
	}

	return isHyprlandSession(env) ? "x11" : null;
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
		return {
			useGl: shouldForceLinuxEgl(env) ? "egl" : undefined,
			disableFeatures: ["VaapiVideoDecoder", "VaapiVideoEncoder"],
		};
	}

	return {};
}
