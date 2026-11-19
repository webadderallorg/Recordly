/* biome-ignore-all lint/correctness/useExhaustiveDependencies: editor domain setters and refs are stable. */
import {
	type Dispatch,
	type MutableRefObject,
	type RefObject,
	type SetStateAction,
	useCallback,
	useMemo,
	useRef,
} from "react";
import { toast } from "@/components/ui/toast";
import type { AspectRatio } from "@/utils/aspectRatioUtils";
import type { UnsavedChangesDecision } from "../layout/EditorDialogs";
import {
	createProjectData,
	deriveNextId,
	fromFileUrl,
	getDefaultBorderRadiusPercent,
	legacyBorderRadiusPixelsToPercent,
	normalizeProjectEditor,
	resolveVideoUrl,
	stripPersistedDevMotionBlurSettings,
	validateProjectData,
} from "../projectPersistence";
import type { useAppearanceState } from "../state/useAppearanceState";
import type { useProjectState } from "../state/useProjectState";
import type { useTimelineState } from "../state/useTimelineState";
import { DEFAULT_WEBCAM_TIME_OFFSET_MS } from "../types";
import { shouldLoopWebcamSource } from "../videoPlayback/webcamSync";
import type { VideoPlaybackRef } from "../VideoPlayback";
import { cloneStructured } from "../videoEditorUtils";
import type { EditorHistoryStack } from "../editorHistory";
import { persistEditorHistory, restoreEditorHistory } from "../editorHistoryPersistence";
import { migrateLegacyTrimOnlyProject } from "./legacyTrimMigration";

type Input = {
	restoringPreferencesRef: MutableRefObject<boolean>;
	t: (key: string) => string;
	project: ReturnType<typeof useProjectState>;
	appearance: ReturnType<typeof useAppearanceState>;
	timeline: ReturnType<typeof useTimelineState>;
	aspectRatio: AspectRatio;
	setAspectRatio: Dispatch<SetStateAction<AspectRatio>>;
	currentSourcePath: string | null;
	currentPersistedEditorState: Parameters<typeof createProjectData>[1];
	videoPlaybackRef: RefObject<VideoPlaybackRef | null>;
	setIsPlaying: Dispatch<SetStateAction<boolean>>;
	setCurrentTime: Dispatch<SetStateAction<number>>;
	setDuration: Dispatch<SetStateAction<number>>;
	applySessionPresentation: (
		session:
			| { hideOverlayCursorByDefault?: boolean; nativeCaptureUnavailable?: boolean }
			| null
			| undefined,
	) => void;
	refreshProjectLibrary: () => Promise<void>;
	buildPersistedEditorState: (
		editor: Parameters<typeof createProjectData>[1],
	) => Parameters<typeof createProjectData>[1];
	resetHistory: () => void;
	restoreHistory: (stack: EditorHistoryStack) => void;
	persistedHistory: ReturnType<typeof persistEditorHistory>;
	refs: {
		nextZoomIdRef: MutableRefObject<number>;
		nextClipIdRef: MutableRefObject<number>;
		nextAudioIdRef: MutableRefObject<number>;
		nextAnnotationIdRef: MutableRefObject<number>;
		nextAnnotationZIndexRef: MutableRefObject<number>;
		clipInitializedRef: MutableRefObject<boolean>;
		autoFullTrackClipIdRef: MutableRefObject<string | null>;
		autoFullTrackClipEndMsRef: MutableRefObject<number | null>;
	};
};

