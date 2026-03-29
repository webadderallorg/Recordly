import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type WheelEvent } from "react";
import { useTimelineContext } from "dnd-timeline";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Plus, Scissors, ZoomIn, MessageSquare, ChevronDown, Check, Gauge, WandSparkles, Music, Crop } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { v4 as uuidv4 } from 'uuid';
import { useScopedT } from "@/contexts/I18nContext";
import { useShortcuts } from "@/contexts/ShortcutsContext";
import { matchesShortcut } from "@/lib/shortcuts";
import { ASPECT_RATIOS, type AspectRatio, getAspectRatioLabel, isCustomAspectRatio } from "@/utils/aspectRatioUtils";
import { formatShortcut } from "@/utils/platformUtils";
import { loadEditorPreferences, saveEditorPreferences } from "../editorPreferences";
import { TutorialHelp } from "../TutorialHelp";
import TimelineWrapper from "./TimelineWrapper";
import Row from "./Row";
import Item from "./Item";
import KeyframeMarkers from "./KeyframeMarkers";
import type { Range, Span } from "dnd-timeline";
import type { ZoomRegion, TrimRegion, AnnotationRegion, SpeedRegion, AudioRegion, CursorTelemetryPoint, ZoomFocus, CaptionCue } from "../types";
import { toFileUrl } from "../projectPersistence";
import { detectInteractionCandidates, normalizeCursorTelemetry } from "./zoomSuggestionUtils";

const ZOOM_ROW_ID = "row-zoom";
const TRIM_ROW_ID = "row-trim";
const ANNOTATION_ROW_ID = "row-annotation";
const SPEED_ROW_ID = "row-speed";
const ORIGINAL_AUDIO_ROW_ID = "row-original-audio";
const AUDIO_ROW_ID = "row-audio";
const CAPTION_ROW_ID = "row-caption";
const FALLBACK_RANGE_MS = 1000;
const TARGET_MARKER_COUNT = 12;
const SUGGESTION_SPACING_MS = 1800;

interface TimelineEditorProps {
  videoDuration: number;
  videoPath?: string;
  currentTime: number;
  onSeek?: (time: number) => void;
  cursorTelemetry?: CursorTelemetryPoint[];
  disableSuggestedZooms?: boolean;
  zoomRegions: ZoomRegion[];
  onZoomAdded: (span: Span) => void;
  onZoomSuggested?: (span: Span, focus: ZoomFocus) => void;
  onZoomSpanChange: (id: string, span: Span) => void;
  onZoomDelete: (id: string) => void;
  selectedZoomId: string | null;
  onSelectZoom: (id: string | null) => void;
  trimRegions?: TrimRegion[];
  onTrimAdded?: (span: Span) => void;
  onTrimSpanChange?: (id: string, span: Span) => void;
  onTrimDelete?: (id: string) => void;
  selectedTrimId?: string | null;
  onSelectTrim?: (id: string | null) => void;
  annotationRegions?: AnnotationRegion[];
  onAnnotationAdded?: (span: Span) => void;
  onAnnotationSpanChange?: (id: string, span: Span) => void;
  onAnnotationDelete?: (id: string) => void;
  selectedAnnotationId?: string | null;
  onSelectAnnotation?: (id: string | null) => void;
  speedRegions?: SpeedRegion[];
  onSpeedAdded?: (span: Span) => void;
  onSpeedSpanChange?: (id: string, span: Span) => void;
  onSpeedDelete?: (id: string) => void;
  selectedSpeedId?: string | null;
  onSelectSpeed?: (id: string | null) => void;
  audioRegions?: AudioRegion[];
  onAudioAdded?: (span: Span, audioPath: string) => void;
  onAudioSpanChange?: (id: string, span: Span) => void;
  onAudioMutedChange?: (id: string, muted: boolean) => void;
  onAudioSoloedChange?: (id: string, soloed: boolean) => void;
  onAudioDelete?: (id: string) => void;
  selectedAudioId?: string | null;
  onSelectAudio?: (id: string | null) => void;
  masterAudioMuted?: boolean;
  onMasterAudioMutedChange?: (muted: boolean) => void;
  masterAudioSoloed?: boolean;
  onMasterAudioSoloedChange?: (soloed: boolean) => void;
  masterAudioVolume?: number;
  audioTrackVolume?: number;
  onMasterAudioVolumeChange?: (volume: number) => void;
  onAudioTrackVolumeChange?: (volume: number) => void;
  autoCaptions?: CaptionCue[];
  onCaptionSpanChange?: (id: string, span: Span) => void;
  selectedCaptionId?: string | null;
  onSelectCaption?: (id: string | null) => void;
  onClearAutoCaptions?: () => void;
  aspectRatio: AspectRatio;
  onAspectRatioChange: (aspectRatio: AspectRatio) => void;
  onOpenCropEditor?: () => void;
  isCropped?: boolean;
  isMasterSelected?: boolean;
  onSelectMaster?: (selected: boolean) => void;
}

interface TimelineScaleConfig {
  minItemDurationMs: number;
  defaultItemDurationMs: number;
  minVisibleRangeMs: number;
}

interface TimelineRenderItem {
  id: string;
  rowId: string;
  span: Span;
  label: string;
  zoomDepth?: number;
  speedValue?: number;
  audioPath?: string;
  variant: 'zoom' | 'trim' | 'annotation' | 'speed' | 'audio' | 'caption';
  muted?: boolean;
  soloed?: boolean;
  fadeInMs?: number;
  fadeOutMs?: number;
}

const SCALE_CANDIDATES = [
  { intervalSeconds: 0.05, gridSeconds: 0.01 },
  { intervalSeconds: 0.1, gridSeconds: 0.02 },
  { intervalSeconds: 0.25, gridSeconds: 0.05 },
  { intervalSeconds: 0.5, gridSeconds: 0.1 },
  { intervalSeconds: 1, gridSeconds: 0.25 },
  { intervalSeconds: 2, gridSeconds: 0.5 },
  { intervalSeconds: 5, gridSeconds: 1 },
  { intervalSeconds: 10, gridSeconds: 2 },
  { intervalSeconds: 15, gridSeconds: 3 },
  { intervalSeconds: 30, gridSeconds: 5 },
  { intervalSeconds: 60, gridSeconds: 10 },
  { intervalSeconds: 120, gridSeconds: 20 },
  { intervalSeconds: 300, gridSeconds: 30 },
  { intervalSeconds: 600, gridSeconds: 60 },
  { intervalSeconds: 900, gridSeconds: 120 },
  { intervalSeconds: 1800, gridSeconds: 180 },
  { intervalSeconds: 3600, gridSeconds: 300 },
];

function calculateAxisScale(visibleRangeMs: number): { intervalMs: number; gridMs: number } {
  const visibleSeconds = visibleRangeMs / 1000;
  const candidate =
    SCALE_CANDIDATES.find((scaleCandidate) => {
      if (visibleSeconds <= 0) {
        return true;
      }
      return visibleSeconds / scaleCandidate.intervalSeconds <= TARGET_MARKER_COUNT;
    }) ?? SCALE_CANDIDATES[SCALE_CANDIDATES.length - 1];

  return {
    intervalMs: Math.round(candidate.intervalSeconds * 1000),
    gridMs: Math.round(candidate.gridSeconds * 1000),
  };
}

function calculateTimelineScale(durationSeconds: number): TimelineScaleConfig {
  const totalMs = Math.max(0, Math.round(durationSeconds * 1000));

  const minItemDurationMs = 100;

  const defaultItemDurationMs =
    totalMs > 0
      ? Math.max(minItemDurationMs, Math.min(Math.round(totalMs * 0.05), 30000))
      : Math.max(minItemDurationMs, 1000);

  const minVisibleRangeMs = 300;

  return {
    minItemDurationMs,
    defaultItemDurationMs,
    minVisibleRangeMs,
  };
}

function createInitialRange(totalMs: number): Range {
  if (totalMs > 0) {
    return { start: 0, end: totalMs };
  }

  return { start: 0, end: FALLBACK_RANGE_MS };
}

function normalizeWheelDeltaToPixels(delta: number, deltaMode: number) {
  if (deltaMode === 1) {
    return delta * 16;
  }

  if (deltaMode === 2) {
    return delta * 240;
  }

  return delta;
}

function formatTimeLabel(milliseconds: number, intervalMs: number) {
  const totalSeconds = milliseconds / 1000;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const fractionalDigits = intervalMs < 250 ? 2 : intervalMs < 1000 ? 1 : 0;

  if (hours > 0) {
    const minutesString = minutes.toString().padStart(2, "0");
    const secondsString = Math.floor(seconds).toString().padStart(2, "0");
    return `${hours}:${minutesString}:${secondsString}`;
  }

  if (fractionalDigits > 0) {
    const secondsWithFraction = seconds.toFixed(fractionalDigits);
    const [wholeSeconds, fraction] = secondsWithFraction.split(".");
    return `${minutes}:${wholeSeconds.padStart(2, "0")}.${fraction}`;
  }

  return `${minutes}:${Math.floor(seconds).toString().padStart(2, "0")}`;
}


function formatPlayheadTime(ms: number): string {
  const s = ms / 1000;
  const min = Math.floor(s / 60);
  const sec = s % 60;
  if (min > 0) return `${min}:${sec.toFixed(1).padStart(4, "0")}`;
  return `${sec.toFixed(1)}s`;
}

