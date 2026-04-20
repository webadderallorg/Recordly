import { useCallback, useEffect } from "react";
import { fromFileUrl, normalizeProjectEditor, resolveVideoUrl } from "../projectPersistence";
import { DEFAULT_MP4_EXPORT_FRAME_RATE } from "../videoEditorUtils";
import type { WebcamOverlaySettings } from "../types";
import type { useEditorPreferences } from "./useEditorPreferences";
import type { useEditorRegions } from "./useEditorRegions";
import type { useEditorCaptions } from "./useEditorCaptions";
import type { useEditorProject } from "./useEditorProject";

type Prefs = ReturnType<typeof useEditorPreferences>;
type Regions = ReturnType<typeof useEditorRegions>;
type Captions = ReturnType<typeof useEditorCaptions>;
type Project = ReturnType<typeof useEditorProject>;

interface LoadedEditorPreferences {
	padding: number;
	borderRadius: number;
	aspectRatio: string;
	exportFormat: string;
	mp4FrameRate: number | null;
	exportQuality: string;
	exportEncodingMode: string;
	exportBackendPreference: string;
	exportPipelineModel: string;
	gifFrameRate: number;
	gifLoop: boolean;
	gifSizePreset: string;
}

interface SmokeExportConfig {
	enabled: boolean;
	inputPath?: string | null;
	webcamInputPath?: string | null;
	webcamShadow?: number;
	webcamSize?: number;
	encodingMode?: string;
}

interface UseEditorInitParams {
	prefs: Prefs;
	regions: Regions;
	captions: Captions;
	project: Project;
	smokeExportConfig: SmokeExportConfig;
	initialEditorPreferences: LoadedEditorPreferences;
	setVideoSourcePath: (v: string | null) => void;
	setVideoPath: (v: string | null) => void;
	setCurrentProjectPath: (v: string | null) => void;
	setIsPlaying: (v: boolean) => void;
	setCurrentTime: (v: number) => void;
	setDuration: (v: number) => void;
	setError: (v: string | null) => void;
	setLoading: (v: boolean) => void;
	videoPlaybackRef: React.RefObject<{ pause: () => void } | null>;
}

export function useOnApplyLoadedProject({
	prefs,
	regions,
	captions,
	setIsPlaying,
	setCurrentTime,
	setDuration,
	setError,
	setVideoSourcePath,
	setVideoPath,
	setCurrentProjectPath,
	videoPlaybackRef,
}: Pick<
	UseEditorInitParams,
	| "prefs"
	| "regions"
	| "captions"
	| "setIsPlaying"
	| "setCurrentTime"
	| "setDuration"
	| "setError"
	| "setVideoSourcePath"
	| "setVideoPath"
	| "setCurrentProjectPath"
	| "videoPlaybackRef"
>) {
	return useCallback(
		async (
			normalizedEditor: ReturnType<typeof normalizeProjectEditor>,
			sourcePath: string,
			projectPath: string | null,
		) => {
			try {
				videoPlaybackRef.current?.pause();
			} catch {
				// no-op
			}
			setIsPlaying(false);
			setCurrentTime(0);
			setDuration(0);
			setError(null);

			setVideoSourcePath(sourcePath);
			setVideoPath(await resolveVideoUrl(sourcePath));
			setCurrentProjectPath(projectPath);
			regions.pendingFreshRecordingAutoZoomPathRef.current = null;

			if (normalizedEditor.webcam.sourcePath) {
				await window.electronAPI.setCurrentRecordingSession?.({
					videoPath: sourcePath,
					webcamPath: normalizedEditor.webcam.sourcePath,
				});
			} else {
				await window.electronAPI.setCurrentVideoPath(sourcePath);
			}

			prefs.applyProjectPreferences(normalizedEditor);
			regions.resetForProject(normalizedEditor);
			captions.resetForProject(normalizedEditor);
			return true;
		},
		[
			prefs.applyProjectPreferences,
			regions.resetForProject,
			captions.resetForProject,
			setIsPlaying,
			setCurrentTime,
			setDuration,
			setError,
			setVideoSourcePath,
			setVideoPath,
			setCurrentProjectPath,
			videoPlaybackRef,
		],
	);
}

