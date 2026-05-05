export interface BuiltInWallpaper {
	id: string;
	label: string;
	relativePath: string;
	publicPath: string;
}

const IMAGE_FILE_PATTERN = /\.(avif|gif|jpe?g|png|svg|webp)$/i;
const VIDEO_FILE_PATTERN = /\.(avi|m4v|mkv|mov|mp4|webm)$/i;

export const BUILT_IN_WALLPAPERS: BuiltInWallpaper[] = [
	createWallpaperEntry("tahoe-light.jpg", "Tahoe Light"),
	createWallpaperEntry("tahoe-dark.jpg", "Tahoe Dark"),
	createWallpaperEntry("midnight-8.jpg", "Midnight 8"),
	createWallpaperEntry("ipad-17-dark.jpg", "iPad 17 Dark"),
	createWallpaperEntry("ipad-17-light.jpg", "iPad 17 Light"),
	createWallpaperEntry("sequoia-blue.jpg", "Sequoia Blue"),
	createWallpaperEntry("sequoia-blue-orange.jpg", "Sequoia Blue Orange"),
	createWallpaperEntry("ventura.jpg", "Ventura"),
	createWallpaperEntry("sonoma-clouds.jpg", "Sonoma Clouds"),
	createWallpaperEntry("sonoma-light.jpg", "Sonoma Light"),
	createWallpaperEntry("sonoma-dark.jpg", "Sonoma Dark"),
	createWallpaperEntry("glassmorphism-3.jpg", "Glassmorphism 3"),
	createWallpaperEntry("glassmorphism-4.jpg", "Glassmorphism 4"),
	createWallpaperEntry("energy-19.jpg", "Energy 19"),
	createWallpaperEntry("wallpaper3.jpg", "Wallpaper 3"),
	createWallpaperEntry("wallpaper4.jpg", "Wallpaper 4"),
	createWallpaperEntry("cityscape.jpg", "Cityscape"),
	createWallpaperEntry("levels.jpg", "Levels"),
	createWallpaperEntry("wallpaper10.jpg", "Wallpaper 10"),
	createWallpaperEntry("ventura-dark.jpg", "Ventura Dark"),
	createWallpaperEntry("sonoma-evening.jpg", "Sonoma Evening"),
	createWallpaperEntry("sonoma-horizon.jpg", "Sonoma Horizon"),
	createWallpaperEntry("iridescent-9.jpg", "Iridescent 9"),
	createWallpaperEntry("energy-17.jpg", "Energy 17"),
	createWallpaperEntry("wispysky.mp4", "Wispy Sky"),
];

export const WALLPAPER_PATHS = BUILT_IN_WALLPAPERS.map((wallpaper) => wallpaper.publicPath);
export const WALLPAPER_RELATIVE_PATHS = BUILT_IN_WALLPAPERS.map(
	(wallpaper) => wallpaper.relativePath,
);
export const DEFAULT_WALLPAPER_PATH = "/wallpapers/tahoe-light.jpg";
export const DEFAULT_WALLPAPER_RELATIVE_PATH = "wallpapers/tahoe-light.jpg";

export function isVideoWallpaperSource(value: string): boolean {
	if (!value) {
		return false;
	}

	const normalizedValue = value.split("?")[0]?.toLowerCase() ?? value.toLowerCase();
	return VIDEO_FILE_PATTERN.test(normalizedValue);
}

function toWallpaperId(fileName: string) {
	return fileName
		.replace(/\.[^.]+$/, "")
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

function toWallpaperLabel(fileName: string) {
	const baseName = fileName.replace(/\.[^.]+$/, "").trim();
	if (!baseName) {
		return "Wallpaper";
	}

	return baseName
		.replace(/[_-]+/g, " ")
		.replace(/\s+/g, " ")
		.replace(/\b\w/g, (match) => match.toUpperCase());
}

function createWallpaperEntry(fileName: string, label = toWallpaperLabel(fileName)): BuiltInWallpaper {
	const encodedFileName = encodeURIComponent(fileName);
	return {
		id: toWallpaperId(fileName) || `wallpaper-${encodedFileName.toLowerCase()}`,
		label,
		relativePath: `wallpapers/${fileName}`,
		publicPath: `/wallpapers/${encodedFileName}`,
	};
}

export async function getAvailableWallpapers(): Promise<BuiltInWallpaper[]> {
	const fallbackWallpapers = BUILT_IN_WALLPAPERS;

	if (typeof window === "undefined" || !window.electronAPI?.listAssetDirectory) {
		return fallbackWallpapers;
	}

	try {
		const result = await window.electronAPI.listAssetDirectory("wallpapers");
		if (!result.success || !result.files?.length) {
			return fallbackWallpapers;
		}

		const discoveredFiles = new Set(
			result.files.filter(
				(fileName) =>
					IMAGE_FILE_PATTERN.test(fileName) || VIDEO_FILE_PATTERN.test(fileName),
			),
		);

		if (discoveredFiles.size === 0) {
			return fallbackWallpapers;
		}

		const curatedWallpapers = fallbackWallpapers.filter((wallpaper) =>
			discoveredFiles.has(wallpaper.relativePath.replace(/^wallpapers\//, "")),
		);

		return curatedWallpapers.length > 0 ? curatedWallpapers : fallbackWallpapers;
	} catch {
		return fallbackWallpapers;
	}
}
