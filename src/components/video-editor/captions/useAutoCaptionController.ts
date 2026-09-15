import { type Dispatch, type SetStateAction, useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import { resolveAutoCaptionSourcePath } from "../autoCaptionSource";
import { type CaptionEditTarget, updateCaptionCuesForEditedTarget } from "../captionEditing";
import { resolveVideoUrl } from "../projectPersistence";
import {
	type AutoCaptionSettings,
	type CaptionCue,
	type ClipRegion,
	getClipSourceEndMs,
} from "../types";
import { getErrorMessage } from "../videoEditorUtils";

type DownloadStatus = "idle" | "downloading" | "downloaded" | "error";
type Translator = (
	key: string,
	fallback?: string,
	params?: Record<string, string | number>,
) => string;

interface UseAutoCaptionControllerParams {
	t: Translator;
	videoPath: string | null;
	setVideoPath: Dispatch<SetStateAction<string | null>>;
	videoSourcePath: string | null;
	setVideoSourcePath: Dispatch<SetStateAction<string | null>>;
	webcamSourcePath: string | null;
	captionEngine?: "whisper" | "parakeet";
	setCaptionEngine?: Dispatch<SetStateAction<"whisper" | "parakeet">>;
	whisperExecutablePath: string | null;
	setWhisperExecutablePath: Dispatch<SetStateAction<string | null>>;
	whisperModelPath: string | null;
	setWhisperModelPath: Dispatch<SetStateAction<string | null>>;
	downloadedWhisperModelPath: string | null;
	setDownloadedWhisperModelPath: Dispatch<SetStateAction<string | null>>;
	whisperModelDownloadStatus: DownloadStatus;
	setWhisperModelDownloadStatus: Dispatch<SetStateAction<DownloadStatus>>;
	setWhisperModelDownloadProgress: Dispatch<SetStateAction<number>>;
	parakeetExecutablePath?: string | null;
	setParakeetExecutablePath?: Dispatch<SetStateAction<string | null>>;
	parakeetModelPath?: string | null;
	setParakeetModelPath?: Dispatch<SetStateAction<string | null>>;
	downloadedParakeetModelPath?: string | null;
	setDownloadedParakeetModelPath?: Dispatch<SetStateAction<string | null>>;
	parakeetModelDownloadStatus?: DownloadStatus;
	setParakeetModelDownloadStatus?: Dispatch<SetStateAction<DownloadStatus>>;
	parakeetModelDownloadProgress?: number;
	setParakeetModelDownloadProgress?: Dispatch<SetStateAction<number>>;
	clipRegions?: ClipRegion[];
	isGeneratingCaptions: boolean;
	setIsGeneratingCaptions: Dispatch<SetStateAction<boolean>>;
	autoCaptionSettings: AutoCaptionSettings;
	setAutoCaptionSettings: Dispatch<SetStateAction<AutoCaptionSettings>>;
	setAutoCaptions: Dispatch<SetStateAction<CaptionCue[]>>;
	syncActiveVideoSource: (sourcePath: string, webcamPath?: string | null) => Promise<void>;
}

export function useAutoCaptionController({
	t,
	videoPath,
	setVideoPath,
	videoSourcePath,
	setVideoSourcePath,
	webcamSourcePath,
	captionEngine = "whisper",
	setCaptionEngine,
	whisperExecutablePath,
	setWhisperExecutablePath,
	whisperModelPath,
	setWhisperModelPath,
	downloadedWhisperModelPath,
	setDownloadedWhisperModelPath,
	whisperModelDownloadStatus,
	setWhisperModelDownloadStatus,
	setWhisperModelDownloadProgress,
	parakeetExecutablePath = null,
	setParakeetExecutablePath,
	parakeetModelPath = null,
	setParakeetModelPath,
	downloadedParakeetModelPath = null,
	setDownloadedParakeetModelPath,
	parakeetModelDownloadStatus = "idle",
	setParakeetModelDownloadStatus,
	parakeetModelDownloadProgress = 0,
	setParakeetModelDownloadProgress,
	isGeneratingCaptions,
	setIsGeneratingCaptions,
	autoCaptionSettings,
	setAutoCaptionSettings,
	setAutoCaptions,
	syncActiveVideoSource,
	clipRegions = [],
}: UseAutoCaptionControllerParams) {
	const captionGenerationInFlightRef = useRef(false);

	useEffect(() => {
		const unsubscribe = window.electronAPI.onWhisperSmallModelDownloadProgress((state) => {
			setWhisperModelDownloadStatus(state.status);
			setWhisperModelDownloadProgress(state.progress);
			if (state.status === "downloaded") {
				setDownloadedWhisperModelPath(state.path ?? null);
				setWhisperModelPath((current) => current ?? state.path ?? null);
			} else if (state.status === "idle") {
				setDownloadedWhisperModelPath(null);
			} else if (state.status === "error" && state.error) {
				toast.error(state.error);
			}
		});

		void window.electronAPI.getWhisperSmallModelStatus().then((result) => {
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
		});

		return () => unsubscribe?.();
	}, [
		setDownloadedWhisperModelPath,
		setWhisperModelDownloadProgress,
		setWhisperModelDownloadStatus,
		setWhisperModelPath,
	]);

	useEffect(() => {
		if (
			!setParakeetModelDownloadStatus ||
			!setParakeetModelDownloadProgress ||
			!setDownloadedParakeetModelPath ||
			!setParakeetModelPath
		)
			return;

		const unsubscribe = window.electronAPI.onParakeetModelDownloadProgress?.((state) => {
			setParakeetModelDownloadStatus(state.status);
			setParakeetModelDownloadProgress(state.progress);
			if (state.status === "downloaded") {
				setDownloadedParakeetModelPath(state.path ?? null);
				setParakeetModelPath((current) => current ?? state.path ?? null);
			} else if (state.status === "idle") {
				setDownloadedParakeetModelPath(null);
			} else if (state.status === "error" && state.error) {
				toast.error(state.error);
			}
		});

		void window.electronAPI.getParakeetModelStatus?.()?.then((result) => {
			if (!result?.success) return;
			if (result.exists && result.path) {
				setDownloadedParakeetModelPath(result.path);
				setParakeetModelPath((current) => current ?? result.path ?? null);
				setParakeetModelDownloadStatus("downloaded");
				setParakeetModelDownloadProgress(100);
			} else {
				setDownloadedParakeetModelPath(null);
				setParakeetModelDownloadStatus("idle");
				setParakeetModelDownloadProgress(0);
			}
		});

		return () => unsubscribe?.();
	}, [
		setDownloadedParakeetModelPath,
		setParakeetModelDownloadProgress,
		setParakeetModelDownloadStatus,
		setParakeetModelPath,
	]);

	useEffect(() => {
		if (!setParakeetExecutablePath) return;

		const unsubscribe = window.electronAPI.onParakeetRuntimeDownloadProgress?.((state) => {
			if (state.status === "downloaded" && state.path) {
				setParakeetExecutablePath(state.path);
			}
		});

		void window.electronAPI
			.getParakeetRuntimeStatus?.(parakeetExecutablePath)
			?.then((result) => {
				if (result?.exists && result.path) {
					if (!parakeetExecutablePath) {
						setParakeetExecutablePath(result.path);
					}
				} else if (!parakeetExecutablePath && captionEngine === "parakeet") {
					void window.electronAPI.downloadSherpaOnnxRuntime?.()?.then((downloadRes) => {
						if (downloadRes?.success && downloadRes.path) {
							setParakeetExecutablePath(downloadRes.path);
						}
					});
				}
			});

		return () => unsubscribe?.();
	}, [captionEngine, parakeetExecutablePath, setParakeetExecutablePath]);

	const handlePickWhisperExecutable = useCallback(async () => {
		const result = await window.electronAPI.openWhisperExecutablePicker();
		if (!result.success || !result.path) return;
		setWhisperExecutablePath(result.path);
		toast.success("Whisper executable selected");
	}, [setWhisperExecutablePath]);

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
	}, [
		setDownloadedWhisperModelPath,
		setWhisperModelDownloadProgress,
		setWhisperModelDownloadStatus,
		setWhisperModelPath,
		whisperModelDownloadStatus,
	]);

	const handlePickWhisperModel = useCallback(async () => {
		const result = await window.electronAPI.openWhisperModelPicker();
		if (!result.success || !result.path) return;
		setWhisperModelPath(result.path);
		toast.success("Whisper model selected");
	}, [setWhisperModelPath]);

	const handleDeleteWhisperSmallModel = useCallback(async () => {
		const result = await window.electronAPI.deleteWhisperSmallModel();
		if (!result.success) {
			toast.error(result.error || "Failed to delete Whisper small model");
			return;
		}
		setWhisperModelPath((current) => (current === downloadedWhisperModelPath ? null : current));
		setDownloadedWhisperModelPath(null);
		setWhisperModelDownloadStatus("idle");
		setWhisperModelDownloadProgress(0);
		toast.success("Whisper small model deleted");
	}, [
		downloadedWhisperModelPath,
		setDownloadedWhisperModelPath,
		setWhisperModelDownloadProgress,
		setWhisperModelDownloadStatus,
		setWhisperModelPath,
	]);

	const handlePickParakeetExecutable = useCallback(async () => {
		const result = await window.electronAPI.openParakeetExecutablePicker?.();
		if (!result?.success || !result.path) return;
		setParakeetExecutablePath?.(result.path);
		toast.success("sherpa-onnx executable selected");
	}, [setParakeetExecutablePath]);

	const handleDownloadParakeetModel = useCallback(async () => {
		if (parakeetModelDownloadStatus === "downloading") return;
		setParakeetModelDownloadStatus?.("downloading");
		setParakeetModelDownloadProgress?.(0);
		const result = await window.electronAPI.downloadParakeetModel?.();
		if (!result?.success) {
			setParakeetModelDownloadStatus?.("error");
			toast.error(result?.error || "Failed to download Parakeet model");
			return;
		}
		if (result.path) {
			setDownloadedParakeetModelPath?.(result.path);
			setParakeetModelPath?.(result.path);
			void window.electronAPI.getParakeetRuntimeStatus?.()?.then((runtime) => {
				if (runtime?.exists && runtime.path) {
					setParakeetExecutablePath?.(runtime.path);
				}
			});
		}
	}, [
		parakeetModelDownloadStatus,
		setDownloadedParakeetModelPath,
		setParakeetExecutablePath,
		setParakeetModelDownloadProgress,
		setParakeetModelDownloadStatus,
		setParakeetModelPath,
	]);

	const handlePickParakeetModel = useCallback(async () => {
		const result = await window.electronAPI.openParakeetModelPicker?.();
		if (!result?.success || !result.path) return;
		setParakeetModelPath?.(result.path);
		toast.success("Parakeet model selected");
		void window.electronAPI
			.getParakeetRuntimeStatus?.(parakeetExecutablePath)
			?.then((runtime) => {
				if (runtime?.exists && runtime.path) {
					setParakeetExecutablePath?.(runtime.path);
				} else if (!parakeetExecutablePath) {
					void window.electronAPI.downloadSherpaOnnxRuntime?.()?.then((downloadRes) => {
						if (downloadRes?.success && downloadRes.path) {
							setParakeetExecutablePath?.(downloadRes.path);
						}
					});
				}
			});
	}, [parakeetExecutablePath, setParakeetExecutablePath, setParakeetModelPath]);

	const handleDeleteParakeetModel = useCallback(async () => {
		const result = await window.electronAPI.deleteParakeetModel?.();
		if (!result?.success) {
			toast.error(result?.error || "Failed to delete Parakeet model");
			return;
		}
		setParakeetModelPath?.((current) =>
			current === downloadedParakeetModelPath ? null : current,
		);
		setDownloadedParakeetModelPath?.(null);
		setParakeetModelDownloadStatus?.("idle");
		setParakeetModelDownloadProgress?.(0);
		toast.success("Parakeet model deleted");
	}, [
		downloadedParakeetModelPath,
		setDownloadedParakeetModelPath,
		setParakeetModelDownloadProgress,
		setParakeetModelDownloadStatus,
		setParakeetModelPath,
	]);

	const handleGenerateAutoCaptions = useCallback(async () => {
		if (captionGenerationInFlightRef.current || isGeneratingCaptions) return;
		captionGenerationInFlightRef.current = true;
		setIsGeneratingCaptions(true);
		try {
			let sourcePath = resolveAutoCaptionSourcePath({ videoSourcePath, videoPath });
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
			await syncActiveVideoSource(sourcePath, webcamSourcePath);
			if (sourcePath !== videoSourcePath) {
				setVideoSourcePath(sourcePath);
				setVideoPath(await resolveVideoUrl(sourcePath));
			}

			if (captionEngine === "parakeet") {
				if (!parakeetModelPath) {
					toast.error("Select a Parakeet model folder or download the model first");
					return;
				}
			} else {
				if (!whisperModelPath) {
					toast.error("Select a Whisper model or download the small model first");
					return;
				}
			}

			let clipStartMs: number | undefined;
			let clipEndMs: number | undefined;
			if (clipRegions.length > 0) {
				const minStart = Math.min(...clipRegions.map((c) => c.startMs));
				const maxEnd = Math.max(...clipRegions.map((c) => getClipSourceEndMs(c)));
				if (minStart > 0) {
					clipStartMs = minStart;
				}
				if (maxEnd > (clipStartMs ?? 0)) {
					clipEndMs = maxEnd;
				}
			}

			const result = await window.electronAPI.generateAutoCaptions({
				videoPath: sourcePath,
				engine: captionEngine,
				whisperExecutablePath: whisperExecutablePath ?? undefined,
				whisperModelPath: whisperModelPath ?? undefined,
				parakeetExecutablePath: parakeetExecutablePath ?? undefined,
				parakeetModelPath: parakeetModelPath ?? undefined,
				language: autoCaptionSettings.language,
				clipStartMs,
				clipEndMs,
			});
			if (!result.success || !result.cues) {
				const errorMessage = result.error ? getErrorMessage(result.error) : result.message;
				toast.error(errorMessage || "Failed to generate captions");
				return;
			}
			setAutoCaptions(result.cues);
			if (result.cues.length > 0) {
				setAutoCaptionSettings((current) => ({ ...current, enabled: true }));
			}
			toast.success(result.message || `Generated ${result.cues.length} captions`);
		} catch (error) {
			toast.error(getErrorMessage(error));
		} finally {
			captionGenerationInFlightRef.current = false;
			setIsGeneratingCaptions(false);
		}
	}, [
		autoCaptionSettings.language,
		captionEngine,
		clipRegions,
		isGeneratingCaptions,
		parakeetExecutablePath,
		parakeetModelPath,
		setAutoCaptionSettings,
		setAutoCaptions,
		setIsGeneratingCaptions,
		setVideoPath,
		setVideoSourcePath,
		syncActiveVideoSource,
		videoPath,
		videoSourcePath,
		webcamSourcePath,
		whisperExecutablePath,
		whisperModelPath,
	]);

	const handleSaveAutoCaptionEdit = useCallback(
		(target: CaptionEditTarget, text: string) => {
			setAutoCaptions((captions) => updateCaptionCuesForEditedTarget(captions, target, text));
			toast.success(t("settings.captions.editSaved", "Caption updated"));
		},
		[setAutoCaptions, t],
	);

	return {
		captionEngine,
		setCaptionEngine,
		parakeetExecutablePath,
		parakeetModelPath,
		downloadedParakeetModelPath,
		parakeetModelDownloadStatus,
		parakeetModelDownloadProgress,
		handlePickWhisperExecutable,
		handleDownloadWhisperSmallModel,
		handlePickWhisperModel,
		handleDeleteWhisperSmallModel,
		handlePickParakeetExecutable,
		handlePickParakeetModel,
		handleDownloadParakeetModel,
		handleDeleteParakeetModel,
		handleGenerateAutoCaptions,
		handleSaveAutoCaptionEdit,
	};
}
