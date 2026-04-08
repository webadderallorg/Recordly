import { useRef } from "react";
import { Rnd } from "react-rnd";
import type { AnnotationRegion } from "./types";
import { cn } from "@/lib/utils";
import { getArrowComponent } from "./ArrowSvgs";

interface AnnotationOverlayProps {
  annotation: AnnotationRegion;
  isSelected: boolean;
  containerWidth: number;
  containerHeight: number;
  onPositionChange: (id: string, position: { x: number; y: number }) => void;
  onSizeChange: (id: string, size: { width: number; height: number }) => void;
  onClick: (id: string) => void;
  zIndex: number;
  isSelectedBoost: boolean; // Boost z-index when selected for easy editing
}

export function AnnotationOverlay({
  annotation,
  isSelected,
  containerWidth,
  containerHeight,
  onPositionChange,
  onSizeChange,
  onClick,
  zIndex,
  isSelectedBoost,
}: AnnotationOverlayProps) {
  const x = (annotation.position.x / 100) * containerWidth;
  const y = (annotation.position.y / 100) * containerHeight;
  const width = (annotation.size.width / 100) * containerWidth;
  const height = (annotation.size.height / 100) * containerHeight;

  const isDraggingRef = useRef(false);

  const renderArrow = () => {
    const direction = annotation.figureData?.arrowDirection || 'right';
    const color = annotation.figureData?.color || '#2563EB';
    const strokeWidth = annotation.figureData?.strokeWidth || 4;

    const ArrowComponent = getArrowComponent(direction);
    return <ArrowComponent color={color} strokeWidth={strokeWidth} />;
  };

  const renderContent = () => {
    switch (annotation.type) {
      case 'text':
        return (
          <div
            className="w-full h-full flex items-center p-2 overflow-hidden"
            style={{
              justifyContent: annotation.style.textAlign === 'left' ? 'flex-start' : 
                            annotation.style.textAlign === 'right' ? 'flex-end' : 'center',
              alignItems: 'center',
            }}
          >
            <span
              style={{
                color: annotation.style.color,
                backgroundColor: annotation.style.backgroundColor,
                fontSize: `${annotation.style.fontSize}px`,
                fontFamily: annotation.style.fontFamily,
                fontWeight: annotation.style.fontWeight,
                fontStyle: annotation.style.fontStyle,
                textDecoration: annotation.style.textDecoration,
                textAlign: annotation.style.textAlign,
                wordBreak: 'break-word',
                whiteSpace: 'pre-wrap',
                boxDecorationBreak: 'clone',
                WebkitBoxDecorationBreak: 'clone',
                padding: '0.1em 0.2em',
                borderRadius: '4px',
                lineHeight: '1.4',
              }}
            >
              {annotation.content}
            </span>
          </div>
        );

      case 'image':
        if (annotation.content && annotation.content.startsWith('data:image')) {
          return (
            <img
              src={annotation.content}
              alt="Annotation"
              className="w-full h-full object-contain"
              draggable={false}
            />
          );
        }
        return (
          <div className="w-full h-full flex items-center justify-center text-slate-400 text-sm">
            No image
          </div>
        );

      case 'figure':
        if (!annotation.figureData) {
          return (
            <div className="w-full h-full flex items-center justify-center text-slate-400 text-sm">
              No arrow data
            </div>
          );
        }

        return (
          <div className="w-full h-full flex items-center justify-center p-2">
            {renderArrow()}
          </div>
        );

      case 'blur':
        return (
          <div
            className="w-full h-full rounded-md overflow-hidden relative"
            style={{
              backdropFilter: `blur(${(annotation.figureData?.blurIntensity || 1.0) * 16}px)`,
              WebkitBackdropFilter: `blur(${(annotation.figureData?.blurIntensity || 1.0) * 16}px)`,
              backgroundColor: 'rgba(255, 255, 255, 0.05)',
            }}
          >
            {/* Optional: subtle border for the blur area to make it visible in editor */}
            <div className="absolute inset-0 border border-white/5 pointer-events-none" />
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <Rnd
      position={{ x, y }}
      size={{ width, height }}
      onDragStart={() => {
        isDraggingRef.current = true;
      }}
      onDragStop={(_e, d) => {
        const xPercent = (d.x / containerWidth) * 100;
        const yPercent = (d.y / containerHeight) * 100;
        onPositionChange(annotation.id, { x: xPercent, y: yPercent });
        
        // Reset dragging flag after a short delay to prevent click event
        setTimeout(() => {
          isDraggingRef.current = false;
        }, 100);
      }}
      onResizeStop={(_e, _direction, ref, _delta, position) => {
        const xPercent = (position.x / containerWidth) * 100;
        const yPercent = (position.y / containerHeight) * 100;
        const widthPercent = (ref.offsetWidth / containerWidth) * 100;
        const heightPercent = (ref.offsetHeight / containerHeight) * 100;
        onPositionChange(annotation.id, { x: xPercent, y: yPercent });
        onSizeChange(annotation.id, { width: widthPercent, height: heightPercent });
      }}
      onClick={() => {
        if (isDraggingRef.current) return;
        onClick(annotation.id);
      }}
      bounds="parent"
      className={cn(
        "cursor-move transition-all",
        isSelected && "ring-2 ring-[#2563EB] ring-offset-2 ring-offset-transparent"
      )}
      style={{
        zIndex: isSelectedBoost ? zIndex + 1000 : zIndex, // Boost selected annotation to ensure it's on top
        pointerEvents: isSelected ? 'auto' : 'none',
        border: isSelected ? '2px solid rgba(37, 99, 235, 0.8)' : 'none',
        backgroundColor: isSelected ? 'rgba(37, 99, 235, 0.1)' : 'transparent',
        boxShadow: isSelected ? '0 0 0 1px rgba(37, 99, 235, 0.35)' : 'none',
      }}
      enableResizing={isSelected}
      disableDragging={!isSelected}
      resizeHandleStyles={{
        topLeft: {
          width: '12px',
          height: '12px',
          backgroundColor: isSelected ? 'white' : 'transparent',
          border: isSelected ? '2px solid #2563EB' : 'none',
          borderRadius: '50%',
          left: '-6px',
          top: '-6px',
          cursor: 'nwse-resize',
        },
        topRight: {
          width: '12px',
          height: '12px',
          backgroundColor: isSelected ? 'white' : 'transparent',
          border: isSelected ? '2px solid #2563EB' : 'none',
          borderRadius: '50%',
          right: '-6px',
          top: '-6px',
          cursor: 'nesw-resize',
        },
        bottomLeft: {
          width: '12px',
          height: '12px',
          backgroundColor: isSelected ? 'white' : 'transparent',
          border: isSelected ? '2px solid #2563EB' : 'none',
          borderRadius: '50%',
          left: '-6px',
          bottom: '-6px',
          cursor: 'nesw-resize',
        },
        bottomRight: {
          width: '12px',
          height: '12px',
          backgroundColor: isSelected ? 'white' : 'transparent',
          border: isSelected ? '2px solid #2563EB' : 'none',
          borderRadius: '50%',
          right: '-6px',
          bottom: '-6px',
          cursor: 'nwse-resize',
        },
      }}
    >
      <div
        className={cn(
          "w-full h-full rounded-lg",
          annotation.type === 'text' && "bg-transparent",
          annotation.type === 'image' && "bg-transparent",
          annotation.type === 'figure' && "bg-transparent",
          isSelected && "shadow-lg"
        )}
      >
        {renderContent()}
      </div>
    </Rnd>
  );
}

