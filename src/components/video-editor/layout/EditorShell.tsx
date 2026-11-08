import { useI18n as useUiLocale } from "@/contexts/I18nContext";
import { type ComponentProps, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EditorAnnouncementBanner } from "@/components/announcements/EditorAnnouncementBanner";
import { OnboardingController } from "@/components/auth/OnboardingController";
import { RecordlyAccountMenu } from "@/components/auth/RecordlyAccountMenu";
import { RecordlySignInDialog, type SignInReason } from "@/components/auth/RecordlySignInDialog";
import { useRecordlyAuth } from "@/components/auth/useRecordlyAuth";
import { PricingModal } from "@/components/billing/PricingModal";
import { getProjectShareRevision } from "../cloud/projectShareLinks";
import { AccountProfileContext } from "@/components/ui/account-avatar";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/toast";
import { LoadingTransition } from "@/components/ui/loading-transition";
import type { useI18n } from "@/contexts/I18nContext";
import { getStartupView } from "@/lib/startupView";
import { RECORDING_DRAG_TYPE } from "@/types/recordingLibrary";
import { collectLibrarySourceProtection } from "../dashboard/librarySourceProtection";
import { DashboardSettingsContext } from "../dashboard/DashboardSettings";
import { HomeLoadingSkeleton } from "../dashboard/HomeLoadingSkeleton";
import type { useEditorExportController } from "../export/useEditorExportController";
import type { useExportDimensions } from "../export/useExportDimensions";
import type { useExportSession } from "../export/useExportSession";
import type { useExportSettings } from "../export/useExportSettings";
import type { useTimelineEditingController } from "../hooks/useTimelineEditingController";
import { useVideoSourceRecovery } from "../hooks/useVideoSourceRecovery";
import { RecordingLibraryPanel } from "../library/RecordingLibraryPanel";
import { useRecordingLibrary } from "../library/useRecordingLibrary";
import type { useVideoEditorPresets } from "../presets/useVideoEditorPresets";
import type { useEditorProjectController } from "../project/useEditorProjectController";
import { SettingsPanel } from "../SettingsPanel";
import type { useAppearanceState } from "../state/useAppearanceState";
import type { useEditorUiState } from "../state/useEditorUiState";
import type { useProjectState } from "../state/useProjectState";
import type { useTimelineState } from "../state/useTimelineState";
import type { SettingsSection } from "../SettingsSections";
import { AppSettingsDialog } from "./AppSettingsDialog";
import { EditorDialogs } from "./EditorDialogs";
import { EditorHeader } from "./EditorHeader";
import { EditorLoadingSkeleton } from "./EditorLoadingSkeleton";
import { EditorPreviewPanel } from "./EditorPreviewPanel";
import { EditorSidebar } from "./EditorSidebar";
import { EditorTimelinePanel } from "./EditorTimelinePanel";
import { ProjectLoadError } from "./ProjectLoadError";
import { resolveVideoUrl } from "../projectPersistence";
import { isMissingProjectRecording } from "../project/projectLoadError";
import { AutoZoomNudgeContext, useAutoZoomNudge } from "../timeline/useAutoZoomNudge";
import { useFirstRecordingAutoZooms } from "../hooks/useFirstRecordingAutoZooms";

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
	const { t: uiText } = useUiLocale();
	const [onboardingRequest, setOnboardingRequest] = useState(0);
	const showOnboarding = useCallback(() => {
		setAppSettingsOpen(false);
		setOnboardingRequest((value) => value + 1);
	}, []);
	const [signInOpen, setSignInOpen] = useState(false);
	const [appSettingsOpen, setAppSettingsOpen] = useState(false);
	const [appSettingsCategory, setAppSettingsCategory] = useState<SettingsSection>("general");
	const [signInReason, setSignInReason] = useState<SignInReason>("account");
	const [shareRequestNonce, setShareRequestNonce] = useState(0);
	const [dashboardInitialSection, setDashboardInitialSection] = useState<"projects" | "settings">(
		"projects",
	);
	const auth = useRecordlyAuth();
	const resumeShareAfterSignIn = useRef(false);
	const requestSignIn = (reason: SignInReason, resumeShare = false) => {
		if (reason === "share" && auth.user) {
			setShareRequestNonce((value) => value + 1);
			return;
		}
		resumeShareAfterSignIn.current = reason === "share" || resumeShare;
		setSignInReason(reason);
		setSignInOpen(true);
	};
	const handleAuthenticated = useCallback(() => {
		setSignInOpen(false);
		if (resumeShareAfterSignIn.current) {
			resumeShareAfterSignIn.current = false;
			setShareRequestNonce((value) => value + 1);
		}
	}, []);
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
	const shouldNudgeAutoZooms = useAutoZoomNudge(
		projectController.snapshot.currentSourcePath,
		projectController.snapshot.currentPersistedEditorState,
		// A source replacement can retain the previous preview's ready flag for a
		// render. Wait for the new timeline before capturing its unedited baseline.
		!project.loading && ui.isPreviewReady && ui.duration > 0 && ui.clipInitializedRef.current,
	);
	useFirstRecordingAutoZooms({
		sourcePath: project.videoSourcePath,
		ready: !project.loading && ui.isPreviewReady && ui.clipInitializedRef.current,
		isSavedProject: project.openedSavedProject,
		totalMs: ui.duration * 1000,
		clipRegions: timeline.clipRegions,
		zoomRegions: timeline.zoomRegions,
		cursorTelemetry: editing.cursor.normalizedCursorTelemetry,
		cursorTelemetrySourcePath: timeline.cursorTelemetrySourcePath,
		onZoomSuggested: editing.zoomCommands.handleZoomSuggested,
	});
	const openDashboard = (section: "projects" | "settings" = "projects") => {
		setDashboardInitialSection(section);
		void projectController.openActions.handleOpenProjectBrowser();
	};
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
	const [retryingSource, setRetryingSource] = useState(false);
	const [dismissedError, setDismissedError] = useState<{
		message: string;
		source: string | null;
	} | null>(null);
	const errorSource = project.currentProjectPath ?? project.videoSourcePath;
	useEffect(() => {
		if (!project.error) setDismissedError(null);
		else ui.setIsPlaying(false);
	}, [project.error, ui.setIsPlaying]);
	const showProjectError =
		project.error &&
		(dismissedError?.message !== project.error || dismissedError?.source !== errorSource);

	const latestProject = useRef(project);
	latestProject.current = project;
	const retrySource = async () => {
		if (retryingSource || !project.videoSourcePath) return;
		const source = project.videoSourcePath;
		const errorAtRetry = project.error;
		const isCurrent = () =>
			latestProject.current.videoSourcePath === source &&
			latestProject.current.error === errorAtRetry;
		setRetryingSource(true);
		try {
			const url = await resolveVideoUrl(source);
			if (!isCurrent()) return;
			project.setVideoPath(url);
			remountRecoveredVideo();
			project.setError(null);
		} catch (error) {
			if (isCurrent())
				project.setError(error instanceof Error ? error.message : String(error));
		} finally {
			setRetryingSource(false);
		}
	};
	const {
		snapshot,
		history,
		lifecycle,
		autoCaption,
		saveActions,
		openActions,
		hasUnsavedChanges,
	} = projectController;
	const protectedSnapshotRef = useRef(lifecycle.currentProjectSnapshot);
	protectedSnapshotRef.current = lifecycle.currentProjectSnapshot;
	const getProtectedSourcePaths = useCallback(
		() => collectLibrarySourceProtection(protectedSnapshotRef.current),
		[],
	);

	const projectShareRevision = useMemo(
		() => getProjectShareRevision(lifecycle.currentProjectSnapshot),
		[lifecycle.currentProjectSnapshot],
	);
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
	} = editing;
	const { dialogActions, status: exportStatus } = exportController;
	const dashboardSettingsContent = useMemo(
		() => (
			<SettingsPanel
				{...settingsPanelProps}
				accountUser={auth.user}
				onShowOnboarding={showOnboarding}
				hideAppearance
				activeEffectSection="settings"
				selectedAnnotationId={null}
				selectedClipId={null}
				advanced
			/>
		),
		[settingsPanelProps, showOnboarding, auth.user],
	);
	const onboarding = (
		<OnboardingController
			requestNonce={onboardingRequest}
			ready={!auth.loading}
			user={auth.user}
			configured={auth.configured}
			callbackError={auth.callbackError}
		/>
	);
	const editorDialogs = (
		<AccountProfileContext.Provider value={auth.user}>
			<PricingModal
				onSignIn={() => requestSignIn(auth.user ? "reauthenticate" : "account")}
			/>
			<DashboardSettingsContext.Provider value={dashboardSettingsContent}>
				<AppSettingsDialog
					open={appSettingsOpen}
					initialCategory={appSettingsCategory}
					onOpenChange={setAppSettingsOpen}
					onImportFile={openActions.handleImportMediaOrProject}
				/>
				<EditorDialogs
					getProtectedSourcePaths={getProtectedSourcePaths}
					editorTitle={
						project.videoPath && !project.error && !project.loading
							? snapshot.projectDisplayName
							: undefined
					}
					headerLeftControlsPaddingClass={headerLeftControlsPaddingClass}
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
					dashboardInitialSection={dashboardInitialSection}
					setProjectBrowserOpen={project.setProjectBrowserOpen}
					projectLibraryEntries={project.projectLibraryEntries}
					projectLibraryLoading={project.projectLibraryLoading}
					projectLibraryError={project.projectLibraryError}
					onRetryLibraryLoad={projectController.refreshProjectLibrary}
					projectError={project.error}
					projectErrorRecordingSource={project.videoSourcePath ?? undefined}
					projectErrorSource={
						project.currentProjectPath ?? project.videoSourcePath ?? undefined
					}
					onDashboardSignIn={() =>
						requestSignIn(auth.user ? "reauthenticate" : "account")
					}
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
					accountId={auth.user?.id}
					authToken={auth.accessToken}
					handleImportMediaOrProject={openActions.handleImportMediaOrProject}
					handleOpenProjectFromLibrary={openActions.handleOpenProjectFromLibrary}
					nativeCaptureUnavailableModalOpen={ui.nativeCaptureUnavailableModalOpen}
					setNativeCaptureUnavailableModalOpen={ui.setNativeCaptureUnavailableModalOpen}
				/>
			</DashboardSettingsContext.Provider>
		</AccountProfileContext.Provider>
	);
	return (
		<>
			<LoadingTransition
				loading={project.loading && !project.error}
				fallback={
					getStartupView() === "home" ? (
						<HomeLoadingSkeleton />
					) : (
						<EditorLoadingSkeleton />
					)
				}
				className="h-screen overflow-hidden bg-editor-bg"
			>
				<div className="flex h-screen flex-col overflow-hidden bg-editor-bg text-foreground selection:bg-accent/20">
					<EditorHeader
						accountMenu={
							<RecordlyAccountMenu
								user={auth.user}
								compact
								placement="header"
								triggerLabel={uiText("ui.recordlyAccount")}
								onSignIn={() =>
									requestSignIn(auth.user ? "reauthenticate" : "account")
								}
								onSettings={(section = "general") => {
									setAppSettingsCategory(section);
									setAppSettingsOpen(true);
								}}
								className="size-9 rounded-full"
							/>
						}
						clipsOpen={library.open}
						onToggleClips={() => library.setOpen((open) => !open)}
						t={t}
						headerLeftControlsPaddingClass={headerLeftControlsPaddingClass}
						project={project}
						projectRevision={projectShareRevision}
						projectBrowserTriggerRef={ui.projectBrowserTriggerRef}
						projectNameInputRef={ui.projectNameInputRef}
						projectDisplayName={snapshot.projectDisplayName}
						hasUnsavedChanges={hasUnsavedChanges}
						canUndo={history.canUndo}
						canRedo={history.canRedo}
						handleOpenProjectBrowser={() => openDashboard()}
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
						onRequestShareSignIn={() =>
							requestSignIn(auth.user ? "reauthenticate" : "share", true)
						}
						onRequestFeedbackSignIn={() =>
							requestSignIn(auth.user ? "reauthenticate" : "account")
						}
						shareRequestNonce={shareRequestNonce}
						authToken={auth.accessToken}
						accountId={auth.user?.id}
						revealExportedFile={dialogActions.revealExportedFile}
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
								].sort(
									(a, b) => Number(a.dataset.startMs) - Number(b.dataset.startMs),
								);
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
								paths.every(
									(value) => typeof value === "string" && value.length > 0,
								)
							)
								void library.addToTimeline(paths, index);
						}}
					>
						<div className="relative z-10 flex min-h-0 flex-1 pt-3">
							<EditorSidebar
								panelContent={
									library.open ? (
										<RecordingLibraryPanel library={library} />
									) : undefined
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
								onOpenSettings={() => {
									setAppSettingsCategory("general");
									setAppSettingsOpen(true);
								}}
								settingsPanelProps={{
									...settingsPanelProps,
									accountUser: auth.user,
									onShowOnboarding: showOnboarding,
								}}
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
								handleOpenCropEditor={ui.handleOpenCropEditor}
								isCropping={ui.showCropModal}
								onCancelCrop={ui.handleCancelCropEditor}
								onDoneCrop={ui.handleCloseCropEditor}
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
						<AutoZoomNudgeContext.Provider value={shouldNudgeAutoZooms}>
							<EditorTimelinePanel
								getAnnotationPlacement={() =>
									ui.videoPlaybackRef.current?.getAnnotationPlacement?.() ?? null
								}
								zoomPresentationOptions={appearance}
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
								currentTime={ui.currentTime}
								handleSelectAnnotation={handleSelectAnnotation}
							/>
						</AutoZoomNudgeContext.Provider>
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
				</div>
			</LoadingTransition>
			{showProjectError && project.error && (
				<ProjectLoadError
					error={project.error}
					recordingSource={project.videoSourcePath ?? undefined}
					source={errorSource ?? undefined}
					onRetry={project.videoSourcePath ? () => void retrySource() : undefined}
					retrying={retryingSource}
					onLocate={
						isMissingProjectRecording(project.error) && project.currentProjectPath
							? () => {
									if (retryingSource) return;
									setRetryingSource(true);
									void projectController.openActions
										.handleRelinkProjectRecording(project.currentProjectPath!)
										.finally(() => setRetryingSource(false));
								}
							: undefined
					}
					onDismiss={() =>
						project.error &&
						setDismissedError({ message: project.error, source: errorSource })
					}
				/>
			)}

			<RecordlySignInDialog
				open={signInOpen}
				onOpenChange={setSignInOpen}
				reason={signInReason}
				authenticationVersion={auth.callbackVersion}
				user={auth.user}
				configured={auth.configured}
				callbackError={auth.callbackError}
				onAuthenticated={handleAuthenticated}
			/>
			{editorDialogs}
			{onboarding}
			<Toaster className="pointer-events-auto" />
		</>
	);
}
