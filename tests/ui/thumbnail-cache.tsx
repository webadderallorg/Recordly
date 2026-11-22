import { useState } from "react";
import { createRoot } from "react-dom/client";
import { RecordingThumbnail } from "@/components/video-editor/library/RecordingThumbnail";
import { useWallpaperPreviews } from "@/components/video-editor/useWallpaperPreviews";
import { WallpaperGrid } from "@/components/video-editor/WallpaperGrid";
import { I18nProvider } from "@/contexts/I18nContext";
import { ThemeProvider } from "@/contexts/ThemeContext";
import "@/index.css";

let requests = 0;
const wallpaperMode = location.search.includes("wallpapers");
window.electronAPI = {
	getAssetBasePath: async () => "file:///Applications/Recordly.app/Contents/Resources/assets/",
	generateWallpaperThumbnail: async (path: string) => {
		if (path.includes("golden-gate"))
			return new Promise(() => {
				/* Simulate a decoder that has not completed. */
			});
		const response = await fetch("/tests/ui/fixtures/recording-thumbnail.jpg");
		return { success: true, data: new Uint8Array(await response.arrayBuffer()) };
	},
	getRecordingThumbnail: async () => {
		document.documentElement.dataset.requests = String(++requests);
		return { success: true, value: "/tests/ui/fixtures/recording-thumbnail.jpg" };
	},
} as unknown as typeof window.electronAPI;
function Fixture() {
	const [shown, setShown] = useState(true);
	const [bytes, setBytes] = useState(100);
	return (
		<main>
			<button onClick={() => setShown((value) => !value)}>Toggle row</button>
			<button onClick={() => setBytes((value) => value + 1)}>Change recording</button>
			{shown && (
				<RecordingThumbnail
					entry={{
						path: "/recordings/clip.mp4",
						name: "Clip",
						bytes,
						createdAt: 1,
						url: "",
					}}
				/>
			)}
		</main>
	);
}
function Wallpapers() {
	const { wallpapers, previews } = useWallpaperPreviews(true);
	return (
		<WallpaperGrid
			items={wallpapers
				.filter((wallpaper) => !wallpaper.publicPath.endsWith(".mp4"))
				.map((wallpaper) => ({
					key: wallpaper.id,
					value: wallpaper.publicPath,
					label: wallpaper.label,
					previewUrl: previews[wallpaper.publicPath] ?? "",
				}))}
			addLabel="Add wallpaper"
			onAdd={() => undefined}
			onSelect={() => undefined}
			onRemove={() => undefined}
			isSelected={() => false}
		/>
	);
}
createRoot(document.getElementById("root")!).render(
	<ThemeProvider>
		<I18nProvider>{wallpaperMode ? <Wallpapers /> : <Fixture />}</I18nProvider>
	</ThemeProvider>,
);
