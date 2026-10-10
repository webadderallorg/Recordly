import path from "node:path";

export const MEDIA_CONTENT_TYPES: Record<string, string> = {
	".mp4": "video/mp4",
	".webm": "video/webm",
	".mov": "video/quicktime",
	".mkv": "video/x-matroska",
	".avi": "video/x-msvideo",
	".wav": "audio/wav",
	".mp3": "audio/mpeg",
	".ogg": "audio/ogg",
	".m4a": "audio/mp4",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
};

/**
 * Resolves the MIME content type for a given local media file path.
 *
 * @param filePath - Local path to the media file.
 * @returns Standard MIME type string or application/octet-stream fallback.
 */
export function getMediaContentType(filePath: string): string {
	return MEDIA_CONTENT_TYPES[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

/**
 * Checks whether the file extension of a given path is a supported media format.
 *
 * @param filePath - Local path to the media file.
 * @returns Boolean indicating whether the format is supported.
 */
export function isSupportedLocalMediaPath(filePath: string): boolean {
	return path.extname(filePath).toLowerCase() in MEDIA_CONTENT_TYPES;
}
