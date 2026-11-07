import fs from "node:fs/promises";
import path from "node:path";
import { app } from "electron";
import { getFfmpegBinaryPath } from "../../ffmpeg/binary";
import { replaceShareExportSource } from "../../growingShareUpload";
import {
	buildEditedTrackSourceAudioFilter,
	buildTrimmedSourceAudioFilter,
	getEditedAudioExtension,
	type NativeVideoAudioMuxMetrics,
	type NativeVideoExportFinishOptions,
} from "../../nativeVideoExport";
import { formatFfmpegSeconds, getNowMs } from "./constants";
import { runFfmpegAudioMux } from "./process";
import { removeTemporaryExportFile } from "./stream";
import {
	type NativeStaticLayoutExportSession,
	type NativeVideoAudioMuxArgsOptions,
	type NativeVideoAudioMuxProgress,
} from "./types";

export function canCopyAudioCodecIntoMp4(codec?: string | null) {
	const normalized = (codec ?? "").trim().toLowerCase();
	if (!normalized) {
		return false;
	}

	return (
		normalized.includes("aac") ||
		normalized.includes("mp4a") ||
		normalized.includes("mpeg-4 audio") ||
		normalized.includes("mp3") ||
		normalized.includes("alac")
	);
}

export function buildNativeVideoAudioMuxArgs(
	videoPath: string,
	audioInputPath: string,
	outputPath: string,
	options: NativeVideoExportFinishOptions,
	argsOptions: NativeVideoAudioMuxArgsOptions = {},
) {
	const audioMode = options.audioMode ?? "none";
	const useEditedTrackFiltergraph =
		audioMode === "edited-track" && options.editedTrackStrategy === "filtergraph-fast-path";
	const args = ["-y", "-hide_banner", "-loglevel", "error"];
	if (argsOptions.progressPipe) {
		args.push(
			"-stats_period",
			"0.5",
			"-progress",
			`pipe:${argsOptions.progressPipe}`,
			"-nostats",
		);
	}
	args.push("-i", videoPath, "-i", audioInputPath);

	if (audioMode === "trim-source") {
		const filter = buildTrimmedSourceAudioFilter(options.trimSegments ?? []);
		if (filter) {
			args.push("-filter_complex", filter, "-map", "0:v:0", "-map", "[aout]");
		} else {
			args.push("-map", "0:v:0", "-map", "1:a:0");
		}
	} else if (useEditedTrackFiltergraph) {
		const filter = buildEditedTrackSourceAudioFilter(
			options.editedTrackSegments ?? [],
			options.audioSourceSampleRate ?? 0,
		);
		if (!filter) {
			throw new Error("Edited-track filtergraph inputs are incomplete for native export");
		}
		if (
			typeof options.outputDurationSec === "number" &&
			Number.isFinite(options.outputDurationSec) &&
			options.outputDurationSec > 0
		) {
			const duration = formatFfmpegSeconds(options.outputDurationSec * 1000);
			args.push(
				"-filter_complex",
				`${filter};[aout]apad,atrim=duration=${duration},asetpts=PTS-STARTPTS[aout_sync]`,
				"-map",
				"0:v:0",
				"-map",
				"[aout_sync]",
			);
		} else {
			args.push("-filter_complex", filter, "-map", "0:v:0", "-map", "[aout]");
		}
	} else {
		args.push("-map", "0:v:0", "-map", "1:a:0");
	}

	args.push("-c:v", "copy");
	if (audioMode === "copy-source" && canCopyAudioCodecIntoMp4(options.audioSourceCodec)) {
		args.push("-c:a", "copy");
	} else {
		args.push("-c:a", "aac", "-b:a", "192k");
	}
	if (
		typeof options.outputDurationSec === "number" &&
		Number.isFinite(options.outputDurationSec) &&
		options.outputDurationSec > 0
	) {
		args.push("-t", formatFfmpegSeconds(options.outputDurationSec * 1000));
	} else if (audioMode !== "copy-source") {
		args.push("-shortest");
	}
	args.push("-movflags", "+faststart", outputPath);

	return args;
}

