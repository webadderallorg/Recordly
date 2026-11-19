import fs from "node:fs/promises";
import path from "node:path";
import { app } from "electron";
import { getFfprobeBinaryPath } from "../../ffmpeg/binary";
import {
	buildNativeStaticLayoutChunks,
	type NativeStaticLayoutExportArgsConfig,
} from "../../nativeVideoExport";
import { muxNativeVideoExportAudio } from "./audio";
import { tryNativeStaticGpuExport } from "./gpuAttempt";
import {
	hasNativeStaticLayoutSourceCrop,
	hasNativeStaticLayoutTimeline,
	normalizeNativeStaticLayoutBackground,
	shouldUsePrecompositedStaticLayout,
} from "./layout";
import { validateNativeVideoOutputFile } from "./probe";
import { nativeStaticLayoutExportSessions } from "./sessions";
import { prepareNativeStaticLayoutSourceInput } from "./sourceProxy";
import { renderNativeStaticFfmpeg } from "./staticFfmpeg";
import { removeTemporaryExportFile } from "./stream";
import { prepareNativeStaticLayoutTimelineMap } from "./timeline";
import {
	type NativeStaticLayoutExportMetrics,
	type NativeStaticLayoutExportOptions,
	type NativeStaticLayoutExportProgress,
	type NativeStaticLayoutExportSession,
} from "./types";

