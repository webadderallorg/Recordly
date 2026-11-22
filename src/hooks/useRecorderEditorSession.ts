import { useCallback, useRef } from "react";
import { toast } from "@/components/ui/toast";
import { translate } from "@/i18n/runtime";
import type { RecorderCoreContext } from "./recorderContext";
export function useRecorderEditorSession(
	context: Pick<
		RecorderCoreContext,
		"setFinalizing" | "hideEditorOverlayCursorByDefault" | "webcamTimeOffsetMs"
	>,
) {
	const { setFinalizing, hideEditorOverlayCursorByDefault, webcamTimeOffsetMs } = context;
	const loadingEditorOpen = useRef<Promise<boolean> | null>(null);

	const openLoadingEditor = () => {
		if (loadingEditorOpen.current) return;
		loadingEditorOpen.current =
			window.electronAPI
				.openLoadingRecordingEditor?.()
				.then((result) => result.success)
				.catch((error) => {
					console.warn("Could not open loading editor:", error);
					return false;
				}) ?? Promise.resolve(false);
	};

	const notifyRecordingFinalizationFailure = useCallback(
		async (message: string) => {
			setFinalizing(false);
			if (await loadingEditorOpen.current)
				await window.electronAPI.finishRecordingEditor?.(message);
			loadingEditorOpen.current = null;
			toast.error(message, { duration: 10000 });
		},
		[setFinalizing],
	);

	const logNativeCaptureDiagnostics = useCallback(async (context: string) => {
		if (typeof window.electronAPI?.getLastNativeCaptureDiagnostics !== "function") {
			return;
		}

		try {
			const result = await window.electronAPI.getLastNativeCaptureDiagnostics();
			if (result.success && result.diagnostics) {
				console.warn(`[NativeCaptureDiagnostics:${context}]`, result.diagnostics);
			}
		} catch (error) {
			console.warn("Failed to load native capture diagnostics:", error);
		}
	}, []);

	const buildNativeCaptureFailureMessage = useCallback(
		async (context: string, fallbackMessage: string) => {
			if (typeof window.electronAPI?.getLastNativeCaptureDiagnostics !== "function") {
				return fallbackMessage;
			}

			try {
				const result = await window.electronAPI.getLastNativeCaptureDiagnostics();
				const diagnostics = result.success ? (result.diagnostics ?? null) : null;
				if (!diagnostics) {
					return fallbackMessage;
				}

				console.warn(`[NativeCaptureDiagnostics:${context}]`, diagnostics);

				const details: string[] = [];
				if (diagnostics.error) {
					details.push(diagnostics.error);
				}
				if (diagnostics.outputPath && (diagnostics.fileSizeBytes ?? 0) > 0) {
					details.push(
						translate("notifications.savedFile", "Saved file: {{path}}", {
							path: diagnostics.outputPath,
						}),
					);
				}

				return details.length > 0
					? `${fallbackMessage} ${details.join(". ")}`
					: fallbackMessage;
			} catch (error) {
				console.warn("Failed to load native capture diagnostics:", error);
				return fallbackMessage;
			}
		},
		[],
	);

	const finalizeRecordingSession = useCallback(
		async (videoPath: string, webcamPath: string | null) => {
			const start = performance.now();
			console.log("[PERF:RENDERER] Finalize Session & Switch to Editor: STARTED");
			const shouldHideOverlayCursor = hideEditorOverlayCursorByDefault.current;
			try {
				if (webcamPath) {
					await window.electronAPI.setCurrentRecordingSession({
						videoPath,
						webcamPath,
						timeOffsetMs: webcamTimeOffsetMs.current,
						hideOverlayCursorByDefault: shouldHideOverlayCursor,
					});
				} else {
					await window.electronAPI.setCurrentVideoPath(videoPath, {
						hideOverlayCursorByDefault: shouldHideOverlayCursor,
					});
				}
			} catch (error) {
				console.error("Failed to persist recording session metadata:", error);

				try {
					await window.electronAPI.setCurrentVideoPath(videoPath, {
						hideOverlayCursorByDefault: shouldHideOverlayCursor,
					});
				} catch (fallbackError) {
					console.error("Failed to persist fallback video path:", fallbackError);
				}
			}

			setFinalizing(false);
			if (await loadingEditorOpen.current) await window.electronAPI.finishRecordingEditor();
			else await window.electronAPI.switchToEditor();
			loadingEditorOpen.current = null;
			console.log(
				`[PERF:RENDERER] Finalize Session & Switch to Editor: COMPLETED in ${(performance.now() - start).toFixed(2)}ms`,
			);
		},
		[hideEditorOverlayCursorByDefault, webcamTimeOffsetMs, setFinalizing],
	);

	return {
		openLoadingEditor,
		notifyRecordingFinalizationFailure,
		logNativeCaptureDiagnostics,
		buildNativeCaptureFailureMessage,
		finalizeRecordingSession,
	};
}
