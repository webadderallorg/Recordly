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

export async function resolveDisplayMediaSource({
	platform,
	env,
	selectedSourceId,
	getSources,
}: {
	platform: string;
	env: NodeJS.ProcessEnv;
	selectedSourceId: string | null | undefined;
	getSources: () => Promise<Array<{ id: string; name: string }>>;
}): Promise<{ id: string; name: string } | null> {
	if (platform === "linux" && isLikelyLinuxWaylandSession(env)) {
		// Chromium opens the portal once when it resolves this source. Enumerating first opens it twice.
		return { id: "screen:0:0", name: "Entire screen" };
	}
	if (!selectedSourceId || selectedSourceId === LINUX_PORTAL_SCREEN_SOURCE_ID) return null;
	const source = (await getSources()).find((source) => source.id === selectedSourceId);
	// A vanished source must never silently become a different window or the whole screen.
	return source ? { id: source.id, name: source.name } : null;
}
