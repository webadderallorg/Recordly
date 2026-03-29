import type { Span } from "dnd-timeline";
import { useItem } from "dnd-timeline";
import { Gauge, MessageSquare, Music, Scissors, ZoomIn } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import glassStyles from "./ItemGlass.module.css";
import { generateWaveform } from "@/utils/audioWaveform";




interface ItemProps {
  id: string;
  span: Span;
  rowId: string;
  children: React.ReactNode;
  isSelected?: boolean;
  onSelect?: () => void;
  zoomDepth?: number;
  speedValue?: number;
  audioPath?: string;
  variant?: 'zoom' | 'trim' | 'annotation' | 'speed' | 'audio' | 'caption' | 'caption-range';
  isDraggable?: boolean;
  isResizable?: boolean;
  muted?: boolean;
  fadeInMs?: number;
  fadeOutMs?: number;
}

// Map zoom depth to multiplier labels
const ZOOM_LABELS: Record<number, string> = {
	1: "1.25×",
	2: "1.5×",
	3: "1.8×",
	4: "2.2×",
	5: "3.5×",
	6: "5×",
};

function formatMs(ms: number): string {
	const totalSeconds = ms / 1000;
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	if (minutes > 0) {
		return `${minutes}:${seconds.toFixed(1).padStart(4, "0")}`;
	}
	return `${seconds.toFixed(1)}s`;
}

