import { useEffect, useState } from "react";

interface AreaSelection {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface AreaSelectionWithOffset extends AreaSelection {
  winX: number;
  winY: number;
}

export function AreaHighlight() {
  const [area, setArea] = useState<AreaSelectionWithOffset | null>(null);

  useEffect(() => {
    const removeListener = window.electronAPI.onAreaHighlightData((data: AreaSelectionWithOffset) => {
      setArea(data);
    });

    return () => {
      removeListener?.();
    };
  }, []);

  if (!area) return null;

  // Since the window starts at area.winX, area.winY (global coordinates),
  // we must subtract these to get coordinates relative to the window's content area (0,0).
  const relX = area.x - area.winX;
  const relY = area.y - area.winY;

  return (
    <div className="fixed inset-0 pointer-events-none overflow-hidden">
      {/* Dimmed overlay around the selection */}
      <div
        className="absolute inset-0 bg-black/30"
        style={{
          clipPath: `polygon(
            0% 0%,
            100% 0%,
            100% 100%,
            0% 100%,
            0% 0%,
            ${relX}px ${relY}px,
            ${relX}px ${relY + area.height}px,
            ${relX + area.width}px ${relY + area.height}px,
            ${relX + area.width}px ${relY}px,
            ${relX}px ${relY}px
          )`,
        }}
      />

      {/* Animated blue border */}
      <div
        className="absolute border-2 border-[#2563EB] shadow-[0_0_15px_rgba(37,99,235,0.5)] animate-pulse"
        style={{
          left: relX,
          top: relY,
          width: area.width,
          height: area.height,
          borderRadius: 4,
        }}
      />

      {/* Label badge */}
      <div
        className="absolute flex items-center gap-1.5 px-2 py-1 bg-[#2563EB] text-white text-[10px] font-bold rounded-t"
        style={{
          left: relX,
          top: relY - 22,
        }}
      >
        <div className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
        RECORDING AREA
      </div>
    </div>
  );
}
