import { AccountProfileContext } from "@/components/ui/account-avatar";
import { DashboardSettingsContext } from "../dashboard/DashboardSettings";
import { RecordlySignInDialog, type SignInReason } from "@/components/auth/RecordlySignInDialog";
import { useRecordlyAuth } from "@/components/auth/useRecordlyAuth";
import { useVideoSourceRecovery } from "../hooks/useVideoSourceRecovery";
import { useRecordingLibrary } from "../library/useRecordingLibrary";
import { RecordingLibraryPanel } from "../library/RecordingLibraryPanel";
import { RECORDING_DRAG_TYPE } from "@/types/recordingLibrary";
import { Button } from "@/components/ui/button";
import { useCallback, useMemo, useEffect, useRef, useState, type ComponentProps } from "react";
import { EditorAnnouncementBanner } from "@/components/announcements/EditorAnnouncementBanner";
import { Toaster } from "@/components/ui/toast";
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
import { isAutoMotionAllowed } from "../videoPlayback/motionAnimation";
import { CropEditorDialog } from "./CropEditorDialog";
import { EditorDialogs } from "./EditorDialogs";
import { EditorLoadingSkeleton } from "./EditorLoadingSkeleton";
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
	const [signInOpen, setSignInOpen] = useState(false);
	const [signInReason, setSignInReason] = useState<SignInReason>("account");
	const [shareRequestNonce, setShareRequestNonce] = useState(0);
	const auth = useRecordlyAuth();
	const requestSignIn = (reason: SignInReason) => {
		if (reason === "share" && auth.user) {
			setShareRequestNonce((value) => value + 1);
			return;
		}
		setSignInReason(reason);
		setSignInOpen(true);
	};
	const handleAuthenticated = useCallback(() => {
		setSignInOpen(false);
		if (signInReason === "share") setShareRequestNonce((value) => value + 1);
	}, [signInReason]);
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
	const library = useRecordingLibrary(project, timeline, ui, appearance);
	// biome-ignore lint/correctness/useExhaustiveDependencies: Changing the active inspector closes the Videos view.
	useEffect(() => {
		library.setOpen(false);
	}, [ui.activeEffectSection, library.setOpen]);
	const timelinePanelRef = useRef<HTMLDivElement>(null);
	const wasImporting = useRef(false);
	useEffect(() => {
		if (wasImporting.current && !library.importing) timelinePanelRef.current?.focus();
		wasImporting.current = library.importing;
	}, [library.importing]);
	const { setIsPreviewReady, setPreviewVersion } = ui;
	const remountRecoveredVideo = useCallback(() => {
		setIsPreviewReady(false);
		setPreviewVersion((version) => version + 1);
	}, [setIsPreviewReady, setPreviewVersion]);
	const handlePreviewError = useVideoSourceRecovery(project, remountRecoveredVideo);
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
	const dashboardSettingsContent = useMemo(
		() => (
			<SettingsPanel
				{...settingsPanelProps}
				activeEffectSection="settings"
				selectedAnnotationId={null}
				selectedClipId={null}
				advanced
			/>
		),
		[settingsPanelProps],
	);
	const editorDialogs = (
		<AccountProfileContext.Provider value={auth.user}>
			<DashboardSettingsContext.Provider value={dashboardSettingsContent}>
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
					projectError={project.error}
					onDashboardSignIn={() => requestSignIn("account")}
					onDeleteProjects={openActions.handleDeleteProjects}
					onRenameProject={openActions.handleRenameLibraryProject}
					onShareProject={async (path) => {
						if (
							path !== project.currentProjectPath &&
							!(await openActions.handleOpenProjectFromLibrary(path))
						)
							return;
						project.setProjectBrowserOpen(false);
						if (!auth.user) requestSignIn("share");
						else setShareRequestNonce((value) => value + 1);
					}}
					accountLabel={auth.user?.email}
					handleImportMediaOrProject={openActions.handleImportMediaOrProject}
					handleOpenProjectFromLibrary={openActions.handleOpenProjectFromLibrary}
					nativeCaptureUnavailableModalOpen={ui.nativeCaptureUnavailableModalOpen}
					setNativeCaptureUnavailableModalOpen={ui.setNativeCaptureUnavailableModalOpen}
				/>
			</DashboardSettingsContext.Provider>
		</AccountProfileContext.Provider>
	);
	if (project.loading && !project.error)
		return (
			<>
				<EditorLoadingSkeleton />
				<RecordlySignInDialog
					open={signInOpen}
					onOpenChange={setSignInOpen}
					reason={signInReason}
					user={auth.user}
					configured={auth.configured}
					callbackError={auth.callbackError}
					onAuthenticated={handleAuthenticated}
				/>
				{editorDialogs}
				<Toaster className="pointer-events-auto" />
			</>
		);
	if (project.error)
		return (
			<div className="flex h-screen items-center justify-center bg-background">
				<div className="flex flex-col items-center gap-3">
					<div role="alert" className="max-w-xl break-words text-center text-destructive">
						{project.error}
					</div>
					<Button
						variant="ghost"
						ref={ui.projectBrowserFallbackTriggerRef}
						type="button"
						onClick={openActions.handleOpenProjectBrowser}
						className="px-3 py-1.5 text-sm"
					>
						Open Projects
					</Button>
				</div>
				<RecordlySignInDialog
					open={signInOpen}
					onOpenChange={setSignInOpen}
					reason={signInReason}
					user={auth.user}
					configured={auth.configured}
					callbackError={auth.callbackError}
					onAuthenticated={handleAuthenticated}
				/>
				{editorDialogs}
				<Toaster className="pointer-events-auto" />
			</div>
		);

	return (
		<div className="flex h-screen flex-col overflow-hidden bg-editor-bg text-foreground selection:bg-accent/20">
			<EditorHeader
				clipsOpen={library.open}
				onToggleClips={() => library.setOpen((open) => !open)}
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
				prepareExportForShare={dialogActions.prepareExportForShare}
				onRequestShareSignIn={() => requestSignIn("share")}
				shareRequestNonce={shareRequestNonce}
				authToken={auth.accessToken}
				revealExportedFile={dialogActions.revealExportedFile}
				exportMessage={exportMessage}
			/>
			<EditorAnnouncementBanner />
			<div
				className="relative flex min-h-0 flex-1 flex-col"
				onPointerDownCapture={(event) => {
					if ((event.target as HTMLElement).closest("[data-timeline-item]"))
						library.setOpen(false);
				}}
				onDragOver={(event) => {
					if (event.dataTransfer.types.includes(RECORDING_DRAG_TYPE)) {
						event.preventDefault();
						event.dataTransfer.dropEffect = "copy";
					}
				}}
				onDrop={(event) => {
					const path = event.dataTransfer.getData(RECORDING_DRAG_TYPE);
					if (!path) return;
					event.preventDefault();
					event.stopPropagation();
					const timelinePanel = (event.target as HTMLElement).closest(
						"[data-timeline-panel]",
					);
					let index: number | undefined;
					if (timelinePanel) {
						const clips = [
							...timelinePanel.querySelectorAll<HTMLElement>(
								'[data-timeline-item][data-variant="clip"]',
							),
						].sort((a, b) => Number(a.dataset.startMs) - Number(b.dataset.startMs));
						index = clips.findIndex((clip) => {
							const rect = clip.getBoundingClientRect();
							return event.clientX < rect.left + rect.width / 2;
						});
						if (index < 0) index = clips.length;
					}
					let paths: unknown;
					try {
						paths = JSON.parse(path);
					} catch {
						paths = [path];
					}
					if (
						Array.isArray(paths) &&
						paths.every((value) => typeof value === "string" && value.length > 0)
					)
						void library.addToTimeline(paths, index);
				}}
			>
				<div className="relative z-10 flex min-h-0 flex-1 pt-3">
					<EditorSidebar
						accountUser={auth.user}
						onAccountClick={() => requestSignIn("account")}
						panelContent={
							library.open ? <RecordingLibraryPanel library={library} /> : undefined
						}
						t={t}
						activeSection={ui.activeEffectSection}
						setActiveSection={(section) => {
							library.setOpen(false);
							timeline.setSelectedAnnotationId(null);
							timeline.setSelectedZoomId(null);
							timeline.setSelectedClipId(null);
							timeline.setSelectedAudioId(null);
							timeline.setSelectedCaptionId(null);
							ui.setActiveEffectSection(section);
						}}
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
						setDuration={ui.setDuration}
						isPreviewReady={ui.isPreviewReady}
						setIsPreviewReady={ui.setIsPreviewReady}
						setCurrentTime={ui.setCurrentTime}
						setIsPlaying={ui.setIsPlaying}
						setError={handlePreviewError}
					/>
				</div>
				<EditorTimelinePanel
					panelRef={timelinePanelRef}
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
					disableSuggestedZooms={!isAutoMotionAllowed(appearance.motionAnimationEnabled, appearance.autoApplyFreshRecordingAutoZooms)}
					currentTime={ui.currentTime}
					handleSelectAnnotation={handleSelectAnnotation}
				/>
			</div>
			{library.importing && (
				<div
					className="fixed inset-0 z-[100] flex items-center justify-center bg-background/80"
					role="status"
					aria-live="polite"
				>
					<div className="rounded-xl border border-separator bg-background p-6 text-center">
						<p className="font-medium">{t("editor.cloud.addingVideo")}</p>
						<p className="mt-2 text-sm text-muted-foreground">
							{t("editor.cloud.preparingFootage")}
						</p>
						<Button
							className="mt-4"
							variant="ghost"
							size="sm"
							disabled={library.cancelling}
							onClick={() => void library.cancelImport()}
						>
							{t("common.actions.cancel", "Cancel")}
						</Button>
					</div>
				</div>
			)}
			<RecordlySignInDialog
				open={signInOpen}
				onOpenChange={setSignInOpen}
				reason={signInReason}
				user={auth.user}
				configured={auth.configured}
				callbackError={auth.callbackError}
				onAuthenticated={handleAuthenticated}
			/>
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
