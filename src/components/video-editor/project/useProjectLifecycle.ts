/* biome-ignore-all lint/correctness/useExhaustiveDependencies: editor domain setters and refs are stable. */
import { normalizeProjectCaptureMetadata } from "../projectPersistence";
import {
	type Dispatch,
	type MutableRefObject,
	type RefObject,
	type SetStateAction,
	useCallback,
	useMemo,
	useRef,
} from "react";
import { toast } from "sonner";
import type { AspectRatio } from "@/utils/aspectRatioUtils";
import type { useExportSettings } from "../export/useExportSettings";
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
import type { VideoPlaybackRef } from "../VideoPlayback";
import { cloneStructured } from "../videoEditorUtils";

type Input = {
	t: (key: string) => string;
	project: ReturnType<typeof useProjectState>;
	appearance: ReturnType<typeof useAppearanceState>;
	timeline: ReturnType<typeof useTimelineState>;
	exportSettings: ReturnType<typeof useExportSettings>;
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
	refs: {
		nextZoomIdRef: MutableRefObject<number>;
		nextClipIdRef: MutableRefObject<number>;
		nextAudioIdRef: MutableRefObject<number>;
		nextAnnotationIdRef: MutableRefObject<number>;
		nextAnnotationZIndexRef: MutableRefObject<number>;
		clipInitializedRef: MutableRefObject<boolean>;
		autoFullTrackClipIdRef: MutableRefObject<string | null>;
		autoFullTrackClipEndMsRef: MutableRefObject<number | null>;
		pendingFreshRecordingAutoZoomPathRef: MutableRefObject<string | null>;
		pendingFreshRecordingAutoSuggestTelemetryCountRef: MutableRefObject<number>;
		autoSuggestedVideoPathRef: MutableRefObject<string | null>;
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

	const applyLoadedProject = useCallback(async (candidate: unknown, path?: string | null) => {
		const current = inputRef.current;
		const { project, appearance, timeline, exportSettings, refs } = current;
		if (!validateProjectData(candidate)) return false;
		const loadedProject = candidate;
		const captureMetadata = normalizeProjectCaptureMetadata(loadedProject.captureMetadata);
		project.setCaptureMetadata(captureMetadata);
		const sourcePath = fromFileUrl(loadedProject.videoPath);
		const persistedEditor = stripPersistedDevMotionBlurSettings(loadedProject.editor ?? {});
		const editor = normalizeProjectEditor({
			...persistedEditor,
			borderRadius:
				loadedProject.version < 2 && typeof persistedEditor.borderRadius === "number"
					? persistedEditor.borderRadius === 0
						? getDefaultBorderRadiusPercent()
						: legacyBorderRadiusPixelsToPercent(persistedEditor.borderRadius)
					: persistedEditor.borderRadius,
		});
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
		refs.pendingFreshRecordingAutoZoomPathRef.current = null;
		if (editor.webcam.sourcePath) {
			await window.electronAPI.setCurrentRecordingSession?.(
				{
					videoPath: sourcePath,
					webcamPath: editor.webcam.sourcePath,
					timeOffsetMs: editor.webcam.timeOffsetMs,
					captureMetadata,
				},
				{ preserveProjectPath: Boolean(path) },
			);
			const session = await window.electronAPI.getCurrentRecordingSession?.();
			current.applySessionPresentation(session?.success ? session.session : null);
		} else {
			await window.electronAPI.setCurrentVideoPath(sourcePath, {
				preserveProjectPath: Boolean(path),
			});
			current.applySessionPresentation(null);
		}
		project.setVideoPath(await resolveVideoUrl(sourcePath));

		appearance.setWallpaper(editor.wallpaper);
		appearance.setShadowIntensity(editor.shadowIntensity);
		appearance.setBackgroundBlur(editor.backgroundBlur);
		appearance.setZoomMotionBlur(editor.zoomMotionBlur);
		appearance.setZoomMotionBlurTuning({ ...editor.zoomMotionBlurTuning });
		appearance.setZoomTemporalMotionBlur(editor.zoomTemporalMotionBlur);
		appearance.setZoomMotionBlurSampleCount(editor.zoomMotionBlurSampleCount);
		appearance.setZoomMotionBlurShutterFraction(editor.zoomMotionBlurShutterFraction);
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
		appearance.setDeviceFrame(editor.deviceFrame);
		appearance.setBorderRadius(editor.borderRadius);
		appearance.setPadding(editor.padding);
		appearance.setCropRegion(editor.cropRegion);
		appearance.setWebcam(editor.webcam);
		timeline.setZoomRegions(editor.zoomRegions);
		timeline.setTrimRegions(editor.trimRegions);
		timeline.setClipRegions(editor.clipRegions);
		refs.clipInitializedRef.current = editor.clipRegions.length > 0;
		refs.autoFullTrackClipIdRef.current = null;
		refs.autoFullTrackClipEndMsRef.current = null;
		timeline.setSpeedRegions(editor.speedRegions);
		timeline.setAnnotationRegions(editor.annotationRegions);
		timeline.setAudioRegions(editor.audioRegions);
		timeline.setSourceAudioTrackSettingsByClip(editor.sourceAudioTrackSettingsByClip ?? {});
		timeline.setDefaultSourceAudioTrackSettings(editor.defaultSourceAudioTrackSettings ?? {});
		timeline.setAutoCaptions(editor.autoCaptions);
		timeline.setAutoCaptionSettings(editor.autoCaptionSettings);
		current.setAspectRatio(editor.aspectRatio);
		exportSettings.setExportEncodingMode(editor.exportEncodingMode);
		exportSettings.setExportBackendPreference(editor.exportBackendPreference);
		exportSettings.setExportPipelineModel(editor.exportPipelineModel);
		exportSettings.setExportQuality(editor.exportQuality);
		exportSettings.setMp4FrameRate(editor.mp4FrameRate);
		exportSettings.setExportFormat(editor.exportFormat);
		exportSettings.setGifFrameRate(editor.gifFrameRate);
		exportSettings.setGifLoop(editor.gifLoop);
		exportSettings.setGifSizePreset(editor.gifSizePreset);
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
			editor.annotationRegions.reduce((max, region) => Math.max(max, region.zIndex), 0) + 1;
		current.resetHistory();
		project.setLastSavedSnapshot(
			cloneStructured(
				createProjectData(
					sourcePath,
					current.buildPersistedEditorState(editor),
					loadedProject.projectId ?? null,
					captureMetadata,
				),
			),
		);
		await current.refreshProjectLibrary();
		return true;
	}, []);

	const currentProjectSnapshot = useMemo(
		() =>
			input.currentSourcePath
				? createProjectData(
						input.currentSourcePath,
						input.currentPersistedEditorState,
						project.lastSavedSnapshot?.projectId ?? null,
						project.captureMetadata,
					)
				: null,
		[
			input.currentSourcePath,
			input.currentPersistedEditorState,
			project.lastSavedSnapshot?.projectId,
			project.captureMetadata,
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
					captureMetadata: project.captureMetadata,
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
		[
			input.currentSourcePath,
			project.currentProjectPath,
			project.captureMetadata,
			appearance.webcam.timeOffsetMs,
		],
	);
	const syncActiveVideoSource = useCallback(
		async (sourcePath: string, webcamPath?: string | null) => {
			if (webcamPath) {
				await window.electronAPI.setCurrentRecordingSession?.(
					{
						videoPath: sourcePath,
						webcamPath,
						timeOffsetMs: appearance.webcam.timeOffsetMs,
						captureMetadata: project.captureMetadata,
					},
					{ preserveProjectPath: Boolean(project.currentProjectPath) },
				);
			} else
				await window.electronAPI.setCurrentVideoPath(sourcePath, {
					preserveProjectPath: Boolean(project.currentProjectPath),
				});
		},
		[appearance.webcam.timeOffsetMs, project.currentProjectPath, project.captureMetadata],
	);
	const resetSourceScopedEditorState = useCallback(() => {
		const current = inputRef.current;
		const { timeline, refs } = current;
		current.project.setCaptureMetadata(undefined);
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
		refs.pendingFreshRecordingAutoSuggestTelemetryCountRef.current = 0;
		refs.autoSuggestedVideoPathRef.current = null;
		current.resetHistory();
	}, []);
	const handleUploadWebcam = useCallback(async () => {
		const result = await window.electronAPI.openVideoFilePicker();
		if (!result.success || !result.path) return;
		appearance.setWebcam((previous) => ({
			...previous,
			enabled: true,
			sourcePath: result.path ?? null,
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
