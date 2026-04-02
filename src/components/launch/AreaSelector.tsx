import { useEffect, useRef, useState } from "react";
import { useScopedT } from "../../contexts/I18nContext";

interface Selection {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function AreaSelector() {
  const t = useScopedT("launch");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isSelecting, setIsSelecting] = useState(false);
  const [isMoving, setIsMoving] = useState(false);
  const [selection, setSelection] = useState<Selection | null>(null);
  const startPoint = useRef<{ x: number, y: number } | null>(null);
  const moveOffset = useRef<{ x: number, y: number } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const updateCanvas = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      draw();
    };

    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Draw dimmed background
      ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Selected monitor identification
      ctx.fillStyle = "rgba(255, 255, 255, 1.0)";
      ctx.font = "italic 11px Inter, sans-serif";

      if (selection) {
        // Clear selection area
        ctx.clearRect(selection.x, selection.y, selection.width, selection.height);
        
        // Draw selection border (Glow effect)
        ctx.shadowBlur = 15;
        ctx.shadowColor = "rgba(37, 99, 235, 0.4)";
        ctx.strokeStyle = "#2563EB";
        ctx.lineWidth = 2;
        ctx.strokeRect(selection.x, selection.y, selection.width, selection.height);
        ctx.shadowBlur = 0;

        // Draw dimensions label
        const pad = 8;
        const isTooSmall = selection.width < 100 || selection.height < 100;
        const info = `${Math.round(selection.width)} × ${Math.round(selection.height)}`;
        ctx.font = "bold 10px Inter, sans-serif";
        const textWidth = ctx.measureText(info).width;
        
        const labelX = selection.x;
        const labelY = selection.y < 30 ? selection.y + selection.height + 25 : selection.y - 5;
        
        ctx.fillStyle = isTooSmall ? "#EF4444" : "#2563EB";
        ctx.fillRect(labelX, labelY - 18, textWidth + (pad * 2), 22);
        
        ctx.fillStyle = "#FFFFFF";
        ctx.fillText(info, labelX + pad, labelY - 2);
      }
    };

    window.addEventListener("resize", updateCanvas);
    updateCanvas();

    return () => window.removeEventListener("resize", updateCanvas);
  }, [selection]);

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
      const newX = currentX - moveOffset.current.x;
      const newY = currentY - moveOffset.current.y;
      
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

  const confirmSelection = async () => {
    if (selection && selection.width >= 100 && selection.height >= 100) {
      await window.electronAPI.setSelectedArea(selection);
      window.close();
    }
  };

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
            disabled={selection.width < 100 || selection.height < 100}
            className={`px-4 py-1.5 bg-[#2563EB] text-white rounded-full text-xs font-medium shadow-lg hover:bg-blue-600 transition-colors pointer-events-auto ${
              (selection.width < 100 || selection.height < 100) ? 'opacity-50 cursor-not-allowed' : ''
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
