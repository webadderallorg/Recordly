import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { DEFAULT_EDITOR_PREFERENCES } from "../editorPreferences";
import { useExportSettings } from "./useExportSettings";

it.each([false, true])("honors frame rate regardless of Advanced (%s)", (advanced) => {
	const preferences = {
		...DEFAULT_EDITOR_PREFERENCES,
		advancedExportSettings: advanced,
		mp4FrameRate: 60 as const,
		gifFrameRate: 30 as const,
		exportEncodingMode: "quality" as const,
	};
	let settings!: ReturnType<typeof useExportSettings>;
	function Capture() {
		settings = useExportSettings(preferences, [], []);
		return null;
	}
	renderToStaticMarkup(<Capture />);
	expect(settings).toMatchObject({
		mp4FrameRate: 60,
		gifFrameRate: 30,
		exportEncodingMode: advanced ? "quality" : "balanced",
	});
	// Turning the disclosure off must not erase a user's saved overrides.
	expect(preferences.mp4FrameRate).toBe(60);
	expect(preferences.exportEncodingMode).toBe("quality");
});
