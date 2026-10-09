export const LINUX_PORTAL_SCREEN_SOURCE_ID = "screen:linux-portal";

/**
 * Detects whether the current environment is explicitly running a Linux Wayland session.
 *
 * Only returns true when `XDG_SESSION_TYPE` explicitly identifies "wayland".
 * Unset or unknown session types are not treated as Wayland portal sessions to prevent
 * breaking display enumeration on X11 or hybrid environments where WAYLAND_DISPLAY might be inherited.
 *
 * @param env - The process environment variables object.
 * @returns True if the session type is explicitly "wayland", false otherwise.
 */
export function isLikelyLinuxWaylandSession(env: NodeJS.ProcessEnv): boolean {
	const sessionType = env.XDG_SESSION_TYPE?.trim().toLowerCase();
	return sessionType === "wayland";
}

/**
 * Determines the appropriate screen source ID for a given display across platforms.
 *
 * @param options - Configuration options including display ID, environment, matched source ID, and platform.
 * @returns The resolved source ID string for screen capture.
 */
export function getScreenSourceIdForDisplay({
	displayId,
	env = process.env,
	matchedSourceId,
	platform,
}: {
	displayId: string;
	env?: NodeJS.ProcessEnv;
	matchedSourceId?: string | null;
	platform: NodeJS.Platform | string;
}): string {
	if (matchedSourceId) {
		return matchedSourceId;
	}

	if (platform === "linux" && isLikelyLinuxWaylandSession(env)) {
		return LINUX_PORTAL_SCREEN_SOURCE_ID;
	}

	return `screen:fallback:${displayId}`;
}

