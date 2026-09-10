import type { ComponentProps } from "react";
import { EditorAnnouncementBanner } from "@/components/announcements/EditorAnnouncementBanner";
import { Toaster } from "@/components/ui/sonner";
import type { useI18n } from "@/contexts/I18nContext";
import type { useEditorExportController } from "../export/useEditorExportController";
import type { useExportDimensions } from "../export/useExportDimensions";
import type { useExportSession } from "../export/useExportSession";
import type { useExportSettings } from "../export/useExportSettings";
import type { useTimelineEditingController } from "../hooks/useTimelineEditingController";
import type { useVideoEditorPresets } from "../presets/useVideoEditorPresets";
import type { useEditorProjectController } from "../project/useEditorProjectController";
import { SettingsPanel } from "../SettingsPanel";
import type { useAppearanceState } from "../state/useAppearanceState";
import type { useEditorUiState } from "../state/useEditorUiState";
import type { useProjectState } from "../state/useProjectState";
import type { useTimelineState } from "../state/useTimelineState";
import { CropEditorDialog } from "./CropEditorDialog";
import { EditorDialogs } from "./EditorDialogs";
import { EditorHeader } from "./EditorHeader";
import { EditorPreviewPanel } from "./EditorPreviewPanel";
import { EditorSidebar } from "./EditorSidebar";
import { EditorTimelinePanel } from "./EditorTimelinePanel";

type Props = {
	t: ReturnType<typeof useI18n>["t"];
	project: ReturnType<typeof useProjectState>;
	appearance: ReturnType<typeof useAppearanceState>;
	timeline: ReturnType<typeof useTimelineState>;
	ui: ReturnType<typeof useEditorUiState>;
	presets: ReturnType<typeof useVideoEditorPresets>;
	projectController: ReturnType<typeof useEditorProjectController>;
	editing: ReturnType<typeof useTimelineEditingController>;
	exportController: ReturnType<typeof useEditorExportController>;
	exportSettings: ReturnType<typeof useExportSettings>;
	exportSession: ReturnType<typeof useExportSession>;
	exportDimensions: ReturnType<typeof useExportDimensions>;
	settingsPanelProps: ComponentProps<typeof SettingsPanel>;
	headerLeftControlsPaddingClass: string;
	hasCaptionsForSidecar: boolean;
	nvidiaCudaExportAvailable: boolean;
	experimentalNvidiaCudaExport: boolean;
	setExperimentalNvidiaCudaExport: (enabled: boolean) => void;
	effectiveShowCursor: boolean;
	previewAspectRatioValue: number;
};

