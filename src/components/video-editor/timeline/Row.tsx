import type { RowDefinition } from "dnd-timeline";
import { useRow } from "dnd-timeline";
import type React from "react";

interface RowProps extends RowDefinition {
	children: React.ReactNode;
	label?: string;
	hint?: string;
	isEmpty?: boolean;
	labelColor?: string;
	onBlankPointerDown?: (event: React.PointerEvent<HTMLDivElement>) => void;
}

export default function Row({
	id,
	children,
	label,
	hint,
	isEmpty,
	labelColor = "#666",
	onBlankPointerDown,
}: RowProps) {
	const { setNodeRef, rowWrapperStyle, rowStyle } = useRow({ id });

	return (
		<div
			className="bg-transparent relative flex-1 min-h-[26px]"
			style={{ ...rowWrapperStyle, marginBottom: 2 }}
		>
			{label && (
				<div
					className="absolute left-1.5 top-1/2 -translate-y-1/2 text-[9px] font-semibold uppercase tracking-widest z-20 pointer-events-none select-none"
					style={{ color: labelColor, writingMode: "horizontal-tb" }}
				>
					{label}
				</div>
			)}
			{isEmpty && hint && (
				<div className="absolute inset-0 flex items-center justify-center pointer-events-none select-none z-10">
					<span className="text-[11px] text-foreground/15 font-medium">{hint}</span>
				</div>
			)}
			<div
				ref={setNodeRef}
				className="relative h-full min-h-0 overflow-hidden"
				style={rowStyle}
				onPointerDown={(event) => {
					if (event.target === event.currentTarget) {
						onBlankPointerDown?.(event);
					}
				}}
				onClick={(event) => {
					if (event.target === event.currentTarget && onBlankPointerDown) {
						event.stopPropagation();
					}
				}}
			>
				{children}
			</div>
		</div>
	);
}
