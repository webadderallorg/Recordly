import type { PointerEvent as ReactPointerEvent } from "react";
import { useCallback, useRef } from "react";
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

function clamp(value: number, min: number, max: number) {
	return Math.min(max, Math.max(min, value));
}

function quantizeToStep(value: number, min: number, step: number) {
	if (!(step > 0)) {
		return value;
	}

	return min + Math.round((value - min) / step) * step;
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
	const rootRef = useRef<HTMLDivElement | null>(null);
	const pct = Math.min(100, Math.max(0, ((value - min) / (max - min || 1)) * 100));
	const dividerClass =
		accentColor === "purple"
			? "bg-foreground/95 shadow-[0_0_10px_rgba(139,92,246,0.28)]"
			: "bg-foreground/95 shadow-[0_0_10px_rgba(37,99,235,0.28)]";

	const setValueFromClientX = useCallback(
		(clientX: number) => {
			const root = rootRef.current;
			if (!root) {
				return;
			}

			const bounds = root.getBoundingClientRect();
			if (!(bounds.width > 0)) {
				return;
			}

			const normalized = clamp((clientX - bounds.left) / bounds.width, 0, 1);
			const rawValue = min + normalized * (max - min);
			const nextValue = clamp(quantizeToStep(rawValue, min, step), min, max);
			onChange(Number(nextValue.toFixed(6)));
		},
		[max, min, onChange, step],
	);

	const handlePointerDown = useCallback(
		(event: ReactPointerEvent<HTMLDivElement>) => {
			event.preventDefault();
			const pointerId = event.pointerId;
			const target = event.currentTarget;

			target.setPointerCapture(pointerId);
			setValueFromClientX(event.clientX);

			const handlePointerMove = (moveEvent: PointerEvent) => {
				if (moveEvent.pointerId !== pointerId) {
					return;
				}

				setValueFromClientX(moveEvent.clientX);
			};

			const finishPointer = (finishEvent: PointerEvent) => {
				if (finishEvent.pointerId !== pointerId) {
					return;
				}

				target.releasePointerCapture(pointerId);
				target.removeEventListener("pointermove", handlePointerMove);
				target.removeEventListener("pointerup", finishPointer);
				target.removeEventListener("pointercancel", finishPointer);
			};

			target.addEventListener("pointermove", handlePointerMove);
			target.addEventListener("pointerup", finishPointer);
			target.addEventListener("pointercancel", finishPointer);
		},
		[setValueFromClientX],
	);

	return (
		<div
			ref={rootRef}
			role="slider"
			tabIndex={0}
			aria-label={label}
			aria-valuemin={min}
			aria-valuemax={max}
			aria-valuenow={value}
			aria-valuetext={formatValue(value)}
			onPointerDown={handlePointerDown}
			onKeyDown={(event) => {
				if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
					event.preventDefault();
					onChange(clamp(quantizeToStep(value - step, min, step), min, max));
				}

				if (event.key === "ArrowRight" || event.key === "ArrowUp") {
					event.preventDefault();
					onChange(clamp(quantizeToStep(value + step, min, step), min, max));
				}
			}}
			className="relative flex h-10 w-full select-none items-center overflow-hidden rounded-xl bg-editor-bg/80 px-1.5 outline-none focus-visible:ring-1 focus-visible:ring-[#2563EB]/40"
		>
			<div
				className="pointer-events-none absolute inset-y-[3px] left-[3px] right-auto rounded-[10px] bg-foreground/[0.08] shadow-[0_4px_10px_0_rgba(0,0,0,0.18)] transition-none"
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
			<span className="pointer-events-none relative z-10 flex-1 pl-3 text-[12px] font-medium text-muted-foreground">
				{label}
			</span>
			<span className="pointer-events-none relative z-10 pr-3 text-[12px] font-medium tabular-nums text-foreground">
				{formatValue(value)}
			</span>
		</div>
	);
}
