import type {
	Dispatch,
	MutableRefObject,
	RefObject,
	SetStateAction,
} from "react";
import { toast } from "sonner";
import type {
	ExportMp4FrameRate,
	ExportProgress,
	ExportSettings,
	SupportedMp4Dimensions,
} from "@/lib/exporter";
import {
	DEFAULT_MP4_CODEC,
	GifExporter,
	ModernVideoExporter,
	VideoExporter,
} from "@/lib/exporter";
import { extensionHost } from "@/lib/extensions";
import type { VideoPlaybackRef } from "../VideoPlayback";
import {
	calculateMp4ExportDimensions,
	getEncodingModeBitrateMultiplier,
	type SmokeExportConfig,
	summarizeErrorMessage,
	writeSmokeExportReport,
} from "../videoEditorUtils";
import {
	type CancelableExporter,
	createSmokeProgressTracker,
	type PendingExportSave,
	type RenderConfig,
	resolveWebcamUrl,
} from "./editorExportShared";

interface RunEditorExportOptions {
	settings: ExportSettings;
	videoPlaybackRef: RefObject<VideoPlaybackRef | null>;
	smokeExportConfig: SmokeExportConfig;
	getRenderConfig: () => RenderConfig;
	ensureSupportedMp4SourceDimensions: (
		frameRate: ExportMp4FrameRate,
	) => Promise<SupportedMp4Dimensions>;
	remountPreview: () => void;
	clearPendingExportSave: () => void;
	setPendingExportSave: (pendingSave: PendingExportSave) => void;
	markExportAsSaving: () => void;
	showExportSuccessToast: (filePath: string) => void;
	setIsExporting: Dispatch<SetStateAction<boolean>>;
	setExportProgress: Dispatch<SetStateAction<ExportProgress | null>>;
	setExportError: Dispatch<SetStateAction<string | null>>;
	setShowExportDropdown: Dispatch<SetStateAction<boolean>>;
	setExportedFilePath: Dispatch<SetStateAction<string | undefined>>;
	exporterRef: MutableRefObject<CancelableExporter | null>;
}

