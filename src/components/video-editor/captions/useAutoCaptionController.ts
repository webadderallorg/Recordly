import {
	type Dispatch,
	type SetStateAction,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { toast } from "@/components/ui/toast";
import { useScopedT } from "@/contexts/I18nContext";
import { type CaptionModelId, getCaptionModel, isCaptionModelId } from "@/shared/captionModels";
import { resolveAutoCaptionSourcePath } from "../autoCaptionSource";
import { type CaptionEditTarget, updateCaptionCuesForEditedTarget } from "../captionEditing";
import { resolveVideoUrl } from "../projectPersistence";
import type { AutoCaptionSettings, CaptionCue } from "../types";
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
	whisperExecutablePath: string | null;
	setWhisperExecutablePath: Dispatch<SetStateAction<string | null>>;
	whisperModelPath: string | null;
	setWhisperModelPath: Dispatch<SetStateAction<string | null>>;
	downloadedWhisperModelPath: string | null;
	setDownloadedWhisperModelPath: Dispatch<SetStateAction<string | null>>;
	whisperModelDownloadStatus: DownloadStatus;
	setWhisperModelDownloadStatus: Dispatch<SetStateAction<DownloadStatus>>;
	setWhisperModelDownloadProgress: Dispatch<SetStateAction<number>>;
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
	whisperExecutablePath,
	setWhisperExecutablePath,
	setWhisperModelPath,
	downloadedWhisperModelPath,
	setDownloadedWhisperModelPath,
	whisperModelDownloadStatus,
	setWhisperModelDownloadStatus,
	setWhisperModelDownloadProgress,
	isGeneratingCaptions,
	setIsGeneratingCaptions,
	setAutoCaptionSettings,
	setAutoCaptions,
	syncActiveVideoSource,
}: UseAutoCaptionControllerParams) {
	const te = useScopedT("editing");
	const captionGenerationInFlightRef = useRef(false);
	const activeSourceRef = useRef({ videoSourcePath, videoPath });
	activeSourceRef.current = { videoSourcePath, videoPath };

	const [captionModelId, setCaptionModelId] = useState<CaptionModelId>(() => {
		const saved = window.electronAPI.getAppSetting?.("recordly.captions.model");
		return isCaptionModelId(saved) ? saved : "parakeet-v3";
	});
	const selectedModelRef = useRef(captionModelId);
	selectedModelRef.current = captionModelId;
	const modelOperationRef = useRef(false);
	const [captionModelLoading, setCaptionModelLoading] = useState(true);
	const [modelOperationActive, setModelOperationActive] = useState(false);

	// Legacy path/state names remain compatible with saved editor preferences.
	// Every selection is resolved against a verified managed installation.
	useEffect(() => {
		let disposed = false;
		let receivedProgress = false;
		setCaptionModelLoading(true);
		setWhisperModelPath(null);
		setDownloadedWhisperModelPath(null);
		setWhisperModelDownloadStatus("idle");
		setWhisperModelDownloadProgress(0);
		const unsubscribe = window.electronAPI.onCaptionModelDownloadProgress((state) => {
			if (disposed || state.modelId !== captionModelId) return;
			receivedProgress = true;
			setCaptionModelLoading(false);
			setWhisperModelDownloadStatus(state.status);
			setWhisperModelDownloadProgress(state.progress);
			const path = state.status === "downloaded" ? (state.path ?? null) : null;
			setDownloadedWhisperModelPath(path);
			setWhisperModelPath(path);
		});
		void window.electronAPI
			.getCaptionModelStatus(captionModelId)
			.then((result) => {
				if (disposed || receivedProgress) return;
				const installed = result.success && result.exists && result.path;
				setDownloadedWhisperModelPath(installed || null);
				setWhisperModelPath(installed || null);
				setWhisperModelDownloadStatus(
					installed ? "downloaded" : result.success ? "idle" : "error",
				);
				setWhisperModelDownloadProgress(installed ? 100 : 0);
				setCaptionModelLoading(false);
			})
			.catch(() => {
				if (!disposed && !receivedProgress) {
					setWhisperModelDownloadStatus("error");
					setCaptionModelLoading(false);
				}
			});
		return () => {
			disposed = true;
			unsubscribe?.();
		};
	}, [
		captionModelId,
		setDownloadedWhisperModelPath,
		setWhisperModelDownloadProgress,
		setWhisperModelDownloadStatus,
		setWhisperModelPath,
	]);

	const handleCaptionModelChange = useCallback(
		(modelId: CaptionModelId) => {
			if (
				modelId === captionModelId ||
				!isCaptionModelId(modelId) ||
				modelOperationRef.current ||
				captionGenerationInFlightRef.current ||
				isGeneratingCaptions ||
				whisperModelDownloadStatus === "downloading"
			)
				return;
			selectedModelRef.current = modelId;
			setCaptionModelLoading(true);
			setWhisperModelPath(null);
			setDownloadedWhisperModelPath(null);
			setWhisperModelDownloadStatus("idle");
			setWhisperModelDownloadProgress(0);
			setCaptionModelId(modelId);
			window.electronAPI.setAppSetting?.("recordly.captions.model", modelId);
		},
		[
			captionModelId,
			isGeneratingCaptions,
			whisperModelDownloadStatus,
			setWhisperModelPath,
			setDownloadedWhisperModelPath,
			setWhisperModelDownloadStatus,
			setWhisperModelDownloadProgress,
		],
	);

	const handlePickWhisperExecutable = useCallback(async () => {
		const result = await window.electronAPI.openWhisperExecutablePicker();
		if (!result.success || !result.path) return;
		setWhisperExecutablePath(result.path);
		toast.success(te("whisperExecutableSelected", "Whisper executable selected"));
	}, [setWhisperExecutablePath, te]);

	const handleDownloadWhisperSmallModel = useCallback(async () => {
		if (
			modelOperationRef.current ||
			whisperModelDownloadStatus === "downloading" ||
			captionGenerationInFlightRef.current
		)
			return;
		modelOperationRef.current = true;
		setModelOperationActive(true);
		setWhisperModelDownloadStatus("downloading");
		setWhisperModelDownloadProgress(0);
		try {
			const result = await window.electronAPI.downloadCaptionModel(captionModelId);
			if (!result.success || !result.path)
				throw new Error(result.error ?? "Model download did not complete.");
			if (selectedModelRef.current !== captionModelId) return;
			setDownloadedWhisperModelPath(result.path);
			setWhisperModelPath(result.path);
			setWhisperModelDownloadStatus("downloaded");
			setWhisperModelDownloadProgress(100);
		} catch (error) {
			if (selectedModelRef.current === captionModelId) setWhisperModelDownloadStatus("error");
			toast.error(te("captionModelDownloadFailed", "Failed to download caption model"), {
				description: getErrorMessage(error),
			});
		} finally {
			modelOperationRef.current = false;
			setModelOperationActive(false);
		}
	}, [
		captionModelId,
		setDownloadedWhisperModelPath,
		setWhisperModelDownloadProgress,
		setWhisperModelDownloadStatus,
		setWhisperModelPath,
		whisperModelDownloadStatus,
		te,
	]);

	const handlePickWhisperModel = useCallback(async () => {
		const result = await window.electronAPI.openWhisperModelPicker();
		if (!result.success || !result.path) return;
		setWhisperModelPath(result.path);
		toast.success(te("whisperModelSelected", "Whisper model selected"));
	}, [setWhisperModelPath, te]);

	const handleDeleteWhisperSmallModel = useCallback(async () => {
		if (
			modelOperationRef.current ||
			captionGenerationInFlightRef.current ||
			isGeneratingCaptions ||
			whisperModelDownloadStatus === "downloading"
		)
			return;
		modelOperationRef.current = true;
		setModelOperationActive(true);
		try {
			const result = await window.electronAPI.deleteCaptionModel(captionModelId);
			if (!result.success) throw new Error(result.error ?? "Could not remove model.");
			if (selectedModelRef.current !== captionModelId) return;
			setWhisperModelPath(null);
			setDownloadedWhisperModelPath(null);
			setWhisperModelDownloadStatus("idle");
			setWhisperModelDownloadProgress(0);
			toast.success(te("captionModelDeleted", "Caption model removed"));
		} catch (error) {
			toast.error(te("captionModelDeleteFailed", "Could not remove caption model"), {
				description: getErrorMessage(error),
			});
		} finally {
			modelOperationRef.current = false;
			setModelOperationActive(false);
		}
	}, [
		captionModelId,
		isGeneratingCaptions,
		whisperModelDownloadStatus,
		te,
		setDownloadedWhisperModelPath,
		setWhisperModelDownloadProgress,
		setWhisperModelDownloadStatus,
		setWhisperModelPath,
	]);

	const handleGenerateAutoCaptions = useCallback(async () => {
		if (
			captionGenerationInFlightRef.current ||
			modelOperationRef.current ||
			isGeneratingCaptions
		)
			return;
		captionGenerationInFlightRef.current = true;
		setIsGeneratingCaptions(true);
		try {
			if (!downloadedWhisperModelPath || whisperModelDownloadStatus !== "downloaded") {
				toast.error(
					te("downloadCaptionModelFirst", "Download the selected caption model first"),
				);
				return;
			}
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
				toast.error(te("noSourceVideo", "No source video is loaded"));
				return;
			}
			// Refreshing an unchanged session revokes active companion-audio URLs.
			if (sourcePath !== videoSourcePath) {
				await syncActiveVideoSource(sourcePath, webcamSourcePath);
				setVideoSourcePath(sourcePath);
				setVideoPath(await resolveVideoUrl(sourcePath));
			}
			const result = await window.electronAPI.generateAutoCaptions({
				videoPath: sourcePath,
				captionModelId,
				engine: getCaptionModel(captionModelId).engine,
				...(getCaptionModel(captionModelId).engine === "parakeet"
					? { parakeetModelPath: downloadedWhisperModelPath }
					: {
							whisperModelPath: downloadedWhisperModelPath,
							whisperExecutablePath: whisperExecutablePath ?? undefined,
						}),
				language: "auto",
			});
			if (resolveAutoCaptionSourcePath(activeSourceRef.current) !== sourcePath) {
				toast.info(
					te(
						"captionSourceChanged",
						"Recording changed; generated captions were not applied.",
					),
				);
				return;
			}
			if (!result.success || !result.cues) {
				const errorMessage = result.error ? getErrorMessage(result.error) : result.message;
				toast.error(te("captionsFailed", "Failed to generate captions"), {
					description: errorMessage,
				});
				return;
			}
			setAutoCaptions(result.cues);
			if (result.cues.length > 0) {
				setAutoCaptionSettings((current) => ({ ...current, enabled: true }));
			}
			toast.success(
				te("captionsGenerated", "Captions generated: {{count}}", {
					count: result.cues.length,
				}),
			);
		} catch (error) {
			toast.error(te("captionsFailed", "Failed to generate captions"), {
				description: getErrorMessage(error),
			});
		} finally {
			captionGenerationInFlightRef.current = false;
			setIsGeneratingCaptions(false);
		}
	}, [
		te,
		captionModelId,
		whisperExecutablePath,
		isGeneratingCaptions,
		setAutoCaptionSettings,
		setAutoCaptions,
		setIsGeneratingCaptions,
		setVideoPath,
		setVideoSourcePath,
		syncActiveVideoSource,
		videoPath,
		videoSourcePath,
		webcamSourcePath,
		downloadedWhisperModelPath,
		whisperModelDownloadStatus,
	]);

	const handleSaveAutoCaptionEdit = useCallback(
		(target: CaptionEditTarget, text: string) => {
			setAutoCaptions((captions) => updateCaptionCuesForEditedTarget(captions, target, text));
			toast.success(t("settings.captions.editSaved", "Caption updated"));
		},
		[setAutoCaptions, t],
	);

	return {
		captionModelId,
		captionModelLoading: captionModelLoading || modelOperationActive,
		handleCaptionModelChange,
		handlePickWhisperExecutable,
		handleDownloadWhisperSmallModel,
		handlePickWhisperModel,
		handleDeleteWhisperSmallModel,
		handleGenerateAutoCaptions,
		handleSaveAutoCaptionEdit,
	};
}
