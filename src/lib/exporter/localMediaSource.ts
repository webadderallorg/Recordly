import { fromFileUrl, toFileUrl } from "@/components/video-editor/projectPersistence";

const NOOP = () => undefined;
const REMOTE_MEDIA_URL_PATTERN = /^(https?:|blob:|data:)/i;
const LOOPBACK_MEDIA_HOSTS = new Set(["127.0.0.1", "localhost"]);
const BUNDLED_ASSET_PATH_PREFIXES = ["/wallpapers/", "/app-icons/"];

export function isAbsoluteLocalPath(resource: string) {
	return (
		resource.startsWith("/") ||
		/^[A-Za-z]:[\\/]/.test(resource) ||
		/^\\\\[^\\]+\\[^\\]+/.test(resource)
	);
}

function isBundledAssetPath(resource: string) {
	return BUNDLED_ASSET_PATH_PREFIXES.some((prefix) => resource.startsWith(prefix));
}

function getLocalMediaServerPath(resource: string) {
	if (!/^https?:\/\//i.test(resource)) {
		return null;
	}

	try {
		const url = new URL(resource);
		if (!LOOPBACK_MEDIA_HOSTS.has(url.hostname) || url.pathname !== "/video") {
			return null;
		}

		const mediaPath = url.searchParams.get("path");
		return mediaPath && mediaPath.trim().length > 0 ? mediaPath : null;
	} catch {
		return null;
	}
}

export function isLocalMediaServerUrl(resource: string) {
	return getLocalMediaServerPath(resource) !== null;
}

export function getLocalFilePath(resource: string) {
	const localMediaServerPath = getLocalMediaServerPath(resource);
	if (localMediaServerPath) {
		return localMediaServerPath;
	}

	if (/^file:\/\//i.test(resource)) {
		return fromFileUrl(resource);
	}

	if (isBundledAssetPath(resource)) {
		return null;
	}

	return isAbsoluteLocalPath(resource) ? resource : null;
}

function isRemoteMediaResource(resource: string) {
	return REMOTE_MEDIA_URL_PATTERN.test(resource) && !isLocalMediaServerUrl(resource);
}

export function getNormalizedMediaResourceUrl(resource: string) {
	const localFilePath = getLocalFilePath(resource);
	if (!localFilePath) {
		return resource;
	}

	if (isLocalMediaServerUrl(resource)) {
		return resource;
	}

	return /^file:\/\//i.test(resource) ? resource : toFileUrl(localFilePath);
}

function inferMimeType(filePath: string) {
	const normalized = filePath.split("?")[0]?.toLowerCase() ?? filePath.toLowerCase();

	if (normalized.endsWith(".mp4") || normalized.endsWith(".m4v")) return "video/mp4";
	if (normalized.endsWith(".mov")) return "video/quicktime";
	if (normalized.endsWith(".webm")) return "video/webm";
	if (normalized.endsWith(".mkv")) return "video/x-matroska";
	if (normalized.endsWith(".avi")) return "video/x-msvideo";
	if (normalized.endsWith(".mp3")) return "audio/mpeg";
	if (normalized.endsWith(".wav")) return "audio/wav";
	if (normalized.endsWith(".m4a")) return "audio/mp4";
	if (normalized.endsWith(".aac")) return "audio/aac";
	if (normalized.endsWith(".ogg")) return "audio/ogg";
	if (normalized.endsWith(".opus")) return "audio/ogg;codecs=opus";
	if (normalized.endsWith(".flac")) return "audio/flac";

	return "application/octet-stream";
}

export async function resolveMediaResourceUrl(resource: string): Promise<string> {
	const localFilePath = getLocalFilePath(resource);
	if (!localFilePath) {
		return resource;
	}

	if (isLocalMediaServerUrl(resource)) {
		return resource;
	}

	if (typeof window !== "undefined" && window.electronAPI?.getLocalMediaUrl) {
		try {
			const result = await window.electronAPI.getLocalMediaUrl(localFilePath);
			if (result.success) {
				return result.url;
			}
		} catch {
			// Fall through to a file URL when the local media server is unavailable.
		}
	}

	return /^file:\/\//i.test(resource) ? resource : toFileUrl(localFilePath);
}

export async function createReadableMediaResourceFile(resource: string): Promise<File> {
	const localFilePath = getLocalFilePath(resource);
	const filename = (localFilePath ?? resource).split(/[\\/]/).pop()?.split("?")[0] || "media";

	if (localFilePath && typeof window !== "undefined" && window.electronAPI?.readLocalFile) {
		const result = await window.electronAPI.readLocalFile(localFilePath);
		if (!result.success || !result.data) {
			throw new Error(result.error || "Failed to read local media file");
		}

		const bytes = result.data instanceof Uint8Array ? result.data : new Uint8Array(result.data);
		const arrayBuffer = bytes.buffer.slice(
			bytes.byteOffset,
			bytes.byteOffset + bytes.byteLength,
		) as ArrayBuffer;
		return new File([arrayBuffer], filename, { type: inferMimeType(filename) });
	}

	const resourceUrl = await resolveMediaResourceUrl(resource);
	const response = await fetch(resourceUrl);
	if (!response.ok) {
		throw new Error(
			`Failed to load media resource: ${response.status} ${response.statusText}`,
		);
	}

	const blob = await response.blob();
	return new File([blob], filename, { type: blob.type || inferMimeType(filename) });
}

export async function resolveMediaElementSource(resource: string): Promise<{
	src: string;
	revoke: () => void;
}> {
	if (!resource || isRemoteMediaResource(resource)) {
		return { src: resource, revoke: NOOP };
	}

	return {
		src: await resolveMediaResourceUrl(resource),
		revoke: NOOP,
	};
}
