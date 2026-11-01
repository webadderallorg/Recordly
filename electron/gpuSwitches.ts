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

function getOzoneSwitchValue(argv: readonly string[], name: string): string | undefined {
	const prefix = `--${name}=`;
	// Chromium uses the last occurrence of a repeated switch.
	for (let i = argv.length - 1; i >= 0; i--) {
		if (argv[i].startsWith(prefix)) {
			return argv[i].slice(prefix.length);
		}
	}
	return undefined;
}

function getForcedLinuxWindowSystem(
	env: NodeJS.ProcessEnv,
	argv: readonly string[],
): "wayland" | "x11" | null {
	// The --ozone-platform switch picks the backend Chromium actually uses, e.g.
	// XWayland when launched with --ozone-platform=x11 from a Wayland session.
	// ELECTRON_OZONE_PLATFORM_HINT is ignored by Electron 43, so it is not read.
	return (
		normalizeLinuxWindowSystem(getOzoneSwitchValue(argv, "ozone-platform")) ??
		normalizeLinuxWindowSystem(getOzoneSwitchValue(argv, "ozone-platform-hint")) ??
		normalizeLinuxWindowSystem(env.OZONE_PLATFORM)
	);
}

export function isLinuxX11Session(env: NodeJS.ProcessEnv, argv: readonly string[] = []): boolean {
	const forcedWindowSystem = getForcedLinuxWindowSystem(env, argv);
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
		// Do not force --use-gl=egl on X11: Electron 43 only allows ANGLE, so the
		// GPU process exits and WebGL/WebGPU become unavailable to the editor.
		return {
			disableFeatures: ["VaapiVideoDecoder", "VaapiVideoEncoder"],
		};
	}

	return {};
}
