import { isLikelyLinuxWaylandSession } from "./ipc/register/sourceMapping";

export interface GpuSwitches {
	useAngle?: string;
	useGl?: string;
	disableFeatures?: string[];
}

/**
 * Determines whether Linux EGL rendering switch should be forced.
 * Returns false on all environments to avoid GPU driver crashes.
 *
 * @param _env - Process environment variables.
 * @returns Boolean flag indicating if EGL should be forced.
 */
export function shouldForceLinuxEgl(_env: NodeJS.ProcessEnv): boolean {
	return false;
}

/**
 * Returns platform-specific GPU command-line switches and disabled feature flags.
 *
 * @param platform - Target operating system platform.
 * @param env - Process environment variables.
 * @returns Object containing GPU switches and disabled features.
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
		const isWayland = isLikelyLinuxWaylandSession(env);
		const disableFeatures = ["VaapiVideoDecoder", "VaapiVideoEncoder"];
		if (!isWayland) {
			disableFeatures.push("WebRTCPipeWireCapturer");
		}
		return {
			disableFeatures,
		};
	}

	return {};
}
