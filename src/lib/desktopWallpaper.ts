export const DESKTOP_WALLPAPER = "desktop-wallpaper";

let pending: Promise<string | null> | undefined;
let bridge: Window["electronAPI"] | undefined;

/** Share one immutable desktop-image snapshot between editor startup and the picker. */
export function getDesktopWallpaperPath(): Promise<string | null> {
	const api = typeof window === "undefined" ? undefined : window.electronAPI;
	if (!api?.getDesktopWallpaper) return Promise.resolve(null);
	if (bridge !== api) {
		bridge = api;
		pending = undefined;
	}
	if (!pending) {
		const task: Promise<string | null> = Promise.resolve()
			.then(() => api.getDesktopWallpaper())
			.then((result) => (result.success && result.path ? result.path : null))
			.catch(() => null)
			.finally(() => {
				if (pending === task) pending = undefined;
			});
		pending = task;
	}
	return pending;
}

/** Preferences follow the desktop; saved projects retain their concrete snapshot path. */
export function desktopWallpaperPreference(wallpaper: string): string {
	return /(?:^|[\\/])desktop-wallpapers[\\/][a-f0-9]{64}\.png$/i.test(wallpaper)
		? DESKTOP_WALLPAPER
		: wallpaper;
}
