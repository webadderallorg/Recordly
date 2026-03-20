import { fromFileUrl, toFileUrl } from "@/components/video-editor/projectPersistence";

const NOOP = () => {};
const REMOTE_MEDIA_URL_PATTERN = /^(https?:|blob:|data:)/i;

function isAbsoluteLocalPath(resource: string) {
	return (
		resource.startsWith("/") ||
		/^[A-Za-z]:[\\/]/.test(resource) ||
		/^\\\\[^\\]+\\[^\\]+/.test(resource)
	);
}

function getLocalFilePath(resource: string) {
	if (/^file:\/\//i.test(resource)) {
		return fromFileUrl(resource);
	}

	return isAbsoluteLocalPath(resource) ? resource : null;
}

function getNormalizedResourceUrl(resource: string) {
	const localFilePath = getLocalFilePath(resource);
	if (!localFilePath) {
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

export async function resolveMediaElementSource(resource: string): Promise<{
	src: string;
	revoke: () => void;
}> {
	if (!resource || REMOTE_MEDIA_URL_PATTERN.test(resource)) {
		return { src: resource, revoke: NOOP };
	}

	const normalizedResource = getNormalizedResourceUrl(resource);
	const localFilePath = getLocalFilePath(resource) ?? getLocalFilePath(normalizedResource);
	if (!localFilePath || typeof window === "undefined" || !window.electronAPI?.readLocalFile) {
		return { src: normalizedResource, revoke: NOOP };
	}

	try {
		const result = await window.electronAPI.readLocalFile(localFilePath);
		if (!result.success || !result.data) {
			return { src: normalizedResource, revoke: NOOP };
		}

		const bytes =
			result.data instanceof Uint8Array ? result.data : new Uint8Array(result.data);
		const blob = new Blob([Uint8Array.from(bytes)], { type: inferMimeType(localFilePath) });
		const objectUrl = URL.createObjectURL(blob);

		return {
			src: objectUrl,
			revoke: () => {
				URL.revokeObjectURL(objectUrl);
			},
		};
	} catch {
		return { src: normalizedResource, revoke: NOOP };
	}
}
