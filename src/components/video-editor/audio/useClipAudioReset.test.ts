import { describe, expect, it } from "vitest";
import type { SourceAudioTrackSettings } from "./audioTypes";
import { useClipAudioReset } from "./useClipAudioReset";

function harness(selectedClipId: string | null, defaults: SourceAudioTrackSettings = {}) {
	let saved = {
		selected: { mic: { volume: 0, normalize: true } },
		other: { mic: { volume: 0.4, normalize: true } },
	} as Record<string, SourceAudioTrackSettings>;
	const initial = saved;
	const render = () =>
		useClipAudioReset({
			selectedClipId,
			defaultSourceAudioTrackSettings: defaults,
			sourceAudioTrackSettingsByClip: saved,
			setSourceAudioTrackSettingsByClip: (update) => {
				saved = typeof update === "function" ? update(saved) : update;
			},
		});
	return { render, initial, read: () => saved };
}

describe("saved clip audio recovery", () => {
	it("restores silent saved tracks and clears normalization only for the selected clip", () => {
		const state = harness("selected");
		expect(state.render().hasClipAudioOverrides).toBe(true);
		state.render().onResetClipAudio();
		expect(state.read().selected.mic).toEqual({ volume: 1, normalize: false });
		expect(state.read().other).toBe(state.initial.other);
		expect(state.initial.selected.mic.volume).toBe(0);
		expect(state.render().hasClipAudioOverrides).toBe(false);
		// These settings are serialized directly in the project, so recovery survives reload.
		expect(JSON.parse(JSON.stringify(state.read())).selected.mic.volume).toBe(1);
	});

	it("neutralizes inherited settings without changing defaults or other clips", () => {
		const defaults = { system: { volume: 0, normalize: true } };
		const state = harness("new-clip", defaults);
		expect(state.render().hasClipAudioOverrides).toBe(true);
		state.render().onResetClipAudio();
		expect({ ...defaults, ...state.read()["new-clip"] }).toEqual({
			system: { volume: 1, normalize: false },
		});
		expect(defaults.system.volume).toBe(0);
		expect(state.read().selected).toBe(state.initial.selected);
		expect(state.render().hasClipAudioOverrides).toBe(false);
	});

	it("does nothing without a selection and hides recovery for untouched clips", () => {
		const state = harness(null);
		expect(state.render().hasClipAudioOverrides).toBe(false);
		state.render().onResetClipAudio();
		expect(state.read()).toBe(state.initial);
		expect(harness("new-clip").render().hasClipAudioOverrides).toBe(false);
	});
});
