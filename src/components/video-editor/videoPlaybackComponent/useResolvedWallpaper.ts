import { useEffect } from "react";
import { getAssetPath, getRenderableAssetUrl } from "@/lib/assetPath";
import {
	DEFAULT_WALLPAPER_PATH,
	DEFAULT_WALLPAPER_RELATIVE_PATH,
	isVideoWallpaperSource,
} from "@/lib/wallpapers";

interface UseResolvedWallpaperParams {
	wallpaper?: string;
	setResolvedWallpaper: (value: string | null) => void;
	setResolvedWallpaperKind: (value: "image" | "video" | "style") => void;
}

export function useResolvedWallpaper({
	wallpaper,
	setResolvedWallpaper,
	setResolvedWallpaperKind,
}: UseResolvedWallpaperParams) {
	useEffect(() => {
		let mounted = true;
		(async () => {
			try {
				if (!wallpaper) {
					const defaultWallpaper = await getAssetPath(DEFAULT_WALLPAPER_RELATIVE_PATH);
					if (mounted) {
						setResolvedWallpaper(defaultWallpaper);
						setResolvedWallpaperKind("image");
					}
					return;
				}

				if (
					wallpaper.startsWith("#") ||
					wallpaper.startsWith("linear-gradient") ||
					wallpaper.startsWith("radial-gradient")
				) {
					if (mounted) {
						setResolvedWallpaper(wallpaper);
						setResolvedWallpaperKind("style");
					}
					return;
				}

				if (isVideoWallpaperSource(wallpaper)) {
					let videoSrc = wallpaper;
					if (wallpaper.startsWith("/") && !wallpaper.startsWith("//")) {
						videoSrc = await getAssetPath(wallpaper.replace(/^\//, ""));
					}
					if (mounted) {
						setResolvedWallpaper(videoSrc);
						setResolvedWallpaperKind("video");
					}
					return;
				}

				if (wallpaper.startsWith("data:")) {
					if (mounted) {
						setResolvedWallpaper(wallpaper);
						setResolvedWallpaperKind("image");
					}
					return;
				}

				if (
					wallpaper.startsWith("http") ||
					wallpaper.startsWith("file://") ||
					wallpaper.startsWith("/")
				) {
					const renderable = await getRenderableAssetUrl(wallpaper);
					if (mounted) {
						setResolvedWallpaper(renderable);
						setResolvedWallpaperKind("image");
					}
					return;
				}

				const resolved = await getRenderableAssetUrl(
					await getAssetPath(wallpaper.replace(/^\//, "")),
				);
				if (mounted) {
					setResolvedWallpaper(resolved);
					setResolvedWallpaperKind("image");
				}
			} catch {
				if (mounted) {
					setResolvedWallpaper(wallpaper || DEFAULT_WALLPAPER_PATH);
					setResolvedWallpaperKind(
						isVideoWallpaperSource(wallpaper || "") ? "video" : "image",
					);
				}
			}
		})();

		return () => {
			mounted = false;
		};
	}, [setResolvedWallpaper, setResolvedWallpaperKind, wallpaper]);
}