function PlaybackCursor({
  currentTimeMs,
  videoDurationMs,
  onSeek,
  timelineRef,
  keyframes = [],
}: {
  currentTimeMs: number;
  videoDurationMs: number;
  onSeek?: (time: number) => void;
  timelineRef: React.RefObject<HTMLDivElement>;
  keyframes?: { id: string; time: number }[];
}) {

  const { sidebarWidth = 0, direction, range, valueToPixels, pixelsToValue } = useTimelineContext();
  const sideProperty = direction === "rtl" ? "right" : "left";
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!timelineRef.current || !onSeek) return;

      const rect = timelineRef.current.getBoundingClientRect();
      const clickX = e.clientX - rect.left - sidebarWidth;

      // Allow dragging outside to 0 or max, but clamp the value
      const relativeMs = pixelsToValue(clickX);
      let absoluteMs = Math.max(0, Math.min(range.start + relativeMs, videoDurationMs));

      // Snap to nearby keyframe if within threshold (150ms)
      const snapThresholdMs = 150;
      const nearbyKeyframe = keyframes.find(
        (kf) =>
          Math.abs(kf.time - absoluteMs) <= snapThresholdMs &&
          kf.time >= range.start &&
          kf.time <= range.end,
      );

      if (nearbyKeyframe) {
        absoluteMs = nearbyKeyframe.time;
      }

      onSeek(absoluteMs / 1000);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      document.body.style.cursor = "";
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    document.body.style.cursor = "ew-resize";

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
    };
  }, [
    isDragging,
    onSeek,
    timelineRef,
    sidebarWidth,
    range.start,
    range.end,
    videoDurationMs,
    pixelsToValue,
    keyframes,
  ]);

  if (videoDurationMs <= 0 || currentTimeMs < 0) {
    return null;
  }

  const clampedTime = Math.min(currentTimeMs, videoDurationMs);

  if (clampedTime < range.start || clampedTime > range.end) {
    return null;
  }

  const offset = valueToPixels(clampedTime - range.start);

  return (
    <div
      className="absolute top-0 bottom-0 z-50 group/cursor"
      style={{
        [sideProperty === "right" ? "marginRight" : "marginLeft"]: `${sidebarWidth - 1}px`,
        pointerEvents: "none", // Allow clicks to pass through to timeline, but we'll enable pointer events on the handle
      }}
    >
      <div
        className="absolute top-0 bottom-0 w-[2px] bg-[#2563EB] shadow-[0_0_10px_rgba(37,99,235,0.5)] cursor-ew-resize pointer-events-auto hover:shadow-[0_0_15px_rgba(37,99,235,0.7)] transition-shadow"
        style={{
          [sideProperty]: `${offset}px`,
        }}
        onMouseDown={(e) => {
          e.stopPropagation(); // Prevent timeline click
          setIsDragging(true);
        }}
      >
        <div
          className="absolute -top-1 left-1/2 -translate-x-1/2 hover:scale-125 transition-transform"
          style={{ width: "16px", height: "16px" }}
        >
          <div className="w-3 h-3 mx-auto mt-[2px] bg-[#2563EB] rotate-45 rounded-sm shadow-lg border border-white/20" />
        </div>
        {isDragging && (
          <div className="absolute -top-6 left-1/2 -translate-x-1/2 px-1.5 py-0.5 rounded bg-black/80 text-[10px] text-white/90 font-medium tabular-nums whitespace-nowrap border border-white/10 shadow-lg pointer-events-none">
            {formatPlayheadTime(clampedTime)}
          </div>
        )}
      </div>
    </div>
  );
}

