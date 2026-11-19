import { useEffect } from "react";
import { createRoot } from "react-dom/client";
import { I18nProvider } from "@/contexts/I18nContext";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { DEFAULT_EDITOR_PREFERENCES } from "@/components/video-editor/editorPreferences";
import { BackgroundSettings } from "@/components/video-editor/settings/BackgroundSettings";
import { useBackgroundSettings } from "@/components/video-editor/settings/useBackgroundSettings";
import { useAppearanceState } from "@/components/video-editor/state/useAppearanceState";
import "@/index.css";

const desktop = `/recordly/desktop-wallpapers/${"a".repeat(64)}.png`;
let finish: (value: { success: boolean; path?: string }) => void;
const result = new Promise<{ success: boolean; path?: string }>((resolve) => {
	finish = resolve;
});
const image = fetch("/wallpapers/tahoe-dark.jpg").then(
	async (response) => new Uint8Array(await response.arrayBuffer()),
);
let desktopRequests = 0;
Object.assign(window, {
	electronAPI: {
		getDesktopWallpaper: () =>
			result.then((value) => {
				desktopRequests += 1;
				return location.search.includes("retry-desktop") && desktopRequests === 1
					? { success: false }
					: value;
			}),
		getAssetBasePath: async () => null,
		readLocalFile: async () => ({ success: true, data: await image }),
		generateWallpaperThumbnail: async (path: string) => {
			if (
				location.search.includes("pending-thumbnail") &&
				path.includes("desktop-wallpapers")
			)
				return new Promise(() => {
					// Simulate a thumbnail that remains queued during the test.
				});
			return { success: false };
		},
	},
});
const preferences = {
	...DEFAULT_EDITOR_PREFERENCES,
	...(location.search.includes("explicit") ? { wallpaper: "#112233" } : {}),
	customWallpapers: [
		"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16'%3E%3Cpath fill='%23d19' d='M0 0h16v16H0z'/%3E%3C/svg%3E",
	],
};
function Preview() {
	const appearance = useAppearanceState(preferences);
	const { wallpaper, setWallpaper } = appearance;
	const background = useBackgroundSettings(
		{ selected: wallpaper, onWallpaperChange: setWallpaper },
		preferences,
		true,
	);
	useEffect(() => {
		if (location.search.includes("restore")) setWallpaper("/wallpapers/tahoe-light.jpg");
	}, [setWallpaper]);
	return (
		<main className="mx-auto mt-8 w-80 space-y-4">
			<button onClick={() => finish({ success: true, path: desktop })}>
				Make desktop available
			</button>
			<button onClick={() => finish({ success: false })}>Desktop unavailable</button>
			<button onClick={() => setWallpaper("#abcdef")}>
				Choose a color before desktop loads
			</button>
			<output data-testid="selected-wallpaper">{wallpaper}</output>
			<BackgroundSettings background={background} onWallpaperChange={setWallpaper} />
		</main>
	);
}
createRoot(document.getElementById("root")!).render(
	<I18nProvider>
		<ThemeProvider>
			<Preview />
		</ThemeProvider>
	</I18nProvider>,
);
