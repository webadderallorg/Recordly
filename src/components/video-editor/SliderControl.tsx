import { cn } from "@/lib/utils";

interface SliderControlProps {
  label: string;
  value: number;
  defaultValue: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  formatValue: (value: number) => string;
  parseInput: (text: string) => number | null;
  accentColor?: "purple" | "blue";
}

export function SliderControl({
  label,
  value,
  defaultValue: _defaultValue,
  min,
  max,
  step,
  onChange,
  formatValue,
  parseInput: _parseInput,
  accentColor = "blue",
}: SliderControlProps) {
  const pct = Math.min(100, Math.max(0, ((value - min) / (max - min || 1)) * 100));
  const dividerClass =
    accentColor === "purple"
      ? "bg-white/95 shadow-[0_0_10px_rgba(139,92,246,0.28)]"
      : "bg-white/95 shadow-[0_0_10px_rgba(37,99,235,0.28)]";

  return (
		<div className="relative flex h-10 w-full select-none items-center overflow-hidden rounded-xl bg-black/60 px-1.5">
			<div
				className="absolute inset-y-[3px] left-[3px] right-auto rounded-[10px] bg-white/[0.08] shadow-[0_4px_10px_0_rgba(0,0,0,0.18)] transition-none"
				style={{
					width: pct > 0 ? `max(calc(${pct}% - 6px), 2.1rem)` : 0,
				}}
			/>
      <div
        className={cn(
          "pointer-events-none absolute bottom-[18%] top-[18%] z-10 w-[2px] rounded-full transition-none",
          dividerClass,
        )}
        style={{ left: `calc(${pct}% - 8px)` }}
      />
      <span className="pointer-events-none relative z-10 flex-1 pl-3 text-[12px] font-medium text-slate-300">
        {label}
      </span>
      <span className="pointer-events-none relative z-10 pr-3 text-[12px] font-medium tabular-nums text-slate-100">
        {formatValue(value)}
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="absolute inset-0 h-full w-full cursor-ew-resize opacity-0"
      />
    </div>
  );
}
