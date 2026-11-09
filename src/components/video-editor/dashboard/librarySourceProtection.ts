/** Collect additive protection hints; the main process canonicalizes and validates them. */
export function collectLibrarySourceProtection(snapshot: unknown): string[] {
	const paths = new Set<string>();
	const visit = (value: unknown) => {
		if (
			typeof value === "string" &&
			/\.(mp4|mov|webm|mkv|m4v|wav|m4a|mp3|ogg|flac)(?:[?#].*)?$/i.test(value)
		)
			paths.add(value);
		else if (Array.isArray(value)) value.forEach(visit);
		else if (value && typeof value === "object") Object.values(value).forEach(visit);
	};
	visit(snapshot);
	return [...paths];
}