export async function exportNativeStaticLayoutVideo(
	ffmpegPath: string,
	options: NativeStaticLayoutExportOptions,
	onProgress?: (progress: NativeStaticLayoutExportProgress) => void,
	onOutputFile?: (filePath: string) => void,
) {
	if (options.width % 2 !== 0 || options.height % 2 !== 0) {
		throw new Error("Native static layout export requires even output dimensions");
	}
	if (!Number.isFinite(options.durationSec) || options.durationSec <= 0) {
		throw new Error("Native static layout export requires a positive duration");
	}
	const sessionId =
		options.sessionId ??
		`recordly-static-layout-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
	if (typeof sessionId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(sessionId)) {
		throw new Error("Native static layout export requires a safe session ID");
	}
	options = await normalizeNativeStaticLayoutBackground(options);
	if (
		options.webcamInputPath &&
		!(options.experimentalWindowsGpuCompositor && process.platform === "win32")
	) {
		throw new Error("Native webcam overlay requires the Windows GPU compositor");
	}
	if (
		options.zoomTelemetry?.length &&
		!(options.experimentalWindowsGpuCompositor && process.platform === "win32")
	) {
		throw new Error("Native zoom telemetry requires the Windows GPU compositor");
	}
	if (
		options.cursorTelemetry?.length &&
		!(options.experimentalWindowsGpuCompositor && process.platform === "win32")
	) {
		throw new Error("Native cursor telemetry requires the Windows GPU compositor");
	}

	const chunkDurationSec = Math.max(1, Math.min(300, options.chunkDurationSec ?? 120));
	const chunks = buildNativeStaticLayoutChunks(options.durationSec, chunkDurationSec);
	if (chunks.length === 0) {
		throw new Error("Native static layout export produced no chunks");
	}

	const session: NativeStaticLayoutExportSession = {
		terminating: false,
		currentProcess: null,
	};
	const chunkDirectory = path.join(app.getPath("temp"), sessionId);
	const concatListPath = path.join(chunkDirectory, "chunks.txt");
	const videoOnlyPath = path.join(app.getPath("temp"), `${sessionId}.mp4`);
	onOutputFile?.(videoOnlyPath);
	const ffprobePath = getFfprobeBinaryPath();
	let outputPathToKeep: string | null = null;
	let videoOutputValidated = false;
	const metrics: NativeStaticLayoutExportMetrics = {
		chunkCount: chunks.length,
		chunkDurationSec,
		chunkExecMs: 0,
		fallbackChunkCount: 0,
		chunks: [],
	};
	const validateRenderedVideoOutput = async () => {
		await validateNativeVideoOutputFile(ffprobePath, videoOnlyPath, {
			durationSec: options.durationSec,
			targetFrames: Math.ceil(options.durationSec * options.frameRate),
		});
		videoOutputValidated = true;
	};

	try {
		nativeStaticLayoutExportSessions.set(sessionId, session);
		await fs.mkdir(chunkDirectory, { recursive: true });
		const sourceInput = await prepareNativeStaticLayoutSourceInput(
			ffmpegPath,
			options,
			path.join(chunkDirectory, "source-proxy.mp4"),
			session,
		);
		if (sourceInput.elapsedMs > 0) {
			metrics.staticAssetExecMs = (metrics.staticAssetExecMs ?? 0) + sourceInput.elapsedMs;
		}
		if (sourceInput.inputPath !== options.inputPath) {
			console.info("[native-static-layout-export] Prepared H.264 source proxy", {
				sourceCodec: sourceInput.sourceCodec,
				proxyCodec: sourceInput.proxyCodec,
				elapsedMs: sourceInput.elapsedMs,
			});
			options = {
				...options,
				inputPath: sourceInput.inputPath,
			};
		}
		const timelineMapPath = await prepareNativeStaticLayoutTimelineMap(
			options,
			path.join(chunkDirectory, "timeline-map.csv"),
		);
		if (timelineMapPath) {
			if (!(options.experimentalWindowsGpuCompositor && process.platform === "win32")) {
				throw new Error("Native timeline-map export requires the Windows GPU compositor");
			}
			options = {
				...options,
				timelineMapPath,
			};
		}
		const fullConfig: NativeStaticLayoutExportArgsConfig = {
			inputPath: options.inputPath,
			outputPath: videoOnlyPath,
			width: options.width,
			height: options.height,
			frameRate: options.frameRate,
			bitrate: options.bitrate,
			encodingMode: options.encodingMode,
			contentWidth: options.contentWidth,
			contentHeight: options.contentHeight,
			offsetX: options.offsetX,
			offsetY: options.offsetY,
			sourceCropX: options.sourceCropX,
			sourceCropY: options.sourceCropY,
			sourceCropWidth: options.sourceCropWidth,
			sourceCropHeight: options.sourceCropHeight,
			backgroundColor: options.backgroundColor,
			backgroundImagePath: options.backgroundImagePath,
			backgroundBlurPx: options.backgroundBlurPx,
			borderRadius: options.borderRadius,
			shadowIntensity: options.shadowIntensity,
			durationSec: options.durationSec,
		};
		const usePrecompositedLayout = shouldUsePrecompositedStaticLayout(options);

		const { didRenderVideo, didMuxAudioInline } = await tryNativeStaticGpuExport({
			ffmpegPath,
			options,
			session,
			chunkDirectory,
			videoOnlyPath,
			metrics,
			onProgress,
			validateRenderedVideoOutput,
		});

		if (!didRenderVideo && hasNativeStaticLayoutTimeline(options)) {
			throw new Error("Native timeline-map export requires a GPU compositor backend");
		}
		if (!didRenderVideo && hasNativeStaticLayoutSourceCrop(options)) {
			throw new Error("Native crop export requires a GPU compositor backend");
		}

		if (!didRenderVideo) {
			await renderNativeStaticFfmpeg({
				ffmpegPath,
				options,
				session,
				chunkDirectory,
				videoOnlyPath,
				concatListPath,
				metrics,
				fullConfig,
				chunks,
				usePrecompositedLayout,
			});
		}

		const videoOnlyStat = await fs.stat(videoOnlyPath);
		metrics.videoOnlyBytes = videoOnlyStat.size;
		if (!videoOutputValidated) {
			await validateRenderedVideoOutput();
		}
		if (didMuxAudioInline) {
			outputPathToKeep = videoOnlyPath;
			return {
				outputPath: videoOnlyPath,
				metrics,
			};
		}
		const audioMuxProgressStart = 97.25;
		const audioMuxProgressEnd = 99;
		const progressTotalFrames = Math.max(1, Math.ceil(options.durationSec * options.frameRate));
		const finalized = await muxNativeVideoExportAudio(
			videoOnlyPath,
			options.audioOptions ?? {},
			(progress) => {
				const ratio = Math.max(0, Math.min(1, progress.ratio));
				const percentage =
					audioMuxProgressStart + (audioMuxProgressEnd - audioMuxProgressStart) * ratio;
				const progressPayload: NativeStaticLayoutExportProgress = {
					sessionId,
					stage: "finalizing",
					currentFrame: progressTotalFrames,
					totalFrames: progressTotalFrames,
					percentage,
				};
				const backend = metrics.chunks[0]?.backend;
				if (backend) {
					progressPayload.backend = backend;
				}
				onProgress?.(progressPayload);
			},
			session,
		);
		Object.assign(metrics, finalized.metrics);
		outputPathToKeep = finalized.outputPath;
		return {
			outputPath: finalized.outputPath,
			metrics,
		};
	} catch (error) {
		await removeTemporaryExportFile(videoOnlyPath);
		throw error;
	} finally {
		nativeStaticLayoutExportSessions.delete(sessionId);
		await fs.rm(chunkDirectory, { force: true, recursive: true }).catch(() => undefined);
		if (outputPathToKeep !== videoOnlyPath) {
			await removeTemporaryExportFile(videoOnlyPath);
		}
	}
}
