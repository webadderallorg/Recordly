import { expect, it } from "vitest";
import { collectLibrarySourceProtection } from "./librarySourceProtection";
it("includes unsaved clips/audio/webcam/background media and history without modifying the snapshot", () => {
	const snapshot = {
		videoPath: "/r/main.mp4",
		editor: {
			clipRegions: [{ sourcePath: "/r/other.mp4" }],
			audioRegions: [{ audioUrl: "file:///r/music.wav" }],
			webcamPath: "/r/webcam.webm",
			wallpaper: "/r/background.mp4",
		},
		history: [{ videoPath: "/r/old.mp4" }],
		text: "hello",
	};
	const before = JSON.stringify(snapshot);
	expect(collectLibrarySourceProtection(snapshot)).toEqual([
		"/r/main.mp4",
		"/r/other.mp4",
		"file:///r/music.wav",
		"/r/webcam.webm",
		"/r/background.mp4",
		"/r/old.mp4",
	]);
	expect(JSON.stringify(snapshot)).toBe(before);
});
