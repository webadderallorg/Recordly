import { getLocalMediaServerPath } from "./localMediaUrl";
import { resolveAvailableWallpaperPath } from "./wallpapers";

function encodeRelativeAssetPath(relativePath: string): string {
	return relativePath
		.replace(/^\/+/, "")
		.split("/")
		.filter(Boolean)
		.map((part) => encodeURIComponent(part))
		.join("/");
}

function ensureTrailingSlash(value: string): string {
	return value.endsWith("/") ? value : `${value}/`;
}

const WINDOWS_ABSOLUTE_PATH_PATTERN = /^[A-Za-z]:[\\/]/;
const WINDOWS_UNC_PATH_PATTERN = /^\\\\[^\\]+\\[^\\]+/;

function encodeFilePathSegments(pathname: string, keepWindowsDrive = false): string {
	return pathname
		.split("/")
		.map((segment, index) => {
			if (!segment) return "";
			if (keepWindowsDrive && index === 1 && /^[A-Za-z]:$/.test(segment)) {
				return segment;
			}
			return encodeURIComponent(segment);
		})
		.join("/");
}

function toFileUrl(filePath: string): string {
	const normalized = filePath.replace(/\\/g, "/");

	if (WINDOWS_ABSOLUTE_PATH_PATTERN.test(normalized)) {
		return `file://${encodeFilePathSegments(`/${normalized}`, true)}`;
	}

	if (normalized.startsWith("//")) {
		const [host, ...pathParts] = normalized.replace(/^\/+/, "").split("/");
		const encodedPath = pathParts.map((part) => encodeURIComponent(part)).join("/");
		return encodedPath ? `file://${host}/${encodedPath}` : `file://${host}/`;
	}

	const absolutePath = normalized.startsWith("/") ? normalized : `/${normalized}`;
	return `file://${encodeFilePathSegments(absolutePath)}`;
}

export function isAbsoluteLocalAssetPath(asset: string): boolean {
	return (
		asset.startsWith("/") ||
		WINDOWS_ABSOLUTE_PATH_PATTERN.test(asset) ||
		WINDOWS_UNC_PATH_PATTERN.test(asset)
	);
}

export async function getAssetPath(relativePath: string): Promise<string> {
	const encodedRelativePath = encodeRelativeAssetPath(relativePath);
	const isWebContext =
		typeof window !== "undefined" && Boolean(window.location?.protocol?.startsWith("http"));

	try {
		if (typeof window !== "undefined") {
			if (typeof window.electronAPI?.getAssetBasePath === "function") {
				const base = await window.electronAPI.getAssetBasePath();
				if (base) {
					// Keep native export's filesystem metadata in the bridge, while
					// HTTP renderers load bundled files through their own origin.
					if (base.startsWith("file:") && isWebContext && window.location.origin) {
						return new URL(
							`__recordly_assets/${encodedRelativePath}`,
							`${window.location.origin}/`,
						).toString();
					}
					return new URL(encodedRelativePath, ensureTrailingSlash(base)).toString();
				}
			}
		}
	} catch (error) {
		if (!isWebContext) {
			throw error;
		}
	}

	if (isWebContext) {
		// Dev and browser contexts serve public assets from the site root. Packaged
		// Electron windows resolve above to the single extraResources asset copy.
		return `/${encodedRelativePath}`;
	}

	throw new Error(`Failed to resolve asset base path for ${relativePath}`);
}

const BASE64_CHUNK_SIZE = 0x8000;
const localFileDataUrlCache = new Map<string, string>();

