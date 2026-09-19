import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { probeNativeVideoMetadata } from "./export/native-video";
import { getFfmpegBinaryPath } from "./ffmpeg/binary";
import { syncExistingFile, syncParentDirectory } from "./project/atomicSave";
import { getCompanionAudioFallbackInfo } from "./recording/diagnostics";
import { getRecordingsDir, getTelemetryPathForVideo } from "./utils";

const MAX_CAPTURED_FFMPEG_ERROR_CHARS = 32_000;

export interface TimelineClipMediaMetadata {
	width: number;
	height: number;
	duration: number;
	frameRate: number;
	hasAudio: boolean;
}

export interface TimelineClipImportResult {
	success: boolean;
	outputPath?: string;
	sourceDurationMs?: number;
	importedDurationMs?: number;
	totalDurationMs?: number;
	message?: string;
}

export interface TimelineClipAudioInput {
	inputIndex: number;
	startDelayMs?: number;
}

function evenDimension(value: number) {
	return Math.max(2, Math.round(value / 2) * 2);
}

function safeFrameRate(value: number) {
	return Math.min(120, Math.max(1, Number.isFinite(value) ? value : 30));
}

function audioFilter(
	inputs: TimelineClipAudioInput[],
	metadata: TimelineClipMediaMetadata,
	label: string,
) {
	if (inputs.length === 0) {
		return `anullsrc=r=48000:cl=stereo,atrim=duration=${metadata.duration.toFixed(6)},asetpts=PTS-STARTPTS[${label}]`;
	}

	const normalizedLabels = inputs.map((_, index) => `${label}input${index}`);
	const filters = inputs.map((input, index) => {
		const delay = Math.max(0, Math.round(input.startDelayMs ?? 0));
		const delayFilter = delay > 0 ? `,adelay=${delay}|${delay}` : "";
		return `[${input.inputIndex}:a:0]aresample=48000,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo${delayFilter},apad,atrim=duration=${metadata.duration.toFixed(6)},asetpts=PTS-STARTPTS[${normalizedLabels[index]}]`;
	});
	if (normalizedLabels.length === 1) {
		filters.push(`[${normalizedLabels[0]}]anull[${label}]`);
	} else {
		filters.push(
			`${normalizedLabels.map((inputLabel) => `[${inputLabel}]`).join("")}amix=inputs=${normalizedLabels.length}:duration=longest:normalize=0,alimiter=limit=0.95[${label}]`,
		);
	}
	return filters.join(";");
}

export function buildTimelineClipImportArgs(options: {
	sourcePath: string;
	clipPath: string;
	outputPath: string;
	source: TimelineClipMediaMetadata;
	clip: TimelineClipMediaMetadata;
	additionalInputPaths?: string[];
	sourceAudioInputs?: TimelineClipAudioInput[];
	clipAudioInputs?: TimelineClipAudioInput[];
}) {
	const width = evenDimension(options.source.width);
	const height = evenDimension(options.source.height);
	const frameRate = safeFrameRate(options.source.frameRate);
	const videoFilter = (inputIndex: number, label: string) =>
		`[${inputIndex}:v:0]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=${frameRate.toFixed(3)},format=yuv420p,setpts=PTS-STARTPTS[${label}]`;
	const filter = [
		videoFilter(0, "v0"),
		audioFilter(
			options.sourceAudioInputs ?? (options.source.hasAudio ? [{ inputIndex: 0 }] : []),
			options.source,
			"a0",
		),
		videoFilter(1, "v1"),
		audioFilter(
			options.clipAudioInputs ?? (options.clip.hasAudio ? [{ inputIndex: 1 }] : []),
			options.clip,
			"a1",
		),
		"[v0][a0][v1][a1]concat=n=2:v=1:a=1[vout][aout]",
	].join(";");

	return [
		"-hide_banner",
		"-y",
		"-i",
		options.sourcePath,
		"-i",
		options.clipPath,
		...(options.additionalInputPaths ?? []).flatMap((inputPath) => ["-i", inputPath]),
		"-filter_complex",
		filter,
		"-map",
		"[vout]",
		"-map",
		"[aout]",
		"-fps_mode",
		"cfr",
		"-r",
		frameRate.toFixed(3),
		"-c:v",
		"libx264",
		"-preset",
		"veryfast",
		"-crf",
		"18",
		"-c:a",
		"aac",
		"-b:a",
		"192k",
		"-movflags",
		"+faststart",
		"-max_muxing_queue_size",
		"4096",
		options.outputPath,
	];
}

async function resolveAudioInputs(
	videoPath: string,
	videoInputIndex: number,
	metadata: TimelineClipMediaMetadata,
	nextInputIndex: number,
) {
	const fallback = await getCompanionAudioFallbackInfo(videoPath);
	const paths = fallback.paths.length > 0 ? fallback.paths : metadata.hasAudio ? [videoPath] : [];
	const additionalInputPaths: string[] = [];
	const inputs: TimelineClipAudioInput[] = [];
	for (const audioPath of paths) {
		const resolvedAudioPath = path.resolve(audioPath);
		const isEmbedded = resolvedAudioPath === path.resolve(videoPath);
		inputs.push({
			inputIndex: isEmbedded ? videoInputIndex : nextInputIndex + additionalInputPaths.length,
			startDelayMs: fallback.startDelayMsByPath[audioPath] ?? 0,
		});
		if (!isEmbedded) additionalInputPaths.push(resolvedAudioPath);
	}
	return { inputs, additionalInputPaths };
}