function TimelineAxis({
  videoDurationMs,
  currentTimeMs,
}: {
  videoDurationMs: number;
  currentTimeMs: number;
}) {
  const { sidebarWidth = 0, direction, range, valueToPixels } = useTimelineContext();
  const sideProperty = direction === "rtl" ? "right" : "left";

  const { intervalMs } = useMemo(
    () => calculateAxisScale(range.end - range.start),
    [range.end, range.start],
  );

  const markers = useMemo(() => {
    if (intervalMs <= 0) {
      return { markers: [], minorTicks: [] };
    }

    const maxTime = videoDurationMs > 0 ? videoDurationMs : range.end;
    const visibleStart = Math.max(0, Math.min(range.start, maxTime));
    const visibleEnd = Math.min(range.end, maxTime);
    const markerTimes = new Set<number>();

    const firstMarker = Math.ceil(visibleStart / intervalMs) * intervalMs;

    for (let time = firstMarker; time <= maxTime; time += intervalMs) {
      if (time >= visibleStart && time <= visibleEnd) {
        markerTimes.add(Math.round(time));
      }
    }

    if (visibleStart <= maxTime) {
      markerTimes.add(Math.round(visibleStart));
    }

    if (videoDurationMs > 0) {
      markerTimes.add(Math.round(videoDurationMs));
    }

    const sorted = Array.from(markerTimes)
      .filter((time) => time <= maxTime)
      .sort((a, b) => a - b);

    // Generate minor ticks (4 ticks between major intervals)
    const minorTicks = [];
    const minorInterval = intervalMs / 5;

    for (let time = firstMarker; time <= maxTime; time += minorInterval) {
      if (time >= visibleStart && time <= visibleEnd) {
        // Skip if it's close to a major marker
        const isMajor = Math.abs(time % intervalMs) < 1;
        if (!isMajor) {
          minorTicks.push(time);
        }
      }
    }

    return {
      markers: sorted.map((time) => ({
        time,
        label: formatTimeLabel(time, intervalMs),
      })),
      minorTicks,
    };
  }, [intervalMs, range.end, range.start, videoDurationMs]);

  return (
    <div
      className="h-8 bg-[#161619] border-b border-white/10 relative overflow-hidden select-none cursor-pointer"
      style={{
        [sideProperty === "right" ? "marginRight" : "marginLeft"]: `${sidebarWidth}px`,
      }}
      onMouseDown={(e) => {
        // Also allow starting selection from the ruler
        (e.currentTarget.parentElement as any)?.__handleMouseDown?.(e);
      }}
      onClick={(e) => {
        // Also allow seeking/clearing from the ruler
        (e.currentTarget.parentElement as any)?.__handleTimelineClick?.(e);
      }}
    >
      {/* Minor Ticks */}
      {markers.minorTicks.map((time) => {
        const offset = valueToPixels(time - range.start);
        return (
          <div
            key={`minor-${time}`}
            className="absolute bottom-0 h-1 w-[1px] bg-white/5"
            style={{ [sideProperty]: `${offset}px` }}
          />
        );
      })}

      {/* Major Markers */}
      {markers.markers.map((marker) => {
        const offset = valueToPixels(marker.time - range.start);
        const markerStyle: React.CSSProperties = {
          position: "absolute",
          bottom: 0,
          height: "100%",
          display: "flex",
          flexDirection: "row",
          alignItems: "flex-end",
          [sideProperty]: `${offset}px`,
        };

        return (
          <div key={marker.time} style={markerStyle}>
            <div className="flex flex-col items-center pb-1">
              <div className="h-2 w-[1px] bg-white/20 mb-1" />
              <span
                className={cn(
                  "text-[10px] font-medium tabular-nums tracking-tight",
                  marker.time === currentTimeMs ? "text-[#2563EB]" : "text-slate-500",
                )}
              >
                {marker.label}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Timeline({
  items,
  videoDurationMs,
  currentTimeMs,
  onSeek,
  onSelectZoom,
  onSelectTrim,
  onSelectAnnotation,
  onSelectSpeed,
  onSelectAudio,
  onAudioMutedChange,
  onAudioSoloedChange,
  audioRegions,
  masterAudioMuted = false,
  onMasterAudioMutedChange,
  masterAudioSoloed = false,
  onMasterAudioSoloedChange,
  masterAudioVolume = 1,
  audioTrackVolume = 1,
  selectedZoomId,
  selectedTrimId,
  selectedAnnotationId,
  selectedSpeedId,
  selectedAudioId,
  selectedCaptionId,
  onSelectCaption,
  selectAllBlocksActive = false,
  onClearBlockSelection,
  keyframes = [],
  isMasterSelected = false,
  onSelectMaster,
}: {
  items: TimelineRenderItem[];
  videoDurationMs: number;
  currentTimeMs: number;
  onSeek?: (time: number) => void;
  onSelectZoom?: (id: string | null) => void;
  onSelectTrim?: (id: string | null) => void;
  onSelectAnnotation?: (id: string | null) => void;
  onSelectSpeed?: (id: string | null) => void;
  onSelectAudio?: (id: string | null) => void;
  onAudioMutedChange?: (id: string, muted: boolean) => void;
  onAudioSoloedChange?: (id: string, soloed: boolean) => void;
  audioRegions?: AudioRegion[];
  masterAudioMuted?: boolean;
  onMasterAudioMutedChange?: (muted: boolean) => void;
  masterAudioSoloed?: boolean;
  onMasterAudioSoloedChange?: (soloed: boolean) => void;
  masterAudioVolume?: number;
  audioTrackVolume?: number;
  onMasterAudioVolumeChange?: (volume: number) => void;
  onAudioTrackVolumeChange?: (volume: number) => void;
  selectedZoomId: string | null;
  selectedTrimId?: string | null;
  selectedAnnotationId?: string | null;
  selectedSpeedId?: string | null;
  selectedAudioId?: string | null;
  selectedCaptionId?: string | null;
  onSelectCaption?: (id: string | null) => void;
  selectAllBlocksActive?: boolean;
  onClearBlockSelection?: () => void;
  keyframes?: { id: string; time: number }[];
  isMasterSelected?: boolean;
  onSelectMaster?: (selected: boolean) => void;
}) {
  const { setTimelineRef, style, sidebarWidth = 0, range, pixelsToValue } = useTimelineContext();
  const localTimelineRef = useRef<HTMLDivElement | null>(null);

  const setRefs = useCallback(
    (node: HTMLDivElement | null) => {
      if (localTimelineRef.current !== node) {
        setTimelineRef(node);
        localTimelineRef.current = node;
      }
    },
    [setTimelineRef],
  );

  const handleMouseDown = useCallback(() => {
    // Background clicks are handled as seeking.
    // Dragging items is handled by dnd-timeline.
  }, []);


  const handleTimelineClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!onSeek || videoDurationMs <= 0) return;

      onSelectZoom?.(null);
      onSelectTrim?.(null);
      onSelectAnnotation?.(null);
      onSelectSpeed?.(null);
      onSelectAudio?.(null);
      onSelectCaption?.(null);
      onSelectMaster?.(false);
      onClearBlockSelection?.();

      const rect = e.currentTarget.getBoundingClientRect();
      const clickX = e.clientX - rect.left - sidebarWidth;

      if (clickX < 0) return;

      const relativeMs = pixelsToValue(clickX);
      const absoluteMs = Math.max(0, Math.min(range.start + relativeMs, videoDurationMs));

      onSeek(absoluteMs / 1000);
    },
    [onSeek, onSelectZoom, onSelectTrim, onSelectAnnotation, onSelectSpeed, onSelectAudio, onSelectCaption, videoDurationMs, sidebarWidth, range.start, pixelsToValue, onClearBlockSelection],
  );


  useEffect(() => {
    if (localTimelineRef.current) {
      // Expose handlers for internal components like Axis
      (localTimelineRef.current as any).__handleMouseDown = handleMouseDown;
      (localTimelineRef.current as any).__handleTimelineClick = handleTimelineClick;
    }
  }, [handleMouseDown, handleTimelineClick]);

  const zoomItems = items.filter(item => item.rowId === ZOOM_ROW_ID);
  const trimItems = items.filter(item => item.rowId === TRIM_ROW_ID);
  const annotationItems = items.filter(item => item.rowId === ANNOTATION_ROW_ID);
  const speedItems = items.filter(item => item.rowId === SPEED_ROW_ID);
  const originalAudioItems = items.filter(item => item.rowId === ORIGINAL_AUDIO_ROW_ID);
  const audioItems = items.filter(item => item.rowId === AUDIO_ROW_ID);
  const captionItems = items.filter(item => item.rowId === CAPTION_ROW_ID);

  const handleAllAudioMute = useCallback(() => {
    if (!audioRegions || audioRegions.length === 0) return;
    const allMuted = audioRegions.every((r) => r.muted);
    audioRegions.forEach((r) => {
      onAudioMutedChange?.(r.id, !allMuted);
      if (!allMuted && r.soloed) onAudioSoloedChange?.(r.id, false);
    });
  }, [audioRegions, onAudioMutedChange, onAudioSoloedChange]);

  const handleAllAudioSolo = useCallback(() => {
    if (!audioRegions || audioRegions.length === 0) return;
    const anySoloed = audioRegions.some((r) => r.soloed);
    if (!anySoloed) {
      // Solo the first region (this will unsolo Master/others due to exclusive logic in parent)
      onAudioSoloedChange?.(audioRegions[0].id, true);
      if (audioRegions[0].muted) onAudioMutedChange?.(audioRegions[0].id, false);
    } else {
      // Clear all solos in this track
      audioRegions.forEach((r) => {
        if (r.soloed) onAudioSoloedChange?.(r.id, false);
      });
    }
  }, [audioRegions, onAudioSoloedChange, onAudioMutedChange]);

  const anyAudioMuted = useMemo(() => audioRegions && audioRegions.length > 0 && audioRegions.every((r) => r.muted), [audioRegions]);
  const anyAudioSoloed = useMemo(() => audioRegions && audioRegions.length > 0 && audioRegions.some((r) => r.soloed), [audioRegions]);

  const masterAudioControls = (
    <div className="flex items-center gap-1 ml-1 overflow-hidden pointer-events-auto">
      <button
        type="button"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          const nextMuted = !masterAudioMuted;
          onMasterAudioMutedChange?.(nextMuted);
          if (nextMuted && masterAudioSoloed) onMasterAudioSoloedChange?.(false);
        }}
        className={cn(
          "w-4 h-4 rounded-[4px] border flex items-center justify-center text-[8px] font-bold transition-all",
          masterAudioMuted
            ? "bg-red-500/20 border-red-500/50 text-red-400"
            : "bg-white/5 border-white/10 text-white/50 hover:bg-white/10 hover:text-white"
        )}
        title="Mute Master"
      >
        M
      </button>
      <button
        type="button"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          const nextSoloed = !masterAudioSoloed;
          onMasterAudioSoloedChange?.(nextSoloed);
          if (nextSoloed && masterAudioMuted) onMasterAudioMutedChange?.(false);
        }}
        className={cn(
          "w-4 h-4 rounded-[4px] border flex items-center justify-center text-[8px] font-bold transition-all",
          masterAudioSoloed
            ? "bg-amber-500/20 border-amber-500/50 text-amber-400"
            : "bg-white/5 border-white/10 text-white/50 hover:bg-white/10 hover:text-white"
        )}
        title="Solo Master"
      >
        S
      </button>
      {masterAudioVolume !== 1 && (
        <span className="text-[8px] tabular-nums text-white/30 ml-0.5">{Math.round(masterAudioVolume * 100)}%</span>
      )}
    </div>
  );

  const audioControls = (
    <div className="flex items-center gap-1 ml-1 overflow-hidden pointer-events-auto">
      <button
        type="button"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          handleAllAudioMute();
        }}
        className={cn(
          "w-4 h-4 rounded-[4px] border flex items-center justify-center text-[8px] font-bold transition-all",
          anyAudioMuted
            ? "bg-red-500/20 border-red-500/50 text-red-400"
            : "bg-white/5 border-white/10 text-white/50 hover:bg-white/10 hover:text-white"
        )}
        title="Mute All Audio"
      >
        M
      </button>
      <button
        type="button"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          handleAllAudioSolo();
        }}
        className={cn(
          "w-4 h-4 rounded-[4px] border flex items-center justify-center text-[8px] font-bold transition-all",
          anyAudioSoloed
            ? "bg-amber-500/20 border-amber-500/50 text-amber-400"
            : "bg-white/5 border-white/10 text-white/50 hover:bg-white/10 hover:text-white"
        )}
        title="Solo Audio Track"
      >
        S
      </button>
      {audioTrackVolume !== 1 && (
        <span className="text-[8px] tabular-nums text-white/30 ml-0.5">{Math.round(audioTrackVolume * 100)}%</span>
      )}
    </div>
  );

  return (
    <div
      ref={setRefs}
      style={style}
      className="select-none bg-[#17171a] h-full min-h-0 relative cursor-pointer group flex flex-col"
      onMouseDown={handleMouseDown}
      onClick={handleTimelineClick}
    >

      <div className="absolute inset-0 bg-[linear-gradient(to_right,#ffffff03_1px,transparent_1px)] bg-[length:20px_100%] pointer-events-none" />
      <TimelineAxis videoDurationMs={videoDurationMs} currentTimeMs={currentTimeMs} />
      <PlaybackCursor
        currentTimeMs={currentTimeMs}
        videoDurationMs={videoDurationMs}
        onSeek={onSeek}
        timelineRef={localTimelineRef}
        keyframes={keyframes}
      />


      <div className="relative z-10 flex flex-1 min-h-0 flex-col">
        <Row id={ZOOM_ROW_ID} isEmpty={zoomItems.length === 0} hint="Press Z to add zoom">
          {zoomItems.map((item) => (
            <Item
              id={item.id}
              key={item.id}
              rowId={item.rowId}
              span={item.span}
              isSelected={selectAllBlocksActive || item.id === selectedZoomId}
              onSelect={() => onSelectZoom?.(item.id)}
              zoomDepth={item.zoomDepth}
              variant="zoom"
            >
              {item.label}
            </Item>
          ))}
        </Row>

        <Row id={TRIM_ROW_ID} isEmpty={trimItems.length === 0} hint="Press T to add trim">
          {trimItems.map((item) => (
            <Item
              id={item.id}
              key={item.id}
              rowId={item.rowId}
              span={item.span}
              isSelected={selectAllBlocksActive || item.id === selectedTrimId}
              onSelect={() => onSelectTrim?.(item.id)}
              variant="trim"
            >
              {item.label}
            </Item>
          ))}
        </Row>

        <Row
          id={ANNOTATION_ROW_ID}
          isEmpty={annotationItems.length === 0}
          hint="Press A to add annotation"
        >
          {annotationItems.map((item) => (
            <Item
              id={item.id}
              key={item.id}
              rowId={item.rowId}
              span={item.span}
              isSelected={selectAllBlocksActive || item.id === selectedAnnotationId}
              onSelect={() => onSelectAnnotation?.(item.id)}
              variant="annotation"
            >
              {item.label}
            </Item>
          ))}
        </Row>

        <Row id={SPEED_ROW_ID} isEmpty={speedItems.length === 0} hint="Press S to add speed">
          {speedItems.map((item) => (
            <Item
              id={item.id}
              key={item.id}
              rowId={item.rowId}
              span={item.span}
              isSelected={selectAllBlocksActive || item.id === selectedSpeedId}
              onSelect={() => onSelectSpeed?.(item.id)}
              variant="speed"
              speedValue={item.speedValue}
            >
              {item.label}
            </Item>
          ))}
        </Row>

        <Row
          id={ORIGINAL_AUDIO_ROW_ID}
          label="Master"
          labelColor="#A855F7"
          isEmpty={originalAudioItems.length === 0}
          controls={masterAudioControls}
        >
          {originalAudioItems.map((item) => (
            <Item
              id={item.id}
              key={item.id}
              rowId={item.rowId}
              span={item.span}
              isSelected={isMasterSelected}
              onSelect={() => onSelectMaster?.(true)}
              variant="audio"
              audioPath={item.audioPath}
              isDraggable={false}
              isResizable={false}
              muted={item.muted}
            >
              {item.label}
            </Item>
          ))}
        </Row>

        <Row id={AUDIO_ROW_ID} label="Audio" labelColor="#A855F7" controls={audioControls} isEmpty={audioItems.length === 0} hint="Click music icon to add audio">
          {audioItems.map((item) => (
            <Item
              id={item.id}
              key={item.id}
              rowId={item.rowId}
              span={item.span}
              isSelected={selectAllBlocksActive || item.id === selectedAudioId}
              onSelect={() => onSelectAudio?.(item.id)}
              variant="audio"
              audioPath={item.audioPath}
              muted={item.muted}
              fadeInMs={item.fadeInMs}
              fadeOutMs={item.fadeOutMs}
            >
              {item.label}
            </Item>
          ))}
        </Row>

        <Row id={CAPTION_ROW_ID} isEmpty={captionItems.length === 0} hint="Generated captions will appear here">
          {captionItems.map((item) => (
            <Item
              id={item.id}
              key={item.id}
              rowId={item.rowId}
              span={item.span}
              isSelected={selectAllBlocksActive || item.id === selectedCaptionId}
              onSelect={() => onSelectCaption?.(item.id)}
              variant="caption"
            >
              {item.label}
            </Item>
          ))}
        </Row>
      </div>
    </div>
  );
}

