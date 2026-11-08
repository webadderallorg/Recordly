import { getLocalMediaServerPath } from "@/lib/localMediaUrl";

function isFileUrl(value: string): boolean {
	return /^file:\/\//i.test(value);
}

function encodePathSegments(pathname: string, keepWindowsDrive = false): string {
	return pathname
		.split("/")
		.map((segment, index) => {
			if (!segment) return "";
			if (keepWindowsDrive && index === 1 && /^[a-zA-Z]:$/.test(segment)) {
				return segment;
			}
			return encodeURIComponent(segment);
		})
		.join("/");
}

export function toFileUrl(filePath: string): string {
	const normalized = filePath.replace(/\\/g, "/");

	// Windows drive path: C:/Users/...
	if (/^[a-zA-Z]:\//.test(normalized)) {
		return `file://${encodePathSegments(`/${normalized}`, true)}`;
	}

	// UNC path: //server/share/...
	if (normalized.startsWith("//")) {
		const [host, ...pathParts] = normalized.replace(/^\/+/, "").split("/");
		const encodedPath = pathParts.map((part) => encodeURIComponent(part)).join("/");
		return encodedPath ? `file://${host}/${encodedPath}` : `file://${host}/`;
	}

	const absolutePath = normalized.startsWith("/") ? normalized : `/${normalized}`;
	return `file://${encodePathSegments(absolutePath)}`;
}

export function fromFileUrl(fileUrl: string): string {
	const value = fileUrl.trim();
	const serverPath = getLocalMediaServerPath(value);
	if (serverPath) return serverPath;
	if (!isFileUrl(value)) {
		return fileUrl;
	}

	try {
		const url = new URL(value);
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
		const rawFallbackPath = value.replace(/^file:\/\//i, "");
		let fallbackPath = rawFallbackPath;
		try {
			fallbackPath = decodeURIComponent(rawFallbackPath);
		} catch {
			// Keep raw best-effort path if percent decoding fails.
		}
		return fallbackPath.replace(/^\/([a-zA-Z]:)/, "$1");
	}
}

export async function resolveVideoUrl(sourcePath: string): Promise<string> {
	const trimmedSourcePath = fromFileUrl(sourcePath.trim());
	if (/^(?:https?:|blob:|data:)/i.test(trimmedSourcePath)) {
		return trimmedSourcePath;
	}
	const localPath = fromFileUrl(trimmedSourcePath);
	try {
		const result = await window.electronAPI.getLocalMediaUrl(localPath);
		if (result.success) {
			return result.url;
		}
	} catch {
		// Media server unavailable — fall through to file:// URL.
	}
	return toFileUrl(localPath);
}
