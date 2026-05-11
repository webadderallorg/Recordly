import React, { useCallback, useMemo, useState } from "react";
import type {
	SourceAudioTrackMeta,
	SourceAudioTrackSettings,
} from "@/components/video-editor/audio/audioTypes";

interface UseSourceAudioTrackSettingsParams {
  selectedClipId: string | null;
  activeClipId: string | null;
  sourceAudioTrackSettingsByClip: Record<string, SourceAudioTrackSettings>;
  setSourceAudioTrackSettingsByClip: React.Dispatch<
    React.SetStateAction<Record<string, SourceAudioTrackSettings>>
  >;
  defaultSourceAudioTrackSettings: SourceAudioTrackSettings;
  setDefaultSourceAudioTrackSettings: React.Dispatch<React.SetStateAction<SourceAudioTrackSettings>>;
}

export interface UseSourceAudioTrackSettingsResult {
  sourceAudioTrackMeta: SourceAudioTrackMeta;
  activeSourceAudioTrackSettings: SourceAudioTrackSettings;
  selectedClipSourceAudioTrackSettings: SourceAudioTrackSettings;
  getSourceAudioTrackSettingsForClip: (clipId: string | null) => SourceAudioTrackSettings;
  onSourceAudioTracksMetaChange: (tracks: SourceAudioTrackMeta) => void;
  onSelectedClipSourceAudioTrackVolumeChange: (id: string, volume: number) => void;
  onSelectedClipSourceAudioTrackNormalizeChange: (id: string, normalize: boolean) => void;
}

function isSameTrackMeta(left: SourceAudioTrackMeta, right: SourceAudioTrackMeta): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const leftTrack = left[index];
    const rightTrack = right[index];
    if (!leftTrack || !rightTrack) return false;
    if (leftTrack.id !== rightTrack.id || leftTrack.label !== rightTrack.label) {
      return false;
    }
  }
  return true;
}

export function useSourceAudioTrackSettings({
  selectedClipId,
  activeClipId,
  sourceAudioTrackSettingsByClip,
  setSourceAudioTrackSettingsByClip,
  defaultSourceAudioTrackSettings,
  setDefaultSourceAudioTrackSettings,
}: UseSourceAudioTrackSettingsParams): UseSourceAudioTrackSettingsResult {
  const [sourceAudioTrackMeta, setSourceAudioTrackMeta] = useState<SourceAudioTrackMeta>([]);

  const activeSourceAudioTrackSettings = useMemo(() => {
    if (!activeClipId) {
      return defaultSourceAudioTrackSettings;
    }
    return {
      ...defaultSourceAudioTrackSettings,
      ...(sourceAudioTrackSettingsByClip[activeClipId] ?? {}),
    };
  }, [activeClipId, defaultSourceAudioTrackSettings, sourceAudioTrackSettingsByClip]);

  const selectedClipSourceAudioTrackSettings = useMemo(() => {
    if (!selectedClipId) {
      return defaultSourceAudioTrackSettings;
    }
    return {
      ...defaultSourceAudioTrackSettings,
      ...(sourceAudioTrackSettingsByClip[selectedClipId] ?? {}),
    };
  }, [defaultSourceAudioTrackSettings, selectedClipId, sourceAudioTrackSettingsByClip]);

  const onSourceAudioTracksMetaChange = useCallback((tracks: SourceAudioTrackMeta) => {
    setSourceAudioTrackMeta((prev) => (isSameTrackMeta(prev, tracks) ? prev : tracks));
    setDefaultSourceAudioTrackSettings((prev) => {
      const next: SourceAudioTrackSettings = {};
      for (const track of tracks) {
        next[track.id] = prev[track.id] ?? { volume: 1, normalize: false };
      }
      const prevKeys = Object.keys(prev);
      const nextKeys = Object.keys(next);
      if (prevKeys.length !== nextKeys.length) {
        return next;
      }
      for (const key of nextKeys) {
        const prevSetting = prev[key];
        const nextSetting = next[key];
        if (!prevSetting || !nextSetting) {
          return next;
        }
        if (
          prevSetting.volume !== nextSetting.volume ||
          prevSetting.normalize !== nextSetting.normalize
        ) {
          return next;
        }
      }
      return prev;
    });
  }, []);

  const getSourceAudioTrackSettingsForClip = useCallback(
    (clipId: string | null): SourceAudioTrackSettings => {
      if (!clipId) {
        return defaultSourceAudioTrackSettings;
      }
      return {
        ...defaultSourceAudioTrackSettings,
        ...(sourceAudioTrackSettingsByClip[clipId] ?? {}),
      };
    },
    [defaultSourceAudioTrackSettings, sourceAudioTrackSettingsByClip],
  );

	const onSelectedClipSourceAudioTrackVolumeChange = useCallback(
		(id: string, volume: number) => {
			if (!selectedClipId) return;
			setSourceAudioTrackSettingsByClip((prev) => {
				const prevClip = prev[selectedClipId] ?? defaultSourceAudioTrackSettings;
				const nextVolume = Number.isFinite(volume)
					? Math.max(0, Math.min(1, volume))
					: (prevClip[id]?.volume ?? 1);
				const prevNormalize = prevClip[id]?.normalize ?? false;
				if (
					prevClip[id]?.volume === nextVolume &&
					prevClip[id]?.normalize === prevNormalize
				) {
					return prev;
				}
				return {
					...prev,
					[selectedClipId]: {
						...prevClip,
						[id]: {
							volume: nextVolume,
							normalize: prevNormalize,
						},
					},
				};
			});
		},
		[defaultSourceAudioTrackSettings, selectedClipId],
	);

	const onSelectedClipSourceAudioTrackNormalizeChange = useCallback(
		(id: string, normalize: boolean) => {
			if (!selectedClipId) return;
			setSourceAudioTrackSettingsByClip((prev) => {
				const prevClip = prev[selectedClipId] ?? defaultSourceAudioTrackSettings;
				const prevVolume = prevClip[id]?.volume ?? 1;
				if (prevClip[id]?.normalize === normalize) {
					return prev;
				}
				return {
					...prev,
					[selectedClipId]: {
						...prevClip,
						[id]: {
							volume: prevVolume,
							normalize,
						},
					},
				};
			});
		},
		[defaultSourceAudioTrackSettings, selectedClipId],
	);

  return {
    sourceAudioTrackMeta,
    activeSourceAudioTrackSettings,
    selectedClipSourceAudioTrackSettings,
    getSourceAudioTrackSettingsForClip,
    onSourceAudioTracksMetaChange,
    onSelectedClipSourceAudioTrackVolumeChange,
    onSelectedClipSourceAudioTrackNormalizeChange,
  };
}