async function runFfmpeg(ffmpegPath: string, args: string[]) {
	await new Promise<void>((resolve, reject) => {
		const child = spawn(ffmpegPath, args, {
			windowsHide: true,
			stdio: ["ignore", "ignore", "pipe"],
		});
		let errorOutput = "";
		child.stderr?.setEncoding("utf8");
		child.stderr?.on("data", (chunk: string) => {
			errorOutput = `${errorOutput}${chunk}`.slice(-MAX_CAPTURED_FFMPEG_ERROR_CHARS);
		});
		child.once("error", reject);
		child.once("close", (code, signal) => {
			if (code === 0) {
				resolve();
				return;
			}
			reject(
				new Error(
					`Unable to prepare imported clip (FFmpeg ${signal ? `signal ${signal}` : `exit ${code ?? "unknown"}`}).${errorOutput ? `\n${errorOutput}` : ""}`,
				),
			);
		});
	});
}

async function copyCursorTelemetry(sourcePath: string, outputPath: string) {
	try {
		await fs.copyFile(
			getTelemetryPathForVideo(sourcePath),
			getTelemetryPathForVideo(outputPath),
		);
		return true;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		return false;
	}
}

export async function importTimelineClip(
	sourcePath: string,
	clipPath: string,
): Promise<TimelineClipImportResult> {
	const normalizedSourcePath = path.resolve(sourcePath);
	const normalizedClipPath = path.resolve(clipPath);
	if (normalizedSourcePath === normalizedClipPath) {
		throw new Error("The active recording cannot be imported into itself.");
	}

	const [sourceStat, clipStat] = await Promise.all([
		fs.stat(normalizedSourcePath),
		fs.stat(normalizedClipPath),
	]);
	if (!sourceStat.isFile() || !clipStat.isFile()) {
		throw new Error("Both the active recording and imported clip must be files.");
	}

	const ffmpegPath = getFfmpegBinaryPath();
	const [source, clip] = await Promise.all([
		probeNativeVideoMetadata(ffmpegPath, normalizedSourcePath),
		probeNativeVideoMetadata(ffmpegPath, normalizedClipPath),
	]);
	if (source.duration <= 0 || clip.duration <= 0) {
		throw new Error("The active recording or imported clip has an invalid duration.");
	}

	const recordingsDir = await getRecordingsDir();
	const finalPath = path.join(
		recordingsDir,
		`recordly-composite-${Date.now()}-${randomUUID()}.mp4`,
	);
	const partialPath = `${finalPath}.partial.mp4`;
	try {
		const sourceAudio = await resolveAudioInputs(normalizedSourcePath, 0, source, 2);
		const clipAudio = await resolveAudioInputs(
			normalizedClipPath,
			1,
			clip,
			2 + sourceAudio.additionalInputPaths.length,
		);
		await runFfmpeg(
			ffmpegPath,
			buildTimelineClipImportArgs({
				sourcePath: normalizedSourcePath,
				clipPath: normalizedClipPath,
				outputPath: partialPath,
				source,
				clip,
				additionalInputPaths: [
					...sourceAudio.additionalInputPaths,
					...clipAudio.additionalInputPaths,
				],
				sourceAudioInputs: sourceAudio.inputs,
				clipAudioInputs: clipAudio.inputs,
			}),
		);
		const output = await probeNativeVideoMetadata(ffmpegPath, partialPath);
		const expectedDuration = source.duration + clip.duration;
		if (
			output.width !== evenDimension(source.width) ||
			output.height !== evenDimension(source.height) ||
			Math.abs(output.duration - expectedDuration) >
				Math.max(0.05, 2 / safeFrameRate(source.frameRate))
		) {
			throw new Error(
				"The imported clip failed output validation; the original project was not changed.",
			);
		}

		await syncExistingFile(partialPath);
		await fs.rename(partialPath, finalPath);
		await syncParentDirectory(recordingsDir);
		if (await copyCursorTelemetry(normalizedSourcePath, finalPath)) {
			await syncExistingFile(getTelemetryPathForVideo(finalPath));
			await syncParentDirectory(recordingsDir);
		}
		return {
			success: true,
			outputPath: finalPath,
			sourceDurationMs: Math.round(source.duration * 1000),
			importedDurationMs: Math.round(clip.duration * 1000),
			totalDurationMs: Math.round(output.duration * 1000),
		};
	} catch (error) {
		await Promise.all([
			fs.rm(partialPath, { force: true }),
			fs.rm(finalPath, { force: true }),
			fs.rm(getTelemetryPathForVideo(finalPath), { force: true }),
		]).catch(() => undefined);
		throw error;
	}
}
