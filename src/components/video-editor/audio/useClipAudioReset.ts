import type { useTimelineState } from "../state/useTimelineState";

type Input = Pick<
	ReturnType<typeof useTimelineState>,
	| "selectedClipId"
	| "sourceAudioTrackSettingsByClip"
	| "defaultSourceAudioTrackSettings"
	| "setSourceAudioTrackSettingsByClip"
>;

export function useClipAudioReset({
	selectedClipId,
	sourceAudioTrackSettingsByClip,
	defaultSourceAudioTrackSettings,
	setSourceAudioTrackSettingsByClip,
}: Input) {
	const settings = {
		...defaultSourceAudioTrackSettings,
		...(selectedClipId ? sourceAudioTrackSettingsByClip[selectedClipId] : {}),
	};
	return {
		hasClipAudioOverrides:
			selectedClipId !== null &&
			Object.values(settings).some((setting) => setting.volume !== 1 || setting.normalize),
		onResetClipAudio: () => {
			if (!selectedClipId) return;
			setSourceAudioTrackSettingsByClip((current) => {
				const effective = {
					...defaultSourceAudioTrackSettings,
					...current[selectedClipId],
				};
				// Explicit neutral values also override inherited project settings.
				return {
					...current,
					[selectedClipId]: Object.fromEntries(
						Object.keys(effective).map((id) => [id, { volume: 1, normalize: false }]),
					),
				};
			});
		},
	};
}
