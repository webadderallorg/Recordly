import {
	Check,
	CaretDown as ChevronDown,
	Crop,
	ChatText as MessageSquare,
	MusicNote as Music,
	Scissors,
	MagicWand as WandSparkles,
	MagnifyingGlassPlus as ZoomIn,
} from "@phosphor-icons/react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useScopedT } from "@/contexts/I18nContext";
import {
	ASPECT_RATIOS,
	type AspectRatio,
	getAspectRatioLabel,
	isCustomAspectRatio,
} from "@/utils/aspectRatioUtils";

interface TimelineToolbarProps {
	aspectRatio: AspectRatio;
	onAspectRatioChange?: (aspectRatio: AspectRatio) => void;
	customAspectWidth: string;
	customAspectHeight: string;
	onCustomAspectWidthChange: (value: string) => void;
	onCustomAspectHeightChange: (value: string) => void;
	onCustomAspectRatioKeyDown: (event: ReactKeyboardEvent<HTMLInputElement>) => void;
	onApplyCustomAspectRatio: () => void;
	onAddZoom: () => void;
	onSuggestZooms: () => void;
	onAddAnnotation: () => void;
	onAddAudio: () => Promise<void>;
	onSplitClip: () => void;
	onOpenCropEditor?: () => void;
	isCropped: boolean;
	scrollLabels: { pan: string; zoom: string };
}

export function TimelineToolbar({
	aspectRatio,
	onAspectRatioChange,
	customAspectWidth,
	customAspectHeight,
	onCustomAspectWidthChange,
	onCustomAspectHeightChange,
	onCustomAspectRatioKeyDown,
	onApplyCustomAspectRatio,
	onAddZoom,
	onSuggestZooms,
	onAddAnnotation,
	onAddAudio,
	onSplitClip,
	onOpenCropEditor,
	isCropped,
	scrollLabels,
}: TimelineToolbarProps) {
	const t = useScopedT("settings");

	return (
		<div className="flex items-center gap-2 px-4 py-2 border-b border-foreground/10 bg-editor-panel">
			<div className="flex items-center gap-1">
				<Button
					onClick={onAddZoom}
					variant="ghost"
					size="icon"
					className="h-7 w-7 text-muted-foreground hover:text-[#2563EB] hover:bg-[#2563EB]/10 transition-all"
					title="Add Zoom (Z)"
				>
					<ZoomIn className="w-4 h-4" />
				</Button>
				<Button
					onClick={onSuggestZooms}
					variant="ghost"
					size="icon"
					className="h-7 w-7 text-muted-foreground hover:text-[#2563EB] hover:bg-[#2563EB]/10 transition-all"
					title="Suggest Zooms from Cursor"
				>
					<WandSparkles className="w-4 h-4" />
				</Button>
				<Button
					onClick={onAddAnnotation}
					variant="ghost"
					size="icon"
					className="h-7 w-7 text-muted-foreground hover:text-[#B4A046] hover:bg-[#B4A046]/10 transition-all"
					title="Add Annotation (A)"
				>
					<MessageSquare className="w-4 h-4" />
				</Button>
				<Button
					onClick={() => void onAddAudio()}
					variant="ghost"
					size="icon"
					className="h-7 w-7 text-muted-foreground hover:text-[#a855f7] hover:bg-[#a855f7]/10 transition-all"
					title="Add Audio"
				>
					<Music className="w-4 h-4" />
				</Button>
				<Button
					onClick={onSplitClip}
					variant="ghost"
					size="icon"
					className="h-7 w-7 text-muted-foreground hover:text-foreground hover:bg-foreground/10 transition-all"
					title="Split Clip (C)"
				>
					<Scissors className="w-4 h-4" />
				</Button>
			</div>
			<div className="flex items-center gap-2">
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button
							variant="ghost"
							size="sm"
							className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground hover:bg-foreground/10 transition-all gap-1"
						>
							<span className="font-medium">{getAspectRatioLabel(aspectRatio)}</span>
							<ChevronDown className="w-3 h-3" />
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end" className="bg-editor-surface-alt border-foreground/10">
						{ASPECT_RATIOS.map((ratio) => (
							<DropdownMenuItem
								key={ratio}
								onClick={() => onAspectRatioChange?.(ratio)}
								className="text-muted-foreground hover:text-foreground hover:bg-foreground/10 cursor-pointer flex items-center justify-between gap-3"
							>
								<span>{getAspectRatioLabel(ratio)}</span>
								{aspectRatio === ratio ? <Check className="w-3 h-3 text-[#2563EB]" /> : null}
							</DropdownMenuItem>
						))}
						<div className="mx-1 my-1 h-px bg-foreground/10" />
						<div className="px-2 py-1.5 flex items-center gap-2 text-muted-foreground">
							<span className="text-sm">Custom</span>
							<input
								type="text"
								inputMode="numeric"
								value={customAspectWidth}
								onChange={(event) => onCustomAspectWidthChange(event.target.value.replace(/\D/g, ""))}
								onKeyDown={onCustomAspectRatioKeyDown}
								className="w-12 h-7 rounded border border-foreground/10 bg-foreground/5 px-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-[#2563EB]"
								aria-label="Custom aspect width"
							/>
							<span className="text-muted-foreground/70">:</span>
							<input
								type="text"
								inputMode="numeric"
								value={customAspectHeight}
								onChange={(event) => onCustomAspectHeightChange(event.target.value.replace(/\D/g, ""))}
								onKeyDown={onCustomAspectRatioKeyDown}
								className="w-12 h-7 rounded border border-foreground/10 bg-foreground/5 px-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-[#2563EB]"
								aria-label="Custom aspect height"
							/>
							<Button
								variant="ghost"
								size="sm"
								onClick={onApplyCustomAspectRatio}
								className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground hover:bg-foreground/10"
							>
								Set
							</Button>
							{isCustomAspectRatio(aspectRatio) ? (
								<Check className="w-3 h-3 text-[#2563EB] ml-auto" />
							) : null}
						</div>
					</DropdownMenuContent>
				</DropdownMenu>
				<div className="w-[1px] h-4 bg-foreground/10" />
				<Button
					variant="ghost"
					size="sm"
					onClick={() => onOpenCropEditor?.()}
					className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground hover:bg-foreground/10 transition-all gap-1.5"
				>
					<Crop className="w-3.5 h-3.5" />
					<span className="font-medium">{t("sections.crop", "Crop")}</span>
					{isCropped ? <span className="h-1.5 w-1.5 rounded-full bg-[#2563EB]" /> : null}
				</Button>
			</div>
			<div className="flex-1" />
			<div className="flex items-center gap-4 text-[10px] text-muted-foreground/70 font-medium">
				<span className="flex items-center gap-1.5">
					<kbd className="px-1.5 py-0.5 bg-foreground/5 border border-foreground/10 rounded text-[#2563EB] font-sans">
						Side Scroll
					</kbd>
					<span>Pan</span>
				</span>
				<span className="flex items-center gap-1.5">
					<kbd className="px-1.5 py-0.5 bg-foreground/5 border border-foreground/10 rounded text-[#2563EB] font-sans">
						{scrollLabels.pan}
					</kbd>
					<span>Pan</span>
				</span>
				<span className="flex items-center gap-1.5">
					<kbd className="px-1.5 py-0.5 bg-foreground/5 border border-foreground/10 rounded text-[#2563EB] font-sans">
						{scrollLabels.zoom}
					</kbd>
					<span>Zoom</span>
				</span>
			</div>
		</div>
	);
}