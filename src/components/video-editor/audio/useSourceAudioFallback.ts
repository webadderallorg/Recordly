import { useEffect, useRef, useState } from "react";
import { toast } from "@/components/ui/toast";
import {
	SOURCE_AUDIO_FALLBACK_TOAST_ID,
	SOURCE_AUDIO_SILENT_TOAST_ID,
} from "@/components/video-editor/audio/audioTypes";

interface UseSourceAudioFallbackParams {
	currentSourcePath: string | null;
	refreshKey?: number;
	summarizeErrorMessage: (message: string) => string;
}

export function useSourceAudioFallback({
	currentSourcePath,
	refreshKey = 0,
	summarizeErrorMessage,
}: UseSourceAudioFallbackParams) {
	const [sourceAudioFallbackPaths, setSourceAudioFallbackPaths] = useState<string[]>([]);
	const [sourceAudioFallbackStartDelayMsByPath, setSourceAudioFallbackStartDelayMsByPath] =
		useState<Record<string, number>>({});
	const previousSourcePathRef = useRef<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		// Refetch when late recording sidecars are finalized after the editor opens.
		void refreshKey;
		const sourceChanged = previousSourcePathRef.current !== currentSourcePath;
		previousSourcePathRef.current = currentSourcePath;
		if (sourceChanged) {
			setSourceAudioFallbackPaths([]);
			setSourceAudioFallbackStartDelayMsByPath({});
			// Drop the previous source's silence warning immediately; the new source may
			// have no path or fail its request, and in both cases it must not linger.
			toast.dismiss(SOURCE_AUDIO_SILENT_TOAST_ID);
		}

		if (!currentSourcePath) {
			return () => {
				cancelled = true;
			};
		}

		void (async () => {
			try {
				const result =
					await window.electronAPI.getVideoAudioFallbackPaths(currentSourcePath);
				if (cancelled) {
					return;
				}
				if (!result.success) {
					if (sourceChanged) {
						setSourceAudioFallbackPaths([]);
						setSourceAudioFallbackStartDelayMsByPath({});
					}
					toast.warning(
						result.error
							? `Could not load companion audio sources: ${summarizeErrorMessage(result.error)}`
							: "Could not load companion audio sources. Playback and export may miss microphone audio.",
						{ id: SOURCE_AUDIO_FALLBACK_TOAST_ID, duration: 10000 },
					);
					return;
				}

				toast.dismiss(SOURCE_AUDIO_FALLBACK_TOAST_ID);
				setSourceAudioFallbackPaths(result.paths ?? []);
				setSourceAudioFallbackStartDelayMsByPath(result.startDelayMsByPath ?? {});

				if ((result.silentPaths ?? []).length > 0) {
					toast.warning(
						"The microphone track in this recording is silent. The selected microphone did not capture any audio - check that the correct microphone is selected before recording again.",
						{ id: SOURCE_AUDIO_SILENT_TOAST_ID, duration: 15000 },
					);
				} else {
					toast.dismiss(SOURCE_AUDIO_SILENT_TOAST_ID);
				}
			} catch (error) {
				if (!cancelled) {
					if (sourceChanged) {
						setSourceAudioFallbackPaths([]);
						setSourceAudioFallbackStartDelayMsByPath({});
					}
					toast.warning(
						`Could not load companion audio sources: ${summarizeErrorMessage(String(error))}`,
						{ id: SOURCE_AUDIO_FALLBACK_TOAST_ID, duration: 10000 },
					);
				}
			}
		})();

		return () => {
			cancelled = true;
		};
	}, [currentSourcePath, refreshKey, summarizeErrorMessage]);

	return { sourceAudioFallbackPaths, sourceAudioFallbackStartDelayMsByPath };
}
