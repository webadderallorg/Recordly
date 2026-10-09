import { useCallback, useRef } from "react";
import { toast } from "@/components/ui/toast";
import { getMp4ExportBitrate } from "@/lib/exporter/exportBitrate";
import { DEFAULT_MP4_CODEC } from "@/lib/exporter/mp4Support";
import type { ExportSettings } from "@/lib/exporter/types";
import { calculateMp4ExportDimensions, capMp4ShareDimensions } from "../exportDimensions";
import { resolveMp4ExportRouting } from "../mp4ExportRouting";
import { resolveMp4ExportSettings } from "../mp4ExportSettings";
import { createSmokeExportProgressSampler } from "../smokeExportProgress";
import { buildExportRenderOptions } from "./buildExportRenderOptions";
import {
	type PendingExportSave,
	saveExportBlob,
	streamExportBlobToTempFile,
	writeSmokeExportReport,
} from "./exportPersistence";
import { type ExportRange, restrictTimelineToRange } from "./exportRange";
import {
	type ExportRunnerInput,
	showExportErrorToast,
	useExportSuccessToast,
} from "./exportRunnerSupport";

export function useExportRunner(input: ExportRunnerInput) {
	const inputRef = useRef(input);
	inputRef.current = input;
	const showExportSuccessToast = useExportSuccessToast();

	const handleExport = useCallback(
		async (
			settings: ExportSettings,
			options?: {
				destination?: "download" | "share";
				outputPath?: string;
				range?: ExportRange;
				onError?: (message: string) => void;
			},
		): Promise<string | undefined> => {
			const {
				videoPath,
				videoPlaybackRef,
				isPlaying,
				appearance,
				timeline,
				exportSettings,
				exportSession,
				audio,
				smokeExportConfig,
				effectiveSpeedRegions,
				effectiveZoomRegions,
				effectiveCursorTelemetry,
				effectiveShowCursor,
				ensureSupportedMp4SourceDimensions,
				captionSidecarPayload,
				experimentalNvidiaCudaExport,
				nvidiaCudaExportAvailable,
				remountPreview,
			} = inputRef.current;
			const { shadowIntensity, padding } = appearance;
			const { audioRegions, clipRegions, selectedClipId } = timeline;
			const {
				exportQuality,
				exportEncodingMode,
				exportBackendPreference,
				exportPipelineModel,
				mp4FrameRate,
			} = exportSettings;
			const {
				setIsExporting,
				setExportProgress,
				setExportError: setSessionExportError,
				setShowExportDropdown,
				setExportedFilePath,
				setHasPendingExportSave,
				exporterRef,
				pendingExportSaveRef,
				clearPendingExportSave,
				markExportAsSaving,
				exportRunIdRef,
				cancelledExportRunIdRef,
			} = exportSession;
			const setExportError = (message: string | null) => {
				setSessionExportError(message);
				if (message) options?.onError?.(message);
			};
			const reportSaveError = (
				saveResult: { message?: string; error?: string },
				fallback: string,
			) => {
				const message = saveResult.message || fallback;
				setSessionExportError(message);
				options?.onError?.(saveResult.error || message);
				return message;
			};
			if (!videoPath) {
				toast.error("No video loaded");
				return;
			}

			const video = videoPlaybackRef.current?.video;
			if (!video) {
				toast.error("Video not ready");
				return;
			}

			const ranged = options?.range
				? restrictTimelineToRange(
						{
							clipRegions,
							trimRegions: timeline.trimRegions,
							annotationRegions: timeline.annotationRegions,
							zoomRegions: effectiveZoomRegions,
							audioRegions,
						},
						options.range,
						Number.isFinite(video.duration) ? video.duration * 1000 : 0,
					)
				: undefined;
			const exportClipRegions = ranged?.clipRegions ?? clipRegions;
			const exportAudioRegions = ranged?.audioRegions ?? audioRegions;

			const exportRunId = exportRunIdRef.current + 1;
			exportRunIdRef.current = exportRunId;
			cancelledExportRunIdRef.current = null;
			const exportWasCancelled = () => exportRunIdRef.current !== exportRunId;
			const exportWasExplicitlyCancelled = () =>
				cancelledExportRunIdRef.current === exportRunId;
			const discardCancelledTemp = async (pending: PendingExportSave) => {
				if (!pending.tempFilePath) return;
				await window.electronAPI
					.discardExportedTemp?.(pending.tempFilePath)
					.catch(() => undefined);
			};

			setIsExporting(true);
			setExportProgress(null);
			setExportError(null);
			clearPendingExportSave();
			const smokeExportStartedAt = smokeExportConfig.enabled ? performance.now() : null;

			let keepExportDialogOpen = false;
			let savedPath: string | undefined;
			const wasPlaying = isPlaying;
			const restoreTime = video.currentTime;

			try {
				if (wasPlaying) {
					videoPlaybackRef.current?.pause();
				}

				// Get preview CONTAINER dimensions for scaling
				const playbackRef = videoPlaybackRef.current;
				const containerElement = playbackRef?.containerRef?.current;
				const previewWidth = containerElement?.clientWidth || 1920;
				const previewHeight = containerElement?.clientHeight || 1080;
				const effectiveShadowIntensity =
					smokeExportConfig.enabled && smokeExportConfig.shadowIntensity !== undefined
						? smokeExportConfig.shadowIntensity
						: shadowIntensity;
				const smokeProgressSampler = createSmokeExportProgressSampler({
					enabled: smokeExportConfig.enabled,
					startedAtMs: smokeExportStartedAt,
				});
				const smokeProgressSamples = smokeProgressSampler.samples;
				const recordSmokeProgress = smokeProgressSampler.record;

				if (settings.format === "gif" && settings.gifConfig) {
					// GIF Export
					const { GifExporter } = await import("@/lib/exporter/gifExporter");
					if (exportWasCancelled()) return;
					const gifExporter = new GifExporter({
						videoUrl: videoPath,
						width: settings.gifConfig.width,
						height: settings.gifConfig.height,
						frameRate: settings.gifConfig.frameRate,
						loop: settings.gifConfig.loop,
						sizePreset: settings.gifConfig.sizePreset,
						...buildExportRenderOptions({
							appearance,
							timeline,
							effectiveSpeedRegions,
							effectiveZoomRegions,
							effectiveCursorTelemetry,
							effectiveShowCursor,
							previewWidth,
							previewHeight,
							shadowIntensity: effectiveShadowIntensity,
							ranged,
							onProgress: (progress) => {
								if (exportWasCancelled()) return;
								recordSmokeProgress(progress);
								setExportProgress(progress);
							},
						}),
						videoPadding: padding,
						maxDecodeQueue: smokeExportConfig.maxDecodeQueue,
						maxPendingFrames: smokeExportConfig.maxPendingFrames,
					});

					exporterRef.current = gifExporter;
					const result = await gifExporter.export();
					if (exportWasCancelled()) return;

					if (result.success && result.blob) {
						const timestamp = Date.now();
						const fileName = `export-${timestamp}.gif`;
						if (options?.destination === "share") {
							const tempPath = await streamExportBlobToTempFile(result.blob, "gif");
							if (!tempPath)
								throw new Error("Could not prepare the GIF for sharing.");
							return tempPath;
						}
						markExportAsSaving();

						const { saveResult, pendingSave } = await saveExportBlob(
							result.blob,
							fileName,
							options?.outputPath ??
								(smokeExportConfig.enabled ? smokeExportConfig.outputPath : null),
						);
						if (exportWasCancelled()) {
							await discardCancelledTemp(pendingSave);
							return;
						}

						if (saveResult.canceled) {
							pendingExportSaveRef.current = pendingSave;
							setHasPendingExportSave(true);
							setExportError(
								"Save dialog canceled. Click Save Again to save without re-rendering.",
							);
							toast.info("Save canceled. You can save again without re-exporting.");
							keepExportDialogOpen = true;
						} else if (saveResult.success && saveResult.path) {
							if (smokeExportStartedAt !== null) {
								console.log(
									`[smoke-export] Completed in ${Math.round(performance.now() - smokeExportStartedAt)}ms (${saveResult.path})`,
								);
							}
							showExportSuccessToast(saveResult.path);
							setExportedFilePath(saveResult.path);
							savedPath = saveResult.path;
							if (smokeExportConfig.enabled) {
								window.close();
								return;
							}
						} else {
							toast.error(reportSaveError(saveResult, "Failed to save GIF"));
							if (options?.outputPath) await discardCancelledTemp(pendingSave);
							if (smokeExportConfig.enabled) {
								window.close();
								return;
							}
						}
					} else {
						setExportError(result.error || "GIF export failed");
						toast.error(result.error || "GIF export failed");
						if (smokeExportConfig.enabled) {
							window.close();
							return;
						}
					}
				} else {
					// MP4 Export
					const { quality, encodingMode, selectedMp4FrameRate } =
						resolveMp4ExportSettings({
							smokeExportConfig: {
								enabled: smokeExportConfig.enabled,
								quality: smokeExportConfig.quality,
								encodingMode: smokeExportConfig.encodingMode,
								fps: smokeExportConfig.fps,
							},
							settings,
							exportQuality,
							exportEncodingMode,
							mp4FrameRate,
						});
					const {
						pipelineModel,
						useExperimentalNativeExport,
						useExperimentalNvidiaCudaExport,
						backendPreference,
					} = resolveMp4ExportRouting({
						smokeExportConfig: {
							enabled: smokeExportConfig.enabled,
							pipelineModel: smokeExportConfig.pipelineModel,
							useNativeExport: smokeExportConfig.useNativeExport,
							backendPreference: smokeExportConfig.backendPreference,
						},
						settings,
						exportPipelineModel,
						exportBackendPreference,
						experimentalNvidiaCudaExport,
						nvidiaCudaExportAvailable,
					});
					const supportedSourceDimensions = await ensureSupportedMp4SourceDimensions(
						selectedMp4FrameRate,
						{
							capTo1080p: options?.destination === "share",
						},
					);
					if (exportWasCancelled()) return;
					const requestedDimensions = calculateMp4ExportDimensions(
						supportedSourceDimensions.width,
						supportedSourceDimensions.height,
						quality,
					);
					const { width: exportWidth, height: exportHeight } =
						options?.destination === "share"
							? capMp4ShareDimensions(
									requestedDimensions.width,
									requestedDimensions.height,
								)
							: requestedDimensions;
					const bitrate = getMp4ExportBitrate({
						width: exportWidth,
						height: exportHeight,
						frameRate: selectedMp4FrameRate,
						quality,
						encodingMode,
						useModernNativeStaticLayout: useExperimentalNativeExport,
					});
					const sourceAudioTrackSettingsForExport =
						selectedClipId !== null
							? audio.selectedClipSourceAudioTrackSettings
							: audio.activeSourceAudioTrackSettings;

					const exporterConfig = {
						videoUrl: videoPath,
						width: exportWidth,
						height: exportHeight,
						frameRate: selectedMp4FrameRate,
						bitrate,
						codec: DEFAULT_MP4_CODEC,
						encodingMode,
						preferredEncoderPath: supportedSourceDimensions.encoderPath,
						preferredRenderBackend: smokeExportConfig.renderBackend,
						experimentalNativeExport: useExperimentalNativeExport,
						experimentalNvidiaCudaExport: useExperimentalNvidiaCudaExport,
						maxEncodeQueue: smokeExportConfig.maxEncodeQueue,
						maxDecodeQueue: smokeExportConfig.maxDecodeQueue,
						maxPendingFrames: smokeExportConfig.maxPendingFrames,
						...buildExportRenderOptions({
							appearance,
							timeline,
							effectiveSpeedRegions,
							effectiveZoomRegions,
							effectiveCursorTelemetry,
							effectiveShowCursor,
							previewWidth,
							previewHeight,
							shadowIntensity: effectiveShadowIntensity,
							ranged,
							onProgress: (progress) => {
								if (exportWasCancelled()) return;
								recordSmokeProgress(progress);
								setExportProgress(progress);
							},
						}),
						audioRegions: exportAudioRegions,
						clipRegions: exportClipRegions,
						sourceAudioFallbackPaths: audio.sourceAudioFallbackPaths,
						sourceAudioFallbackStartDelayMsByPath:
							audio.sourceAudioFallbackStartDelayMsByPath,
						sourceAudioTrackSettings: sourceAudioTrackSettingsForExport,
					};

					const Exporter =
						pipelineModel === "modern"
							? (await import("@/lib/exporter/modernVideoExporter"))
									.ModernVideoExporter
							: (await import("@/lib/exporter/videoExporter")).VideoExporter;
					if (exportWasCancelled()) return;
					const exporter =
						pipelineModel === "modern"
							? new Exporter({ ...exporterConfig, backendPreference })
							: new Exporter(exporterConfig);

					exporterRef.current = exporter;
					const result = await exporter.export();
					if (exportWasCancelled()) return;
					const smokeExportElapsedMs =
						smokeExportStartedAt !== null
							? Math.round(performance.now() - smokeExportStartedAt)
							: undefined;

					if (result.success && (result.blob || result.tempFilePath)) {
						const timestamp = Date.now();
						const fileName = `export-${timestamp}.mp4`;
						if (options?.destination === "share") {
							if (result.tempFilePath) return result.tempFilePath;
							if (result.blob) {
								const tempPath = await streamExportBlobToTempFile(
									result.blob,
									"mp4",
								);
								if (tempPath) return tempPath;
							}
							throw new Error("Could not prepare the video for sharing.");
						}
						const sidecarForThisExport =
							settings.includeCaptionSidecar && captionSidecarPayload
								? captionSidecarPayload
								: undefined;
						markExportAsSaving();

						let saveResult: {
							success: boolean;
							path?: string;
							message?: string;
							error?: string;
							canceled?: boolean;
						};
						let pendingOnCancel: PendingExportSave;

						if (result.tempFilePath) {
							// Preferred path: main process already holds the finished MP4 on
							// disk, so we just ask it to move the temp file into place. This
							// avoids ever allocating a multi-GiB ArrayBuffer in the renderer.
							saveResult = await window.electronAPI.finalizeExportedVideo({
								tempPath: result.tempFilePath,
								fileName,
								outputPath:
									options?.outputPath ??
									(smokeExportConfig.enabled && smokeExportConfig.outputPath
										? smokeExportConfig.outputPath
										: null),
								captionSidecar: sidecarForThisExport,
							});
							if (exportWasCancelled()) {
								await discardCancelledTemp({
									fileName,
									tempFilePath: result.tempFilePath,
									captionSidecar: sidecarForThisExport,
								});
								return;
							}
							pendingOnCancel = {
								fileName,
								tempFilePath: result.tempFilePath,
								captionSidecar: sidecarForThisExport,
							};
						} else if (result.blob) {
							// Legacy fallback: some export paths still surface a Blob, but in
							// Electron we stream it into a temp file first so save/finalize
							// never requires a giant renderer ArrayBuffer.
							const blobSave = await saveExportBlob(
								result.blob,
								fileName,
								options?.outputPath ??
									(smokeExportConfig.enabled
										? smokeExportConfig.outputPath
										: null),
								sidecarForThisExport,
							);
							if (exportWasCancelled()) {
								await discardCancelledTemp(blobSave.pendingSave);
								return;
							}
							saveResult = blobSave.saveResult;
							pendingOnCancel = blobSave.pendingSave;
						} else {
							saveResult = { success: false, message: "Export produced no output" };
							pendingOnCancel = { fileName };
						}

						if (saveResult.canceled) {
							if (smokeExportConfig.enabled) {
								await writeSmokeExportReport(smokeExportConfig.outputPath, {
									success: false,
									phase: "save",
									format: "mp4",
									pipelineModel,
									backendPreference,
									encodingMode,
									shadowIntensity: effectiveShadowIntensity,
									elapsedMs: smokeExportElapsedMs,
									error: "Save canceled",
									progressSamples: smokeProgressSamples,
									metrics: result.metrics,
								});
							}
							pendingExportSaveRef.current = pendingOnCancel;
							setHasPendingExportSave(true);
							setExportError(
								"Save dialog canceled. Click Save Again to save without re-rendering.",
							);
							toast.info("Save canceled. You can save again without re-exporting.");
							keepExportDialogOpen = true;
						} else if (saveResult.success && saveResult.path) {
							if (smokeExportConfig.enabled) {
								await writeSmokeExportReport(smokeExportConfig.outputPath, {
									success: true,
									phase: "saved",
									format: "mp4",
									pipelineModel,
									backendPreference,
									encodingMode,
									shadowIntensity: effectiveShadowIntensity,
									elapsedMs: smokeExportElapsedMs,
									outputPath: saveResult.path,
									progressSamples: smokeProgressSamples,
									metrics: result.metrics,
								});
							}
							if (smokeExportStartedAt !== null) {
								console.log(
									`[smoke-export] Completed in ${Math.round(performance.now() - smokeExportStartedAt)}ms (${saveResult.path})`,
								);
							}
							showExportSuccessToast(saveResult.path);
							setExportedFilePath(saveResult.path);
							savedPath = saveResult.path;
							if (smokeExportConfig.enabled) {
								window.close();
								return;
							}
						} else {
							if (smokeExportConfig.enabled) {
								await writeSmokeExportReport(smokeExportConfig.outputPath, {
									success: false,
									phase: "save",
									format: "mp4",
									pipelineModel,
									backendPreference,
									encodingMode,
									shadowIntensity: effectiveShadowIntensity,
									elapsedMs: smokeExportElapsedMs,
									error: saveResult.message || "Failed to save video",
									progressSamples: smokeProgressSamples,
									metrics: result.metrics,
								});
							}
							showExportErrorToast(
								reportSaveError(saveResult, "Failed to save video"),
							);
							if (options?.outputPath) {
								await discardCancelledTemp(pendingOnCancel);
							} else if (
								pendingOnCancel.tempFilePath ||
								pendingOnCancel.arrayBuffer
							) {
								// Keep the pending-save entry so the user can retry without
								// re-rendering. The temp file is still on disk (the main
								// process only moves/deletes it on success) and the
								// ArrayBuffer fallback still references its in-memory blob.
								pendingExportSaveRef.current = pendingOnCancel;
								setHasPendingExportSave(true);
								keepExportDialogOpen = true;
							}
							if (smokeExportConfig.enabled) {
								window.close();
								return;
							}
						}
					} else {
						if (smokeExportConfig.enabled) {
							await writeSmokeExportReport(smokeExportConfig.outputPath, {
								success: false,
								phase: "export",
								format: "mp4",
								pipelineModel,
								backendPreference,
								encodingMode,
								shadowIntensity: effectiveShadowIntensity,
								elapsedMs: smokeExportElapsedMs,
								error: result.error || "Export failed",
								progressSamples: smokeProgressSamples,
								metrics: result.metrics,
							});
						}
						setExportError(result.error || "Export failed");
						showExportErrorToast(result.error || "Export failed");
						keepExportDialogOpen = options?.destination !== "share";
						if (smokeExportConfig.enabled) {
							window.close();
							return;
						}
					}
				}

				if (wasPlaying) {
					await videoPlaybackRef.current?.play().catch(() => undefined);
				} else {
					video.currentTime = restoreTime;
				}
				return savedPath;
			} catch (error) {
				if (exportWasCancelled()) return;
				console.error("Export error:", error);
				const errorMessage = error instanceof Error ? error.message : "Unknown error";
				if (smokeExportConfig.enabled) {
					await writeSmokeExportReport(smokeExportConfig.outputPath, {
						success: false,
						phase: "exception",
						format: settings.format,
						elapsedMs:
							smokeExportStartedAt !== null
								? Math.round(performance.now() - smokeExportStartedAt)
								: undefined,
						error: errorMessage,
					});
				}
				setExportError(errorMessage);
				showExportErrorToast(`Export failed: ${errorMessage}`);
				keepExportDialogOpen = options?.destination !== "share";
				if (smokeExportConfig.enabled) {
					window.close();
				}
			} finally {
				if (exportWasExplicitlyCancelled() && exportRunIdRef.current === exportRunId + 1) {
					video.currentTime = restoreTime;
					if (wasPlaying) {
						await videoPlaybackRef.current?.play().catch(() => undefined);
					}
				} else if (!exportWasCancelled()) {
					setIsExporting(false);
					exporterRef.current = null;
					if (options?.destination !== "share" && !options?.outputPath)
						setShowExportDropdown(keepExportDialogOpen);
					remountPreview();
				}
			}
		},
		[showExportSuccessToast],
	);

	return { handleExport, showExportSuccessToast };
}
