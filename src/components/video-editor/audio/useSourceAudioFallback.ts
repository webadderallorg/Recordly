import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { SOURCE_AUDIO_FALLBACK_TOAST_ID } from "@/components/video-editor/audio/audioTypes";

// A microphone sidecar is converted after capture stops, so the editor can open
// before it exists. Re-check on a short interval while the main process reports
// the conversion as still running.
const PENDING_SIDECAR_RECHECK_DELAY_MS = 750;
const PENDING_SIDECAR_MAX_RECHECKS = 240;

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
  const [pendingRecheckCount, setPendingRecheckCount] = useState(0);
  const previousSourcePathRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let recheckTimeout: ReturnType<typeof setTimeout> | null = null;
    // Refetch when late recording sidecars are finalized after the editor opens.
    void refreshKey;
    void pendingRecheckCount;
    const sourceChanged = previousSourcePathRef.current !== currentSourcePath;
    previousSourcePathRef.current = currentSourcePath;
    if (sourceChanged) {
      setSourceAudioFallbackPaths([]);
      setSourceAudioFallbackStartDelayMsByPath({});
      setPendingRecheckCount(0);
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

        if (result.pending && pendingRecheckCount < PENDING_SIDECAR_MAX_RECHECKS) {
          recheckTimeout = setTimeout(() => {
            setPendingRecheckCount((count) => count + 1);
          }, PENDING_SIDECAR_RECHECK_DELAY_MS);
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
      if (recheckTimeout) {
        clearTimeout(recheckTimeout);
      }
    };
  }, [currentSourcePath, pendingRecheckCount, refreshKey, summarizeErrorMessage]);

  return { sourceAudioFallbackPaths, sourceAudioFallbackStartDelayMsByPath };
}
