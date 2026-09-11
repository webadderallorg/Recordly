import { isLikelyLinuxWaylandSession } from "./ipc/register/sourceMapping";

export interface GpuSwitches {
	useAngle?: string;
	useGl?: string;
	disableFeatures?: string[];
}

export function shouldForceLinuxEgl(_env: NodeJS.ProcessEnv): boolean {
	return false;
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
