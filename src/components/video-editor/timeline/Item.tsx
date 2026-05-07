import {
	FilmSlate as Film,
	Gauge,
	ChatCircle as MessageSquare,
	MusicNotes as Music,
	MouseLeftClickIcon as PhMouseLeftClick,
	Scissors,
	MagnifyingGlassPlus as ZoomIn,
} from "@phosphor-icons/react";
import type { Span } from "dnd-timeline";
import { useItem } from "dnd-timeline";
import { useMemo } from "react";
import { cn } from "@/lib/utils";
import glassStyles from "./ItemGlass.module.css";

interface ItemProps {
	id: string;
	span: Span;
	rowId: string;
	children: React.ReactNode;
	isSelected?: boolean;
	onSelect?: () => void;
	zoomDepth?: number;
	zoomMode?: "auto" | "manual";
	speedValue?: number;
	variant?: "zoom" | "trim" | "clip" | "annotation" | "speed" | "audio";
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
	zoomMode = "auto",
	speedValue,
	variant = "zoom",
	children,
}: ItemProps) {
	const { setNodeRef, attributes, listeners, itemStyle, itemContentStyle } = useItem({
		id,
		span,
		data: { rowId },
	});

	const isZoom = variant === "zoom";
	const isTrim = variant === "trim";
	const isClip = variant === "clip";
	const isSpeed = variant === "speed";
	const isAudio = variant === "audio";

	const glassClass = isZoom
		? glassStyles.glassPurple
		: isTrim
			? glassStyles.glassRed
			: isClip
				? glassStyles.glassCyan
				: isSpeed
					? glassStyles.glassAmber
					: isAudio
						? glassStyles.glassDarkGreen
						: glassStyles.glassYellow;

	const timeLabel = useMemo(
		() => `${formatMs(span.start)} – ${formatMs(span.end)}`,
		[span.start, span.end],
	);

	const MIN_ITEM_PX = 6;
	const safeItemStyle = {
		...itemStyle,
		minWidth: MIN_ITEM_PX,
		height: "100%",
		overflow: "hidden",
	};

	return (
		<div
			ref={setNodeRef}
			style={safeItemStyle}
			{...listeners}
			{...attributes}
			onPointerDownCapture={() => onSelect?.()}
			data-timeline-item="true"
			className="group h-full"
		>
			<div
				className="h-full"
				style={{
					...itemContentStyle,
					minWidth: MIN_ITEM_PX,
					height: "100%",
					display: "flex",
					alignItems: "center",
				}}
			>
				<div
					className={cn(
						glassClass,
						"w-full overflow-hidden flex items-center justify-center gap-1.5 cursor-grab active:cursor-grabbing relative",
						isSelected && glassStyles.selected,
					)}
					style={{
						height: "85%",
						minHeight: 22,
						minWidth: MIN_ITEM_PX,
					}}
					onClick={(event) => {
						event.stopPropagation();
						onSelect?.();
					}}
				>
					<div
						className={cn(glassStyles.zoomEndCap, glassStyles.left)}
						style={{ cursor: "col-resize", pointerEvents: "auto" }}
						title="Resize left"
					/>
					<div
						className={cn(glassStyles.zoomEndCap, glassStyles.right)}
						style={{ cursor: "col-resize", pointerEvents: "auto" }}
						title="Resize right"
					/>
					{/* Content */}
					<div className="relative z-10 flex flex-col items-center justify-center text-black/70 dark:text-white/90 opacity-80 group-hover:opacity-100 transition-opacity select-none overflow-hidden">
						<div className="flex items-center gap-1.5">
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
							) : isClip ? (
								<>
									<Film className="w-3.5 h-3.5 shrink-0" />
									<span className="text-[11px] font-semibold tracking-tight whitespace-nowrap">
										Clip
									</span>
								</>
							) : isSpeed ? (
								<>
									<Gauge className="w-3.5 h-3.5 shrink-0" />
									<span className="text-[11px] font-semibold tracking-tight whitespace-nowrap">
										{speedValue !== undefined ? `${speedValue}×` : "Speed"}
									</span>
								</>
							) : isAudio ? (
								<>
									<Music className="w-3.5 h-3.5 shrink-0" />
									<span className="text-[11px] font-semibold tracking-tight truncate max-w-full">
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
						{isZoom ? (
							<div
								className={`flex items-center gap-0.5 transition-opacity ${isSelected ? "opacity-70" : "opacity-0 group-hover:opacity-50"}`}
							>
								<PhMouseLeftClick
									className="w-2.5 h-2.5 shrink-0"
									weight={zoomMode === "manual" ? "regular" : "fill"}
								/>
								<span className="text-[9px] font-medium tracking-tight whitespace-nowrap">
									{zoomMode === "manual" ? "Manual" : "Auto"}
								</span>
							</div>
						) : (
							<span
								className={`text-[9px] tabular-nums tracking-tight whitespace-nowrap transition-opacity ${
									isSelected ? "opacity-60" : "opacity-0 group-hover:opacity-40"
								}`}
							>
								{timeLabel}
							</span>
						)}
					</div>
				</div>
			</div>
		</div>
	);
}
