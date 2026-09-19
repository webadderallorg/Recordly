import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { SOURCE_AUDIO_FALLBACK_TOAST_ID } from "@/components/video-editor/audio/audioTypes";
import type { I18nTranslate } from "@/contexts/I18nContext";

interface UseSourceAudioFallbackParams {
	currentSourcePath: string | null;
	refreshKey?: number;
	summarizeErrorMessage: (message: string) => string;
	t: I18nTranslate;
}

export function useSourceAudioFallback({
	currentSourcePath,
	refreshKey = 0,
	summarizeErrorMessage,
	t,
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
							? `${t("editor.audio.fallbackUnavailable", "Could not load companion audio sources")}: ${summarizeErrorMessage(result.error)}`
							: `${t("editor.audio.fallbackUnavailable", "Could not load companion audio sources")}. ${t("editor.audio.fallbackPlaybackHint", "Playback and export may miss microphone audio.")}`,
						{ id: SOURCE_AUDIO_FALLBACK_TOAST_ID, duration: 10000 },
					);
					return;
				}

				toast.dismiss(SOURCE_AUDIO_FALLBACK_TOAST_ID);
				setSourceAudioFallbackPaths(result.paths ?? []);
				setSourceAudioFallbackStartDelayMsByPath(result.startDelayMsByPath ?? {});
			} catch (error) {
				if (!cancelled) {
					if (sourceChanged) {
						setSourceAudioFallbackPaths([]);
						setSourceAudioFallbackStartDelayMsByPath({});
					}
					toast.warning(
						`${t("editor.audio.fallbackUnavailable", "Could not load companion audio sources")}: ${summarizeErrorMessage(String(error))}`,
						{ id: SOURCE_AUDIO_FALLBACK_TOAST_ID, duration: 10000 },
					);
				}
			}
		})();

		return () => {
			cancelled = true;
		};
	}, [currentSourcePath, refreshKey, summarizeErrorMessage, t]);

	return { sourceAudioFallbackPaths, sourceAudioFallbackStartDelayMsByPath };
}