function toLocalFilePath(resourceUrl: string) {
	if (!resourceUrl.startsWith("file://")) {
		return null;
	}

	const decodedPath = decodeURIComponent(resourceUrl.replace(/^file:\/\//, ""));
	if (/^\/[A-Za-z]:/.test(decodedPath)) {
		return decodedPath.slice(1);
	}

	return decodedPath;
}

function getMimeTypeForAsset(resourceUrl: string) {
	const normalized = resourceUrl.split("?")[0].toLowerCase();

	if (normalized.endsWith(".png")) return "image/png";
	if (normalized.endsWith(".webp")) return "image/webp";
	if (normalized.endsWith(".gif")) return "image/gif";
	if (normalized.endsWith(".svg")) return "image/svg+xml";
	if (normalized.endsWith(".avif")) return "image/avif";
	return "image/jpeg";
}

function toBase64(bytes: Uint8Array) {
	let binary = "";

	for (let index = 0; index < bytes.length; index += BASE64_CHUNK_SIZE) {
		const chunk = bytes.subarray(index, index + BASE64_CHUNK_SIZE);
		binary += String.fromCharCode(...chunk);
	}

	return btoa(binary);
}

export async function getRenderableAssetUrl(asset: string): Promise<string> {
	if (
		!asset ||
		asset.startsWith("data:") ||
		asset.startsWith("http") ||
		asset.startsWith("#") ||
		asset.startsWith("linear-gradient") ||
		asset.startsWith("radial-gradient")
	) {
		return asset;
	}

	const availableAsset = await resolveAvailableWallpaperPath(asset);
	const resolvedAsset =
		isAbsoluteLocalAssetPath(availableAsset) && !isBundledAssetPath(availableAsset)
			? toFileUrl(availableAsset)
			: isBundledAssetPath(availableAsset)
				? await getAssetPath(availableAsset.replace(/^\//, ""))
				: availableAsset;

	const localFilePath = toLocalFilePath(resolvedAsset);
	if (!localFilePath || typeof window === "undefined" || !window.electronAPI?.readLocalFile) {
		return resolvedAsset;
	}

	const cached = localFileDataUrlCache.get(resolvedAsset);
	if (cached) {
		return cached;
	}

	try {
		const result = await window.electronAPI.readLocalFile(localFilePath);
		if (!result.success || !result.data) {
			return resolvedAsset;
		}

		const bytes = result.data instanceof Uint8Array ? result.data : new Uint8Array(result.data);
		const dataUrl = `data:${getMimeTypeForAsset(localFilePath)};base64,${toBase64(bytes)}`;
		localFileDataUrlCache.set(resolvedAsset, dataUrl);
		return dataUrl;
	} catch {
		return resolvedAsset;
	}
}

async function resolveLocalMediaUrl(filePath: string): Promise<string> {
	if (typeof window !== "undefined" && window.electronAPI?.getLocalMediaUrl) {
		try {
			const result = await window.electronAPI.getLocalMediaUrl(filePath);
			if (result.success && result.url) {
				return result.url;
			}
		} catch {
			// Fall through to a file URL when the media server is unavailable.
		}
	}

	return toFileUrl(filePath);
}

function isBundledAssetPath(asset: string): boolean {
	return asset.startsWith("/wallpapers/") || asset.startsWith("/app-icons/");
}

export async function getRenderableVideoUrl(asset: string): Promise<string> {
	const serverPath = getLocalMediaServerPath(asset);
	if (serverPath) return resolveLocalMediaUrl(serverPath);
	const localFilePath = toLocalFilePath(asset);
	if (localFilePath) return resolveLocalMediaUrl(localFilePath);
	if (
		!asset ||
		asset.startsWith("blob:") ||
		asset.startsWith("data:") ||
		asset.startsWith("file://") ||
		asset.startsWith("http")
	) {
		return asset;
	}

	if (isAbsoluteLocalAssetPath(asset) && !isBundledAssetPath(asset)) {
		return resolveLocalMediaUrl(asset);
	}

	if (asset.startsWith("/") && !asset.startsWith("//")) {
		return getAssetPath(asset.replace(/^\/+/, ""));
	}

	return asset;
}

export async function getExportableVideoUrl(asset: string): Promise<string> {
	if (
		!asset ||
		asset.startsWith("blob:") ||
		asset.startsWith("data:") ||
		asset.startsWith("file://") ||
		asset.startsWith("http")
	) {
		return asset;
	}

	if (isAbsoluteLocalAssetPath(asset) && !isBundledAssetPath(asset)) {
		return toFileUrl(asset);
	}

	if (asset.startsWith("/") && !asset.startsWith("//")) {
		return getAssetPath(asset.replace(/^\/+/, ""));
	}

	return asset;
}

// ---------------------------------------------------------------------------
// Wallpaper thumbnail helper — generates a tiny JPEG thumbnail via the main
// process (nativeImage resize) and returns a data URL for fast grid rendering.
// The main process serializes cache misses; disk cache hits can return immediately.
// ---------------------------------------------------------------------------

const thumbnailCache = new Map<string, string>();
const pendingThumbnails = new Map<string, Promise<string>>();
const MAX_THUMBNAILS = 200;

export function peekWallpaperThumbnailUrl(asset: string): string | undefined {
	return thumbnailCache.get(asset);
}

export function getWallpaperThumbnailUrl(asset: string): Promise<string> {
	const cached = thumbnailCache.get(asset);
	if (cached) return Promise.resolve(cached);
	const pending = pendingThumbnails.get(asset);
	if (pending) return pending;
	const task = loadWallpaperThumbnail(asset).finally(() => pendingThumbnails.delete(asset));
	pendingThumbnails.set(asset, task);
	return task;
}

async function loadWallpaperThumbnail(asset: string): Promise<string> {
	if (
		!asset ||
		asset.startsWith("data:") ||
		asset.startsWith("http") ||
		asset.startsWith("#") ||
		asset.startsWith("linear-gradient") ||
		asset.startsWith("radial-gradient")
	) {
		return asset;
	}

	const cached = thumbnailCache.get(asset);
	if (cached) return cached;

	const localFilePath =
		(asset.startsWith("/wallpapers/") ? asset : null) ??
		(isAbsoluteLocalAssetPath(asset) && !isBundledAssetPath(asset) ? asset : null) ??
		toLocalFilePath(
			asset.startsWith("/") && !asset.startsWith("//")
				? await getAssetPath(asset.replace(/^\//, ""))
				: asset,
		);
	if (
		!localFilePath ||
		typeof window === "undefined" ||
		!window.electronAPI?.generateWallpaperThumbnail
	) {
		return getRenderableAssetUrl(asset);
	}

	try {
		const result = await window.electronAPI.generateWallpaperThumbnail(localFilePath);
		if (!result.success || !result.data) {
			return getRenderableAssetUrl(asset);
		}
		const bytes = result.data instanceof Uint8Array ? result.data : new Uint8Array(result.data);
		const dataUrl = `data:image/jpeg;base64,${toBase64(bytes)}`;
		thumbnailCache.set(asset, dataUrl);
		if (thumbnailCache.size > MAX_THUMBNAILS) {
			thumbnailCache.delete(thumbnailCache.keys().next().value!);
		}
		return dataUrl;
	} catch {
		return getRenderableAssetUrl(asset);
	}
}

export default getAssetPath;
