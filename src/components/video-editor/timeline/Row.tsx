import { useRow } from "dnd-timeline";
import type { RowDefinition } from "dnd-timeline";

interface RowProps extends RowDefinition {
  children: React.ReactNode;
  label?: string;
  hint?: string;
  isEmpty?: boolean;
  labelColor?: string;
}

export default function Row({ id, children, label, hint, isEmpty, labelColor = '#666' }: RowProps) {
  const { setNodeRef, rowWrapperStyle, rowStyle } = useRow({ id });

  return (
    <div
      className="border-b border-[#18181b] bg-[#18181b] relative flex-1 min-h-[26px]"
      style={{ ...rowWrapperStyle, marginBottom: 2 }}
    >
      {label && (
        <div
          className="absolute left-1.5 top-1/2 -translate-y-1/2 text-[9px] font-semibold uppercase tracking-widest z-20 pointer-events-none select-none"
          style={{ color: labelColor, writingMode: 'horizontal-tb' }}
        >
          {label}
        </div>
      )}
      {isEmpty && hint && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none select-none z-10">
          <span className="text-[11px] text-white/15 font-medium">{hint}</span>
        </div>
      )}
      <div ref={setNodeRef} className="relative h-full min-h-0" style={rowStyle}>
        {children}
      </div>
    </div>
  );
}