export function useLoadInitialData({
	prefs,
	regions,
	project,
	smokeExportConfig,
	initialEditorPreferences,
	setVideoSourcePath,
	setVideoPath,
	setCurrentProjectPath,
	setError,
	setLoading,
}: Pick<
	UseEditorInitParams,
	| "prefs"
	| "regions"
	| "project"
	| "smokeExportConfig"
	| "initialEditorPreferences"
	| "setVideoSourcePath"
	| "setVideoPath"
	| "setCurrentProjectPath"
	| "setError"
	| "setLoading"
>) {
	useEffect(() => {
		async function loadInitialData() {
			try {
				if (smokeExportConfig.enabled) {
					if (!smokeExportConfig.inputPath) {
						setError("Smoke export input path is missing.");
						return;
					}
					const sourcePath = fromFileUrl(smokeExportConfig.inputPath);
					const sourceVideoUrl = await resolveVideoUrl(sourcePath);
					const smokeWebcamSourcePath = smokeExportConfig.webcamInputPath
						? fromFileUrl(smokeExportConfig.webcamInputPath)
						: null;
					setVideoSourcePath(sourcePath);
					setVideoPath(sourceVideoUrl);
					setCurrentProjectPath(null);
					project.setLastSavedSnapshot(null);
					regions.pendingFreshRecordingAutoZoomPathRef.current = null;
					prefs.setWebcam((prev: WebcamOverlaySettings) => ({
						...prev,
						enabled: !!smokeWebcamSourcePath,
						sourcePath: smokeWebcamSourcePath,
						shadow:
							smokeExportConfig.webcamShadow === undefined
								? prev.shadow
								: smokeExportConfig.webcamShadow,
						size:
							smokeExportConfig.webcamSize === undefined
								? prev.size
								: smokeExportConfig.webcamSize,
					}));
					setError(null);
					return;
				}

				const currentProjectResult = await window.electronAPI.loadCurrentProjectFile();
				if (currentProjectResult.success && currentProjectResult.project) {
					const restored = await project.applyLoadedProject(
						currentProjectResult.project,
						currentProjectResult.path ?? null,
					);
					if (restored) {
						prefs.setPadding(initialEditorPreferences.padding);
						prefs.setBorderRadius(initialEditorPreferences.borderRadius);
						prefs.setAspectRatio(initialEditorPreferences.aspectRatio as Parameters<Prefs["setAspectRatio"]>[0]);
						prefs.setExportFormat(initialEditorPreferences.exportFormat as Parameters<Prefs["setExportFormat"]>[0]);
						prefs.setMp4FrameRate(
							(initialEditorPreferences.mp4FrameRate ?? DEFAULT_MP4_EXPORT_FRAME_RATE) as Parameters<Prefs["setMp4FrameRate"]>[0],
						);
						prefs.setExportQuality(initialEditorPreferences.exportQuality as Parameters<Prefs["setExportQuality"]>[0]);
						prefs.setExportEncodingMode(initialEditorPreferences.exportEncodingMode as Parameters<Prefs["setExportEncodingMode"]>[0]);
						prefs.setExportBackendPreference(
							initialEditorPreferences.exportBackendPreference as Parameters<Prefs["setExportBackendPreference"]>[0],
						);
						prefs.setExportPipelineModel(initialEditorPreferences.exportPipelineModel as Parameters<Prefs["setExportPipelineModel"]>[0]);
						prefs.setGifFrameRate(initialEditorPreferences.gifFrameRate as Parameters<Prefs["setGifFrameRate"]>[0]);
						prefs.setGifLoop(initialEditorPreferences.gifLoop);
						prefs.setGifSizePreset(initialEditorPreferences.gifSizePreset as Parameters<Prefs["setGifSizePreset"]>[0]);
						return;
					}
				}

				const sessionResult = await window.electronAPI.getCurrentRecordingSession?.();
				if (sessionResult?.success && sessionResult.session?.videoPath) {
					const sourcePath = fromFileUrl(sessionResult.session.videoPath);
					const sourceVideoUrl = await resolveVideoUrl(sourcePath);
					setVideoSourcePath(sourcePath);
					setVideoPath(sourceVideoUrl);
					setCurrentProjectPath(null);
					project.setLastSavedSnapshot(null);
					regions.pendingFreshRecordingAutoZoomPathRef.current =
						prefs.autoApplyFreshRecordingAutoZooms ? sourceVideoUrl : null;
					prefs.setWebcam((prev: WebcamOverlaySettings) => ({
						...prev,
						enabled: Boolean(sessionResult.session?.webcamPath),
						sourcePath: sessionResult.session?.webcamPath ?? null,
					}));
					return;
				}

				const result = await window.electronAPI.getCurrentVideoPath();
				if (result.success && result.path) {
					const sourcePath = fromFileUrl(result.path);
					const sourceVideoUrl = await resolveVideoUrl(sourcePath);
					setVideoSourcePath(sourcePath);
					setVideoPath(sourceVideoUrl);
					setCurrentProjectPath(null);
					project.setLastSavedSnapshot(null);
					regions.pendingFreshRecordingAutoZoomPathRef.current = null;
					prefs.setWebcam((prev: WebcamOverlaySettings) => ({
						...prev,
						enabled: false,
						sourcePath: null,
					}));
				} else {
					setError("No video to load. Please record or select a video.");
				}
			} catch (err) {
				setError("Error loading video: " + String(err));
			} finally {
				setLoading(false);
			}
		}
		loadInitialData();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);
}
