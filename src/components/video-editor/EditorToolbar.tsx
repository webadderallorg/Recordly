import {
	CaretDown as ChevronDown,
	CaretUp as ChevronUp,
	Pause,
	Play,
	Plus,
	Scissors,
	SkipBack,
	SkipForward,
	MagicWand as WandSparkles,
	MagnifyingGlassPlus as ZoomIn,
	SpeakerLow as Volume1,
	SpeakerHigh as Volume2,
	SpeakerX as VolumeX,
} from "@phosphor-icons/react";
import type React from "react";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useI18n } from "@/contexts/I18nContext";
import type { TimelineEditorHandle } from "./timeline/TimelineEditor";
import type { useEditorPreferences } from "./hooks/useEditorPreferences";
import type { useEditorRegions } from "./hooks/useEditorRegions";

type Prefs = ReturnType<typeof useEditorPreferences>;
type Regions = ReturnType<typeof useEditorRegions>;

function formatTime(seconds: number) {
	if (!Number.isFinite(seconds) || Number.isNaN(seconds) || seconds < 0) return "0:00";
	const mins = Math.floor(seconds / 60);
	const secs = Math.floor(seconds % 60);
	return `${mins}:${secs.toString().padStart(2, "0")}`;
}

interface EditorToolbarProps {
	prefs: Prefs;
	regions: Regions;
	duration: number;
	isPlaying: boolean;
	timelineCollapsed: boolean;
	timelineRef: React.RefObject<TimelineEditorHandle | null>;
	setTimelineCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
	togglePlayPause: () => void;
	handleSeek: (time: number) => void;
}

