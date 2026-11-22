import { type Dispatch, type RefObject, type SetStateAction, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
	CaretDown,
	Crop,
	MagicWand,
	MagnifyingGlassPlus,
	MinusIcon,
	Pause,
	Play,
	Plus,
	Scissors,
	SkipBack,
	SkipForward,
	SpeakerHigh,
	SpeakerLow,
	SpeakerX,
	Trash,
	TrimEnd,
	TrimStart,
} from "@/components/ui/icons";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Slider } from "@/components/ui/slider";
import type { useI18n } from "@/contexts/I18nContext";
import { useI18n as useUiLocale } from "@/contexts/I18nContext";
import { useShortcuts } from "@/contexts/ShortcutsContext";
import { bindingsEqual, CLEAR_ALL_ZOOMS_SHORTCUT, formatBinding } from "@/lib/shortcuts";
import type { AspectRatio } from "@/utils/aspectRatioUtils";
import type { useVideoEditorAudio } from "../audio/useVideoEditorAudio";
import type { CaptionEditTarget } from "../captionEditing";
import type { useAnnotationRegionCommands } from "../hooks/useAnnotationRegionCommands";
import type { useEditorPlaybackControls } from "../hooks/useEditorPlaybackControls";
import type { useTimelineProjection } from "../hooks/useTimelineProjection";
import type { useZoomRegionCommands } from "../hooks/useZoomRegionCommands";
import { formatPlaybackTime } from "../playbackTime";
import type { useAppearanceState } from "../state/useAppearanceState";
import type { useTimelineState } from "../state/useTimelineState";
import type { TimelineEditorHandle } from "../timeline/TimelineEditor";
import type { VideoPlaybackRef } from "../VideoPlayback";
import { AnnotationToolbar } from "./AnnotationToolbar";
import { AspectRatioPicker } from "./AspectRatioPicker";
import { EditorVideoPreview } from "./EditorVideoPreview";
import { InlineCropEditor } from "./InlineCropEditor";

// Temporarily hide the toolbar while retaining the annotation tools.
const SHOW_ANNOTATION_TOOLBAR = false;

function TimestampDigits({ value }: { value: string }) {
	return Array.from(value, (character, index) => (
		<span
			key={value.length - index}
			aria-hidden="true"
			className={/[0-9]/.test(character) ? "inline-block w-[1ch] text-center" : undefined}
		>
			{character}
		</span>
	));
}

type Props = {
	t: ReturnType<typeof useI18n>["t"];
	videoPath: string | null;
	previewVersion: number;
	aspectRatio: AspectRatio;
	setAspectRatio: Dispatch<SetStateAction<AspectRatio>>;
	previewAspectRatioValue: number;
	videoPlaybackRef: RefObject<VideoPlaybackRef | null>;
	timelineRef: RefObject<TimelineEditorHandle | null>;
	currentTime: number;
	isPlaying: boolean;
	previewVolume: number;
	setPreviewVolume: Dispatch<SetStateAction<number>>;
	suspendRendering: boolean;
	appearance: ReturnType<typeof useAppearanceState>;
	timeline: ReturnType<typeof useTimelineState>;
	audio: ReturnType<typeof useVideoEditorAudio>;
	projection: ReturnType<typeof useTimelineProjection>;
	playback: ReturnType<typeof useEditorPlaybackControls>;
	zoomCommands: ReturnType<typeof useZoomRegionCommands>;
	annotationCommands: ReturnType<typeof useAnnotationRegionCommands>;
	effectiveCursorTelemetry: ReturnType<typeof useTimelineState>["cursorTelemetry"];
	effectiveShowCursor: boolean;
	handleOpenCropEditor: () => void;
	isCropping: boolean;
	onCancelCrop: () => void;
	onDoneCrop: () => void;
	handleSaveAutoCaptionEdit: (target: CaptionEditTarget, text: string) => void;
	handleSelectAnnotation: (id: string | null) => void;
	setDuration: Dispatch<SetStateAction<number>>;
	isPreviewReady: boolean;
	setIsPreviewReady: Dispatch<SetStateAction<boolean>>;
	setCurrentTime: Dispatch<SetStateAction<number>>;
	setIsPlaying: Dispatch<SetStateAction<boolean>>;
	setError: (message: string | null) => void;
	onImportVideoClip: () => void;
	canImportVideoClip: boolean;
};

