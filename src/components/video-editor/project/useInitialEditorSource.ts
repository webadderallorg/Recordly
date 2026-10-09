/* biome-ignore-all lint/correctness/useExhaustiveDependencies: editor state setters are stable and initial source loading intentionally runs once per launch configuration. */
import {
	type Dispatch,
	type MutableRefObject,
	type RefObject,
	type SetStateAction,
	useCallback,
	useEffect,
	useRef,
} from "react";
import { fromFileUrl, resolveVideoUrl } from "../projectPersistence";
import type { getDevOpenRecordingConfig, getSmokeExportConfig } from "../smokeExportConfig";
import type { useAppearanceState } from "../state/useAppearanceState";
import type { useProjectState } from "../state/useProjectState";
import type { useTimelineState } from "../state/useTimelineState";
import { DEFAULT_WEBCAM_TIME_OFFSET_MS } from "../types";
import type { VideoPlaybackRef } from "../VideoPlayback";

type SessionPresentation = {
	hideOverlayCursorByDefault?: boolean;
	nativeCaptureUnavailable?: boolean;
};

type RecordingSession = SessionPresentation & {
	videoPath: string;
	webcamPath?: string | null;
	timeOffsetMs?: number;
};

type Input = {
	project: ReturnType<typeof useProjectState>;
	appearance: ReturnType<typeof useAppearanceState>;
	timeline: ReturnType<typeof useTimelineState>;
	smokeConfig: ReturnType<typeof getSmokeExportConfig>;
	devConfig: ReturnType<typeof getDevOpenRecordingConfig>;
	videoSourcePath: string | null;
	videoPlaybackRef: RefObject<VideoPlaybackRef | null>;
	setIsPlaying: Dispatch<SetStateAction<boolean>>;
	setCurrentTime: Dispatch<SetStateAction<number>>;
	setDuration: Dispatch<SetStateAction<number>>;
	remountPreview: () => void;
	pendingFreshRecordingAutoZoomPathRef: MutableRefObject<string | null>;
	pendingFreshRecordingAgentEditsPathRef: MutableRefObject<string | null>;
	applyLoadedProject: (candidate: unknown, path?: string | null) => Promise<boolean>;
	resetSourceScopedEditorState: () => void;
	applySessionPresentation: (session: SessionPresentation | null | undefined) => void;
};