export function EditorShell(props: Props) {
	const {
		t,
		project,
		appearance,
		timeline,
		ui,
		presets,
		projectController,
		editing,
		exportController,
		exportSettings,
		exportSession,
		exportDimensions,
		settingsPanelProps,
		headerLeftControlsPaddingClass,
		hasCaptionsForSidecar,
		nvidiaCudaExportAvailable,
		experimentalNvidiaCudaExport,
		setExperimentalNvidiaCudaExport,
		effectiveShowCursor,
		previewAspectRatioValue,
	} = props;
	const {
		snapshot,
		history,
		lifecycle,
		autoCaption,
		saveActions,
		openActions,
		hasUnsavedChanges,
	} = projectController;
	const {
		cursor,
		projection,
		audio,
		playback,
		captionCommands,
		zoomCommands,
		clipCommands,
		audioCommands,
		annotationCommands,
		handleSelectAnnotation,
		handleAutoSuggestZoomsConsumed,
	} = editing;
	const { dialogActions, status: exportStatus, exportMessage } = exportController;
	const editorDialogs = (
		<EditorDialogs
			t={t}
			projectSaveDialogOpen={project.projectSaveDialogOpen}
			setProjectSaveDialogOpen={project.setProjectSaveDialogOpen}
			projectSaveDialogDraft={project.projectSaveDialogDraft}
			setProjectSaveDialogDraft={project.setProjectSaveDialogDraft}
			projectSaveDialogInputRef={ui.projectSaveDialogInputRef}
			isSavingProjectDialog={project.isSavingProjectDialog}
			resolveProjectSaveDialog={lifecycle.resolveProjectSaveDialog}
			handleProjectSaveDialogSubmit={saveActions.handleProjectSaveDialogSubmit}
			unsavedChangesDialogOpen={project.unsavedChangesDialogOpen}
			setUnsavedChangesDialogOpen={project.setUnsavedChangesDialogOpen}
			unsavedChangesDialogActionLabel={project.unsavedChangesDialogActionLabel}
			resolveUnsavedChangesDialog={lifecycle.resolveUnsavedChangesDialog}
			projectBrowserOpen={project.projectBrowserOpen}
			setProjectBrowserOpen={project.setProjectBrowserOpen}
			projectLibraryEntries={project.projectLibraryEntries}
			projectBrowserAnchorRef={
				project.error ? ui.projectBrowserFallbackTriggerRef : ui.projectBrowserTriggerRef
			}
			handleImportMediaOrProject={openActions.handleImportMediaOrProject}
			handleOpenProjectFromLibrary={openActions.handleOpenProjectFromLibrary}
			nativeCaptureUnavailableModalOpen={ui.nativeCaptureUnavailableModalOpen}
			setNativeCaptureUnavailableModalOpen={ui.setNativeCaptureUnavailableModalOpen}
		/>
	);
	if (project.loading)
		return (
			<div className="flex h-screen items-center justify-center bg-background">
				<div className="text-foreground">Loading video...</div>
				{editorDialogs}
				<Toaster className="pointer-events-auto" />
			</div>
		);
	if (project.error)
		return (
			<div className="flex h-screen items-center justify-center bg-background">
				<div className="flex flex-col items-center gap-3">
					<div className="text-destructive">{project.error}</div>
					<button
						ref={ui.projectBrowserFallbackTriggerRef}
						type="button"
						onClick={openActions.handleOpenProjectBrowser}
						className="rounded-[5px] bg-neutral-800 px-3 py-1.5 text-sm font-semibold text-white shadow-[0_14px_32px_rgba(0,0,0,0.18)] transition-colors hover:bg-neutral-700 dark:bg-white dark:text-black dark:hover:bg-white/90"
					>
						Open Projects
					</button>
				</div>
				{editorDialogs}
				<Toaster className="pointer-events-auto" />
			</div>
		);

	return (
		<div className="flex h-screen flex-col overflow-hidden bg-editor-bg text-foreground selection:bg-[#2563EB]/30">
			<EditorHeader
				t={t}
				headerLeftControlsPaddingClass={headerLeftControlsPaddingClass}
				project={project}
				projectBrowserTriggerRef={ui.projectBrowserTriggerRef}
				projectNameInputRef={ui.projectNameInputRef}
				projectDisplayName={snapshot.projectDisplayName}
				hasUnsavedChanges={hasUnsavedChanges}
				canUndo={history.canUndo}
				canRedo={history.canRedo}
				handleOpenProjectBrowser={openActions.handleOpenProjectBrowser}
				handleUndo={history.handleUndo}
				handleRedo={history.handleRedo}
				handleProjectNameSubmit={saveActions.handleProjectNameSubmit}
				closeProjectNameEditor={saveActions.closeProjectNameEditor}
				presets={presets}
				exportSettings={exportSettings}
				exportSession={exportSession}
				exportDimensions={exportDimensions}
				exportStatus={exportStatus}
				hasCaptionsForSidecar={hasCaptionsForSidecar}
				nvidiaCudaExportAvailable={nvidiaCudaExportAvailable}
				experimentalNvidiaCudaExport={experimentalNvidiaCudaExport}
				setExperimentalNvidiaCudaExport={setExperimentalNvidiaCudaExport}
				handleOpenExportDropdown={dialogActions.handleOpenExportDropdown}
				handleExportDropdownClose={dialogActions.handleExportDropdownClose}
				handleCancelExport={dialogActions.handleCancelExport}
				handleRetrySaveExport={dialogActions.handleRetrySaveExport}
				handleStartExportFromDropdown={dialogActions.handleStartExportFromDropdown}
				revealExportedFile={dialogActions.revealExportedFile}
				exportMessage={exportMessage}
			/>
			<EditorAnnouncementBanner />
			<div className="relative flex min-h-0 flex-1 flex-col gap-3 p-4">
				<div className="relative z-10 flex min-h-0 flex-1 gap-3">
					<EditorSidebar
						t={t}
						activeSection={ui.activeEffectSection}
						setActiveSection={ui.setActiveEffectSection}
						settingsPanelProps={settingsPanelProps}
					/>
					<EditorPreviewPanel
						t={t}
						videoPath={project.videoPath}
						previewVersion={ui.previewVersion}
						aspectRatio={ui.aspectRatio}
						setAspectRatio={ui.setAspectRatio}
						previewAspectRatioValue={previewAspectRatioValue}
						videoPlaybackRef={ui.videoPlaybackRef}
						timelineRef={ui.timelineRef}
						currentTime={ui.currentTime}
						isPlaying={ui.isPlaying}
						previewVolume={ui.previewVolume}
						setPreviewVolume={ui.setPreviewVolume}
						suspendRendering={exportStatus.shouldSuspendPreviewRendering}
						appearance={appearance}
						timeline={timeline}
						audio={audio}
						projection={projection}
						playback={playback}
						zoomCommands={zoomCommands}
						annotationCommands={annotationCommands}
						effectiveCursorTelemetry={cursor.effectiveCursorTelemetry}
						effectiveShowCursor={effectiveShowCursor}
						isCropped={ui.isCropped}
						handleOpenCropEditor={ui.handleOpenCropEditor}
						handleSaveAutoCaptionEdit={autoCaption.handleSaveAutoCaptionEdit}
						handleSelectAnnotation={handleSelectAnnotation}
						handleAddFreezeFrame={() =>
							clipCommands.handleAddFreezeFrame(
								projection.timelinePlayheadTime * 1000,
							)
						}
						setDuration={ui.setDuration}
						setIsPreviewReady={ui.setIsPreviewReady}
						setCurrentTime={ui.setCurrentTime}
						setIsPlaying={ui.setIsPlaying}
						setFreezeHoldElapsedMs={ui.setFreezeHoldElapsedMs}
						setError={project.setError}
					/>
				</div>
				<EditorTimelinePanel
					timelineRef={ui.timelineRef}
					timeline={timeline}
					projection={projection}
					playback={playback}
					audio={audio}
					zoomCommands={zoomCommands}
					clipCommands={clipCommands}
					audioCommands={audioCommands}
					captionCommands={captionCommands}
					annotationCommands={annotationCommands}
					videoPath={project.videoPath}
					videoSourcePath={project.videoSourcePath}
					cursorTelemetrySourcePath={timeline.cursorTelemetrySourcePath}
					normalizedCursorTelemetry={cursor.normalizedCursorTelemetry}
					autoSuggestZoomsTrigger={ui.autoSuggestZoomsTrigger}
					handleAutoSuggestZoomsConsumed={handleAutoSuggestZoomsConsumed}
					disableSuggestedZooms={!appearance.autoApplyFreshRecordingAutoZooms}
					currentTime={ui.currentTime}
					handleSelectAnnotation={handleSelectAnnotation}
				/>
			</div>
			{editorDialogs}
			<CropEditorDialog
				open={ui.showCropModal}
				t={t}
				videoElement={ui.videoPlaybackRef.current?.video ?? null}
				cropRegion={appearance.cropRegion}
				setCropRegion={appearance.setCropRegion}
				aspectRatio={ui.aspectRatio}
				onCancel={ui.handleCancelCropEditor}
				onDone={ui.handleCloseCropEditor}
			/>
			<Toaster className="pointer-events-auto" />
		</div>
	);
}
