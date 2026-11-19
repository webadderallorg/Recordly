import fs from "node:fs/promises";
import path from "node:path";
import {
	getExperimentalNvidiaCudaExportSkipReason,
	isExplicitNvidiaCudaExportEnabled,
	isNvidiaCudaForceVideoOnlyEnabled,
	isValidatedNvidiaCudaFallbackCandidate,
} from "./capabilities";
import { NVIDIA_CUDA_ALLOW_AUDIO_EXPORT_ENV } from "./constants";
import { canMuxNvidiaCudaSourceAudioInline } from "./gpuArgs";
import {
	runExperimentalNvidiaCudaStaticLayoutExport,
	runExperimentalWindowsGpuStaticLayoutExport,
} from "./gpuProcess";
import { hasNativeStaticLayoutTimeline } from "./layout";
import { prepareWindowsGpuWebcamInput } from "./sourceProxy";
import { removeTemporaryExportFile } from "./stream";
import {
	prepareNvidiaCudaCursorAtlas,
	prepareNvidiaCudaCursorTelemetry,
	prepareWindowsGpuCursorAtlas,
	prepareWindowsGpuCursorTelemetry,
	prepareWindowsGpuZoomTelemetry,
} from "./telemetry";
import {
	type NativeStaticLayoutExportMetrics,
	type NativeStaticLayoutExportOptions,
	type NativeStaticLayoutExportProgress,
	type NativeStaticLayoutExportSession,
} from "./types";
import { validateNvidiaCudaExportSummary, validateWindowsGpuExportSummary } from "./validation";

export interface NativeStaticGpuAttemptOptions {
	ffmpegPath: string;
	options: NativeStaticLayoutExportOptions;
	session: NativeStaticLayoutExportSession;
	chunkDirectory: string;
	videoOnlyPath: string;
	metrics: NativeStaticLayoutExportMetrics;
	onProgress?: (progress: NativeStaticLayoutExportProgress) => void;
	validateRenderedVideoOutput: () => Promise<void>;
}

