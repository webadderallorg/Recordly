import { useEffect, useState } from "react";
import { toast } from "sonner";
import { SOURCE_AUDIO_FALLBACK_TOAST_ID } from "@/components/video-editor/audio/audioTypes";

interface UseSourceAudioFallbackParams {
  currentSourcePath: string | null;
  summarizeErrorMessage: (message: string) => string;
}

export function useSourceAudioFallback({
  currentSourcePath,
  summarizeErrorMessage,
}: UseSourceAudioFallbackParams) {
  const [sourceAudioFallbackPaths, setSourceAudioFallbackPaths] = useState<string[]>([]);
  const [sourceAudioFallbackStartDelayMsByPath, setSourceAudioFallbackStartDelayMsByPath] =
    useState<Record<string, number>>({});

  useEffect(() => {
    let cancelled = false;
    setSourceAudioFallbackPaths([]);
    setSourceAudioFallbackStartDelayMsByPath({});

    if (!currentSourcePath) {
      return () => {
        cancelled = true;
      };
    }

    void (async () => {
      try {
        const result = await window.electronAPI.getVideoAudioFallbackPaths(currentSourcePath);
        if (cancelled) {
          return;
        }
        if (!result.success) {
          setSourceAudioFallbackPaths([]);
          setSourceAudioFallbackStartDelayMsByPath({});
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
      } catch (error) {
        if (!cancelled) {
          setSourceAudioFallbackPaths([]);
          setSourceAudioFallbackStartDelayMsByPath({});
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
  }, [currentSourcePath, summarizeErrorMessage]);

  return { sourceAudioFallbackPaths, sourceAudioFallbackStartDelayMsByPath };
}
