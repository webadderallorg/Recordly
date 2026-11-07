// Account names are public; never fall back to an email address.
export function commentProfileName(metadata: Record<string, unknown> = {}) {
	return [metadata.full_name, metadata.name]
		.find((value): value is string => typeof value === "string" && Boolean(value.trim()))
		?.trim()
		.slice(0, 100);
}

export function commentDisplayName(metadata: Record<string, unknown> = {}) {
	return commentProfileName(metadata) || "Recordly member";
}

const returnKey = "recordly-comment-return";
export function saveCommentReturn(path: string, challenge: string) {
	// Keep the existing /library OAuth callback and return to the same recording.
	sessionStorage.setItem(returnKey, JSON.stringify({ path, challenge, at: Date.now() }));
}

export function takeCommentReturn(challenge?: string): string | null {
	try {
		const saved = sessionStorage.getItem(returnKey);
		sessionStorage.removeItem(returnKey);
		if (!saved) return null;
		const { path, at, challenge: pendingChallenge } = JSON.parse(saved);
		if (!challenge || challenge !== pendingChallenge) return null;
		if (typeof path !== "string" || !/^\/s\/[a-z0-9]+(?:\?t=\d+(?:\.\d+)?)?$/.test(path))
			return null;
		const age = Date.now() - at;
		return age >= 0 && age < 60 * 60 * 1000 ? path : null;
	} catch {
		return null;
	}
}
