import fs from "node:fs/promises";
import path from "node:path";
import {
	buildNativeConcatArgs,
	buildNativeCudaOverlayStaticLayoutArgs,
	buildNativeCudaScaleCpuPadStaticLayoutArgs,
	buildNativePrecompositedStaticLayoutArgs,
	buildNativeStaticBackgroundRenderArgs,
	buildNativeStaticLayoutChunks,
	createNativeSquircleMaskPgmBuffer,
	isNativeCudaOutOfMemory,
	type NativeStaticLayoutBackend,
	type NativeStaticLayoutExportArgsConfig,
} from "../../nativeVideoExport";
import { getNowMs } from "./constants";
import {
	getFfmpegFailureMessage,
	getStaticLayoutChunkOutputPath,
	toConcatFileLine,
} from "./layout";
import { runFfmpegWithMetrics } from "./process";
import {
	type NativeStaticLayoutExportMetrics,
	type NativeStaticLayoutExportOptions,
	type NativeStaticLayoutExportSession,
} from "./types";

export interface NativeStaticFfmpegOptions {
	ffmpegPath: string;
	options: NativeStaticLayoutExportOptions;
	session: NativeStaticLayoutExportSession;
	chunkDirectory: string;
	videoOnlyPath: string;
	concatListPath: string;
	metrics: NativeStaticLayoutExportMetrics;
	fullConfig: NativeStaticLayoutExportArgsConfig;
	chunks: ReturnType<typeof buildNativeStaticLayoutChunks>;
	usePrecompositedLayout: boolean;
}

