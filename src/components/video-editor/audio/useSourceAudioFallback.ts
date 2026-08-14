import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { SOURCE_AUDIO_FALLBACK_TOAST_ID } from "@/components/video-editor/audio/audioTypes";

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
  // Deterministic companion sidecars the finalized recording metadata reports as
  // expected but not yet materialized. Kept out of the export/source-audio path
  // (which only uses existing files) and surfaced for the timeline to retry.
  const [pendingSidecarPaths, setPendingSidecarPaths] = useState<string[]>([]);
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
      setPendingSidecarPaths([]);
    }

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
          if (sourceChanged) {
            setSourceAudioFallbackPaths([]);
            setSourceAudioFallbackStartDelayMsByPath({});
            setPendingSidecarPaths([]);
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
        setPendingSidecarPaths(result.pendingPaths ?? []);
      } catch (error) {
        if (!cancelled) {
          if (sourceChanged) {
            setSourceAudioFallbackPaths([]);
            setSourceAudioFallbackStartDelayMsByPath({});
            setPendingSidecarPaths([]);
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

  return {
    sourceAudioFallbackPaths,
    sourceAudioFallbackStartDelayMsByPath,
    pendingSidecarPaths,
  };
}
