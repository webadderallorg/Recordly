import { useEffect, useState } from "react";
import { getRenderableAssetUrl, getWallpaperThumbnailUrl } from "@/lib/assetPath";
import { DESKTOP_WALLPAPER } from "@/lib/desktopWallpaper";
import {
	BUILT_IN_WALLPAPERS,
	getAvailableWallpapers,
	isVideoWallpaperSource,
} from "@/lib/wallpapers";

/** Keep ready previews visible while other thumbnails are still being decoded. */
export function useWallpaperPreviews(enabled: boolean) {
	const [wallpapers, setWallpapers] = useState(BUILT_IN_WALLPAPERS);
	const [previews, setPreviews] = useState<Record<string, string>>({});
	useEffect(() => {
		if (!enabled) return;
		let mounted = true;
		let loading = false;
		let desktopUnavailable = true;
		let retry = 0;
		let retryTimer: ReturnType<typeof setTimeout> | undefined;
		const retryDelays = [1000, 3000, 10000];
		const refresh = () => {
			if (!mounted || loading) return;
			clearTimeout(retryTimer);
			loading = true;
			void getAvailableWallpapers()
				.then((available) => {
					if (!mounted) return;
					desktopUnavailable = !available.some(
						(wallpaper) => wallpaper.id === DESKTOP_WALLPAPER,
					);
					setWallpapers(available);
					for (const wallpaper of available) {
						if (isVideoWallpaperSource(wallpaper.publicPath)) continue;
						if (wallpaper.id === DESKTOP_WALLPAPER) {
							// Keep the desktop image visible while its smaller thumbnail is queued.
							void getRenderableAssetUrl(wallpaper.publicPath)
								.then((previewUrl) => {
									if (mounted)
										setPreviews((previous) =>
											previous[wallpaper.publicPath]
												? previous
												: {
														...previous,
														[wallpaper.publicPath]: previewUrl,
													},
										);
								})
								.catch(() => undefined);
						}
						// Use the bundled path so HTTP asset transport cannot bypass thumbnail generation.
						void getWallpaperThumbnailUrl(wallpaper.publicPath)
							.then((previewUrl) => {
								if (mounted)
									setPreviews((previous) => ({
										...previous,
										[wallpaper.publicPath]: previewUrl,
									}));
							})
							.catch(() => undefined);
					}
				})
				.catch(() => undefined)
				.finally(() => {
					loading = false;
					// A timed-out OS snapshot must not leave the reserved desktop tile disabled
					// for the entire editor session. Stop polling after a few attempts.
					if (
						mounted &&
						desktopUnavailable &&
						typeof window.electronAPI?.getDesktopWallpaper === "function" &&
						retry < retryDelays.length
					) {
						retryTimer = setTimeout(refresh, retryDelays[retry++]);
					}
				});
		};
		const retryOnFocus = () => {
			if (desktopUnavailable) refresh();
		};
		refresh();
		window.addEventListener("focus", retryOnFocus);
		return () => {
			mounted = false;
			clearTimeout(retryTimer);
			window.removeEventListener("focus", retryOnFocus);
		};
	}, [enabled]);
	return { wallpapers, previews };
}
