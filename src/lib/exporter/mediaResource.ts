const LOOPBACK_MEDIA_SERVER_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

export function isAbsoluteLocalPath(resource: string): boolean {
	return (
		resource.startsWith("/") ||
		/^[A-Za-z]:[\\/]/.test(resource) ||
		/^\\\\[^\\]+\\[^\\]+/.test(resource)
	);
}

function fromFileUrl(resource: string): string {
	try {
		const url = new URL(resource);
		const pathname = decodeURIComponent(url.pathname);

		if (url.host && url.host !== "localhost") {
			const uncPath = `//${url.host}${pathname.startsWith("/") ? pathname : `/${pathname}`}`;
			return uncPath.replace(/\//g, "\\");
		}

		if (/^\/[A-Za-z]:/.test(pathname)) {
			return pathname.slice(1);
		}

		return pathname;
	} catch {
		const rawFallbackPath = resource.replace(/^file:\/\//i, "");
		let fallbackPath = rawFallbackPath;
		try {
			fallbackPath = decodeURIComponent(rawFallbackPath);
		} catch {
			// Keep raw best-effort path if percent decoding fails.
		}
		return fallbackPath.replace(/^\/([A-Za-z]:)/, "$1");
	}
}

function getLoopbackMediaServerPath(resource: string): string | null {
	try {
		const url = new URL(resource);
		if (url.pathname !== "/video") {
			return null;
		}

		if (!/^https?:$/i.test(url.protocol)) {
			return null;
		}

		if (!LOOPBACK_MEDIA_SERVER_HOSTS.has(url.hostname.toLowerCase())) {
			return null;
		}

		const pathParam = url.searchParams.get("path");
		if (!pathParam) {
			return null;
		}

		if (/^file:\/\//i.test(pathParam)) {
			return fromFileUrl(pathParam);
		}

		return isAbsoluteLocalPath(pathParam) ? pathParam : null;
	} catch {
		return null;
	}
}

function getPathBaseName(filePath: string): string {
	const normalized = filePath.replace(/\\/g, "/");
	const segments = normalized.split("/").filter(Boolean);
	return segments[segments.length - 1] ?? "";
}

export function getLocalFilePathFromResource(resource: string): string | null {
	if (!resource) {
		return null;
	}

	if (/^file:\/\//i.test(resource)) {
		return fromFileUrl(resource);
	}

	const mediaServerPath = getLoopbackMediaServerPath(resource);
	if (mediaServerPath) {
		return mediaServerPath;
	}

	return isAbsoluteLocalPath(resource) ? resource : null;
}

export function getResourceFileName(resource: string, fallback: string): string {
	const localFilePath = getLocalFilePathFromResource(resource);
	if (localFilePath) {
		const fileName = getPathBaseName(localFilePath);
		if (fileName) {
			return fileName;
		}
	}

	try {
		const url = new URL(resource);
		const fileName = getPathBaseName(decodeURIComponent(url.pathname));
		if (fileName) {
			return fileName;
		}
	} catch {
		// Ignore parse errors and fall back to the provided default.
	}

	return fallback;
}