export function useProjectLifecycle(input: Input) {
	const { project, appearance } = input;
	const inputRef = useRef(input);
	inputRef.current = input;
	const pendingSaveDialogRef = useRef<{ resolve(saved: boolean): void } | null>(null);
	const pendingUnsavedDialogRef = useRef<{
		resolve(decision: UnsavedChangesDecision): void;
	} | null>(null);

	const applyLoadedProject = useCallback(
		async (candidate: unknown, path?: string | null, isCurrent: () => boolean = () => true) => {
			const current = inputRef.current;
			const { project, appearance, timeline, refs } = current;
			if (!validateProjectData(candidate)) return false;
			const loadedProject = candidate;
			const sourcePath = fromFileUrl(loadedProject.videoPath);
			const persistedEditor = stripPersistedDevMotionBlurSettings(loadedProject.editor ?? {});
			const normalizedEditor = normalizeProjectEditor({
				...persistedEditor,
				borderRadius:
					loadedProject.version < 2 && typeof persistedEditor.borderRadius === "number"
						? persistedEditor.borderRadius === 0
							? getDefaultBorderRadiusPercent()
							: legacyBorderRadiusPixelsToPercent(persistedEditor.borderRadius)
						: persistedEditor.borderRadius,
			});
			const hasSavedClipSequence = Array.isArray(persistedEditor.clipRegions);
			// Probe before replacing any editor state, so a failed legacy migration is transactional.
			const editor = await migrateLegacyTrimOnlyProject(
				normalizedEditor,
				hasSavedClipSequence,
				async () => {
					const result = await window.electronAPI.probeNativeVideoMetadata(sourcePath);
					if (!result.success || !result.metadata) {
						throw new Error(
							"Could not read the recording duration for this legacy project.",
						);
					}
					return result.metadata.duration * 1000;
				},
			);

			if (!isCurrent()) return false;
			const videoUrl = await resolveVideoUrl(sourcePath);
			if (!isCurrent()) return false;
			if (editor.webcam.sourcePath) {
				const result = await window.electronAPI.setCurrentRecordingSession?.(
					{
						videoPath: sourcePath,
						webcamPath: editor.webcam.sourcePath,
						timeOffsetMs: editor.webcam.timeOffsetMs,
					},
					{ preserveProjectPath: Boolean(path) },
				);
				if (result && !result.success) throw new Error("Could not load project media");
				const session = await window.electronAPI.getCurrentRecordingSession?.();
				current.applySessionPresentation(session?.success ? session.session : null);
			} else {
				const result = await window.electronAPI.setCurrentVideoPath(sourcePath, {
					preserveProjectPath: Boolean(path),
				});
				if (!result.success) throw new Error("Could not load project media");
				current.applySessionPresentation(null);
			}
			if (!isCurrent()) return false;
			// Keep the current edit intact until the replacement source is ready.
			try {
				current.videoPlaybackRef.current?.pause();
			} catch {
				/* preview may be tearing down */
			}
			current.setIsPlaying(false);
			current.setCurrentTime(0);
			current.setDuration(0);
			project.setError(null);
			project.setVideoSourcePath(sourcePath);
			project.setCurrentProjectPath(path ?? null);
			project.setVideoPath(videoUrl);
			project.setOpenedSavedProject(true);

			// Restoring a project's look must not replace defaults for future recordings.
			current.restoringPreferencesRef.current = true;
			appearance.setWallpaper(editor.wallpaper);
			appearance.setShadowIntensity(editor.shadowIntensity);
			appearance.setBackgroundBlur(editor.backgroundBlur);
			appearance.setZoomMotionBlur(editor.zoomMotionBlur);
			appearance.setZoomMotionBlurTuning({ ...editor.zoomMotionBlurTuning });
			appearance.setConnectZooms(editor.connectZooms);
			appearance.setZoomInDurationMs(editor.zoomInDurationMs);
			appearance.setZoomInOverlapMs(editor.zoomInOverlapMs);
			appearance.setZoomOutDurationMs(editor.zoomOutDurationMs);
			appearance.setConnectedZoomGapMs(editor.connectedZoomGapMs);
			appearance.setConnectedZoomDurationMs(editor.connectedZoomDurationMs);
			appearance.setZoomInEasing(editor.zoomInEasing);
			appearance.setZoomOutEasing(editor.zoomOutEasing);
			appearance.setConnectedZoomEasing(editor.connectedZoomEasing);
			appearance.setShowCursor(editor.showCursor);
			appearance.setLoopCursor(editor.loopCursor);
			appearance.setCursorStyle(editor.cursorStyle);
			appearance.setCursorSize(editor.cursorSize);
			appearance.setCursorSmoothing(editor.cursorSmoothing);
			appearance.setCursorSpringStiffnessMultiplier(editor.cursorSpringStiffnessMultiplier);
			appearance.setCursorSpringDampingMultiplier(editor.cursorSpringDampingMultiplier);
			appearance.setCursorSpringMassMultiplier(editor.cursorSpringMassMultiplier);
			appearance.setCameraSpringStiffnessMultiplier(editor.cameraSpringStiffnessMultiplier);
			appearance.setCameraSpringDampingMultiplier(editor.cameraSpringDampingMultiplier);
			appearance.setCameraSpringMassMultiplier(editor.cameraSpringMassMultiplier);
			appearance.setCursorClickEffect(editor.cursorClickEffect);
			appearance.setCursorClickEffectColor(editor.cursorClickEffectColor);
			appearance.setCursorClickEffectScale(editor.cursorClickEffectScale);
			appearance.setCursorClickEffectOpacity(editor.cursorClickEffectOpacity);
			appearance.setCursorClickEffectDurationMs(editor.cursorClickEffectDurationMs);
			appearance.setZoomSmoothness(editor.zoomSmoothness);
			appearance.setZoomClassicMode(editor.zoomClassicMode);
			appearance.setCursorMotionBlur(editor.cursorMotionBlur);
			appearance.setCursorClickBounce(editor.cursorClickBounce);
			appearance.setCursorClickBounceDuration(editor.cursorClickBounceDuration);
			appearance.setCursorSway(editor.cursorSway);
			appearance.setCursorIdleHide(editor.cursorIdleHide);
			appearance.setBorderRadius(editor.borderRadius);
			appearance.setPadding(editor.padding);
			appearance.setCropRegion(editor.cropRegion);
			const webcam = {
				...editor.webcam,
				loop:
					editor.webcam.loop ??
					(!editor.webcam.visibleRanges &&
						shouldLoopWebcamSource(
							sourcePath,
							editor.webcam.sourcePath ? fromFileUrl(editor.webcam.sourcePath) : null,
							editor.webcam.timeOffsetMs,
						)),
			};
			appearance.setWebcam(webcam);
			timeline.setZoomRegions(editor.zoomRegions);
			timeline.setTrimRegions(editor.trimRegions);
			timeline.setClipRegions(editor.clipRegions);
			// An explicit empty clip list means the user deleted all footage, not a legacy project.
			refs.clipInitializedRef.current = hasSavedClipSequence || editor !== normalizedEditor;
			refs.autoFullTrackClipIdRef.current = null;
			refs.autoFullTrackClipEndMsRef.current = null;
			timeline.setSpeedRegions(editor.speedRegions);
			timeline.setAnnotationRegions(editor.annotationRegions);
			timeline.setAudioRegions(editor.audioRegions);
			timeline.setSourceAudioTrackSettingsByClip(editor.sourceAudioTrackSettingsByClip ?? {});
			timeline.setDefaultSourceAudioTrackSettings(
				editor.defaultSourceAudioTrackSettings ?? {},
			);
			timeline.setAutoCaptions(editor.autoCaptions);
			timeline.setAutoCaptionSettings(editor.autoCaptionSettings);
			current.setAspectRatio(editor.aspectRatio);
			timeline.setSelectedZoomId(null);
			timeline.setSelectedClipId(null);
			timeline.setSelectedAnnotationId(null);
			timeline.setSelectedAudioId(null);
			refs.nextZoomIdRef.current = deriveNextId(
				"zoom",
				editor.zoomRegions.map(({ id }) => id),
			);
			refs.nextClipIdRef.current = deriveNextId(
				"clip",
				editor.clipRegions.map(({ id }) => id),
			);
			refs.nextAudioIdRef.current = deriveNextId(
				"audio",
				editor.audioRegions.map(({ id }) => id),
			);
			refs.nextAnnotationIdRef.current = deriveNextId(
				"annotation",
				editor.annotationRegions.map(({ id }) => id),
			);
			refs.nextAnnotationZIndexRef.current =
				editor.annotationRegions.reduce((max, region) => Math.max(max, region.zIndex), 0) +
				1;
			const appliedEditor = { ...editor, webcam };
			const restoredHistory = restoreEditorHistory(loadedProject.history, appliedEditor);
			current.restoreHistory(restoredHistory);
			project.setLastSavedSnapshot(
				cloneStructured(
					createProjectData(
						sourcePath,
						current.buildPersistedEditorState(appliedEditor),
						loadedProject.projectId ?? null,
						persistEditorHistory(restoredHistory),
					),
				),
			);
			await current.refreshProjectLibrary();
			return true;
		},
		[],
	);

	const currentProjectSnapshot = useMemo(
		() =>
			input.currentSourcePath
				? createProjectData(
						input.currentSourcePath,
						input.currentPersistedEditorState,
						project.lastSavedSnapshot?.projectId ?? null,
						input.persistedHistory,
					)
				: null,
		[
			input.currentSourcePath,
			input.currentPersistedEditorState,
			project.lastSavedSnapshot?.projectId,
			input.persistedHistory,
		],
	);
	const resolveProjectSaveDialog = useCallback(
		(saved: boolean) => {
			const pending = pendingSaveDialogRef.current;
			pendingSaveDialogRef.current = null;
			project.setProjectSaveDialogOpen(false);
			project.setIsSavingProjectDialog(false);
			pending?.resolve(saved);
		},
		[project.setProjectSaveDialogOpen, project.setIsSavingProjectDialog],
	);
	const openProjectSaveDialog = useCallback(
		(initialName: string) => {
			pendingSaveDialogRef.current?.resolve(false);
			project.setProjectSaveDialogDraft(initialName);
			project.setProjectSaveDialogOpen(true);
			project.setIsSavingProjectDialog(false);
			return new Promise<boolean>((resolve) => {
				pendingSaveDialogRef.current = { resolve };
			});
		},
		[
			project.setProjectSaveDialogDraft,
			project.setProjectSaveDialogOpen,
			project.setIsSavingProjectDialog,
		],
	);
	const resolveUnsavedChangesDialog = useCallback(
		(decision: UnsavedChangesDecision) => {
			const pending = pendingUnsavedDialogRef.current;
			pendingUnsavedDialogRef.current = null;
			project.setUnsavedChangesDialogOpen(false);
			pending?.resolve(decision);
		},
		[project.setUnsavedChangesDialogOpen],
	);
	const openUnsavedChangesDialog = useCallback(
		(actionLabel: string) => {
			pendingUnsavedDialogRef.current?.resolve("cancel");
			project.setUnsavedChangesDialogActionLabel(actionLabel);
			project.setUnsavedChangesDialogOpen(true);
			return new Promise<UnsavedChangesDecision>((resolve) => {
				pendingUnsavedDialogRef.current = { resolve };
			});
		},
		[project.setUnsavedChangesDialogActionLabel, project.setUnsavedChangesDialogOpen],
	);

	const syncRecordingSessionWebcam = useCallback(
		async (webcamPath: string | null, offset?: number) => {
			if (!input.currentSourcePath || !window.electronAPI.setCurrentRecordingSession) return;
			await window.electronAPI.setCurrentRecordingSession(
				{
					videoPath: input.currentSourcePath,
					webcamPath,
					timeOffsetMs:
						webcamPath && Number.isFinite(offset)
							? (offset ?? DEFAULT_WEBCAM_TIME_OFFSET_MS)
							: webcamPath
								? appearance.webcam.timeOffsetMs
								: DEFAULT_WEBCAM_TIME_OFFSET_MS,
				},
				{ preserveProjectPath: Boolean(project.currentProjectPath) },
			);
		},
		[input.currentSourcePath, project.currentProjectPath, appearance.webcam.timeOffsetMs],
	);
	const syncActiveVideoSource = useCallback(
		async (sourcePath: string, webcamPath?: string | null) => {
			if (webcamPath) {
				await window.electronAPI.setCurrentRecordingSession?.(
					{
						videoPath: sourcePath,
						webcamPath,
						timeOffsetMs: appearance.webcam.timeOffsetMs,
					},
					{ preserveProjectPath: Boolean(project.currentProjectPath) },
				);
			} else
				await window.electronAPI.setCurrentVideoPath(sourcePath, {
					preserveProjectPath: Boolean(project.currentProjectPath),
				});
		},
		[appearance.webcam.timeOffsetMs, project.currentProjectPath],
	);
	const resetSourceScopedEditorState = useCallback(() => {
		const current = inputRef.current;
		const { timeline, refs } = current;
		current.project.setOpenedSavedProject(false);
		timeline.setZoomRegions([]);
		timeline.setTrimRegions([]);
		timeline.setClipRegions([]);
		refs.clipInitializedRef.current = false;
		refs.autoFullTrackClipIdRef.current = null;
		refs.autoFullTrackClipEndMsRef.current = null;
		timeline.setSpeedRegions([]);
		timeline.setAnnotationRegions([]);
		timeline.setAudioRegions([]);
		timeline.setCursorTelemetry([]);
		timeline.setCursorTelemetrySourcePath(null);
		timeline.setSourceAudioTrackSettingsByClip({});
		timeline.setDefaultSourceAudioTrackSettings({});
		timeline.setHasClipSourceAudio(false);
		timeline.setAutoCaptions([]);
		timeline.setAutoCaptionSettings((previous) => ({ ...previous, enabled: false }));
		timeline.setSelectedZoomId(null);
		timeline.setSelectedClipId(null);
		timeline.setSelectedAnnotationId(null);
		timeline.setSelectedAudioId(null);
		refs.nextZoomIdRef.current = 1;
		refs.nextClipIdRef.current = 1;
		refs.nextAudioIdRef.current = 1;
		refs.nextAnnotationIdRef.current = 1;
		refs.nextAnnotationZIndexRef.current = 1;
		current.resetHistory();
	}, []);
	const handleUploadWebcam = useCallback(async () => {
		const result = await window.electronAPI.openVideoFilePicker();
		if (!result.success || !result.path) return;
		appearance.setWebcam((previous) => ({
			...previous,
			enabled: true,
			sourcePath: result.path ?? null,
			loop: true,
			visibleRanges: undefined,
			timeOffsetMs: DEFAULT_WEBCAM_TIME_OFFSET_MS,
		}));
		await syncRecordingSessionWebcam(result.path, DEFAULT_WEBCAM_TIME_OFFSET_MS);
		toast.success(input.t("settings.effects.webcamFootageAdded"));
	}, [appearance.setWebcam, syncRecordingSessionWebcam, input.t]);
	const handleClearWebcam = useCallback(async () => {
		appearance.setWebcam((previous) => ({
			...previous,
			enabled: false,
			sourcePath: null,
			loop: false,
			visibleRanges: undefined,
			timeOffsetMs: DEFAULT_WEBCAM_TIME_OFFSET_MS,
		}));
		await syncRecordingSessionWebcam(null);
		toast.success(input.t("settings.effects.webcamFootageRemoved"));
	}, [appearance.setWebcam, syncRecordingSessionWebcam, input.t]);

	return {
		applyLoadedProject,
		currentProjectSnapshot,
		resolveProjectSaveDialog,
		openProjectSaveDialog,
		resolveUnsavedChangesDialog,
		openUnsavedChangesDialog,
		syncActiveVideoSource,
		resetSourceScopedEditorState,
		handleUploadWebcam,
		handleClearWebcam,
	};
}