export function useInitialEditorSource(input: Input) {
	const {
		project,
		appearance,
		timeline,
		smokeConfig,
		devConfig,
		pendingFreshRecordingAutoZoomPathRef,
		pendingFreshRecordingAgentEditsPathRef,
		applyLoadedProject,
		resetSourceScopedEditorState,
		applySessionPresentation,
	} = input;
	const latestRef = useRef(input);
	latestRef.current = input;
	const initialLoadStartedRef = useRef(false);
	const initialLoadRef = useRef<Promise<void> | null>(null);

	const adoptRecordingSession = useCallback(async (session: RecordingSession) => {
		const current = latestRef.current;
		const sourcePath = fromFileUrl(session.videoPath);
		const webcamPath = session.webcamPath ? fromFileUrl(session.webcamPath) : null;
		const sourceUrl = await resolveVideoUrl(sourcePath);
		try {
			current.videoPlaybackRef.current?.pause();
		} catch {
			/* the preview may already be tearing down */
		}
		current.setIsPlaying(false);
		current.setCurrentTime(0);
		current.setDuration(0);
		current.project.setVideoSourcePath(sourcePath);
		current.project.setVideoPath(sourceUrl);
		current.project.setCurrentProjectPath(null);
		current.project.setLastSavedSnapshot(null);
		current.project.setError(null);
		current.project.setProjectBrowserOpen(false);
		current.resetSourceScopedEditorState();
		current.pendingFreshRecordingAutoZoomPathRef.current = current.appearance
			.autoApplyFreshRecordingAutoZooms
			? sourceUrl
			: null;
		current.pendingFreshRecordingAgentEditsPathRef.current = sourceUrl;
		current.applySessionPresentation(session);
		current.appearance.setWebcam((previous) => ({
			...previous,
			visibleRanges: undefined,
			enabled: Boolean(webcamPath),
			sourcePath: webcamPath,
			timeOffsetMs: webcamPath
				? (session.timeOffsetMs ?? DEFAULT_WEBCAM_TIME_OFFSET_MS)
				: DEFAULT_WEBCAM_TIME_OFFSET_MS,
		}));
		current.remountPreview();
	}, []);

	useEffect(() => {
		// This effect owns launch-time hydration. Several of the callbacks it uses
		// intentionally close over live editor state, so their identities may change
		// after hydration updates that state. Never interpret that as a request to
		// reload the source and reset the editor again.
		if (initialLoadStartedRef.current) return;
		initialLoadStartedRef.current = true;

		async function loadInitialData() {
			try {
				if (smokeConfig.enabled && smokeConfig.projectPath) {
					const result = await window.electronAPI.openProjectFileAtPath(
						smokeConfig.projectPath,
					);
					if (!result.success || !result.project) {
						project.setError(
							`Smoke export failed to load project ${smokeConfig.projectPath}: ${result.error || result.message || "unknown error"}`,
						);
						return;
					}
					if (
						!(await applyLoadedProject(
							result.project,
							result.path ?? smokeConfig.projectPath,
						))
					) {
						project.setError(
							`Smoke export could not apply project ${smokeConfig.projectPath}`,
						);
						return;
					}
					project.setError(null);
					return;
				}

				if (!smokeConfig.enabled && devConfig.inputPath) {
					const sourcePath = fromFileUrl(devConfig.inputPath);
					const webcamPath = devConfig.webcamInputPath
						? fromFileUrl(devConfig.webcamInputPath)
						: null;
					if (webcamPath) {
						await window.electronAPI.setCurrentRecordingSession?.({
							videoPath: sourcePath,
							webcamPath,
							timeOffsetMs: DEFAULT_WEBCAM_TIME_OFFSET_MS,
						});
					} else {
						await window.electronAPI.setCurrentVideoPath(sourcePath);
					}
					const sourceUrl = await resolveVideoUrl(sourcePath);
					project.setVideoSourcePath(sourcePath);
					project.setVideoPath(sourceUrl);
					project.setCurrentProjectPath(null);
					project.setLastSavedSnapshot(null);
					resetSourceScopedEditorState();
					pendingFreshRecordingAutoZoomPathRef.current =
						appearance.autoApplyFreshRecordingAutoZooms ? sourceUrl : null;
					pendingFreshRecordingAgentEditsPathRef.current = sourceUrl;
					appearance.setWebcam((previous) => ({
						...previous,
						visibleRanges: undefined,
						enabled: Boolean(webcamPath),
						sourcePath: webcamPath,
						timeOffsetMs: DEFAULT_WEBCAM_TIME_OFFSET_MS,
					}));
					project.setError(null);
					return;
				}

				if (smokeConfig.enabled) {
					if (!smokeConfig.inputPath) {
						project.setError("Smoke export input path is missing.");
						return;
					}
					const sourcePath = fromFileUrl(smokeConfig.inputPath);
					const webcamPath = smokeConfig.webcamInputPath
						? fromFileUrl(smokeConfig.webcamInputPath)
						: null;
					if (webcamPath) {
						await window.electronAPI.setCurrentRecordingSession?.({
							videoPath: sourcePath,
							webcamPath,
							timeOffsetMs: DEFAULT_WEBCAM_TIME_OFFSET_MS,
						});
					} else {
						await window.electronAPI.setCurrentVideoPath(sourcePath);
					}
					const sourceUrl = await resolveVideoUrl(sourcePath);
					project.setVideoSourcePath(sourcePath);
					project.setVideoPath(sourceUrl);
					project.setCurrentProjectPath(null);
					project.setLastSavedSnapshot(null);
					resetSourceScopedEditorState();
					pendingFreshRecordingAutoZoomPathRef.current = null;
					appearance.setWebcam((previous) => ({
						...previous,
						visibleRanges: undefined,
						enabled: Boolean(webcamPath),
						sourcePath: webcamPath,
						timeOffsetMs: DEFAULT_WEBCAM_TIME_OFFSET_MS,
						shadow: smokeConfig.webcamShadow ?? previous.shadow,
						size: smokeConfig.webcamSize ?? previous.size,
						width: smokeConfig.webcamSize ?? previous.width ?? previous.size,
						height: smokeConfig.webcamSize ?? previous.height ?? previous.size,
					}));
					project.setError(null);
					return;
				}

				const currentProject = await window.electronAPI.loadCurrentProjectFile();
				if (
					currentProject.success &&
					currentProject.project &&
					(await applyLoadedProject(currentProject.project, currentProject.path ?? null))
				) {
					return;
				}

				const sessionResult = await window.electronAPI.getCurrentRecordingSession?.();
				if (sessionResult?.success && sessionResult.session?.videoPath) {
					await adoptRecordingSession(sessionResult.session);
					return;
				}

				const currentVideo = await window.electronAPI.getCurrentVideoPath();
				if (!currentVideo.success || !currentVideo.path) {
					// An empty session is the normal dashboard launch, not a load failure.
					project.setProjectBrowserOpen(true);
					return;
				}
				const sourcePath = fromFileUrl(currentVideo.path);
				project.setVideoSourcePath(sourcePath);
				project.setVideoPath(await resolveVideoUrl(sourcePath));
				project.setCurrentProjectPath(null);
				project.setLastSavedSnapshot(null);
				resetSourceScopedEditorState();
				pendingFreshRecordingAutoZoomPathRef.current = null;
				applySessionPresentation(null);
				appearance.setWebcam((previous) => ({
					...previous,
					visibleRanges: undefined,
					enabled: false,
					sourcePath: null,
					timeOffsetMs: DEFAULT_WEBCAM_TIME_OFFSET_MS,
				}));
			} catch (error) {
				project.setError(`Error loading video: ${String(error)}`);
			} finally {
				project.setLoading(false);
			}
		}
		initialLoadRef.current = loadInitialData();
	}, [
		adoptRecordingSession,
		applyLoadedProject,
		applySessionPresentation,
		devConfig,
		resetSourceScopedEditorState,
		smokeConfig,
	]);

	useEffect(() => {
		if (!window.electronAPI.onRecordingSessionChanged) return;
		return window.electronAPI.onRecordingSessionChanged((session) => {
			if (!session?.videoPath) return;
			const sessionSourcePath = fromFileUrl(session.videoPath);
			if (sessionSourcePath !== latestRef.current.videoSourcePath) {
				void (initialLoadRef.current ?? Promise.resolve())
					.then(() => {
						if (sessionSourcePath === latestRef.current.videoSourcePath) return;
						return adoptRecordingSession(session);
					})
					.catch((error) =>
						latestRef.current.project.setError(
							`Error loading recording: ${String(error)}`,
						),
					);
				return;
			}
			const webcamPath = session.webcamPath ? fromFileUrl(session.webcamPath) : null;
			appearance.setWebcam((previous) => ({
				...previous,
				visibleRanges: undefined,
				enabled: Boolean(webcamPath),
				sourcePath: webcamPath,
				timeOffsetMs: webcamPath
					? (session.timeOffsetMs ?? previous.timeOffsetMs)
					: DEFAULT_WEBCAM_TIME_OFFSET_MS,
			}));
			timeline.setSourceAudioFallbackRefreshKey((key) => key + 1);
		});
	}, [adoptRecordingSession, appearance.setWebcam, timeline.setSourceAudioFallbackRefreshKey]);

	useEffect(() => {
		let cancelled = false;
		if (!appearance.webcam.sourcePath) {
			appearance.setResolvedWebcamVideoUrl(null);
			return;
		}
		void resolveVideoUrl(appearance.webcam.sourcePath).then((url) => {
			if (!cancelled) appearance.setResolvedWebcamVideoUrl(url);
		});
		return () => {
			cancelled = true;
		};
	}, [appearance.webcam.sourcePath, appearance.setResolvedWebcamVideoUrl]);

	useEffect(() => {
		if (!appearance.autoApplyFreshRecordingAutoZooms) {
			pendingFreshRecordingAutoZoomPathRef.current = null;
		}
	}, [appearance.autoApplyFreshRecordingAutoZooms, pendingFreshRecordingAutoZoomPathRef]);
}
