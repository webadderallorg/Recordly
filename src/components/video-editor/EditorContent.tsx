import {
	Check,
	CaretDown as ChevronDown,
	Crop,
	X,
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
import { ASPECT_RATIOS, getAspectRatioLabel, getAspectRatioValue } from "@/utils/aspectRatioUtils";
import { CropControl } from "./CropControl";
import { EditorToolbar } from "./EditorToolbar";
import TimelineEditor, { type TimelineEditorHandle } from "./timeline/TimelineEditor";
import VideoPlayback, { VideoPlaybackRef } from "./VideoPlayback";
import type { CursorTelemetryPoint } from "./types";
import type { useEditorPreferences } from "./hooks/useEditorPreferences";
import type { useEditorRegions } from "./hooks/useEditorRegions";
import type { useEditorCaptions } from "./hooks/useEditorCaptions";

type Prefs = ReturnType<typeof useEditorPreferences>;
type Regions = ReturnType<typeof useEditorRegions>;
type Captions = ReturnType<typeof useEditorCaptions>;

interface EditorContentProps {
	prefs: Prefs;
	regions: Regions;
	captions: Captions;
	videoPath: string | null;
	currentTime: number;
	duration: number;
	isPlaying: boolean;
	previewVersion: number;
	timelineCollapsed: boolean;
	showCropModal: boolean;
	isCropped: boolean;
	hasSourceAudioFallback: boolean;
	effectiveCursorTelemetry: CursorTelemetryPoint[];
	normalizedCursorTelemetry: CursorTelemetryPoint[];
	autoSuggestZoomsTrigger: number;
	videoPlaybackRef: React.RefObject<VideoPlaybackRef | null>;
	timelineRef: React.RefObject<TimelineEditorHandle | null>;
	setDuration: (v: number) => void;
	setIsPreviewReady: (v: boolean) => void;
	setCurrentTime: (v: number) => void;
	setIsPlaying: (v: boolean) => void;
	setError: (v: string | null) => void;
	setTimelineCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
	togglePlayPause: () => void;
	handleSeek: (time: number) => void;
	handleOpenCropEditor: () => void;
	handleCloseCropEditor: () => void;
	handleCancelCropEditor: () => void;
	handleAutoSuggestZoomsConsumed: () => void;
}

export function EditorContent({
	prefs,
	regions,
	captions,
	videoPath,
	currentTime,
	duration,
	isPlaying,
	previewVersion,
	timelineCollapsed,
	showCropModal,
	isCropped,
	hasSourceAudioFallback,
	effectiveCursorTelemetry,
	normalizedCursorTelemetry,
	autoSuggestZoomsTrigger,
	videoPlaybackRef,
	timelineRef,
	setDuration,
	setIsPreviewReady,
	setCurrentTime,
	setIsPlaying,
	setError,
	setTimelineCollapsed,
	togglePlayPause,
	handleSeek,
	handleOpenCropEditor,
	handleCloseCropEditor,
	handleCancelCropEditor,
	handleAutoSuggestZoomsConsumed,
}: EditorContentProps) {
	const { t } = useI18n();

	return (
		<>
			<div className="flex min-h-0 flex-1 flex-col gap-3">
				{/* Preview */}
				<div className="flex min-h-0 flex-1 flex-col">
					<div className="relative flex flex-1 min-h-0 flex-col overflow-hidden">
						{/* Aspect ratio + crop controls */}
						<div className="flex items-center justify-center gap-2 py-1.5 flex-shrink-0">
							<DropdownMenu>
								<DropdownMenuTrigger asChild>
									<Button
										variant="ghost"
										size="sm"
										className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground hover:bg-foreground/10 transition-all gap-1"
									>
										<span className="font-medium">
											{getAspectRatioLabel(prefs.aspectRatio)}
										</span>
										<ChevronDown className="w-3 h-3" />
									</Button>
								</DropdownMenuTrigger>
								<DropdownMenuContent
									align="center"
									className="bg-editor-surface-alt border-foreground/10"
								>
									{ASPECT_RATIOS.map((ratio) => (
										<DropdownMenuItem
											key={ratio}
											onClick={() => prefs.setAspectRatio(ratio)}
											className="text-muted-foreground hover:text-foreground hover:bg-foreground/10 cursor-pointer flex items-center justify-between gap-3"
										>
											<span>{getAspectRatioLabel(ratio)}</span>
											{prefs.aspectRatio === ratio && (
												<Check className="w-3 h-3 text-[#2563EB]" />
											)}
										</DropdownMenuItem>
									))}
								</DropdownMenuContent>
							</DropdownMenu>
							<div className="w-[1px] h-4 bg-foreground/20" />
							<Button
								variant="ghost"
								size="sm"
								onClick={handleOpenCropEditor}
								className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground hover:bg-foreground/10 transition-all gap-1.5"
							>
								<Crop className="w-3.5 h-3.5" />
								<span className="font-medium">{t("settings.crop.title")}</span>
								{isCropped ? (
									<span className="h-1.5 w-1.5 rounded-full bg-[#2563EB]" />
								) : null}
							</Button>
						</div>
						{/* Video preview */}
						<div
							className="flex w-full min-h-0 flex-1 items-stretch"
							style={{ flex: "1 1 auto", margin: "6px 0 0" }}
						>
							<div className="flex min-w-0 flex-1 items-center justify-center px-1">
								<div
									className="relative overflow-hidden rounded-[30px]"
									style={{
										width: "auto",
										height: "100%",
										aspectRatio: getAspectRatioValue(
											prefs.aspectRatio,
											(() => {
												const previewVideo = videoPlaybackRef.current?.video;
												if (previewVideo && previewVideo.videoHeight > 0) {
													return previewVideo.videoWidth / previewVideo.videoHeight;
												}
												return 16 / 9;
											})(),
										),
										maxWidth: "100%",
										margin: "0 auto",
										boxSizing: "border-box",
									}}
								>
									<VideoPlayback
										key={`${videoPath || "no-video"}:${previewVersion}`}
										aspectRatio={prefs.aspectRatio}
										ref={videoPlaybackRef as React.Ref<VideoPlaybackRef>}
										videoPath={videoPath || ""}
										onDurationChange={setDuration}
										onPreviewReadyChange={setIsPreviewReady}
										onTimeUpdate={setCurrentTime}
										currentTime={currentTime}
										onPlayStateChange={setIsPlaying}
										onError={setError}
										wallpaper={prefs.wallpaper}
										zoomRegions={regions.effectiveZoomRegions}
										selectedZoomId={regions.selectedZoomId}
										onSelectZoom={regions.handleSelectZoom}
										onZoomFocusChange={regions.handleZoomFocusChange}
										isPlaying={isPlaying}
										showShadow={prefs.shadowIntensity > 0}
										shadowIntensity={prefs.shadowIntensity}
										backgroundBlur={prefs.backgroundBlur}
										zoomMotionBlur={prefs.zoomMotionBlur}
										connectZooms={prefs.connectZooms}
										zoomInDurationMs={prefs.zoomInDurationMs}
										zoomInOverlapMs={prefs.zoomInOverlapMs}
										zoomOutDurationMs={prefs.zoomOutDurationMs}
										connectedZoomGapMs={prefs.connectedZoomGapMs}
										connectedZoomDurationMs={prefs.connectedZoomDurationMs}
										zoomInEasing={prefs.zoomInEasing}
										zoomOutEasing={prefs.zoomOutEasing}
										connectedZoomEasing={prefs.connectedZoomEasing}
										borderRadius={prefs.borderRadius}
										padding={prefs.padding}
										frame={prefs.frame}
										cropRegion={prefs.cropRegion}
										webcam={prefs.webcam}
										webcamVideoPath={
											prefs.webcam.sourcePath ? prefs.resolvedWebcamVideoUrl : null
										}
										trimRegions={regions.trimRegions}
										speedRegions={regions.effectiveSpeedRegions}
										annotationRegions={regions.annotationRegions}
										autoCaptions={captions.autoCaptions}
										autoCaptionSettings={captions.autoCaptionSettings}
										selectedAnnotationId={regions.selectedAnnotationId}
										onSelectAnnotation={regions.handleSelectAnnotation}
										onAnnotationPositionChange={regions.handleAnnotationPositionChange}
										onAnnotationSizeChange={regions.handleAnnotationSizeChange}
										cursorTelemetry={effectiveCursorTelemetry}
										showCursor={prefs.showCursor}
										cursorStyle={prefs.cursorStyle}
										cursorSize={prefs.cursorSize}
										cursorSmoothing={prefs.cursorSmoothing}
										zoomSmoothness={prefs.zoomSmoothness}
										zoomClassicMode={prefs.zoomClassicMode}
										cursorMotionBlur={prefs.cursorMotionBlur}
										cursorClickBounce={prefs.cursorClickBounce}
										cursorClickBounceDuration={prefs.cursorClickBounceDuration}
										cursorSway={prefs.cursorSway}
										volume={hasSourceAudioFallback ? 0 : prefs.previewVolume}
									/>
								</div>
							</div>
						</div>
					</div>
				</div>
				{/* Toolbar */}
				<EditorToolbar
					prefs={prefs}
					regions={regions}
					duration={duration}
					isPlaying={isPlaying}
					timelineCollapsed={timelineCollapsed}
					timelineRef={timelineRef}
					setTimelineCollapsed={setTimelineCollapsed}
					togglePlayPause={togglePlayPause}
					handleSeek={handleSeek}
				/>
			</div>
			{/* Timeline */}
			<div
				className="flex-shrink-0 flex flex-col"
				style={{
					height: timelineCollapsed ? undefined : "15%",
					minHeight: timelineCollapsed ? 0 : 160,
				}}
			>
				<TimelineEditor
					ref={timelineRef as React.Ref<TimelineEditorHandle>}
					hideToolbar
					videoDuration={duration}
					currentTime={currentTime}
					playheadTime={regions.timelinePlayheadTime}
					onSeek={handleSeek}
					videoPath={videoPath}
					cursorTelemetry={normalizedCursorTelemetry}
					autoSuggestZoomsTrigger={autoSuggestZoomsTrigger}
					onAutoSuggestZoomsConsumed={handleAutoSuggestZoomsConsumed}
					zoomRegions={regions.zoomRegions}
					onZoomAdded={regions.handleZoomAdded}
					onZoomSuggested={regions.handleZoomSuggested}
					onZoomSpanChange={regions.handleZoomSpanChange}
					onZoomDelete={regions.handleZoomDelete}
					selectedZoomId={regions.selectedZoomId}
					onSelectZoom={regions.handleSelectZoom}
					trimRegions={regions.trimRegions}
					clipRegions={regions.clipRegions}
					onClipSplit={regions.handleClipSplit}
					onClipSpanChange={regions.handleClipSpanChange}
					onClipDelete={regions.handleClipDelete}
					selectedClipId={regions.selectedClipId}
					onSelectClip={regions.handleSelectClip}
					audioRegions={regions.audioRegions}
					onAudioAdded={regions.handleAudioAdded}
					onAudioSpanChange={regions.handleAudioSpanChange}
					onAudioDelete={regions.handleAudioDelete}
					selectedAudioId={regions.selectedAudioId}
					onSelectAudio={regions.handleSelectAudio}
					annotationRegions={regions.annotationRegions}
					onAnnotationAdded={regions.handleAnnotationAdded}
					onAnnotationSpanChange={regions.handleAnnotationSpanChange}
					onAnnotationDelete={regions.handleAnnotationDelete}
					selectedAnnotationId={regions.selectedAnnotationId}
					onSelectAnnotation={regions.handleSelectAnnotation}
					aspectRatio={prefs.aspectRatio}
				/>
			</div>
			{/* Crop modal */}
			{showCropModal ? (
				<>
					<div
						className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200"
						onClick={handleCancelCropEditor}
					/>
					<div className="fixed left-1/2 top-1/2 z-[60] max-h-[90vh] w-[90vw] max-w-5xl -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-2xl border border-foreground/10 bg-background p-8 shadow-2xl animate-in zoom-in-95 duration-200">
						<div className="mb-6 flex items-center justify-between">
							<div>
								<span className="text-xl font-bold text-foreground">
									{t("settings.crop.title")}
								</span>
								<p className="mt-2 text-sm text-muted-foreground">
									{t("settings.crop.instruction")}
								</p>
							</div>
							<Button
								variant="ghost"
								size="icon"
								onClick={handleCancelCropEditor}
								className="text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
							>
								<X className="h-5 w-5" />
							</Button>
						</div>
						<CropControl
							videoElement={videoPlaybackRef.current?.video || null}
							cropRegion={prefs.cropRegion}
							onCropChange={prefs.setCropRegion}
							aspectRatio={prefs.aspectRatio}
						/>
						<div className="mt-6 flex justify-end">
							<Button
								onClick={handleCloseCropEditor}
								size="lg"
								className="bg-[#2563EB] text-white hover:bg-[#2563EB]/90"
							>
								{t("common.actions.done")}
							</Button>
						</div>
					</div>
				</>
			) : null}
		</>
	);
}
