import { isLikelyLinuxWaylandSession } from "./ipc/register/sourceMapping";

export function getLinuxWindowSystem(
	env: NodeJS.ProcessEnv,
	ozonePlatform?: string,
): "wayland" | "x11" {
	const requested = ozonePlatform?.trim().toLowerCase();
	if (requested === "wayland" || requested === "x11") return requested;
	return isLikelyLinuxWaylandSession(env) ? "wayland" : "x11";
}
