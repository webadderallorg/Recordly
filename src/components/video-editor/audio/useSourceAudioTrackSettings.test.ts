import { expect, it, vi } from "vitest";
import type { SourceAudioTrackSettings } from "./audioTypes";
import { useSourceAudioTrackSettings } from "./useSourceAudioTrackSettings";

vi.mock("react", () => ({
	useCallback: (callback: unknown) => callback,
	useMemo: (factory: () => unknown) => factory(),
	useState: (value: unknown) => [value, vi.fn()],
}));

it("preserves saved source volume while metadata disappears and rediscovers tracks", () => {
	const settings = { mixed: { volume: 0.7, normalize: true } };
	let defaults: SourceAudioTrackSettings = settings;
	const setDefaults = vi.fn((update: React.SetStateAction<SourceAudioTrackSettings>) => {
		defaults = typeof update === "function" ? update(defaults) : update;
	});
	const setByClip = vi.fn();
	const render = () => useSourceAudioTrackSettings({
		selectedClipId: "clip-1",
		activeClipId: "clip-1",
		sourceAudioTrackSettingsByClip: {},
		setSourceAudioTrackSettingsByClip: setByClip,
		defaultSourceAudioTrackSettings: defaults,
		setDefaultSourceAudioTrackSettings: setDefaults,
	});
	const audio = render();
	audio.onSourceAudioTracksMetaChange([]);
	audio.onSourceAudioTracksMetaChange([{ id: "mixed", label: "Recording" }]);
	audio.onSourceAudioTracksMetaChange([{ id: "system", label: "System audio" }]);
	expect(setByClip).not.toHaveBeenCalled();
	expect(setDefaults).not.toHaveBeenCalled();
	const restored = render();
	expect(restored.getSourceAudioTrackSettingsForClip("clip-1").mixed).toEqual(settings.mixed);
	expect(restored.activeSourceAudioTrackSettings.mixed.volume).toBe(0.7);
});
