import { isVideoWallpaperSource } from "@/lib/wallpapers";

// A restrained mix of warm, cool, light, and dark backgrounds.
export const GRADIENTS = [
	"linear-gradient(135deg, #dbeafe 0%, #a5b4fc 100%)",
	"linear-gradient(135deg, #e0e7ff 0%, #c4b5fd 100%)",
	"linear-gradient(135deg, #f3e8ff 0%, #fbcfe8 100%)",
	"linear-gradient(135deg, #ffe4e6 0%, #fed7aa 100%)",
	"linear-gradient(135deg, #ffedd5 0%, #fde68a 100%)",
	"linear-gradient(135deg, #d1fae5 0%, #a5f3fc 100%)",
	"linear-gradient(135deg, #cffafe 0%, #93c5fd 100%)",
	"linear-gradient(135deg, #e2e8f0 0%, #94a3b8 100%)",
	"linear-gradient(135deg, #64748b 0%, #1e293b 100%)",
	"linear-gradient(135deg, #312e81 0%, #6366f1 100%)",
	"linear-gradient(135deg, #0f172a 0%, #155e75 100%)",
	"linear-gradient(135deg, #134e4a 0%, #5eead4 100%)",
	"linear-gradient(135deg, #7c3aed 0%, #c084fc 100%)",
	"linear-gradient(135deg, #be185d 0%, #fb7185 100%)",
];

export type BackgroundTab = "image" | "video" | "colors";
export function isHexWallpaper(value: string): boolean {
	return /^#(?:[0-9a-f]{3}){1,2}$/i.test(value);
}

export function getBackgroundTabForWallpaper(value: string): BackgroundTab {
	if (value.startsWith("linear-gradient(") || value.startsWith("radial-gradient(")) {
		return "colors";
	}

	if (isHexWallpaper(value)) {
		return "colors";
	}

	if (isVideoWallpaperSource(value)) {
		return "video";
	}

	return "image";
}

export type WallpaperTile = {
	key: string;
	label: string;
	value: string;
	previewUrl: string;
	disabled?: boolean;
	badge?: string;
};

// Together with the gradients: 24 selections, matching Image (including Desktop).
export const colorPalette = [
	"#FFFFFF",
	"#E2E8F0",
	"#94A3B8",
	"#334155",
	"#000000",
	"#BFDBFE",
	"#C4B5FD",
	"#FBCFE8",
	"#FED7AA",
	"#A7F3D0",
];
