export type LinuxWindowSystem = "wayland" | "x11" | null;

function normalizeLinuxWindowSystem(value: string | undefined): LinuxWindowSystem {
	const normalized = value?.trim().toLowerCase();
	return normalized === "wayland" || normalized === "x11" ? normalized : null;
}

export function resolveLinuxWindowSystem(
	platform: NodeJS.Platform | string,
	env: NodeJS.ProcessEnv = process.env,
): LinuxWindowSystem {
	if (platform !== "linux") {
		return null;
	}

	const configuredWindowSystem =
		normalizeLinuxWindowSystem(env.OZONE_PLATFORM) ??
		normalizeLinuxWindowSystem(env.ELECTRON_OZONE_PLATFORM_HINT);
	if (configuredWindowSystem) {
		return configuredWindowSystem;
	}

	const sessionWindowSystem = normalizeLinuxWindowSystem(env.XDG_SESSION_TYPE);
	if (sessionWindowSystem) {
		return sessionWindowSystem;
	}

	if (env.WAYLAND_DISPLAY) {
		return "wayland";
	}
	if (env.DISPLAY) {
		return "x11";
	}

	return null;
}
