export const LINUX_PORTAL_SCREEN_SOURCE_ID = "screen:linux-portal";

export function isLikelyLinuxWaylandSession(env: NodeJS.ProcessEnv) {
	const sessionType = env.XDG_SESSION_TYPE?.trim().toLowerCase();
	if (sessionType === "wayland") {
		return true;
	}
	if (sessionType === "x11") {
		return false;
	}

	return Boolean(env.WAYLAND_DISPLAY);
}

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
}) {
	if (matchedSourceId) {
		return matchedSourceId;
	}

	if (platform === "linux" && isLikelyLinuxWaylandSession(env)) {
		return LINUX_PORTAL_SCREEN_SOURCE_ID;
	}

	return `screen:fallback:${displayId}`;
}

export function shouldUseSyntheticLinuxPortalSource({
	env,
	platform,
	sourceId,
}: {
	env: NodeJS.ProcessEnv;
	platform: NodeJS.Platform | string;
	sourceId?: string | null;
}) {
	if (platform !== "linux") {
		return false;
	}

	if (
		sourceId &&
		sourceId !== LINUX_PORTAL_SCREEN_SOURCE_ID &&
		!sourceId.startsWith("screen:fallback:")
	) {
		return false;
	}

	return isLikelyLinuxWaylandSession(env);
}