export default function TimelineEditor({
  videoDuration,
  currentTime,
  onSeek,
  cursorTelemetry = [],
  disableSuggestedZooms = false,
  zoomRegions,
  onZoomAdded,
  onZoomSuggested,
  onZoomSpanChange,
  onZoomDelete,
  selectedZoomId,
  onSelectZoom,
  trimRegions = [],
  onTrimAdded,
  onTrimSpanChange,
  onTrimDelete,
  selectedTrimId,
  onSelectTrim,
  annotationRegions = [],
  onAnnotationAdded,
  onAnnotationSpanChange,
  onAnnotationDelete,
  selectedAnnotationId,
  onSelectAnnotation,
  speedRegions = [],
  onSpeedAdded,
  onSpeedSpanChange,
  onSpeedDelete,
  selectedSpeedId,
  onSelectSpeed,
  audioRegions = [],
  onAudioAdded,
  onAudioSpanChange,
  onAudioDelete,
  selectedAudioId,
  onSelectAudio,
  onAudioMutedChange,
  onAudioSoloedChange,
  autoCaptions = [],
  onCaptionSpanChange,
  selectedCaptionId,
  onSelectCaption,
  onClearAutoCaptions,
  videoPath,
  masterAudioMuted = false,
  onMasterAudioMutedChange,
  masterAudioSoloed = false,
  onMasterAudioSoloedChange,
  masterAudioVolume = 1,
  audioTrackVolume = 1,
  isMasterSelected = false,
  onSelectMaster,
  aspectRatio,
  onAspectRatioChange,
  onOpenCropEditor,
  isCropped = false,
}: TimelineEditorProps) {
  const t = useScopedT("settings");
  const initialEditorPreferences = useMemo(() => loadEditorPreferences(), []);
  const totalMs = useMemo(() => Math.max(0, Math.round(videoDuration * 1000)), [videoDuration]);
  const currentTimeMs = useMemo(() => Math.round(currentTime * 1000), [currentTime]);
  const timelineScale = useMemo(() => calculateTimelineScale(videoDuration), [videoDuration]);
  const safeMinDurationMs = useMemo(
    () => (totalMs > 0 ? Math.min(timelineScale.minItemDurationMs, totalMs) : timelineScale.minItemDurationMs),
    [timelineScale.minItemDurationMs, totalMs],
  );

  const [range, setRange] = useState<Range>(() => createInitialRange(totalMs));
  const [keyframes, setKeyframes] = useState<{ id: string; time: number }[]>([]);
  const [selectedKeyframeId, setSelectedKeyframeId] = useState<string | null>(null);
  const [selectAllBlocksActive, setSelectAllBlocksActive] = useState(false);
  const [customAspectWidth, setCustomAspectWidth] = useState(initialEditorPreferences.customAspectWidth);
  const [customAspectHeight, setCustomAspectHeight] = useState(initialEditorPreferences.customAspectHeight);
  const [scrollLabels, setScrollLabels] = useState({
    pan: 'Shift + Ctrl + Scroll',
    zoom: 'Ctrl + Scroll'
  });
  const isTimelineFocusedRef = useRef(false);
  const timelineContainerRef = useRef<HTMLDivElement>(null);
  const { shortcuts: keyShortcuts, isMac } = useShortcuts();

  useEffect(() => {
    setRange(createInitialRange(totalMs));
  }, [totalMs]);

  useEffect(() => {
    if (aspectRatio === 'native') {
      return;
    }
    const [width, height] = aspectRatio.split(':');
    if (width && height) {
      setCustomAspectWidth(width);
      setCustomAspectHeight(height);
    }
  }, [aspectRatio]);

  useEffect(() => {
    saveEditorPreferences({
      customAspectWidth,
      customAspectHeight,
    });
  }, [customAspectHeight, customAspectWidth]);

  const applyCustomAspectRatio = useCallback(() => {
    const width = Number.parseInt(customAspectWidth, 10);
    const height = Number.parseInt(customAspectHeight, 10);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      toast.error('Custom aspect ratio must be positive numbers.');
      return;
    }
    onAspectRatioChange(`${width}:${height}` as AspectRatio);
  }, [customAspectHeight, customAspectWidth, onAspectRatioChange]);

  const handleCustomAspectRatioKeyDown = useCallback((event: ReactKeyboardEvent<HTMLInputElement>) => {
    // Prevent Radix DropdownMenu typeahead from selecting preset items while typing.
    event.stopPropagation();
    if (event.key === 'Enter') {
      event.preventDefault();
      applyCustomAspectRatio();
    }
  }, [applyCustomAspectRatio]);

  useEffect(() => {
    formatShortcut(['shift', 'mod', 'Scroll']).then(pan => {
      formatShortcut(['mod', 'Scroll']).then(zoom => {
        setScrollLabels({ pan, zoom });
      });
    });
  }, []);

  // Add keyframe at current playhead position
  const addKeyframe = useCallback(() => {
    if (totalMs === 0) return;
    const time = Math.max(0, Math.min(currentTimeMs, totalMs));
    if (keyframes.some(kf => Math.abs(kf.time - time) < 1)) return;
    setKeyframes(prev => [...prev, { id: uuidv4(), time }]);
  }, [currentTimeMs, totalMs, keyframes]);

  // Delete selected keyframe
  const deleteSelectedKeyframe = useCallback(() => {
    if (!selectedKeyframeId) return;
    setKeyframes(prev => prev.filter(kf => kf.id !== selectedKeyframeId));
    setSelectedKeyframeId(null);
  }, [selectedKeyframeId]);

  // Move keyframe to new time position
  const handleKeyframeMove = useCallback((id: string, newTime: number) => {
    setKeyframes(prev => prev.map(kf => kf.id === id ? { ...kf, time: Math.max(0, Math.min(newTime, totalMs)) } : kf));
  }, [totalMs]);

  // Delete selected zoom item
  const deleteSelectedZoom = useCallback(() => {
    if (!selectedZoomId) return;
    onZoomDelete(selectedZoomId);
    onSelectZoom(null);
  }, [selectedZoomId, onZoomDelete, onSelectZoom]);

  // Delete selected trim item
  const deleteSelectedTrim = useCallback(() => {
    if (!selectedTrimId || !onTrimDelete || !onSelectTrim) return;
    onTrimDelete(selectedTrimId);
    onSelectTrim(null);
  }, [selectedTrimId, onTrimDelete, onSelectTrim]);

  const deleteSelectedAnnotation = useCallback(() => {
    if (!selectedAnnotationId || !onAnnotationDelete || !onSelectAnnotation) return;
    onAnnotationDelete(selectedAnnotationId);
    onSelectAnnotation(null);
  }, [selectedAnnotationId, onAnnotationDelete, onSelectAnnotation]);

  const deleteSelectedSpeed = useCallback(() => {
    if (!selectedSpeedId || !onSpeedDelete || !onSelectSpeed) return;
    onSpeedDelete(selectedSpeedId);
    onSelectSpeed(null);
  }, [selectedSpeedId, onSpeedDelete, onSelectSpeed]);

  const deleteSelectedAudio = useCallback(() => {
    if (!selectedAudioId || !onAudioDelete || !onSelectAudio) return;
    onAudioDelete(selectedAudioId);
    onSelectAudio(null);
  }, [selectedAudioId, onAudioDelete, onSelectAudio]);


  const clearSelectedBlocks = useCallback(() => {
    onSelectZoom(null);
    onSelectTrim?.(null);
    onSelectAnnotation?.(null);
    onSelectSpeed?.(null);
    onSelectAudio?.(null);
    onSelectCaption?.(null);
    setSelectAllBlocksActive(false);
  }, [onSelectAnnotation, onSelectAudio, onSelectSpeed, onSelectTrim, onSelectZoom, onSelectCaption]);

  const hasAnyTimelineBlocks =
    zoomRegions.length > 0 ||
    trimRegions.length > 0 ||
    annotationRegions.length > 0 ||
    speedRegions.length > 0 ||
    audioRegions.length > 0 ||
    autoCaptions.length > 0;

  const deleteAllBlocks = useCallback(() => {
    const zoomIds = zoomRegions.map((region) => region.id);
    const trimIds = trimRegions.map((region) => region.id);
    const annotationIds = annotationRegions.map((region) => region.id);
    const speedIds = speedRegions.map((region) => region.id);
    const audioIds = audioRegions.map((region) => region.id);

    zoomIds.forEach((id) => onZoomDelete(id));
    trimIds.forEach((id) => onTrimDelete?.(id));
    annotationIds.forEach((id) => onAnnotationDelete?.(id));
    speedIds.forEach((id) => onSpeedDelete?.(id));
    audioIds.forEach((id) => onAudioDelete?.(id));

    onClearAutoCaptions?.();
    clearSelectedBlocks();
    setSelectedKeyframeId(null);
  }, [
    annotationRegions,
    audioRegions,
    clearSelectedBlocks,
    onAnnotationDelete,
    onAudioDelete,
    onClearAutoCaptions,
    onSpeedDelete,
    onTrimDelete,
    onZoomDelete,
    speedRegions,
    trimRegions,
    zoomRegions,
  ]);

  const handleSelectZoom = useCallback((id: string | null) => {
    setSelectAllBlocksActive(false);
    onSelectZoom(id);
    if (id) {
      onSelectTrim?.(null);
      onSelectAnnotation?.(null);
      onSelectSpeed?.(null);
      onSelectAudio?.(null);
      onSelectCaption?.(null);
    }
  }, [onSelectZoom, onSelectTrim, onSelectAnnotation, onSelectSpeed, onSelectAudio, onSelectCaption]);

  const handleSelectTrim = useCallback((id: string | null) => {
    setSelectAllBlocksActive(false);
    onSelectTrim?.(id);
    if (id) {
      onSelectZoom(null);
      onSelectAnnotation?.(null);
      onSelectSpeed?.(null);
      onSelectAudio?.(null);
      onSelectCaption?.(null);
    }
  }, [onSelectZoom, onSelectTrim, onSelectAnnotation, onSelectSpeed, onSelectAudio, onSelectCaption]);

  const handleSelectAnnotation = useCallback((id: string | null) => {
    setSelectAllBlocksActive(false);
    onSelectAnnotation?.(id);
    if (id) {
      onSelectZoom(null);
      onSelectTrim?.(null);
      onSelectSpeed?.(null);
      onSelectAudio?.(null);
      onSelectCaption?.(null);
    }
  }, [onSelectZoom, onSelectTrim, onSelectAnnotation, onSelectSpeed, onSelectAudio, onSelectCaption]);

  const handleSelectSpeed = useCallback((id: string | null) => {
    setSelectAllBlocksActive(false);
    onSelectSpeed?.(id);
    if (id) {
      onSelectZoom(null);
      onSelectTrim?.(null);
      onSelectAnnotation?.(null);
      onSelectAudio?.(null);
      onSelectCaption?.(null);
    }
  }, [onSelectZoom, onSelectTrim, onSelectAnnotation, onSelectSpeed, onSelectAudio, onSelectCaption]);

  const handleSelectAudio = useCallback((id: string | null) => {
    setSelectAllBlocksActive(false);
    onSelectAudio?.(id);
    if (id) {
      onSelectZoom(null);
      onSelectTrim?.(null);
      onSelectAnnotation?.(null);
      onSelectSpeed?.(null);
      onSelectCaption?.(null);
    }
  }, [onSelectZoom, onSelectTrim, onSelectAnnotation, onSelectSpeed, onSelectAudio, onSelectCaption]);

  const handleSelectCaption = useCallback((id: string | null) => {
    setSelectAllBlocksActive(false);
    onSelectCaption?.(id);
    if (id) {
      onSelectZoom(null);
      onSelectTrim?.(null);
      onSelectAnnotation?.(null);
      onSelectSpeed?.(null);
      onSelectAudio?.(null);
    }
  }, [onSelectZoom, onSelectTrim, onSelectAnnotation, onSelectSpeed, onSelectAudio, onSelectCaption]);

  useEffect(() => {
    setRange(createInitialRange(totalMs));
  }, [totalMs]);

  // Normalize regions only when timeline bounds change (not on every region edit).
  // Using refs to read current regions avoids a dependency-loop that re-fires
  // this effect on every drag/resize and races with dnd-timeline's internal state.
  const zoomRegionsRef = useRef(zoomRegions);
  const trimRegionsRef = useRef(trimRegions);
  const speedRegionsRef = useRef(speedRegions);
  const audioRegionsRef = useRef(audioRegions);
  const autoCaptionsRef = useRef(autoCaptions);
  zoomRegionsRef.current = zoomRegions;
  trimRegionsRef.current = trimRegions;
  speedRegionsRef.current = speedRegions;
  audioRegionsRef.current = audioRegions;
  autoCaptionsRef.current = autoCaptions;

  useEffect(() => {
    if (totalMs === 0 || safeMinDurationMs <= 0) {
      return;
    }

    zoomRegionsRef.current.forEach((region) => {
      const clampedStart = Math.max(0, Math.min(region.startMs, totalMs));
      const minEnd = clampedStart + safeMinDurationMs;
      const clampedEnd = Math.min(totalMs, Math.max(minEnd, region.endMs));
      const normalizedStart = Math.max(0, Math.min(clampedStart, totalMs - safeMinDurationMs));
      const normalizedEnd = Math.max(minEnd, Math.min(clampedEnd, totalMs));

      if (normalizedStart !== region.startMs || normalizedEnd !== region.endMs) {
        onZoomSpanChange(region.id, { start: normalizedStart, end: normalizedEnd });
      }
    });

    trimRegionsRef.current.forEach((region) => {
      const clampedStart = Math.max(0, Math.min(region.startMs, totalMs));
      const minEnd = clampedStart + safeMinDurationMs;
      const clampedEnd = Math.min(totalMs, Math.max(minEnd, region.endMs));
      const normalizedStart = Math.max(0, Math.min(clampedStart, totalMs - safeMinDurationMs));
      const normalizedEnd = Math.max(minEnd, Math.min(clampedEnd, totalMs));

      if (normalizedStart !== region.startMs || normalizedEnd !== region.endMs) {
        onTrimSpanChange?.(region.id, { start: normalizedStart, end: normalizedEnd });
      }
    });

    speedRegionsRef.current.forEach((region) => {
      const clampedStart = Math.max(0, Math.min(region.startMs, totalMs));
      const minEnd = clampedStart + safeMinDurationMs;
      const clampedEnd = Math.min(totalMs, Math.max(minEnd, region.endMs));
      const normalizedStart = Math.max(0, Math.min(clampedStart, totalMs - safeMinDurationMs));
      const normalizedEnd = Math.max(minEnd, Math.min(clampedEnd, totalMs));

      if (normalizedStart !== region.startMs || normalizedEnd !== region.endMs) {
        onSpeedSpanChange?.(region.id, { start: normalizedStart, end: normalizedEnd });
      }
    });

    audioRegionsRef.current.forEach((region) => {
      const clampedStart = Math.max(0, Math.min(region.startMs, totalMs));
      const minEnd = clampedStart + safeMinDurationMs;
      const clampedEnd = Math.min(totalMs, Math.max(minEnd, region.endMs));
      const normalizedStart = Math.max(0, Math.min(clampedStart, totalMs - safeMinDurationMs));
      const normalizedEnd = Math.max(minEnd, Math.min(clampedEnd, totalMs));

      if (normalizedStart !== region.startMs || normalizedEnd !== region.endMs) {
        onAudioSpanChange?.(region.id, { start: normalizedStart, end: normalizedEnd });
      }
    });

    autoCaptionsRef.current.forEach((caption: CaptionCue) => {
      const clampedStart = Math.max(0, Math.min(caption.startMs, totalMs));
      const minEnd = clampedStart + safeMinDurationMs;
      const clampedEnd = Math.min(totalMs, Math.max(minEnd, caption.endMs));
      const normalizedStart = Math.max(0, Math.min(clampedStart, totalMs - safeMinDurationMs));
      const normalizedEnd = Math.max(minEnd, Math.min(clampedEnd, totalMs));

      if (normalizedStart !== caption.startMs || normalizedEnd !== caption.endMs) {
        onCaptionSpanChange?.(caption.id, { start: normalizedStart, end: normalizedEnd });
      }
    });
    // Only re-run when the timeline scale changes, not on every region edit
  }, [totalMs, safeMinDurationMs, onZoomSpanChange, onTrimSpanChange, onSpeedSpanChange, onAudioSpanChange, onCaptionSpanChange]);

  const hasOverlap = useCallback((newSpan: Span, excludeId?: string): boolean => {
    // Determine which row the item belongs to
    const isZoomItem = zoomRegions.some(r => r.id === excludeId);
    const isTrimItem = trimRegions.some(r => r.id === excludeId);
    const isAnnotationItem = annotationRegions.some(r => r.id === excludeId);
    const isSpeedItem = speedRegions.some(r => r.id === excludeId);
    const isAudioItem = audioRegions.some(r => r.id === excludeId);
    const isCaptionItem = autoCaptions.some(r => r.id === excludeId);

    if (isAnnotationItem || isCaptionItem) {
      return false;
    }

    // Helper to check overlap against a specific set of regions
    const checkOverlap = (regions: (ZoomRegion | TrimRegion | SpeedRegion | AudioRegion)[]) => {
      return regions.some((region) => {
        if (region.id === excludeId) return false;
        // True overlap: regions actually intersect (not just adjacent)
        return newSpan.end > region.startMs && newSpan.start < region.endMs;
      });
    };

    if (isZoomItem) {
      return checkOverlap(zoomRegions);
    }

    if (isTrimItem) {
      return checkOverlap(trimRegions);
    }

    if (isSpeedItem) {
      return checkOverlap(speedRegions);
    }

    if (isAudioItem) {
      return checkOverlap(audioRegions);
    }

    return false;
  }, [zoomRegions, trimRegions, annotationRegions, speedRegions, audioRegions, autoCaptions]);

  // Keep newly added timeline regions at the original short default instead of
  // scaling them with the full recording length.
  const defaultRegionDurationMs = useMemo(
    () => Math.min(1000, totalMs),
    [totalMs],
  );

  const handleAddZoom = useCallback(() => {
    if (!videoDuration || videoDuration === 0 || totalMs === 0) {
      return;
    }

    const defaultDuration = Math.min(defaultRegionDurationMs, totalMs);
    if (defaultDuration <= 0) {
      return;
    }

    // Always place zoom at playhead
    const startPos = Math.max(0, Math.min(currentTimeMs, totalMs));
    const sorted = [...zoomRegions].sort((a, b) => a.startMs - b.startMs);
    const nextRegion = sorted.find(region => region.startMs > startPos);
    const gapToNext = nextRegion ? nextRegion.startMs - startPos : totalMs - startPos;

    const actualDuration = Math.min(defaultRegionDurationMs, gapToNext);

    const finalStart = startPos;
    const finalEnd = startPos + actualDuration;

    onZoomAdded({ start: finalStart, end: finalEnd });
  }, [videoDuration, totalMs, currentTimeMs, zoomRegions, onZoomAdded, defaultRegionDurationMs]);

  const handleSuggestZooms = useCallback(() => {
    if (!videoDuration || videoDuration === 0 || totalMs === 0) {
      return;
    }

    if (disableSuggestedZooms) {
      toast.info("Suggested zooms are unavailable while cursor looping is enabled.");
      return;
    }

    if (!onZoomSuggested) {
      toast.error("Zoom suggestion handler unavailable");
      return;
    }

    if (cursorTelemetry.length < 2) {
      toast.info("No cursor telemetry available", {
        description: "Record a screencast first to generate cursor-based suggestions.",
      });
      return;
    }

    const defaultDuration = Math.min(defaultRegionDurationMs, totalMs);
    if (defaultDuration <= 0) {
      return;
    }

    const reservedSpans = [...zoomRegions]
      .map((region) => ({ start: region.startMs, end: region.endMs }))
      .sort((a, b) => a.start - b.start);

    const normalizedSamples = normalizeCursorTelemetry(cursorTelemetry, totalMs);

    if (normalizedSamples.length < 2) {
      toast.info("No usable cursor telemetry", {
        description: "The recording does not include enough cursor movement data.",
      });
      return;
    }

    const dwellCandidates = detectInteractionCandidates(normalizedSamples);

    if (dwellCandidates.length === 0) {
      toast.info("No clear interaction moments found", {
        description: "Try a recording with pauses or clicks around important actions.",
      });
      return;
    }

    const sortedCandidates = [...dwellCandidates].sort((a, b) => b.strength - a.strength);
    const acceptedCenters: number[] = [];

    let addedCount = 0;

    sortedCandidates.forEach((candidate) => {
      const tooCloseToAccepted = acceptedCenters.some(
        (center) => Math.abs(center - candidate.centerTimeMs) < SUGGESTION_SPACING_MS,
      );

      if (tooCloseToAccepted) {
        return;
      }

      const centeredStart = Math.round(candidate.centerTimeMs - defaultDuration / 2);
      const candidateStart = Math.max(0, Math.min(centeredStart, totalMs - defaultDuration));
      const candidateEnd = candidateStart + defaultDuration;
      const hasOverlap = reservedSpans.some(
        (span) => candidateEnd > span.start && candidateStart < span.end,
      );

      if (hasOverlap) {
        return;
      }

      reservedSpans.push({ start: candidateStart, end: candidateEnd });
      acceptedCenters.push(candidate.centerTimeMs);
      onZoomSuggested({ start: candidateStart, end: candidateEnd }, candidate.focus);
      addedCount += 1;
    });

    if (addedCount === 0) {
      toast.info("No auto-zoom slots available", {
        description: "Detected dwell points overlap existing zoom regions.",
      });
      return;
    }

    toast.success(`Added ${addedCount} interaction-based zoom suggestion${addedCount === 1 ? "" : "s"}`);
  }, [
    videoDuration,
    totalMs,
    defaultRegionDurationMs,
    zoomRegions,
    disableSuggestedZooms,
    onZoomSuggested,
    cursorTelemetry,
  ]);

  const handleAddTrim = useCallback(() => {
    if (!videoDuration || videoDuration === 0 || totalMs === 0 || !onTrimAdded) {
      return;
    }

    const defaultDuration = Math.min(defaultRegionDurationMs, totalMs);
    if (defaultDuration <= 0) {
      return;
    }

    // Always place trim at playhead
    const startPos = Math.max(0, Math.min(currentTimeMs, totalMs));
    const sorted = [...trimRegions].sort((a, b) => a.startMs - b.startMs);
    const nextRegion = sorted.find(region => region.startMs > startPos);
    const gapToNext = nextRegion ? nextRegion.startMs - startPos : totalMs - startPos;

    const actualDuration = Math.min(defaultRegionDurationMs, gapToNext);

    const finalStart = startPos;
    const finalEnd = startPos + actualDuration;

    onTrimAdded({ start: finalStart, end: finalEnd });
  }, [videoDuration, totalMs, currentTimeMs, trimRegions, onTrimAdded, defaultRegionDurationMs]);

  const handleAddSpeed = useCallback(() => {
    if (!videoDuration || videoDuration === 0 || totalMs === 0 || !onSpeedAdded) {
      return;
    }

    const defaultDuration = Math.min(defaultRegionDurationMs, totalMs);
    if (defaultDuration <= 0) {
      return;
    }

    // Always place speed region at playhead
    const startPos = Math.max(0, Math.min(currentTimeMs, totalMs));
    const sorted = [...speedRegions].sort((a, b) => a.startMs - b.startMs);
    const nextRegion = sorted.find(region => region.startMs > startPos);
    const gapToNext = nextRegion ? nextRegion.startMs - startPos : totalMs - startPos;

    const actualDuration = Math.min(defaultRegionDurationMs, gapToNext);

    const finalStart = startPos;
    const finalEnd = startPos + actualDuration;

    onSpeedAdded({ start: finalStart, end: finalEnd });
  }, [videoDuration, totalMs, currentTimeMs, speedRegions, onSpeedAdded, defaultRegionDurationMs]);

  const handleAddAudio = useCallback(async () => {
    if (!videoDuration || videoDuration === 0 || totalMs === 0 || !onAudioAdded) {
      return;
    }

    const result = await (window as any).electronAPI.openAudioFilePicker();
    if (!result?.success || !result.path) {
      return;
    }

    const audioPath = result.path;

    // Load the audio file to get its full duration
    const audioDurationMs = await new Promise<number>((resolve) => {
      const audio = new Audio(toFileUrl(audioPath));
      audio.addEventListener('loadedmetadata', () => {
        resolve(Math.round(audio.duration * 1000));
      });
      audio.addEventListener('error', () => {
        resolve(0);
      });
    });

    if (audioDurationMs <= 0) {
      toast.error("Could not read audio file", {
        description: "The selected file may be corrupted or in an unsupported format.",
      });
      return;
    }

    const startPos = Math.max(0, Math.min(currentTimeMs, totalMs));
    const sorted = [...audioRegions].sort((a, b) => a.startMs - b.startMs);
    const nextRegion = sorted.find(region => region.startMs > startPos);
    const gapToNext = nextRegion ? nextRegion.startMs - startPos : totalMs - startPos;

    const isOverlapping = sorted.some(region => startPos >= region.startMs && startPos < region.endMs);
    if (isOverlapping || gapToNext <= 0) {
      toast.error("Cannot place audio here", {
        description: "Audio region already exists at this location or not enough space available.",
      });
      return;
    }

    // Use full audio duration, but clamp to available gap and video length
    const actualDuration = Math.min(audioDurationMs, gapToNext, totalMs - startPos);
    onAudioAdded({ start: startPos, end: startPos + actualDuration }, result.path);
  }, [videoDuration, totalMs, currentTimeMs, audioRegions, onAudioAdded]);

  const handleAddAnnotation = useCallback(() => {
    if (!videoDuration || videoDuration === 0 || totalMs === 0 || !onAnnotationAdded) {
      return;
    }

    const defaultDuration = Math.min(defaultRegionDurationMs, totalMs);
    if (defaultDuration <= 0) {
      return;
    }

    // Multiple annotations can exist at the same timestamp
    const finalStart = Math.max(0, Math.min(currentTimeMs, totalMs));
    const finalEnd = Math.min(finalStart + defaultDuration, totalMs);

    onAnnotationAdded({ start: finalStart, end: finalEnd });
  }, [videoDuration, totalMs, currentTimeMs, onAnnotationAdded, defaultRegionDurationMs]);


  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      if (matchesShortcut(e, { key: 'a', ctrl: true }, isMac)) {
        if (!hasAnyTimelineBlocks || !isTimelineFocusedRef.current) {
          return;
        }

        e.preventDefault();
        setSelectedKeyframeId(null);
        setSelectAllBlocksActive(true);
        return;
      }

      if (matchesShortcut(e, keyShortcuts.addZoom, isMac)) {
        handleAddZoom();
      }
      if (matchesShortcut(e, keyShortcuts.addTrim, isMac)) {
        handleAddTrim();
      }
      if (matchesShortcut(e, keyShortcuts.addAnnotation, isMac)) {
        handleAddAnnotation();
      }
      if (matchesShortcut(e, keyShortcuts.addSpeed, isMac)) {
        handleAddSpeed();
      }




      // Tab: Cycle through overlapping annotations at current time
      if (e.key === 'Tab' && annotationRegions.length > 0) {
        const currentTimeMs = Math.round(currentTime * 1000);
        const overlapping = annotationRegions
          .filter(a => currentTimeMs >= a.startMs && currentTimeMs <= a.endMs)
          .sort((a, b) => a.zIndex - b.zIndex); // Sort by z-index

        if (overlapping.length > 0) {
          e.preventDefault();

          if (!selectedAnnotationId || !overlapping.some(a => a.id === selectedAnnotationId)) {
            onSelectAnnotation?.(overlapping[0].id);
          } else {
            // Cycle to next annotation
            const currentIndex = overlapping.findIndex(a => a.id === selectedAnnotationId);
            const nextIndex = e.shiftKey
              ? (currentIndex - 1 + overlapping.length) % overlapping.length // Shift+Tab = backward
              : (currentIndex + 1) % overlapping.length; // Tab = forward
            onSelectAnnotation?.(overlapping[nextIndex].id);
          }
        }
      }
      // Delete key or Ctrl+D / Cmd+D
      if (e.key === 'Delete' || e.key === 'Backspace' || matchesShortcut(e, keyShortcuts.deleteSelected, isMac)) {
        if (selectAllBlocksActive) {
          e.preventDefault();
          deleteAllBlocks();
        } else if (selectedKeyframeId) {
          deleteSelectedKeyframe();
        } else if (selectedZoomId) {
          deleteSelectedZoom();
        } else if (selectedTrimId) {
          deleteSelectedTrim();
        } else if (selectedAnnotationId) {
          deleteSelectedAnnotation();
        } else if (selectedSpeedId) {
          deleteSelectedSpeed();
        } else if (selectedAudioId) {
          deleteSelectedAudio();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [addKeyframe, handleAddZoom, handleAddTrim, handleAddAnnotation, handleAddSpeed, deleteAllBlocks, deleteSelectedKeyframe, deleteSelectedZoom, deleteSelectedTrim, deleteSelectedAnnotation, deleteSelectedSpeed, deleteSelectedAudio, selectedKeyframeId, selectedZoomId, selectedTrimId, selectedAnnotationId, selectedSpeedId, selectedAudioId, annotationRegions, currentTime, hasAnyTimelineBlocks, onSelectAnnotation, keyShortcuts, isMac, selectAllBlocksActive]);

  const clampedRange = useMemo<Range>(() => {
    if (totalMs === 0) {
      return range;
    }

    return {
      start: Math.max(0, Math.min(range.start, totalMs)),
      end: Math.min(range.end, totalMs),
    };
  }, [range, totalMs]);

  const timelineItems = useMemo<TimelineRenderItem[]>(() => {
    const zooms: TimelineRenderItem[] = zoomRegions.map((region, index) => ({
      id: region.id,
      rowId: ZOOM_ROW_ID,
      span: { start: region.startMs, end: region.endMs },
      label: `Zoom ${index + 1}`,
      zoomDepth: region.depth,
      variant: 'zoom',
    }));

    const trims: TimelineRenderItem[] = trimRegions.map((region, index) => ({
      id: region.id,
      rowId: TRIM_ROW_ID,
      span: { start: region.startMs, end: region.endMs },
      label: `Trim ${index + 1}`,
      variant: 'trim',
    }));

    const annotations: TimelineRenderItem[] = annotationRegions.map((region) => {
      let label: string;

      if (region.type === 'text') {
        // Show text preview
        const preview = region.content.trim() || 'Empty text';
        label = preview.length > 20 ? `${preview.substring(0, 20)}...` : preview;
      } else if (region.type === 'image') {
        label = 'Image';
      } else {
        label = 'Annotation';
      }

      return {
        id: region.id,
        rowId: ANNOTATION_ROW_ID,
        span: { start: region.startMs, end: region.endMs },
        label,
        variant: 'annotation',
      };
    });

    const speeds: TimelineRenderItem[] = speedRegions.map((region, index) => ({
      id: region.id,
      rowId: SPEED_ROW_ID,
      span: { start: region.startMs, end: region.endMs },
      label: `Speed ${index + 1}`,
      speedValue: region.speed,
      variant: 'speed',
    }));

    const videoAudio: TimelineRenderItem[] = videoPath && totalMs > 0 ? [{
      id: 'original-video-audio',
      rowId: ORIGINAL_AUDIO_ROW_ID,
      span: { start: 0, end: totalMs },
      label: 'Original Audio',
      variant: 'audio',
      audioPath: videoPath,
      muted: masterAudioMuted
    }] : [];

    const audios: TimelineRenderItem[] = [
      ...audioRegions.map((audio): TimelineRenderItem => ({
        id: audio.id,
        rowId: AUDIO_ROW_ID,
        span: { start: audio.startMs, end: audio.endMs },
        label: audio.audioPath.split(/[\\/]/).pop() || 'Audio',
        variant: 'audio',
        audioPath: audio.audioPath,
        muted: audio.muted,
        soloed: audio.soloed,
        fadeInMs: audio.fadeInMs,
        fadeOutMs: audio.fadeOutMs
      })),
      ...autoCaptions.map((cue): TimelineRenderItem => ({
        id: cue.id,
        rowId: CAPTION_ROW_ID,
        span: { start: cue.startMs, end: cue.endMs },
        label: cue.text,
        variant: 'caption'
      }))
    ];

    return [...zooms, ...trims, ...annotations, ...speeds, ...videoAudio, ...audios];
  }, [zoomRegions, trimRegions, annotationRegions, speedRegions, audioRegions, autoCaptions, videoPath, totalMs, masterAudioMuted]);

  // Flat list of all non-annotation region spans for neighbour-clamping during drag/resize
  const allRegionSpans = useMemo(() => {
    const zooms = zoomRegions.map((r) => ({ id: r.id, start: r.startMs, end: r.endMs }));
    const trims = trimRegions.map((r) => ({ id: r.id, start: r.startMs, end: r.endMs }));
    const speeds = speedRegions.map((r) => ({ id: r.id, start: r.startMs, end: r.endMs }));
    const audios = audioRegions.map((r) => ({ id: r.id, start: r.startMs, end: r.endMs }));
    const captions = autoCaptions.map((r) => ({ id: r.id, start: r.startMs, end: r.endMs }));
    return [...zooms, ...trims, ...speeds, ...audios, ...captions];
  }, [zoomRegions, trimRegions, speedRegions, audioRegions, autoCaptions]);

  const handleItemSpanChange = useCallback((id: string, span: Span, rowId: string) => {
    if (rowId === ZOOM_ROW_ID) {
      onZoomSpanChange(id, span);
    } else if (rowId === TRIM_ROW_ID && onTrimSpanChange) {
      onTrimSpanChange(id, span);
    } else if (rowId === ANNOTATION_ROW_ID && onAnnotationSpanChange) {
      onAnnotationSpanChange(id, span);
    } else if (rowId === SPEED_ROW_ID && onSpeedSpanChange) {
      onSpeedSpanChange(id, span);
    } else if (rowId === AUDIO_ROW_ID && onAudioSpanChange) {
      onAudioSpanChange(id, span);
    } else if (rowId === CAPTION_ROW_ID && onCaptionSpanChange) {
      onCaptionSpanChange(id, span);
    }
  }, [onZoomSpanChange, onTrimSpanChange, onAnnotationSpanChange, onSpeedSpanChange, onAudioSpanChange, onCaptionSpanChange]);

  const panTimelineRange = useCallback((deltaMs: number) => {
    if (!Number.isFinite(deltaMs) || deltaMs === 0 || totalMs <= 0) {
      return;
    }

    setRange((previous) => {
      const visibleSpan = Math.max(1, previous.end - previous.start);
      const maxStart = Math.max(0, totalMs - visibleSpan);
      const nextStart = Math.max(0, Math.min(previous.start + deltaMs, maxStart));

      return {
        start: nextStart,
        end: nextStart + visibleSpan,
      };
    });
  }, [totalMs]);

  const handleTimelineWheel = useCallback((event: WheelEvent<HTMLDivElement>) => {
    if (event.ctrlKey || event.metaKey || totalMs <= 0) {
      return;
    }

    const rawHorizontalDelta = Math.abs(event.deltaX) > 0
      ? event.deltaX
      : event.shiftKey && Math.abs(event.deltaY) > 0
        ? event.deltaY
        : 0;

    if (rawHorizontalDelta === 0) {
      return;
    }

    const containerWidth = timelineContainerRef.current?.clientWidth ?? 0;
    const visibleRangeMs = clampedRange.end - clampedRange.start;

    if (containerWidth <= 0 || visibleRangeMs <= 0) {
      return;
    }

    event.preventDefault();

    const horizontalDeltaPx = normalizeWheelDeltaToPixels(rawHorizontalDelta, event.deltaMode);
    const deltaMs = (horizontalDeltaPx / containerWidth) * visibleRangeMs;

    panTimelineRange(deltaMs);
  }, [clampedRange.end, clampedRange.start, panTimelineRange, totalMs]);

  if (!videoDuration || videoDuration === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center rounded-lg bg-[#17171a] gap-3">
        <div className="w-12 h-12 rounded-full bg-white/5 flex items-center justify-center">
          <Plus className="w-6 h-6 text-slate-600" />
        </div>
        <div className="text-center">
          <p className="text-sm font-medium text-slate-300">No Video Loaded</p>
          <p className="text-xs text-slate-500 mt-1">Drag and drop a video to start editing</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-[#17171a] overflow-auto">
      <div className="flex items-center gap-4 px-4 py-2 border-b border-white/10 bg-[#161619]">




        <div className="w-[1px] h-4 bg-white/10" />
        <div className="flex items-center gap-1">
          <Button
            onClick={handleAddZoom}
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-slate-400 hover:text-[#2563EB] hover:bg-[#2563EB]/10 transition-all"
            title="Add Zoom (Z)"
          >
            <ZoomIn className="w-4 h-4" />
          </Button>
          <Button
            onClick={handleSuggestZooms}
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-slate-400 hover:text-[#2563EB] hover:bg-[#2563EB]/10 transition-all"
            title="Suggest Zooms from Cursor"
          >
            <WandSparkles className="w-4 h-4" />
          </Button>
          <Button
            onClick={handleAddTrim}
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-slate-400 hover:text-[#ef4444] hover:bg-[#ef4444]/10 transition-all"
            title="Add Trim (T)"
          >
            <Scissors className="w-4 h-4" />
          </Button>
          <Button
            onClick={handleAddAnnotation}
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-slate-400 hover:text-[#B4A046] hover:bg-[#B4A046]/10 transition-all"
            title="Add Annotation (A)"
          >
            <MessageSquare className="w-4 h-4" />
          </Button>
          <Button
            onClick={handleAddSpeed}
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-slate-400 hover:text-[#d97706] hover:bg-[#d97706]/10 transition-all"
            title="Add Speed (S)"
          >
            <Gauge className="w-4 h-4" />
          </Button>
          <Button
            onClick={handleAddAudio}
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-slate-400 hover:text-[#a855f7] hover:bg-[#a855f7]/10 transition-all"
            title="Add Audio"
          >
            <Music className="w-4 h-4" />
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs text-slate-400 hover:text-slate-200 hover:bg-white/10 transition-all gap-1"
              >
                <span className="font-medium">{getAspectRatioLabel(aspectRatio)}</span>
                <ChevronDown className="w-3 h-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="bg-[#1a1a1c] border-white/10">
              {ASPECT_RATIOS.map((ratio) => (
                <DropdownMenuItem
                  key={ratio}
                  onClick={() => onAspectRatioChange(ratio)}
                  className="text-slate-300 hover:text-white hover:bg-white/10 cursor-pointer flex items-center justify-between gap-3"
                >
                  <span>{getAspectRatioLabel(ratio)}</span>
                  {aspectRatio === ratio && <Check className="w-3 h-3 text-[#2563EB]" />}
                </DropdownMenuItem>
              ))}
              <div className="mx-1 my-1 h-px bg-white/10" />
              <div className="px-2 py-1.5 flex items-center gap-2 text-slate-300">
                <span className="text-sm">Custom</span>
                <input
                  type="text"
                  inputMode="numeric"
                  value={customAspectWidth}
                  onChange={(event) => setCustomAspectWidth(event.target.value.replace(/\D/g, ''))}
                  onKeyDown={handleCustomAspectRatioKeyDown}
                  className="w-12 h-7 rounded border border-white/15 bg-black/20 px-1.5 text-sm text-slate-100 focus:outline-none focus:ring-1 focus:ring-[#2563EB]"
                  aria-label="Custom aspect width"
                />
                <span className="text-slate-500">:</span>
                <input
                  type="text"
                  inputMode="numeric"
                  value={customAspectHeight}
                  onChange={(event) => setCustomAspectHeight(event.target.value.replace(/\D/g, ''))}
                  onKeyDown={handleCustomAspectRatioKeyDown}
                  className="w-12 h-7 rounded border border-white/15 bg-black/20 px-1.5 text-sm text-slate-100 focus:outline-none focus:ring-1 focus:ring-[#2563EB]"
                  aria-label="Custom aspect height"
                />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={applyCustomAspectRatio}
                  className="h-7 px-2 text-xs text-slate-300 hover:text-white hover:bg-white/10"
                >
                  Set
                </Button>
                {isCustomAspectRatio(aspectRatio) && <Check className="w-3 h-3 text-[#2563EB] ml-auto" />}
              </div>
            </DropdownMenuContent>
          </DropdownMenu>
          <div className="w-[1px] h-4 bg-white/10" />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onOpenCropEditor?.()}
            className="h-7 px-2 text-xs text-slate-400 hover:text-slate-200 hover:bg-white/10 transition-all gap-1.5"
          >
            <Crop className="w-3.5 h-3.5" />
            <span className="font-medium">{t("sections.crop", "Crop")}</span>
            {isCropped ? <span className="h-1.5 w-1.5 rounded-full bg-[#2563EB]" /> : null}
          </Button>
          <TutorialHelp />
        </div>
        <div className="flex-1" />
        <div className="flex items-center gap-4 text-[10px] text-slate-500 font-medium">
          <span className="flex items-center gap-1.5">
            <kbd className="px-1.5 py-0.5 bg-white/5 border border-white/10 rounded text-[#2563EB] font-sans">Side Scroll</kbd>
            <span>Pan</span>
          </span>
          <span className="flex items-center gap-1.5">
            <kbd className="px-1.5 py-0.5 bg-white/5 border border-white/10 rounded text-[#2563EB] font-sans">{scrollLabels.pan}</kbd>
            <span>Pan</span>
          </span>
          <span className="flex items-center gap-1.5">
            <kbd className="px-1.5 py-0.5 bg-white/5 border border-white/10 rounded text-[#2563EB] font-sans">{scrollLabels.zoom}</kbd>
            <span>Zoom</span>
          </span>
        </div>
      </div>
      <div
        ref={timelineContainerRef}
        className="flex-1 min-h-0 overflow-auto bg-[#17171a] relative"
        tabIndex={0}
        onFocus={() => {
          isTimelineFocusedRef.current = true;
        }}
        onBlur={() => {
          isTimelineFocusedRef.current = false;
        }}
        onMouseDown={() => {
          timelineContainerRef.current?.focus();
          isTimelineFocusedRef.current = true;
        }}
        onClick={() => {
          setSelectedKeyframeId(null);
          setSelectAllBlocksActive(false);
        }}
        onWheel={handleTimelineWheel}
      >
        <TimelineWrapper
          range={clampedRange}
          videoDuration={videoDuration}
          hasOverlap={hasOverlap}
          onRangeChange={setRange}
          minItemDurationMs={timelineScale.minItemDurationMs}
          minVisibleRangeMs={timelineScale.minVisibleRangeMs}
          onItemSpanChange={handleItemSpanChange}
          allRegionSpans={allRegionSpans}
        >
          <KeyframeMarkers
            keyframes={keyframes}
            selectedKeyframeId={selectedKeyframeId}
            setSelectedKeyframeId={setSelectedKeyframeId}
            onKeyframeMove={handleKeyframeMove}
            videoDurationMs={totalMs}
            timelineRef={timelineContainerRef}
          />
          <Timeline
            items={timelineItems}
            videoDurationMs={totalMs}
            currentTimeMs={currentTimeMs}
            onSeek={onSeek}
            onSelectZoom={handleSelectZoom}
            onSelectTrim={handleSelectTrim}
            onSelectAnnotation={handleSelectAnnotation}
            onSelectSpeed={handleSelectSpeed}
            onSelectAudio={handleSelectAudio}
            onAudioMutedChange={onAudioMutedChange}
            onAudioSoloedChange={onAudioSoloedChange}
            audioRegions={audioRegions}
            onSelectCaption={handleSelectCaption}
            masterAudioMuted={masterAudioMuted}
            onMasterAudioMutedChange={onMasterAudioMutedChange}
            masterAudioSoloed={masterAudioSoloed}
            onMasterAudioSoloedChange={onMasterAudioSoloedChange}
            masterAudioVolume={masterAudioVolume}
            audioTrackVolume={audioTrackVolume}
            selectedZoomId={selectedZoomId}
            selectedTrimId={selectedTrimId}
            selectedAnnotationId={selectedAnnotationId}
            selectedSpeedId={selectedSpeedId}
            selectedAudioId={selectedAudioId}
            selectedCaptionId={selectedCaptionId}
            selectAllBlocksActive={selectAllBlocksActive}
            onClearBlockSelection={clearSelectedBlocks}
            keyframes={keyframes}
            isMasterSelected={isMasterSelected}
            onSelectMaster={onSelectMaster}
          />
        </TimelineWrapper>
      </div>
    </div>
  );
}