export async function renderNativeStaticFfmpeg({
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
}: NativeStaticFfmpegOptions) {
	if (usePrecompositedLayout) {
		const maskPath = path.join(chunkDirectory, "layout-mask.pgm");
		const staticBackgroundPath = path.join(chunkDirectory, "layout-background.png");
		await fs.writeFile(
			maskPath,
			createNativeSquircleMaskPgmBuffer(
				options.contentWidth,
				options.contentHeight,
				options.borderRadius ?? 0,
			),
		);

		const backgroundResult = await runFfmpegWithMetrics(
			ffmpegPath,
			buildNativeStaticBackgroundRenderArgs({
				...fullConfig,
				inputPath: options.inputPath,
				outputPath: staticBackgroundPath,
				maskPath,
			}),
			2 * 60 * 1000,
			session,
		);
		metrics.staticAssetExecMs = backgroundResult.elapsedMs;
		if (!backgroundResult.success) {
			throw new Error(getFfmpegFailureMessage(backgroundResult));
		}

		const fullResult = await runFfmpegWithMetrics(
			ffmpegPath,
			buildNativePrecompositedStaticLayoutArgs({
				...fullConfig,
				staticBackgroundPath,
				maskPath,
			}),
			15 * 60 * 1000,
			session,
		);
		metrics.chunkExecMs += fullResult.elapsedMs;
		if (!fullResult.success) {
			throw new Error(getFfmpegFailureMessage(fullResult));
		}

		const outputStat = await fs.stat(videoOnlyPath);
		metrics.chunkCount = 1;
		metrics.chunkDurationSec = options.durationSec;
		metrics.chunks.push({
			index: 0,
			startSec: 0,
			durationSec: options.durationSec,
			backend: "cuda-static-composite",
			elapsedMs: fullResult.elapsedMs,
			outputBytes: outputStat.size,
		});
	} else {
		const primaryResult = await runFfmpegWithMetrics(
			ffmpegPath,
			buildNativeCudaOverlayStaticLayoutArgs(fullConfig),
			15 * 60 * 1000,
			session,
		);
		let fullResult = primaryResult;
		let fullBackend: NativeStaticLayoutBackend = "cuda-overlay";
		let fallbackReason: string | undefined;
		if (!primaryResult.success) {
			fullBackend = "cuda-scale-cpu-pad";
			fallbackReason = isNativeCudaOutOfMemory(primaryResult.stderr)
				? "cuda-oom"
				: "cuda-overlay-failed";
			metrics.fallbackChunkCount++;
			fullResult = await runFfmpegWithMetrics(
				ffmpegPath,
				buildNativeCudaScaleCpuPadStaticLayoutArgs(fullConfig),
				15 * 60 * 1000,
				session,
			);
		}
		metrics.chunkExecMs += fullResult.elapsedMs;
		if (fullResult !== primaryResult) {
			metrics.chunkExecMs += primaryResult.elapsedMs;
		}

		if (fullResult.success) {
			const outputStat = await fs.stat(videoOnlyPath);
			metrics.chunkCount = 1;
			metrics.chunkDurationSec = options.durationSec;
			metrics.chunks.push({
				index: 0,
				startSec: 0,
				durationSec: options.durationSec,
				backend: fullBackend,
				elapsedMs: fullResult.elapsedMs,
				outputBytes: outputStat.size,
				fallbackReason,
			});
		} else if (isNativeCudaOutOfMemory(fullResult.stderr)) {
			const concatLines: string[] = [];

			for (const chunk of chunks) {
				if (session.terminating) {
					throw new Error("Native static layout export was cancelled");
				}

				const outputPath = getStaticLayoutChunkOutputPath(chunkDirectory, chunk.index);
				const baseConfig: NativeStaticLayoutExportArgsConfig = {
					inputPath: options.inputPath,
					outputPath,
					width: options.width,
					height: options.height,
					frameRate: options.frameRate,
					bitrate: options.bitrate,
					encodingMode: options.encodingMode,
					contentWidth: options.contentWidth,
					contentHeight: options.contentHeight,
					offsetX: options.offsetX,
					offsetY: options.offsetY,
					backgroundColor: options.backgroundColor,
					startSec: chunk.startSec,
					durationSec: chunk.durationSec,
				};
				const primary = await runFfmpegWithMetrics(
					ffmpegPath,
					buildNativeCudaOverlayStaticLayoutArgs(baseConfig),
					15 * 60 * 1000,
					session,
				);
				let backend: NativeStaticLayoutBackend = "cuda-overlay";
				let result = primary;
				let fallbackReason: string | undefined;

				if (!primary.success && isNativeCudaOutOfMemory(primary.stderr)) {
					backend = "cuda-scale-cpu-pad";
					fallbackReason = "cuda-oom";
					metrics.fallbackChunkCount++;
					result = await runFfmpegWithMetrics(
						ffmpegPath,
						buildNativeCudaScaleCpuPadStaticLayoutArgs(baseConfig),
						15 * 60 * 1000,
						session,
					);
				}

				metrics.chunkExecMs += result.elapsedMs;
				if (!result.success) {
					throw new Error(getFfmpegFailureMessage(result));
				}

				const outputStat = await fs.stat(outputPath);
				metrics.chunks.push({
					index: chunk.index,
					startSec: chunk.startSec,
					durationSec: chunk.durationSec,
					backend,
					elapsedMs: result.elapsedMs,
					outputBytes: outputStat.size,
					fallbackReason,
				});
				concatLines.push(toConcatFileLine(outputPath));
			}

			metrics.chunkCount = chunks.length;
			await fs.writeFile(concatListPath, `${concatLines.join("\n")}\n`, "utf8");
			if (session.terminating) {
				throw new Error("Native static layout export was cancelled");
			}
			const concatStartedAt = getNowMs();
			const concatResult = await runFfmpegWithMetrics(
				ffmpegPath,
				buildNativeConcatArgs({ listPath: concatListPath, outputPath: videoOnlyPath }),
				15 * 60 * 1000,
				session,
			);
			metrics.concatExecMs = getNowMs() - concatStartedAt;
			if (!concatResult.success) {
				throw new Error(getFfmpegFailureMessage(concatResult));
			}
		} else {
			throw new Error(getFfmpegFailureMessage(fullResult));
		}
	}
}