export default function Item({
	id,
	span,
	rowId,
	isSelected = false,
	onSelect,
	zoomDepth = 1,
	speedValue,
	audioPath,
	variant = "zoom",
	children,
  isDraggable = true,
  isResizable = true,
  muted = false,
  fadeInMs,
  fadeOutMs,
}: ItemProps) {
  const isDraggableEffective = isDraggable;

	const { setNodeRef, attributes, listeners, itemStyle, itemContentStyle } = useItem({
		id,
		span,
		disabled: !isDraggableEffective,
		data: { rowId },
	});

  const durationMs = span.end - span.start;

  const isZoom = variant === 'zoom';
  const isTrim = variant === 'trim';
  const isSpeed = variant === 'speed';
  const isAudio = variant === 'audio';
  const isCaption = variant === 'caption';
  const isCaptionRange = variant === 'caption-range';

  const [waveform, setWaveform] = useState<number[] | null>(null);

  useEffect(() => {
    if (isAudio && audioPath) {
      generateWaveform(audioPath).then((peaks) => {
        setWaveform(peaks);
      });
    }
  }, [isAudio, audioPath]);

  const mouseDownPosRef = useRef({ x: 0, y: 0 });

  const handlePointerDown = (e: React.PointerEvent) => {
    mouseDownPosRef.current = { x: e.clientX, y: e.clientY };
    // If dragging is enabled, let dnd-timeline handle its part
    if (isDraggableEffective) {
      listeners?.onPointerDown(e);
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    // We MUST NOT stop propagation on the pointer-up event.
    // Standard dnd libraries (like dnd-timeline) need this event to bubble
    // up to the window/document to successfully terminate the drag state.
    // If we stop it here, the item stays 'sticky' to the mouse.
    const deltaX = Math.abs(e.clientX - mouseDownPosRef.current.x);
    const deltaY = Math.abs(e.clientY - mouseDownPosRef.current.y);
    
    if (deltaX < 5 && deltaY < 5) {
      onSelect?.();
    }
  };




  const glassClass = isZoom
    ? glassStyles.glassGreen
    : isTrim
    ? glassStyles.glassRed
    : isSpeed
    ? glassStyles.glassAmber
    : isAudio
    ? glassStyles.glassPurple
    : isCaption
    ? glassStyles.glassCyan
    : isCaptionRange
    ? glassStyles.glassCyanDashed
    : glassStyles.glassYellow;

  const endCapColor = isZoom
    ? '#2563EB'
    : isTrim
    ? '#ef4444'
    : isSpeed
    ? '#d97706'
    : isAudio
    ? '#a855f7'
    : isCaption
    ? '#0891b2'
    : isCaptionRange
    ? '#06b6d4'
    : '#B4A046';

	const timeLabel = useMemo(
		() => `${formatMs(span.start)} – ${formatMs(span.end)}`,
		[span.start, span.end],
	);

  const MIN_ITEM_PX = 6;
  const safeItemStyle = { ...itemStyle, minWidth: MIN_ITEM_PX, height: "100%" };

  return (
    <div
      ref={setNodeRef}
      style={safeItemStyle}
      {...(isDraggableEffective ? attributes : {})}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onMouseDown={(e) => {
        // Prevent background selection logic
        e.stopPropagation();
      }}
      onClick={(e) => {
        // Prevent the timeline background's onClick (seeking) from firing
        // when we click on a track item.
        e.stopPropagation();
      }}
      className="group h-full"
    >

      <div className="h-full" style={{ ...itemContentStyle, minWidth: 24, height: "100%" }}>
        <div
          className={cn(
            glassClass,
            "w-full h-full overflow-hidden flex items-center justify-center gap-1.5 relative",
            isDraggableEffective ? "cursor-grab active:cursor-grabbing" : "cursor-default",
            isSelected && glassStyles.selected,
            muted && "opacity-40 grayscale-[0.5]"
          )}
          style={{ height: "100%", minHeight: 22, color: '#fff', minWidth: 24 }}
          onClick={(event) => {
            event.stopPropagation();
          }}
        >

          {/* Waveform Background for Audio */}
          {isAudio && waveform && (
            <div className="absolute inset-0 z-0 opacity-30 flex items-center pointer-events-none px-4">
              <svg
                width="100%"
                height="80%"
                viewBox={`0 0 ${waveform.length} 100`}
                preserveAspectRatio="none"
                className="text-white"
              >
                {waveform.map((peak, i) => (
                  <rect
                    key={i}
                    x={i}
                    y={50 - (peak * 50)}
                    width={0.8}
                    height={peak * 100}
                    fill="currentColor"
                    rx={0.2}
                  />
                ))}
              </svg>
            </div>
          )}

          {/* Fade Visualizations */}
          {isAudio && (fadeInMs || fadeOutMs) && (
            <div className="absolute inset-0 z-[5] pointer-events-none flex">
              {fadeInMs && fadeInMs > 0 && (
                <div 
                  className="h-full bg-gradient-to-r from-black/40 to-transparent"
                  style={{ width: `${(fadeInMs / durationMs) * 100}%` }}
                />
              )}
              <div className="flex-1" />
              {fadeOutMs && fadeOutMs > 0 && (
                <div 
                  className="h-full bg-gradient-to-l from-black/40 to-transparent"
                  style={{ width: `${(fadeOutMs / durationMs) * 100}%` }}
                />
              )}
            </div>
          )}

          {isResizable && (
            <>
              <div
                className={cn(glassStyles.zoomEndCap, glassStyles.left)}
                style={{ cursor: 'col-resize', pointerEvents: 'auto', width: 8, opacity: 0.9, background: endCapColor }}
                title="Resize left"
              />
              <div
                className={cn(glassStyles.zoomEndCap, glassStyles.right)}
                style={{ cursor: 'col-resize', pointerEvents: 'auto', width: 8, opacity: 0.9, background: endCapColor }}
                title="Resize right"
              />
            </>
          )}
          {/* Content */}
          <div className="relative z-10 flex flex-col items-center justify-center text-white/90 opacity-80 group-hover:opacity-100 transition-opacity select-none overflow-hidden max-w-full">
            <div className="flex items-center gap-1.5 max-w-full">
              {isZoom ? (
                <>
                  <ZoomIn className="w-3.5 h-3.5 shrink-0" />
                  <span className="text-[11px] font-semibold tracking-tight whitespace-nowrap">
                    {ZOOM_LABELS[zoomDepth] || `${zoomDepth}×`}
                  </span>
                </>
              ) : isTrim ? (
                <>
                  <Scissors className="w-3.5 h-3.5 shrink-0" />
                  <span className="text-[11px] font-semibold tracking-tight whitespace-nowrap">
                    Trim
                  </span>
                </>
              ) : isSpeed ? (
                <>
                  <Gauge className="w-3.5 h-3.5 shrink-0" />
                  <span className="text-[11px] font-semibold tracking-tight whitespace-nowrap">
                    {speedValue !== undefined ? `${speedValue}×` : 'Speed'}
                  </span>
                </>
              ) : isAudio ? (
                <>
                  <Music className="w-3.5 h-3.5 shrink-0" />
                  <span className="text-[11px] font-semibold tracking-tight truncate max-w-full px-2">
                    {children}
                  </span>
                </>
              ) : (
                <>
                  <MessageSquare className="w-3.5 h-3.5 shrink-0" />
                  <span className="text-[11px] font-semibold tracking-tight whitespace-nowrap">
                    {children}
                  </span>
                </>
              )}
            </div>
            <span
              className={`text-[9px] tabular-nums tracking-tight whitespace-nowrap transition-opacity ${
                isSelected ? 'opacity-60' : 'opacity-0 group-hover:opacity-40'
              }`}
            >
              {timeLabel}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