export function EditorPreviewPanel(props: Props) {
	const { locale, t: uiText } = useUiLocale();
	const { shortcuts, isMac } = useShortcuts();
	const [playbackResolution, setPlaybackResolution] = useState("1");
	const {
		t,
		videoPath,
		previewVersion,
		aspectRatio,
		setAspectRatio,
		previewAspectRatioValue,
		videoPlaybackRef,
		timelineRef,
		currentTime,
		isPlaying,
		previewVolume,
		setPreviewVolume,
		suspendRendering,
		appearance,
		timeline,
		audio,
		projection,
		playback,
		zoomCommands,
		annotationCommands,
		effectiveCursorTelemetry,
		effectiveShowCursor,
		handleOpenCropEditor,
		isCropping,
		onCancelCrop,
		onDoneCrop,
		handleSaveAutoCaptionEdit,
		handleSelectAnnotation,
		setDuration,
		isPreviewReady,
		setIsPreviewReady,
		setCurrentTime,
		setIsPlaying,
		setError,
	} = props;
	const clearZoomsLabel = t("settings.zoom.clearAllZooms");
	const clearZoomsTitle = Object.values(shortcuts).some((binding) =>
		bindingsEqual(binding, CLEAR_ALL_ZOOMS_SHORTCUT),
	)
		? clearZoomsLabel
		: `${clearZoomsLabel} (${formatBinding(CLEAR_ALL_ZOOMS_SHORTCUT, isMac)})`;
	const splitClipLabel = `${uiText("editing.splitClip", "Split Clip")} (${formatBinding(shortcuts.splitClip, isMac)})`;
	const trimStartLabel = t("editor.toolbar.trimStart", undefined, {
		shortcut: formatBinding(shortcuts.trimStart, isMac),
	});
	const trimEndLabel = t("editor.toolbar.trimEnd", undefined, {
		shortcut: formatBinding(shortcuts.trimEnd, isMac),
	});
	const playbackResolutionLabel = t("editor.playback.resolution");
	const currentTimestamp = formatPlaybackTime(projection.timelinePlayheadTime);
	const durationTimestamp = formatPlaybackTime(projection.timelineDuration);
	// Reserve label and digit space without changing the inherited UI typography.
	const timestampWidth = `${Math.max(6, durationTimestamp.length)}ch`;

	return (
		<div className="editor-preview-panel flex min-h-0 min-w-0 flex-1 flex-col">
			<div className="flex min-h-0 flex-1 flex-col">
				<div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
					<div className="flex h-10 shrink-0 items-center justify-center gap-3">
						<AspectRatioPicker
							value={aspectRatio}
							onChange={setAspectRatio}
							sourceWidth={videoPlaybackRef.current?.video?.videoWidth}
							sourceHeight={videoPlaybackRef.current?.video?.videoHeight}
						/>
						<div className="h-4 w-px bg-foreground/20" />
						<Button
							variant="ghost"
							size="sm"
							onClick={() => {
								setIsPlaying(false);
								handleOpenCropEditor();
							}}
							disabled={!videoPath || !isPreviewReady || isCropping}
							aria-pressed={isCropping}
							className="h-7 gap-1.5 px-2 text-xs"
						>
							<Crop className="h-3.5 w-3.5" />
							<span className="font-medium">
								{t("settings.sections.crop", "Crop")}
							</span>
						</Button>
					</div>
					<div
						className="flex min-h-0 w-full flex-1 items-stretch gap-3 px-4 py-3"
						style={{ flex: "1 1 auto", margin: 0 }}
					>
						{SHOW_ANNOTATION_TOOLBAR && (
							<AnnotationToolbar
								disabled={!videoPath || !isPreviewReady || isCropping}
								onAdd={(type) => {
									videoPlaybackRef.current?.pause();
									setIsPlaying(false);
									const nextTrack = timeline.annotationRegions.reduce(
										(next, region) =>
											Math.max(next, (region.trackIndex ?? 0) + 1),
										0,
									);
									timelineRef.current?.addAnnotation(
										nextTrack,
										type,
										videoPlaybackRef.current?.getAnnotationPlacement?.() ??
											undefined,
									);
								}}
							/>
						)}
						<div
							className="editor-preview-stage relative flex min-h-0 min-w-0 flex-1 items-center justify-center"
							style={{ containerType: "size" }}
							onPointerDownCapture={(event) => {
								if (
									event.button === 0 &&
									!isCropping &&
									timeline.selectedAnnotationId &&
									event.target instanceof Element &&
									!event.target.closest("[data-annotation-id]")
								) {
									handleSelectAnnotation(null);
								}
							}}
						>
							{isCropping && (
								<InlineCropEditor
									videoElement={videoPlaybackRef.current?.video ?? null}
									cropRegion={appearance.cropRegion}
									onCropChange={appearance.setCropRegion}
									onCancel={onCancelCrop}
									onDone={onDoneCrop}
								/>
							)}
							<div
								className={`editor-preview-frame relative${isPreviewReady ? " loading-content-enter" : ""}`}
								inert={isCropping}
								style={{
									width: `min(100cqw, calc(100cqh * ${previewAspectRatioValue}))`,
									height: `min(100cqh, calc(100cqw / ${previewAspectRatioValue}))`,
									aspectRatio: previewAspectRatioValue,
									maxWidth: "100%",
									margin: "0 auto",
									boxSizing: "border-box",
									opacity: isCropping ? 0 : 1,
									transition: "none",
								}}
							>
								{videoPath && !isPreviewReady && (
									<Skeleton
										aria-label={uiText("ui.loadingPreview")}
										className="pointer-events-none absolute inset-0 z-20 h-full w-full rounded-none"
									/>
								)}
								<EditorVideoPreview
									videoPath={videoPath}
									previewVersion={previewVersion}
									aspectRatio={aspectRatio}
									playbackRef={videoPlaybackRef}
									currentTime={currentTime}
									isPlaying={isPlaying && !isCropping}
									previewVolume={previewVolume}
									previewResolutionScale={Number(playbackResolution) || 1}
									suspendRendering={suspendRendering || isCropping}
									appearance={appearance}
									timeline={timeline}
									audio={audio}
									effectiveZoomRegions={projection.effectiveZoomRegions}
									effectiveCursorTelemetry={effectiveCursorTelemetry}
									effectiveShowCursor={effectiveShowCursor}
									setDuration={setDuration}
									setIsPreviewReady={setIsPreviewReady}
									setCurrentTime={setCurrentTime}
									setIsPlaying={setIsPlaying}
									setError={setError}
									handlers={{
										onSelectZoom: zoomCommands.handleSelectZoom,
										onZoomFocusChange: zoomCommands.handleZoomFocusChange,
										onEditAutoCaption: handleSaveAutoCaptionEdit,
										onSelectAnnotation: handleSelectAnnotation,
										onAnnotationContentChange:
											annotationCommands.handleAnnotationContentChange,
										onAnnotationDelete:
											annotationCommands.handleAnnotationDelete,
										onAnnotationPositionChange:
											annotationCommands.handleAnnotationPositionChange,
										onAnnotationSizeChange:
											annotationCommands.handleAnnotationSizeChange,
									}}
								/>
							</div>
						</div>
					</div>
				</div>
			</div>

			<div className="editor-playback relative grid min-h-14 shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-3 px-4">
				<div className="editor-playback-tools z-10 flex min-w-0 items-center gap-2">
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button
								variant="ghost"
								size="sm"
								className="editor-playback-add-layer h-9 gap-2 px-3"
								aria-label={t("editor.toolbar.addLayer")}
								title={t("editor.toolbar.addLayer")}
							>
								<Plus className="h-3.5 w-3.5" />
								<span className="editor-playback-add-label font-medium">
									{t("editor.toolbar.addLayer")}
								</span>
								<CaretDown className="editor-playback-add-caret h-3 w-3" />
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="start">
							<DropdownMenuItem
								onClick={props.onImportVideoClip}
								disabled={!props.canImportVideoClip}
								className="cursor-pointer text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
							>
								{t("ui.importVideo")}
							</DropdownMenuItem>
							<DropdownMenuItem
								onClick={() => {
									const nextTrack =
										timeline.annotationRegions.length > 0
											? Math.max(
													...timeline.annotationRegions.map(
														(region) => region.trackIndex ?? 0,
													),
												) + 1
											: 0;
									timelineRef.current?.addAnnotation(nextTrack);
								}}
								className="cursor-pointer text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
							>
								{t("timeline.annotation.label")}
							</DropdownMenuItem>
							<DropdownMenuItem
								onClick={() => {
									const nextTrack =
										timeline.audioRegions.length > 0
											? Math.max(
													...timeline.audioRegions.map(
														(region) => region.trackIndex ?? 0,
													),
												) + 1
											: 0;
									timelineRef.current?.addAudio(nextTrack);
								}}
								className="cursor-pointer text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
							>
								{t("timeline.audio.label")}
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>
					<Button
						onClick={() => timelineRef.current?.addZoom()}
						variant="ghost"
						size="icon"
						className="h-9 w-9"
						title={t("timeline.zoom.addZoom")}
					>
						<MagnifyingGlassPlus className="h-4 w-4" />
					</Button>
					<Button
						onClick={() => timelineRef.current?.splitClip()}
						variant="ghost"
						size="icon"
						className="editor-playback-clip-command h-9 w-9"
						title={splitClipLabel}
					>
						<Scissors className="h-4 w-4" />
					</Button>
					<Button
						onClick={() => timelineRef.current?.trimStart()}
						variant="ghost"
						size="icon"
						className="editor-playback-clip-command h-9 w-9"
						title={trimStartLabel}
					>
						<TrimStart className="h-4 w-4" />
					</Button>
					<Button
						onClick={() => timelineRef.current?.trimEnd()}
						variant="ghost"
						size="icon"
						className="editor-playback-clip-command h-9 w-9"
						title={trimEndLabel}
					>
						<TrimEnd className="h-4 w-4" />
					</Button>
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button
								variant="ghost"
								size="icon"
								className="editor-playback-clip-menu h-9 w-9"
								title={uiText("editing.clip", "Clip")}
							>
								<Scissors className="h-4 w-4" />
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="start">
							<DropdownMenuItem onSelect={() => timelineRef.current?.splitClip()}>
								{splitClipLabel}
							</DropdownMenuItem>
							<DropdownMenuItem onSelect={() => timelineRef.current?.trimStart()}>
								{trimStartLabel}
							</DropdownMenuItem>
							<DropdownMenuItem onSelect={() => timelineRef.current?.trimEnd()}>
								{trimEndLabel}
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>
					<Button
						onClick={() => timelineRef.current?.suggestZooms()}
						variant="ghost"
						size="icon"
						className="h-9 w-9"
						aria-label={t("timeline.zoom.suggestZooms")}
						title={t("timeline.zoom.suggestZooms")}
					>
						<MagicWand className="h-4 w-4" />
					</Button>
					<Button
						onClick={() => timelineRef.current?.clearAllZooms()}
						disabled={timeline.zoomRegions.length === 0}
						variant="ghost"
						size="icon"
						className="h-9 w-9"
						aria-label={clearZoomsLabel}
						title={clearZoomsTitle}
					>
						<Trash className="h-4 w-4" aria-hidden="true" />
					</Button>
				</div>

				<div className="editor-playback-center z-10 flex items-center justify-center">
					<div className="pointer-events-auto flex items-center gap-1.5">
						<span
							role="timer"
							aria-label={currentTimestamp}
							className="mr-1 shrink-0 whitespace-nowrap text-right text-[10px] font-medium tabular-nums text-muted-foreground"
							style={{ width: timestampWidth }}
						>
							<TimestampDigits value={currentTimestamp} />
						</span>
						<Button
							variant="ghost"
							size="icon"
							className="h-9 w-9"
							title={`${t("editor.playback.skipBack")} (Home)`}
							aria-label={t("editor.playback.skipBack")}
							aria-keyshortcuts="Home"
							onClick={(event) => {
								if (event.shiftKey) playback.handleSeek(0);
								else playback.handlePreviewSkip("backward");
							}}
							onKeyDown={(event) => {
								if (event.key !== "Home") return;
								event.preventDefault();
								playback.handleSeek(0);
							}}
						>
							<SkipBack className="h-3.5 w-3.5" weight="fill" />
						</Button>
						<Button
							variant="ghost"
							size="icon"
							className={`h-9 w-9 rounded-full ${isPlaying ? "bg-foreground/10 text-foreground hover:bg-foreground/20" : "bg-neutral-800 text-white hover:bg-neutral-700 dark:bg-white dark:text-black dark:hover:bg-white/90"}`}
							onClick={playback.togglePlayPause}
							title={
								isPlaying ? t("editor.playback.pause") : t("editor.playback.play")
							}
						>
							{isPlaying ? (
								<Pause className="h-3.5 w-3.5" weight="fill" />
							) : (
								<Play className="h-3.5 w-3.5" weight="fill" />
							)}
						</Button>
						<Button
							variant="ghost"
							size="icon"
							className="h-9 w-9"
							title={t("editor.playback.skipForward")}
							onClick={() => playback.handlePreviewSkip("forward")}
						>
							<SkipForward className="h-3.5 w-3.5" weight="fill" />
						</Button>
						<span
							role="timer"
							aria-label={durationTimestamp}
							className="ml-1 shrink-0 whitespace-nowrap text-[10px] font-medium tabular-nums text-muted-foreground/70"
							style={{ width: timestampWidth }}
						>
							<TimestampDigits value={durationTimestamp} />
						</span>
					</div>
				</div>

				<div className="editor-playback-volume z-10 ml-auto flex items-center gap-1">
					<div
						role="group"
						aria-label={t("shortcuts.actions.zoomTimeline")}
						className="flex items-center"
					>
						<Button
							onClick={() => timelineRef.current?.zoomTimelineOut()}
							variant="ghost"
							size="icon"
							aria-label={t("native.zoomOut")}
							title={t("native.zoomOut")}
						>
							<MinusIcon className="size-3.5" aria-hidden="true" />
						</Button>
						<Button
							onClick={() => timelineRef.current?.zoomTimelineIn()}
							variant="ghost"
							size="icon"
							aria-label={t("native.zoomIn")}
							title={t("native.zoomIn")}
						>
							<Plus className="size-3.5" aria-hidden="true" />
						</Button>
					</div>
					<div title={playbackResolutionLabel}>
						<Select
							aria-label={playbackResolutionLabel}
							value={playbackResolution}
							onValueChange={setPlaybackResolution}
							disabled={!videoPath || isCropping}
						>
							<SelectTrigger className="editor-playback-resolution text-xs">
								<SelectValue className="truncate" />
							</SelectTrigger>
							<SelectContent placement="top end" className="min-w-24">
								<SelectItem value="1">
									{t("editor.playback.fullResolution")}
								</SelectItem>
								<SelectItem value="0.5">1/2</SelectItem>
								<SelectItem value="0.25">1/4</SelectItem>
							</SelectContent>
						</Select>
					</div>
					<Popover>
						<PopoverTrigger asChild>
							<Button
								variant="ghost"
								size="icon"
								aria-label={t("editor.playback.volume", "Preview volume")}
								title={t("editor.playback.volume", "Preview volume")}
							>
								{previewVolume <= 0.001 ? (
									<SpeakerX className="size-3.5" />
								) : previewVolume < 0.5 ? (
									<SpeakerLow className="size-3.5" />
								) : (
									<SpeakerHigh className="size-3.5" />
								)}
							</Button>
						</PopoverTrigger>
						<PopoverContent
							side="top"
							sideOffset={10}
							aria-label={uiText("ui.previewVolume")}
							className="flex w-14 flex-col items-center gap-3 p-3"
						>
							<span className="text-[10px] tabular-nums text-muted-foreground">
								{new Intl.NumberFormat(locale, { style: "percent" }).format(
									previewVolume,
								)}
							</span>
							<Slider
								aria-label={t("editor.playback.volume", "Preview volume")}
								orientation="vertical"
								min={0}
								max={1}
								step={0.01}
								value={[previewVolume]}
								onValueChange={([value]) => setPreviewVolume(value)}
								className="h-28"
							/>
						</PopoverContent>
					</Popover>
				</div>
			</div>
		</div>
	);
}
