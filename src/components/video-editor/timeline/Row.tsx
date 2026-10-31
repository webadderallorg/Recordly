import type { RowDefinition } from "dnd-timeline";
import { useRow } from "dnd-timeline";
import { TIMELINE_CLIP_ROW_HEIGHT_PX, TIMELINE_ROW_MIN_HEIGHT_PX } from "./timelineLayout";

interface RowProps extends RowDefinition {
	embedded?: boolean;
	caption?: boolean;
	compact?: boolean;
	filmstrip?: boolean;
	children: React.ReactNode;
	label?: string;
	hint?: string;
	isEmpty?: boolean;
	labelColor?: string;
	onMouseEnter?: React.MouseEventHandler<HTMLDivElement>;
	onMouseMove?: React.MouseEventHandler<HTMLDivElement>;
	onMouseLeave?: React.MouseEventHandler<HTMLDivElement>;
	onMouseDown?: React.MouseEventHandler<HTMLDivElement>;
	onClick?: React.MouseEventHandler<HTMLDivElement>;
}

export default function Row({
	id,
	embedded = false,
	caption = false,
	compact = true,
	filmstrip = false,
	children,
	label,
	hint,
	isEmpty,
	labelColor = "#666",
	onMouseEnter,
	onMouseMove,
	onMouseLeave,
	onMouseDown,
	onClick,
}: RowProps) {
	const { setNodeRef, rowWrapperStyle, rowStyle } = useRow({ id });

	return (
		<div
			data-timeline-row={id}
			className="bg-transparent relative"
			style={{
				...rowWrapperStyle,
				...(embedded || caption
					? {
							position: "absolute" as const,
							insetInline: 0,
							...(caption ? { top: 36 } : { bottom: 7 }),
							zIndex: 15,
							pointerEvents: "none" as const,
						}
					: {}),
				marginBottom: 2,
				flexGrow: 0,
				flexShrink: 0,
				height:
					embedded || caption
						? 20
						: filmstrip || !compact
							? TIMELINE_CLIP_ROW_HEIGHT_PX
							: TIMELINE_ROW_MIN_HEIGHT_PX,
				flexBasis: caption
					? 20
					: filmstrip || !compact
						? TIMELINE_CLIP_ROW_HEIGHT_PX
						: TIMELINE_ROW_MIN_HEIGHT_PX,
			}}
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
				className="relative min-w-0 self-stretch"
				style={rowStyle}
				onMouseEnter={onMouseEnter}
				onMouseMove={onMouseMove}
				onMouseLeave={onMouseLeave}
				onMouseDown={onMouseDown}
				onClick={onClick}
			>
				{children}
			</div>
		</div>
	);
}