export async function runEditorExport({
	settings,
	videoPlaybackRef,
	smokeExportConfig,
	getRenderConfig,
	ensureSupportedMp4SourceDimensions,
	remountPreview,
	clearPendingExportSave,
	setPendingExportSave,
	markExportAsSaving,
	showExportSuccessToast,
	setIsExporting,
	setExportProgress,
	setExportError,
	setShowExportDropdown,
	setExportedFilePath,
	exporterRef,
}: RunEditorExportOptions): Promise<void> {
	const config = getRenderConfig();
	if (!config.videoPath) {
		toast.error("No video loaded");
		return;
	}

	const video = videoPlaybackRef.current?.video;
	if (!video) {
		toast.error("Video not ready");
		return;
	}

	setIsExporting(true);
	setExportProgress(null);
	setExportError(null);
	clearPendingExportSave();
	extensionHost.emitEvent({ type: "export:start" });

	const smokeExportStartedAt = smokeExportConfig.enabled ? performance.now() : null;
	const smokeTracker = createSmokeProgressTracker(
		smokeExportConfig,
		smokeExportStartedAt,
		setExportProgress,
	);
	let keepExportDialogOpen = false;

	try {
		const wasPlaying = config.isPlaying;
		const restoreTime = video.currentTime;
		if (wasPlaying) {
			videoPlaybackRef.current?.pause();
		}

		const containerElement = videoPlaybackRef.current?.containerRef?.current;
		const previewWidth = containerElement?.clientWidth || 1920;
		const previewHeight = containerElement?.clientHeight || 1080;
		const effectiveShadowIntensity =
			smokeExportConfig.enabled && smokeExportConfig.shadowIntensity !== undefined
				? smokeExportConfig.shadowIntensity
				: config.shadowIntensity;

		if (settings.format === "gif" && settings.gifConfig) {
			const gifExporter = new GifExporter({
				videoUrl: config.videoPath,
				width: settings.gifConfig.width,
				height: settings.gifConfig.height,
				frameRate: settings.gifConfig.frameRate,
				loop: settings.gifConfig.loop,
				sizePreset: settings.gifConfig.sizePreset,
				wallpaper: config.wallpaper,
				trimRegions: config.trimRegions,
				speedRegions: config.effectiveSpeedRegions,
				showShadow: effectiveShadowIntensity > 0,
				shadowIntensity: effectiveShadowIntensity,
				backgroundBlur: config.backgroundBlur,
				zoomMotionBlur: config.zoomMotionBlur,
				connectZooms: config.connectZooms,
				zoomInDurationMs: config.zoomInDurationMs,
				zoomInOverlapMs: config.zoomInOverlapMs,
				zoomOutDurationMs: config.zoomOutDurationMs,
				connectedZoomGapMs: config.connectedZoomGapMs,
				connectedZoomDurationMs: config.connectedZoomDurationMs,
				zoomInEasing: config.zoomInEasing,
				zoomOutEasing: config.zoomOutEasing,
				connectedZoomEasing: config.connectedZoomEasing,
				borderRadius: config.borderRadius,
				padding: config.padding,
				videoPadding: config.padding,
				cropRegion: config.cropRegion,
				webcam: config.webcam,
				webcamUrl: resolveWebcamUrl(config),
				annotationRegions: config.annotationRegions,
				autoCaptions: config.autoCaptions,
				autoCaptionSettings: config.autoCaptionSettings,
				zoomRegions: config.effectiveZoomRegions,
				cursorTelemetry: config.effectiveCursorTelemetry,
				showCursor: config.showCursor,
				cursorStyle: config.cursorStyle,
				cursorSize: config.cursorSize,
				cursorSmoothing: config.cursorSmoothing,
				zoomSmoothness: config.zoomSmoothness,
				zoomClassicMode: config.zoomClassicMode,
				cursorMotionBlur: config.cursorMotionBlur,
				cursorClickBounce: config.cursorClickBounce,
				cursorClickBounceDuration: config.cursorClickBounceDuration,
				cursorSway: config.cursorSway,
				frame: config.frame,
				previewWidth,
				previewHeight,
				maxDecodeQueue: smokeExportConfig.maxDecodeQueue,
				maxPendingFrames: smokeExportConfig.maxPendingFrames,
				onProgress: (progress: ExportProgress) => smokeTracker.record(progress),
			});
			exporterRef.current = gifExporter as unknown as CancelableExporter;
			const result = await gifExporter.export();

			if (result.success && result.blob) {
				const arrayBuffer = await result.blob.arrayBuffer();
				const fileName = `export-${Date.now()}.gif`;
				markExportAsSaving();
				const saveResult =
					smokeExportConfig.enabled && smokeExportConfig.outputPath
						? await window.electronAPI.writeExportedVideoToPath(
								arrayBuffer,
								smokeExportConfig.outputPath,
							)
						: await window.electronAPI.saveExportedVideo(arrayBuffer, fileName);

				if (saveResult.canceled) {
					setPendingExportSave({ arrayBuffer, fileName });
					setExportError(
						"Save dialog canceled. Click Save Again to save without re-rendering.",
					);
					toast.info("Save canceled. You can save again without re-exporting.");
					keepExportDialogOpen = true;
				} else if (saveResult.success && saveResult.path) {
					if (smokeExportStartedAt !== null) {
						console.log(
							`[smoke-export] Completed in ${Math.round(performance.now() - smokeExportStartedAt)}ms`,
						);
					}
					showExportSuccessToast(saveResult.path);
					setExportedFilePath(saveResult.path);
					if (smokeExportConfig.enabled) {
						window.close();
						return;
					}
				} else {
					setExportError(saveResult.message || "Failed to save GIF");
					toast.error(saveResult.message || "Failed to save GIF");
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
			const quality = settings.quality ?? config.exportQuality;
			const encodingMode = smokeExportConfig.enabled
				? (smokeExportConfig.encodingMode ?? settings.encodingMode ?? config.exportEncodingMode)
				: (settings.encodingMode ?? config.exportEncodingMode);
			const selectedMp4FrameRate = settings.mp4FrameRate ?? config.mp4FrameRate;
			const pipelineModel = smokeExportConfig.enabled
				? (smokeExportConfig.pipelineModel ??
					(smokeExportConfig.useNativeExport ? "modern" : "legacy"))
				: (settings.pipelineModel ?? config.exportPipelineModel);
			const backendPreference =
				pipelineModel === "legacy"
					? "webcodecs"
					: smokeExportConfig.enabled
						? (smokeExportConfig.backendPreference ??
							(smokeExportConfig.useNativeExport ? "breeze" : "webcodecs"))
						: (settings.backendPreference ?? config.exportBackendPreference);

			const supportedSourceDimensions =
				await ensureSupportedMp4SourceDimensions(selectedMp4FrameRate);
			const { width: exportWidth, height: exportHeight } = calculateMp4ExportDimensions(
				supportedSourceDimensions.width,
				supportedSourceDimensions.height,
				quality,
			);

			let bitrate: number;
			if (quality === "source") {
				const totalPixels = exportWidth * exportHeight;
				bitrate =
					totalPixels > 2560 * 1440
						? 80_000_000
						: totalPixels > 1920 * 1080
							? 50_000_000
							: 30_000_000;
			} else {
				const totalPixels = exportWidth * exportHeight;
				bitrate =
					totalPixels <= 1280 * 720
						? 10_000_000
						: totalPixels <= 1920 * 1080
							? 20_000_000
							: 30_000_000;
			}
			bitrate = Math.max(
				2_000_000,
				Math.round(bitrate * getEncodingModeBitrateMultiplier(encodingMode)),
			);

			const exporterConfig = {
				videoUrl: config.videoPath,
				width: exportWidth,
				height: exportHeight,
				frameRate: selectedMp4FrameRate,
				bitrate,
				codec: DEFAULT_MP4_CODEC,
				encodingMode,
				preferredEncoderPath: supportedSourceDimensions.encoderPath,
				experimentalNativeExport: smokeExportConfig.useNativeExport,
				maxEncodeQueue: smokeExportConfig.maxEncodeQueue,
				maxDecodeQueue: smokeExportConfig.maxDecodeQueue,
				maxPendingFrames: smokeExportConfig.maxPendingFrames,
				wallpaper: config.wallpaper,
				trimRegions: config.trimRegions,
				speedRegions: config.effectiveSpeedRegions,
				showShadow: effectiveShadowIntensity > 0,
				shadowIntensity: effectiveShadowIntensity,
				backgroundBlur: config.backgroundBlur,
				zoomMotionBlur: config.zoomMotionBlur,
				connectZooms: config.connectZooms,
				zoomInDurationMs: config.zoomInDurationMs,
				zoomInOverlapMs: config.zoomInOverlapMs,
				zoomOutDurationMs: config.zoomOutDurationMs,
				connectedZoomGapMs: config.connectedZoomGapMs,
				connectedZoomDurationMs: config.connectedZoomDurationMs,
				zoomInEasing: config.zoomInEasing,
				zoomOutEasing: config.zoomOutEasing,
				connectedZoomEasing: config.connectedZoomEasing,
				borderRadius: config.borderRadius,
				padding: config.padding,
				cropRegion: config.cropRegion,
				webcam: config.webcam,
				webcamUrl: resolveWebcamUrl(config),
				annotationRegions: config.annotationRegions,
				autoCaptions: config.autoCaptions,
				autoCaptionSettings: config.autoCaptionSettings,
				zoomRegions: config.effectiveZoomRegions,
				cursorTelemetry: config.effectiveCursorTelemetry,
				showCursor: config.showCursor,
				cursorStyle: config.cursorStyle,
				cursorSize: config.cursorSize,
				cursorSmoothing: config.cursorSmoothing,
				zoomSmoothness: config.zoomSmoothness,
				zoomClassicMode: config.zoomClassicMode,
				cursorMotionBlur: config.cursorMotionBlur,
				cursorClickBounce: config.cursorClickBounce,
				cursorClickBounceDuration: config.cursorClickBounceDuration,
				cursorSway: config.cursorSway,
				frame: config.frame,
				audioRegions: config.audioRegions,
				sourceAudioFallbackPaths: config.sourceAudioFallbackPaths,
				previewWidth,
				previewHeight,
				onProgress: (progress: ExportProgress) => smokeTracker.record(progress),
			};

			const exporter =
				pipelineModel === "modern"
					? new ModernVideoExporter({ ...exporterConfig, backendPreference })
					: new VideoExporter(exporterConfig);
			exporterRef.current = exporter;
			const result = await exporter.export();
			const smokeElapsedMs =
				smokeExportStartedAt !== null
					? Math.round(performance.now() - smokeExportStartedAt)
					: undefined;

			if (result.success && result.blob) {
				const arrayBuffer = await result.blob.arrayBuffer();
				const fileName = `export-${Date.now()}.mp4`;
				markExportAsSaving();
				const saveResult =
					smokeExportConfig.enabled && smokeExportConfig.outputPath
						? await window.electronAPI.writeExportedVideoToPath(
								arrayBuffer,
								smokeExportConfig.outputPath,
							)
						: await window.electronAPI.saveExportedVideo(arrayBuffer, fileName);

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
							elapsedMs: smokeElapsedMs,
							error: "Save canceled",
							progressSamples: smokeTracker.progressSamples,
							metrics: result.metrics,
						});
					}
					setPendingExportSave({ arrayBuffer, fileName });
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
							elapsedMs: smokeElapsedMs,
							outputPath: saveResult.path,
							progressSamples: smokeTracker.progressSamples,
							metrics: result.metrics,
						});
					}
					if (smokeExportStartedAt !== null) {
						console.log(
							`[smoke-export] Completed in ${Math.round(performance.now() - smokeExportStartedAt)}ms`,
						);
					}
					showExportSuccessToast(saveResult.path);
					setExportedFilePath(saveResult.path);
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
							elapsedMs: smokeElapsedMs,
							error: saveResult.message || "Failed to save video",
							progressSamples: smokeTracker.progressSamples,
							metrics: result.metrics,
						});
					}
					setExportError(saveResult.message || "Failed to save video");
					toast.error(saveResult.message || "Failed to save video");
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
						elapsedMs: smokeElapsedMs,
						error: result.error || "Export failed",
						progressSamples: smokeTracker.progressSamples,
						metrics: result.metrics,
					});
				}
				setExportError(result.error || "Export failed");
				toast.error(summarizeErrorMessage(result.error || "Export failed"));
				if (smokeExportConfig.enabled) {
					window.close();
					return;
				}
			}
		}

		if (wasPlaying) {
			videoPlaybackRef.current?.play();
		} else {
			video.currentTime = restoreTime;
		}
	} catch (error) {
		console.error("Export error:", error);
		const errorMessage = error instanceof Error ? error.message : "Unknown error";
		if (smokeExportConfig.enabled) {
			await writeSmokeExportReport(smokeExportConfig.outputPath, {
				success: false,
				phase: "exception",
				format: settings.format,
				elapsedMs:
					smokeExportConfig.enabled && performance
						? Math.round(
								performance.now() - (smokeExportStartedAt ?? performance.now()),
							)
						: undefined,
				error: errorMessage,
			});
			window.close();
		}
		setExportError(errorMessage);
		toast.error(`Export failed: ${summarizeErrorMessage(errorMessage)}`);
	} finally {
		extensionHost.emitEvent({ type: "export:complete" });
		setIsExporting(false);
		exporterRef.current = null;
		setShowExportDropdown(keepExportDialogOpen);
		remountPreview();
	}
}