import { resolveLinuxWindowSystem } from "./linuxWindowSystem";

export interface GpuSwitches {
	useAngle?: string;
	useGl?: string;
	disableFeatures?: string[];
}

export function shouldForceLinuxEgl(env: NodeJS.ProcessEnv): boolean {
	return resolveLinuxWindowSystem("linux", env) !== "wayland";
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