export async function tryNativeStaticGpuExport({
	ffmpegPath,
	options,
	session,
	chunkDirectory,
	videoOnlyPath,
	metrics,
	onProgress,
	validateRenderedVideoOutput,
}: NativeStaticGpuAttemptOptions) {
	let didRenderVideo = false;
	let didMuxAudioInline = false;
	if (options.experimentalWindowsGpuCompositor && process.platform === "win32") {
		try {
			if (session.terminating) {
				throw new Error("Native static layout export was cancelled");
			}
			let experimentalGpuOptions = options;
			if (options.webcamInputPath) {
				const webcamProxyPath = path.join(chunkDirectory, "webcam-proxy.mp4");
				const webcamInput = await prepareWindowsGpuWebcamInput(
					ffmpegPath,
					options,
					webcamProxyPath,
					session,
				);
				if (webcamInput.elapsedMs > 0) {
					metrics.staticAssetExecMs =
						(metrics.staticAssetExecMs ?? 0) + webcamInput.elapsedMs;
				}
				if (webcamInput.inputPath && webcamInput.inputPath !== options.webcamInputPath) {
					experimentalGpuOptions = {
						...options,
						webcamInputPath: webcamInput.inputPath,
					};
				}
			}
			if (options.cursorTelemetry?.length) {
				const cursorTelemetryPath = await prepareWindowsGpuCursorTelemetry(
					options,
					path.join(chunkDirectory, "cursor-telemetry.csv"),
				);
				if (cursorTelemetryPath) {
					experimentalGpuOptions = {
						...experimentalGpuOptions,
						cursorTelemetryPath,
					};
				}
				const cursorAtlas = await prepareWindowsGpuCursorAtlas(
					options,
					path.join(chunkDirectory, "cursor-atlas.png"),
					path.join(chunkDirectory, "cursor-atlas.csv"),
				);
				if (cursorAtlas) {
					experimentalGpuOptions = {
						...experimentalGpuOptions,
						cursorAtlasPath: cursorAtlas.atlasPath,
						cursorAtlasMetadataPath: cursorAtlas.metadataPath,
					};
				}
			}
			if (options.zoomTelemetry?.length) {
				const zoomTelemetryPath = await prepareWindowsGpuZoomTelemetry(
					options,
					path.join(chunkDirectory, "zoom-telemetry.csv"),
				);
				if (zoomTelemetryPath) {
					experimentalGpuOptions = {
						...experimentalGpuOptions,
						zoomTelemetryPath,
					};
				}
			}
			let experimentalNvidiaCudaOptions = experimentalGpuOptions;
			const nvidiaCudaSkipReason = await getExperimentalNvidiaCudaExportSkipReason(options);
			let shouldTryNvidiaCuda = nvidiaCudaSkipReason === null;
			const validatedCudaFallbackCandidate = isValidatedNvidiaCudaFallbackCandidate(options);
			if (
				shouldTryNvidiaCuda &&
				(validatedCudaFallbackCandidate || isNvidiaCudaForceVideoOnlyEnabled()) &&
				(experimentalNvidiaCudaOptions.audioOptions?.audioMode ?? "none") !== "none"
			) {
				experimentalNvidiaCudaOptions = {
					...experimentalNvidiaCudaOptions,
					nvidiaCudaForceVideoOnly: true,
				};
				console.info(
					"[native-static-layout-export] NVIDIA CUDA candidate will use shared audio mux validation",
					{
						audioMode: experimentalNvidiaCudaOptions.audioOptions?.audioMode ?? "none",
						forcedByEnv: isNvidiaCudaForceVideoOnlyEnabled(),
						userOptIn: options.experimentalNvidiaCudaExport === true,
					},
				);
			}
			const shouldLogNvidiaCudaSkip =
				isExplicitNvidiaCudaExportEnabled() ||
				(options.experimentalNvidiaCudaExport === true &&
					nvidiaCudaSkipReason !== "env-disabled");
			if (
				!shouldTryNvidiaCuda &&
				shouldLogNvidiaCudaSkip &&
				nvidiaCudaSkipReason !== "env-disabled"
			) {
				console.warn(
					"[native-static-layout-export] Skipping NVIDIA CUDA compositor; falling back to Windows GPU compositor",
					{
						reason: nvidiaCudaSkipReason,
						audioMode: options.audioOptions?.audioMode ?? "none",
						overrideEnv: NVIDIA_CUDA_ALLOW_AUDIO_EXPORT_ENV,
						userOptIn: options.experimentalNvidiaCudaExport === true,
					},
				);
			}
			if (shouldTryNvidiaCuda && options.cursorTelemetry?.length) {
				const cursorTelemetryPath = await prepareNvidiaCudaCursorTelemetry(
					options,
					path.join(chunkDirectory, "cursor-telemetry.json"),
				);
				const cursorAtlas = await prepareNvidiaCudaCursorAtlas(
					options,
					path.join(chunkDirectory, "cursor-atlas-nvidia.png"),
					path.join(chunkDirectory, "cursor-atlas-nvidia.tsv"),
				);
				shouldTryNvidiaCuda = Boolean(cursorTelemetryPath && cursorAtlas);
				if (cursorTelemetryPath && cursorAtlas) {
					experimentalNvidiaCudaOptions = {
						...experimentalNvidiaCudaOptions,
						cursorTelemetryPath,
						cursorAtlasPath: cursorAtlas.atlasPath,
						cursorAtlasMetadataPath: cursorAtlas.metadataPath,
					};
				}
			}

			if (shouldTryNvidiaCuda) {
				try {
					const shouldMuxAudioInline = canMuxNvidiaCudaSourceAudioInline(
						experimentalNvidiaCudaOptions,
					);
					const cudaResult = await runExperimentalNvidiaCudaStaticLayoutExport(
						ffmpegPath,
						experimentalNvidiaCudaOptions,
						videoOnlyPath,
						chunkDirectory,
						session,
						onProgress,
					);
					const cudaValidationIssues = validateNvidiaCudaExportSummary(
						cudaResult.summary,
						{
							durationSec: options.durationSec,
							targetFrames: Math.ceil(options.durationSec * options.frameRate),
							requiresTimelineSync: shouldMuxAudioInline,
						},
					);
					if (cudaValidationIssues.length > 0) {
						throw new Error(
							`Experimental NVIDIA CUDA compositor produced an invalid output: ${cudaValidationIssues.join("; ")}`,
						);
					}
					const outputStat = await fs.stat(videoOnlyPath);
					if (outputStat.size <= 0) {
						throw new Error(
							"Experimental NVIDIA CUDA compositor produced an empty output file",
						);
					}
					await validateRenderedVideoOutput();
					console.info("[native-static-layout-export] NVIDIA CUDA compositor completed", {
						elapsedMs: cudaResult.elapsedMs,
						fps: cudaResult.summary.fps,
						targetFrames: cudaResult.summary.targetFrames,
						durationSec: cudaResult.summary.durationSec,
						nativeEncodeMs: cudaResult.summary.timingsMs?.nativeEncode,
						muxMs: cudaResult.summary.timingsMs?.mux,
						endToEndMs: cudaResult.summary.timingsMs?.endToEnd,
						nativeFps:
							cudaResult.summary.nativeSummary?.measuredFps ??
							cudaResult.summary.nativeSummary?.fps,
						mappedDisplayFrames: cudaResult.summary.nativeSummary?.mappedDisplayFrames,
						selectedDisplayFrames:
							cudaResult.summary.nativeSummary?.selectedDisplayFrames,
						skippedDisplayFrames:
							cudaResult.summary.nativeSummary?.skippedDisplayFrames,
						roiCompositeFrames: cudaResult.summary.nativeSummary?.roiCompositeFrames,
						monolithicCompositeFrames:
							cudaResult.summary.nativeSummary?.monolithicCompositeFrames,
						copyCompositeFrames: cudaResult.summary.nativeSummary?.copyCompositeFrames,
						webcamOverlay: cudaResult.summary.nativeSummary?.webcamOverlay,
						cursorAtlas: cudaResult.summary.nativeSummary?.cursorAtlas,
						zoomOverlay: cudaResult.summary.nativeSummary?.zoomOverlay,
						zoomSamples: cudaResult.summary.nativeSummary?.zoomSamples,
					});
					metrics.chunkCount = 1;
					metrics.chunkDurationSec = options.durationSec;
					metrics.chunkExecMs += cudaResult.elapsedMs;
					metrics.chunks.push({
						index: 0,
						startSec: 0,
						durationSec: options.durationSec,
						backend: "nvidia-cuda-compositor",
						elapsedMs: cudaResult.elapsedMs,
						outputBytes: outputStat.size,
						nvidiaCudaSummary: cudaResult.summary,
					});
					didRenderVideo = true;
					didMuxAudioInline = shouldMuxAudioInline;
				} catch (error) {
					if (session.terminating) {
						throw error;
					}
					metrics.fallbackChunkCount++;
					console.warn(
						"[native-static-layout-export] Experimental NVIDIA CUDA compositor failed or produced invalid output; falling back to Windows GPU compositor:",
						error,
					);
					await removeTemporaryExportFile(videoOnlyPath);
				}
			}

			if (!didRenderVideo) {
				const gpuResult = await runExperimentalWindowsGpuStaticLayoutExport(
					experimentalGpuOptions,
					videoOnlyPath,
					session,
					onProgress,
				);
				const gpuValidationIssues = validateWindowsGpuExportSummary(gpuResult.summary, {
					durationSec: options.durationSec,
					targetFrames: Math.ceil(options.durationSec * options.frameRate),
				});
				if (gpuValidationIssues.length > 0) {
					throw new Error(
						`Experimental Windows GPU compositor produced an invalid output: ${gpuValidationIssues.join("; ")}`,
					);
				}
				await validateRenderedVideoOutput();
				console.info("[native-static-layout-export] Windows GPU compositor completed", {
					elapsedMs: gpuResult.elapsedMs,
					width: gpuResult.summary.width,
					height: gpuResult.summary.height,
					fps: gpuResult.summary.fps,
					frames: gpuResult.summary.frames,
					realtimeMultiplier: gpuResult.summary.realtimeMultiplier,
					surfacePoolSize: gpuResult.summary.surfacePoolSize,
					gpuDecodeSurface: gpuResult.summary.gpuDecodeSurface,
					adapterIndex: gpuResult.summary.adapterIndex,
					encoderBackend: gpuResult.summary.encoderBackend,
					encoderTuningApplied: gpuResult.summary.encoderTuningApplied,
					readMs: gpuResult.summary.readMs,
					videoProcessMs: gpuResult.summary.videoProcessMs,
					writeSampleMs: gpuResult.summary.writeSampleMs,
					finalizeMs: gpuResult.summary.finalizeMs,
					webcamOverlay: gpuResult.summary.webcamOverlay,
					cursorOverlay: gpuResult.summary.cursorOverlay,
					cursorAtlas: gpuResult.summary.cursorAtlas,
					zoomOverlay: gpuResult.summary.zoomOverlay,
				});
				const outputStat = await fs.stat(videoOnlyPath);
				metrics.chunkCount = 1;
				metrics.chunkDurationSec = options.durationSec;
				metrics.chunkExecMs += gpuResult.elapsedMs;
				metrics.chunks.push({
					index: 0,
					startSec: 0,
					durationSec: options.durationSec,
					backend: "windows-d3d11-compositor",
					elapsedMs: gpuResult.elapsedMs,
					outputBytes: outputStat.size,
					windowsGpuSummary: gpuResult.summary,
				});
				didRenderVideo = true;
			}
		} catch (error) {
			if (session.terminating) {
				throw error;
			}
			if (hasNativeStaticLayoutTimeline(options)) {
				throw error;
			}
			metrics.fallbackChunkCount++;
			console.warn(
				"[native-static-layout-export] Experimental Windows GPU compositor unavailable; falling back to FFmpeg static layout:",
				error,
			);
			await removeTemporaryExportFile(videoOnlyPath);
			if (
				options.webcamInputPath ||
				options.zoomTelemetry?.length ||
				options.cursorTelemetry?.length
			) {
				throw error;
			}
		}
	}
	return { didRenderVideo, didMuxAudioInline };
}