export async function muxNativeVideoExportAudio(
	videoPath: string,
	options: NativeVideoExportFinishOptions,
	onProgress?: (progress: NativeVideoAudioMuxProgress) => void,
	session?: NativeStaticLayoutExportSession,
) {
	const audioMode = options.audioMode ?? "none";
	if (audioMode === "none") {
		return {
			outputPath: videoPath,
			metrics: {} as NativeVideoAudioMuxMetrics,
		};
	}

	const ffmpegPath = getFfmpegBinaryPath();
	const metrics: NativeVideoAudioMuxMetrics = {};
	const tempArtifacts: string[] = [];
	let audioInputPath = options.audioSourcePath ?? null;
	const useEditedTrackFiltergraph =
		audioMode === "edited-track" && options.editedTrackStrategy === "filtergraph-fast-path";

	if (audioMode === "edited-track" && !useEditedTrackFiltergraph) {
		if (!options.editedAudioData) {
			throw new Error("Edited audio data is missing for native export");
		}

		const extension = getEditedAudioExtension(options.editedAudioMimeType);
		audioInputPath = path.join(
			app.getPath("temp"),
			`recordly-export-audio-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${extension}`,
		);
		const tempAudioWriteStartedAt = getNowMs();
		await fs.writeFile(audioInputPath, Buffer.from(options.editedAudioData));
		metrics.tempEditedAudioWriteMs = getNowMs() - tempAudioWriteStartedAt;
		metrics.tempEditedAudioBytes = options.editedAudioData.byteLength;
		tempArtifacts.push(audioInputPath);
	}

	if (!audioInputPath) {
		return {
			outputPath: videoPath,
			metrics,
		};
	}

	const outputPath = path.join(
		path.dirname(videoPath),
		`${path.basename(videoPath, path.extname(videoPath))}-final.mp4`,
	);

	const args = buildNativeVideoAudioMuxArgs(
		videoPath,
		audioInputPath,
		outputPath,
		options,
		onProgress ? { progressPipe: 2 } : {},
	);

	let ownsOutput = false;
	try {
		// Reserve the derived artifact exclusively. Never overwrite or later remove
		// an existing recording, audio input, symlink, or another export's result.
		const output = await fs.open(outputPath, "wx", 0o600);
		ownsOutput = true;
		await output.close();
		replaceShareExportSource(videoPath, outputPath);
		const ffmpegExecStartedAt = getNowMs();
		await runFfmpegAudioMux(ffmpegPath, args, 15 * 60 * 1000, options, onProgress, session);
		metrics.ffmpegExecMs = getNowMs() - ffmpegExecStartedAt;
		console.info("[native-video-export] Audio mux completed", {
			ffmpegExecMs: metrics.ffmpegExecMs,
			audioMode: options.audioMode,
			tempVideoBytes: metrics.tempVideoBytes,
			muxedVideoBytes: metrics.muxedVideoBytes,
		});
		await removeTemporaryExportFile(videoPath);
		return {
			outputPath,
			metrics,
		};
	} catch (error) {
		// The caller only learns this derived path after a successful mux. Remove
		// a partial result here so failed buffer exports cannot leave it behind.
		if (ownsOutput) await removeTemporaryExportFile(outputPath);
		throw error;
	} finally {
		await Promise.allSettled(
			tempArtifacts.map((artifactPath) => removeTemporaryExportFile(artifactPath)),
		);
	}
}

export async function muxExportedVideoAudioBuffer(
	videoData: ArrayBuffer,
	options: NativeVideoExportFinishOptions,
) {
	const tempVideoPath = path.join(
		app.getPath("temp"),
		`recordly-export-video-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.mp4`,
	);
	const metrics: NativeVideoAudioMuxMetrics = {};
	let succeeded = false;
	let outputPath = tempVideoPath;

	try {
		const tempVideoWriteStartedAt = getNowMs();
		await fs.writeFile(tempVideoPath, Buffer.from(videoData));
		metrics.tempVideoWriteMs = getNowMs() - tempVideoWriteStartedAt;
		metrics.tempVideoBytes = videoData.byteLength;
		const finalized = await muxNativeVideoExportAudio(tempVideoPath, options);
		Object.assign(metrics, finalized.metrics);
		outputPath = finalized.outputPath;
		// Record byte size via stat instead of reading the whole file into a
		// Buffer — fs.readFile throws ERR_FS_FILE_TOO_LARGE on >2 GiB outputs.
		try {
			const stat = await fs.stat(outputPath);
			metrics.muxedVideoBytes = stat.size;
		} catch {
			// Stat failures are non-fatal; size is purely metric data.
		}
		succeeded = true;
		return {
			outputPath,
			metrics,
		};
	} finally {
		// Always remove the unmuxed intermediate when the muxer wrote a separate
		// file. Only remove the muxed output on failure — on success the caller
		// owns it and is responsible for moving/deleting it.
		const cleanupTargets: string[] = [];
		if (outputPath !== tempVideoPath) {
			cleanupTargets.push(tempVideoPath);
		}
		if (!succeeded) {
			cleanupTargets.push(outputPath);
		}
		if (cleanupTargets.length > 0) {
			await Promise.allSettled(
				cleanupTargets.map((target) => removeTemporaryExportFile(target)),
			);
		}
	}
}
