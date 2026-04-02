import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useScopedT } from "../../contexts/I18nContext";

interface Selection {
  x: number;
  y: number;
  width: number;
  height: number;
}

const MIN_SELECTION_SIZE = 100;

function isSelectionTooSmall(selection: Selection | null): boolean {
  if (!selection) return true;
  return selection.width < MIN_SELECTION_SIZE || selection.height < MIN_SELECTION_SIZE;
}

export function AreaSelector() {
  const t = useScopedT("launch");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isSelecting, setIsSelecting] = useState(false);
  const [isMoving, setIsMoving] = useState(false);
  const [selection, setSelection] = useState<Selection | null>(null);
  const selectionRef = useRef<Selection | null>(null);
  const startPoint = useRef<{ x: number, y: number } | null>(null);
  const moveOffset = useRef<{ x: number, y: number } | null>(null);

  // Sync ref for access in resize handler without re-binding effects
  useEffect(() => {
    selectionRef.current = selection;
  }, [selection]);

  const render = useCallback((currentSelection = selection) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const w = window.innerWidth;
    const h = window.innerHeight;

    ctx.clearRect(0, 0, w, h);

    // Draw dimmed background
    ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
    ctx.fillRect(0, 0, w, h);

    // Selected monitor identification
    ctx.fillStyle = "rgba(255, 255, 255, 1.0)";
    ctx.font = "italic 11px Inter, sans-serif";

    if (currentSelection) {
      // Clear selection area
      ctx.clearRect(currentSelection.x, currentSelection.y, currentSelection.width, currentSelection.height);
      
      // Draw selection border (Glow effect)
      ctx.shadowBlur = 15;
      ctx.shadowColor = "rgba(37, 99, 235, 0.4)";
      ctx.strokeStyle = "#2563EB";
      ctx.lineWidth = 2;
      ctx.strokeRect(currentSelection.x, currentSelection.y, currentSelection.width, currentSelection.height);
      ctx.shadowBlur = 0;

      // Draw dimensions label
      const pad = 8;
      const isTooSmall = isSelectionTooSmall(currentSelection);
      const info = `${Math.round(currentSelection.width)} × ${Math.round(currentSelection.height)}`;
      ctx.font = "bold 10px Inter, sans-serif";
      const textWidth = ctx.measureText(info).width;
      
      const labelX = currentSelection.x;
      const labelY = currentSelection.y < 30 ? currentSelection.y + currentSelection.height + 25 : currentSelection.y - 5;
      
      ctx.fillStyle = isTooSmall ? "#EF4444" : "#2563EB";
      ctx.fillRect(labelX, labelY - 18, textWidth + (pad * 2), 22);
      
      ctx.fillStyle = "#FFFFFF";
      ctx.fillText(info, labelX + pad, labelY - 2);
    }
  }, [selection]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const updateCanvasSize = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = window.innerWidth;
      const h = window.innerHeight;
      
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
      
      // Force immediate redraw because setting canvas.width clears the context
      render(selectionRef.current);
    };

    window.addEventListener("resize", updateCanvasSize);
    updateCanvasSize();

    return () => window.removeEventListener("resize", updateCanvasSize);
  }, [render]); // render changes only when selection changes, but still avoids frequent width/height reassignment during mousemove if we're careful

  // Trigger draw on selection update
  useEffect(() => {
    render();
  }, [render]);

  const handleMouseDown = (e: React.MouseEvent) => {
    const mouseX = e.clientX;
    const mouseY = e.clientY;

    // Check if clicking inside existing selection to move it
    if (selection && 
        mouseX >= selection.x && mouseX <= selection.x + selection.width &&
        mouseY >= selection.y && mouseY <= selection.y + selection.height) {
      setIsMoving(true);
      moveOffset.current = {
        x: mouseX - selection.x,
        y: mouseY - selection.y
      };
      return;
    }

    setIsSelecting(true);
    startPoint.current = { x: mouseX, y: mouseY };
    setSelection({ x: mouseX, y: mouseY, width: 0, height: 0 });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const currentX = e.clientX;
    const currentY = e.clientY;

    if (isMoving && selection && moveOffset.current) {
      // Move existing selection
      const maxX = window.innerWidth - selection.width;
      const maxY = window.innerHeight - selection.height;
      
      const newX = Math.max(0, Math.min(currentX - moveOffset.current.x, maxX));
      const newY = Math.max(0, Math.min(currentY - moveOffset.current.y, maxY));
      
      setSelection({
        ...selection,
        x: newX,
        y: newY
      });
      return;
    }

    if (!isSelecting || !startPoint.current) return;
    
    const x = Math.min(startPoint.current.x, currentX);
    const y = Math.min(startPoint.current.y, currentY);
    const width = Math.abs(startPoint.current.x - currentX);
    const height = Math.abs(startPoint.current.y - currentY);

    setSelection({ x, y, width, height });
  };

  const handleMouseUp = () => {
    // If the selection is too tiny (like a single click), clear it
    if (selection && (selection.width < 10 || selection.height < 10)) {
      setSelection(null);
    }
    
    setIsSelecting(false);
    setIsMoving(false);
    moveOffset.current = null;
  };

  const confirmSelection = useCallback(async () => {
    if (isSelectionTooSmall(selection)) {
      toast.error(t("sourceSelector.selectionTooSmall", "Selection area is too small. Please select an area at least 100x100 pixels."));
      return;
    }

    if (selection) {
      // Pass selection in DIP coordinates (CSS pixels). Scaling to physical pixels
      // is handled by the capture engine/backend to ensure accuracy across displays.
      const result = await window.electronAPI.setSelectedArea(selection);
      if (result.success) {
        window.close();
      } else {
        toast.error(result.error || result.message || "Failed to set recording area. Please try again.");
      }
    }
  }, [selection, t]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        window.electronAPI.cancelAreaSelector();
      } else if (e.key === "Enter") {
        confirmSelection();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selection]);

  return (
    <div 
      className="relative w-full h-full cursor-crosshair overflow-hidden select-none"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
    >
      <canvas 
        ref={canvasRef} 
        className="absolute inset-0 pointer-events-none"
      />
      
      {selection && !isSelecting && (
        <div 
          className="absolute flex gap-2 z-[100]"
          style={{ 
            left: selection.x + selection.width / 2, 
            top: selection.y + selection.height + 10,
            transform: 'translateX(-50%)'
          }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            onClick={confirmSelection}
            disabled={isSelectionTooSmall(selection)}
            className={`px-4 py-1.5 bg-[#2563EB] text-white rounded-full text-xs font-medium shadow-lg hover:bg-blue-600 transition-colors pointer-events-auto ${
              isSelectionTooSmall(selection) ? 'opacity-50 cursor-not-allowed' : ''
            }`}
          >
            {t("sourceSelector.recordArea", "Record Area")}
          </button>
          <button
            onClick={async () => {
              await window.electronAPI.cancelAreaSelector();
            }}
            className="px-4 py-1.5 bg-zinc-800 text-white rounded-full text-xs font-medium shadow-lg hover:bg-zinc-700 transition-colors pointer-events-auto"
          >
            {t("sourceSelector.cancel", "Cancel")}
          </button>
        </div>
      )}

      <div className="absolute top-4 left-1/2 -translate-x-1/2 px-4 py-2 bg-black/60 backdrop-blur-md rounded-full border border-white/10 pointer-events-none text-white text-xs font-medium shadow-2xl transition-all">
        {selection 
          ? "Tip: Click and drag inside the area to move it"
          : t("sourceSelector.selectAreaPlaceholder", "Click and drag to select recording area")
        }
      </div>
    </div>
  );
}
