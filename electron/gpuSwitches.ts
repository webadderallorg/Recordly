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
	env: NodeJS.ProcessEnv = process.env,
): GpuSwitches {
	if (env.RECORDLY_USE_ANGLE) {
		const disable = env.RECORDLY_DISABLE_FEATURES
			? env.RECORDLY_DISABLE_FEATURES.split(",").map((s) => s.trim()).filter(Boolean)
			: undefined;
		return {
			useAngle: env.RECORDLY_USE_ANGLE === "none" ? undefined : env.RECORDLY_USE_ANGLE,
			disableFeatures: disable,
		};
	}

	if (platform === "darwin") {
		return {
			useAngle: "metal",
			disableFeatures: ["MacCatapLoopbackAudioForScreenShare"],
		};
	}

	if (platform === "win32") {
		// On Windows ARM64 (Snapdragon X / Qualcomm Adreno), native D3D11/Vulkan drivers can hit access
		// violations (0xC0000005 / exit_code=-1073741819) when Chromium attempts GPU rasterization or WebGPU.
		// Microsoft's WARP (DirectX software rasterizer) provides flawless, crash-free WebGL2 preview rendering.
		if (
			process.arch === "arm64" ||
			env.TARGET_ARCH === "arm64" ||
			env.PROCESSOR_ARCHITECTURE === "ARM64" ||
			env.PROCESSOR_ARCHITEW6432 === "ARM64"
		) {
			return {
				useAngle: "warp",
				disableFeatures: ["WebGPU"],
			};
		}
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