export function EditorToolbar({
	prefs,
	regions,
	duration,
	isPlaying,
	timelineCollapsed,
	timelineRef,
	setTimelineCollapsed,
	togglePlayPause,
	handleSeek,
}: EditorToolbarProps) {
	const { t } = useI18n();

	return (
		<div className="relative flex flex-shrink-0 items-center px-1 py-1">
			{/* Left tools */}
			<div className="z-10 flex min-w-0 flex-1 items-center gap-1.5">
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button
							variant="ghost"
							size="sm"
							className="h-7 gap-1 rounded-full border border-foreground/[0.08] bg-foreground/[0.04] px-2.5 text-[11px] text-foreground/65 shadow-[inset_0_1px_0_hsl(var(--foreground)/0.06)] transition-all hover:bg-foreground/[0.08] hover:text-foreground"
						>
							<Plus className="w-3.5 h-3.5" />
							<span className="font-medium">{t("editor.toolbar.addLayer")}</span>
							<ChevronDown className="w-3 h-3" />
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent
						align="start"
						className="bg-editor-surface-alt border-foreground/10"
					>
						<DropdownMenuItem
							onClick={() => {
								const nextTrackIndex =
									regions.annotationRegions.length > 0
										? Math.max(
												...regions.annotationRegions.map((r) => r.trackIndex ?? 0),
											) + 1
										: 0;
								timelineRef.current?.addAnnotation(nextTrackIndex);
							}}
							className="text-muted-foreground hover:text-foreground hover:bg-foreground/10 cursor-pointer"
						>
							{t("timeline.annotation.label")}
						</DropdownMenuItem>
						<DropdownMenuItem
							onClick={() => timelineRef.current?.addAudio()}
							className="text-muted-foreground hover:text-foreground hover:bg-foreground/10 cursor-pointer"
						>
							{t("timeline.audio.label")}
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
				<div className="w-[1px] h-4 bg-foreground/10 mx-1" />
				<Button
					onClick={() => timelineRef.current?.addZoom()}
					variant="ghost"
					size="icon"
					className="h-7 w-7 rounded-full text-muted-foreground transition-all hover:bg-[#2563EB]/10 hover:text-[#2563EB]"
					title={t("timeline.zoom.addZoom")}
				>
					<ZoomIn className="w-4 h-4" />
				</Button>
				<Button
					onClick={() => timelineRef.current?.suggestZooms()}
					variant="ghost"
					size="icon"
					className="h-7 w-7 rounded-full text-muted-foreground transition-all hover:bg-[#2563EB]/10 hover:text-[#2563EB]"
					title={t("timeline.zoom.suggestZooms")}
				>
					<WandSparkles className="w-4 h-4" />
				</Button>
				<Button
					onClick={() => timelineRef.current?.splitClip()}
					variant="ghost"
					size="icon"
					className="h-7 w-7 rounded-full text-muted-foreground transition-all hover:bg-foreground/10 hover:text-foreground"
					title={t("editor.toolbar.splitClip")}
				>
					<Scissors className="w-4 h-4" />
				</Button>
			</div>
			{/* Playback controls */}
			<div className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none">
				<div className="flex items-center gap-1.5 pointer-events-auto">
					<span className="mr-1 text-[10px] font-medium tabular-nums text-muted-foreground">
						{formatTime(regions.timelinePlayheadTime)}
					</span>
					<Button
						variant="ghost"
						size="icon"
						className="h-7 w-7 rounded-full text-muted-foreground transition-all hover:bg-foreground/10 hover:text-foreground"
						title={t("editor.playback.skipBack")}
						onClick={() => {
							const currentMs = regions.timelinePlayheadTime * 1000;
							const kfs = timelineRef.current?.keyframes ?? [];
							const prev = [...kfs].reverse().find((k) => k.time < currentMs - 50);
							handleSeek(
								prev ? prev.time / 1000 : Math.max(0, regions.timelinePlayheadTime - 5),
							);
						}}
					>
						<SkipBack className="w-3.5 h-3.5" weight="fill" />
					</Button>
					<Button
						variant="ghost"
						size="icon"
						className={`h-7 w-7 rounded-full border border-foreground/10 transition-all shadow-[0_8px_18px_rgba(0,0,0,0.18)] ${isPlaying ? "bg-foreground/10 text-foreground hover:bg-foreground/20" : "bg-neutral-800 text-white hover:bg-neutral-700 dark:bg-white dark:text-black dark:hover:bg-white/90"}`}
						onClick={togglePlayPause}
						title={isPlaying ? "Pause" : "Play"}
					>
						{isPlaying ? (
							<Pause className="w-3.5 h-3.5" weight="fill" />
						) : (
							<Play className="w-3.5 h-3.5" weight="fill" />
						)}
					</Button>
					<Button
						variant="ghost"
						size="icon"
						className="h-7 w-7 rounded-full text-muted-foreground transition-all hover:bg-foreground/10 hover:text-foreground"
						title={t("editor.playback.skipForward")}
						onClick={() => {
							const currentMs = regions.timelinePlayheadTime * 1000;
							const kfs = timelineRef.current?.keyframes ?? [];
							const next = kfs.find((k) => k.time > currentMs + 50);
							handleSeek(
								next ? next.time / 1000 : Math.min(duration, regions.timelinePlayheadTime + 5),
							);
						}}
					>
						<SkipForward className="w-3.5 h-3.5" weight="fill" />
					</Button>
					<span className="text-[10px] font-medium text-muted-foreground/70 tabular-nums ml-1">
						{formatTime(duration)}
					</span>
				</div>
			</div>
			{/* Right: collapse + volume */}
			<div className="z-10 ml-auto flex items-center gap-2">
				<Button
					variant="ghost"
					size="icon"
					title={
						timelineCollapsed
							? t("editor.timeline.expand")
							: t("editor.timeline.collapse")
					}
					className="h-7 w-7 rounded-full text-muted-foreground transition-all hover:bg-foreground/10 hover:text-foreground"
					onClick={() => setTimelineCollapsed((p) => !p)}
				>
					{timelineCollapsed ? (
						<ChevronUp className="w-3.5 h-3.5" />
					) : (
						<ChevronDown className="w-3.5 h-3.5" />
					)}
				</Button>
				<div className="flex items-center gap-1.5">
					<button
						type="button"
						className="text-muted-foreground hover:text-foreground transition-colors"
						title={t("editor.playback.muteUnmute")}
						onClick={() =>
							prefs.setPreviewVolume(prefs.previewVolume <= 0.001 ? 1 : 0)
						}
					>
						{prefs.previewVolume <= 0.001 ? (
							<VolumeX className="w-3.5 h-3.5" />
						) : prefs.previewVolume < 0.5 ? (
							<Volume1 className="w-3.5 h-3.5" />
						) : (
							<Volume2 className="w-3.5 h-3.5" />
						)}
					</button>
					<div className="relative flex h-7 w-24 select-none items-center overflow-hidden rounded-full border border-foreground/[0.06] bg-editor-bg/80 shadow-[inset_0_1px_0_hsl(var(--foreground)/0.06)]">
						<div
							className="absolute inset-y-[3px] left-[3px] right-auto rounded-[10px] bg-foreground/[0.08]"
							style={{
								width:
									prefs.previewVolume > 0
										? `max(calc(${prefs.previewVolume * 100}% - 6px), 1.2rem)`
										: 0,
							}}
						/>
						<div
							className="pointer-events-none absolute bottom-[18%] top-[18%] z-10 w-[2px] rounded-full bg-foreground/95 shadow-[0_0_10px_rgba(37,99,235,0.28)]"
							style={{
								left: `calc(${prefs.previewVolume * 100}% - 8px)`,
							}}
						/>
						<span className="pointer-events-none relative z-10 pl-2 text-[10px] font-medium text-muted-foreground">
							{Math.round(prefs.previewVolume * 100)}%
						</span>
						<input
							type="range"
							min="0"
							max="1"
							step="0.01"
							value={prefs.previewVolume}
							onChange={(e) => prefs.setPreviewVolume(Number(e.target.value))}
							className="absolute inset-0 h-full w-full cursor-ew-resize opacity-0"
						/>
					</div>
				</div>
			</div>
		</div>
	);
}
