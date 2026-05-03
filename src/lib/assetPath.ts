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

	if (isWebContext) {
		return `/${encodedRelativePath}`;
	}

	try {
		if (typeof window !== "undefined") {
			if (typeof window.electronAPI?.getAssetBasePath === "function") {
				const base = await window.electronAPI.getAssetBasePath();
				if (!base) {
					throw new Error(`Failed to resolve asset base path for ${relativePath}`);
				}

				return new URL(encodedRelativePath, ensureTrailingSlash(base)).toString();
			}
		}
	} catch (error) {
		if (!isWebContext) {
			throw error;
		}
	}

	// Fallback for web/dev server: public/wallpapers are served at '/wallpapers/...'
	return `/${encodedRelativePath}`;
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
		availableAsset.startsWith("/") && !availableAsset.startsWith("//")
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
// Concurrency is capped to avoid OOM from loading many full-res images at once.
// ---------------------------------------------------------------------------

const thumbnailCache = new Map<string, string>();

const THUMB_CONCURRENCY = 3;
let thumbActive = 0;
const thumbQueue: Array<() => void> = [];

function acquireThumbSlot(): Promise<void> {
	if (thumbActive < THUMB_CONCURRENCY) {
		thumbActive++;
		return Promise.resolve();
	}
	return new Promise<void>((resolve) => thumbQueue.push(resolve));
}

function releaseThumbSlot(): void {
	const next = thumbQueue.shift();
	if (next) {
		next();
	} else {
		thumbActive--;
	}
}

export async function getWallpaperThumbnailUrl(asset: string): Promise<string> {
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

	const localFilePath = toLocalFilePath(
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

	await acquireThumbSlot();
	try {
		const result = await window.electronAPI.generateWallpaperThumbnail(localFilePath);
		if (!result.success || !result.data) {
			return getRenderableAssetUrl(asset);
		}
		const bytes = result.data instanceof Uint8Array ? result.data : new Uint8Array(result.data);
		const dataUrl = `data:image/jpeg;base64,${toBase64(bytes)}`;
		thumbnailCache.set(asset, dataUrl);
		return dataUrl;
	} catch {
		return getRenderableAssetUrl(asset);
	} finally {
		releaseThumbSlot();
	}
}

export default getAssetPath;
