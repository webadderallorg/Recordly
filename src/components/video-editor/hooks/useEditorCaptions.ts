/**
 * useEditorCaptions – manages Whisper auto-caption state and handlers.
 */
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { resolveAutoCaptionSourcePath } from "../autoCaptionSource";
import { loadEditorPreferences, saveEditorPreferences } from "../editorPreferences";
import { resolveVideoUrl } from "../projectPersistence";
import {
	type AutoCaptionSettings,
	type CaptionCue,
	DEFAULT_AUTO_CAPTION_SETTINGS,
} from "../types";

interface UseEditorCaptionsParams {
	videoSourcePath: string | null;
	videoPath: string | null;
	webcamSourcePath: string | null;
	syncActiveVideoSource: (sourcePath: string, webcamPath?: string | null) => Promise<void>;
	setVideoSourcePath: (path: string | null) => void;
	setVideoPath: (path: string | null) => void;
}

export function useEditorCaptions({
	videoSourcePath,
	videoPath,
	webcamSourcePath,
	syncActiveVideoSource,
	setVideoSourcePath,
	setVideoPath,
}: UseEditorCaptionsParams) {
	const initial = loadEditorPreferences();

	const [autoCaptions, setAutoCaptions] = useState<CaptionCue[]>([]);
	const [autoCaptionSettings, setAutoCaptionSettings] = useState<AutoCaptionSettings>(
		DEFAULT_AUTO_CAPTION_SETTINGS,
	);
	const [whisperExecutablePath, setWhisperExecutablePath] = useState<string | null>(
		initial.whisperExecutablePath,
	);
	const [whisperModelPath, setWhisperModelPath] = useState<string | null>(
		initial.whisperModelPath,
	);
	const [downloadedWhisperModelPath, setDownloadedWhisperModelPath] = useState<string | null>(
		null,
	);
	const [whisperModelDownloadStatus, setWhisperModelDownloadStatus] = useState<
		"idle" | "downloading" | "downloaded" | "error"
	>(initial.whisperModelPath ? "downloaded" : "idle");
	const [whisperModelDownloadProgress, setWhisperModelDownloadProgress] = useState(0);
	const [isGeneratingCaptions, setIsGeneratingCaptions] = useState(false);

	// Persist whisper paths to preferences
	useEffect(() => {
		const current = loadEditorPreferences();
		saveEditorPreferences({
			...current,
			whisperExecutablePath,
			whisperModelPath,
		});
	}, [whisperExecutablePath, whisperModelPath]);

	// Load whisper model status on mount
	useEffect(() => {
		const unsubscribe = window.electronAPI.onWhisperSmallModelDownloadProgress((state) => {
			setWhisperModelDownloadStatus(state.status);
			setWhisperModelDownloadProgress(state.progress);
			if (state.status === "downloaded") {
				setDownloadedWhisperModelPath(state.path ?? null);
				setWhisperModelPath((current) => current ?? state.path ?? null);
			}
			if (state.status === "idle") setDownloadedWhisperModelPath(null);
			if (state.status === "error" && state.error) toast.error(state.error);
		});

		void (async () => {
			const result = await window.electronAPI.getWhisperSmallModelStatus();
			if (!result.success) return;
			if (result.exists && result.path) {
				setDownloadedWhisperModelPath(result.path);
				setWhisperModelPath((current) => current ?? result.path ?? null);
				setWhisperModelDownloadStatus("downloaded");
				setWhisperModelDownloadProgress(100);
			} else {
				setDownloadedWhisperModelPath(null);
				setWhisperModelDownloadStatus("idle");
				setWhisperModelDownloadProgress(0);
			}
		})();

		return () => unsubscribe?.();
	}, []);

	const handlePickWhisperExecutable = useCallback(async () => {
		const result = await window.electronAPI.openWhisperExecutablePicker();
		if (!result.success || !result.path) return;
		setWhisperExecutablePath(result.path);
		toast.success("Whisper executable selected");
	}, []);

	const handlePickWhisperModel = useCallback(async () => {
		const result = await window.electronAPI.openWhisperModelPicker();
		if (!result.success || !result.path) return;
		setWhisperModelPath(result.path);
		toast.success("Whisper model selected");
	}, []);

	const handleDownloadWhisperSmallModel = useCallback(async () => {
		if (whisperModelDownloadStatus === "downloading") return;
		setWhisperModelDownloadStatus("downloading");
		setWhisperModelDownloadProgress(0);
		const result = await window.electronAPI.downloadWhisperSmallModel();
		if (!result.success) {
			setWhisperModelDownloadStatus("error");
			toast.error(result.error || "Failed to download Whisper small model");
			return;
		}
		if (result.path) {
			setDownloadedWhisperModelPath(result.path);
			setWhisperModelPath(result.path);
		}
	}, [whisperModelDownloadStatus]);

	const handleDeleteWhisperSmallModel = useCallback(async () => {
		const result = await window.electronAPI.deleteWhisperSmallModel();
		if (!result.success) {
			toast.error(result.error || "Failed to delete Whisper small model");
			return;
		}
		setWhisperModelPath((current) =>
			current === downloadedWhisperModelPath ? null : current,
		);
		setDownloadedWhisperModelPath(null);
		setWhisperModelDownloadStatus("idle");
		setWhisperModelDownloadProgress(0);
	}, [downloadedWhisperModelPath]);

	const handleGenerateAutoCaptions = useCallback(async () => {
		if (isGeneratingCaptions) return;

		let sourcePath = resolveAutoCaptionSourcePath({
			videoSourcePath,
			videoPath,
		});

		if (!sourcePath) {
			const sessionResult = await window.electronAPI.getCurrentRecordingSession?.();
			const currentVideoResult = await window.electronAPI.getCurrentVideoPath();
			sourcePath = resolveAutoCaptionSourcePath({
				recordingSessionVideoPath:
					sessionResult?.success && sessionResult.session?.videoPath
						? sessionResult.session.videoPath
						: null,
				currentVideoPath: currentVideoResult.success
					? (currentVideoResult.path ?? null)
					: null,
			});
		}

		if (!sourcePath) {
			toast.error("No source video is loaded");
			return;
		}

		if (sourcePath !== videoSourcePath) {
			setVideoSourcePath(sourcePath);
			setVideoPath(await resolveVideoUrl(sourcePath));
		}

		await syncActiveVideoSource(sourcePath, webcamSourcePath ?? null);

		if (!whisperModelPath) {
			toast.error("Select a Whisper model or download the small model first");
			return;
		}

		setIsGeneratingCaptions(true);
		try {
			const result = await window.electronAPI.generateAutoCaptions({
				videoPath: sourcePath,
				whisperModelPath,
				whisperExecutablePath: whisperExecutablePath ?? undefined,
				language: autoCaptionSettings.language,
			});
			if (!result.success || !result.cues) {
				toast.error(result.message ?? result.error ?? "Failed to generate captions");
				return;
			}
			setAutoCaptions(result.cues);
			setAutoCaptionSettings((previous) => ({ ...previous, enabled: true }));
			toast.success(result.message || `Generated ${result.cues.length} captions`);
		} catch (error) {
			toast.error(`Caption generation failed: ${String(error)}`);
		} finally {
			setIsGeneratingCaptions(false);
		}
	}, [
		isGeneratingCaptions,
		videoSourcePath,
		videoPath,
		webcamSourcePath,
		whisperModelPath,
		whisperExecutablePath,
		syncActiveVideoSource,
		setVideoSourcePath,
		setVideoPath,
		autoCaptionSettings.language,
	]);

	const handleClearAutoCaptions = useCallback(() => {
		setAutoCaptions([]);
		setAutoCaptionSettings((previous) => ({ ...previous, enabled: false }));
	}, []);

	/** Reset captions from a freshly loaded project. */
	const resetForProject = useCallback(
		(editor: { autoCaptions: CaptionCue[]; autoCaptionSettings: AutoCaptionSettings }) => {
			setAutoCaptions(editor.autoCaptions);
			setAutoCaptionSettings(editor.autoCaptionSettings);
		},
		[],
	);

	return {
		autoCaptions,
		setAutoCaptions,
		autoCaptionSettings,
		setAutoCaptionSettings,
		whisperExecutablePath,
		setWhisperExecutablePath,
		whisperModelPath,
		setWhisperModelPath,
		downloadedWhisperModelPath,
		whisperModelDownloadStatus,
		whisperModelDownloadProgress,
		isGeneratingCaptions,
		handlePickWhisperExecutable,
		handlePickWhisperModel,
		handleDownloadWhisperSmallModel,
		handleDeleteWhisperSmallModel,
		handleGenerateAutoCaptions,
		handleClearAutoCaptions,
		resetForProject,
	};
}