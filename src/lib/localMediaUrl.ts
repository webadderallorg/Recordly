/** The port belongs to one app run; persist the file path, never this URL. */
export function getLocalMediaServerPath(resource: string): string | null {
	try {
		const url = new URL(resource);
		if (
			!["http:", "https:"].includes(url.protocol) ||
			!["127.0.0.1", "localhost"].includes(url.hostname) ||
			url.pathname !== "/video"
		)
			return null;
		const filePath = url.searchParams.get("path");
		return filePath &&
			(/^\//.test(filePath) ||
				/^[A-Za-z]:[\\/]/.test(filePath) ||
				filePath.startsWith("\\\\"))
			? filePath
			: null;
	} catch {
		return null;
	}
}
