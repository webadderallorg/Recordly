import { execFile, spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { app } from "electron";
import { getBundledWhisperExecutableCandidates } from "../paths/binaries";
import type { CaptionCuePayload, CaptionEngineType } from "../types";
import { getFfmpegBinaryPath } from "../ffmpeg/binary";
import { ensureReadableFile, isExecutableFile } from "./generateUtils";
import {
	adjustCueOffsets,
	MAX_SINGLE_PASS_DURATION_SEC,
	mergeAndDeduplicateChunkCues,
	planAudioChunks,
	probeAudioDuration,
	sliceAudioChunk,
} from "./chunking";
import {
	ensureSherpaOnnxRuntimeBinary,
	findExistingSherpaOnnxExecutable,
	resolveParakeetModelFiles,
} from "./parakeet";
import {
	parseParakeetJsonOutput,
	parseSrtCues,
	parseWhisperJsonCues,
	shouldRetryWhisperWithoutJson,
} from "./parser";
import { isMissingWindowsWhisperRuntimeDependency } from "./runtimeErrors";
import { detectSilenceIntervals } from "./silence";

const execFileAsync = promisify(execFile);

export interface TranscriptionRequest {
	videoPath: string;
	audioWavPath: string;
	language?: string;
	executablePath?: string | null;
	modelPath?: string | null;
}

export interface TranscriptionResult {
	cues: CaptionCuePayload[];
	engine: CaptionEngineType;
}

export interface ITranscriptionEngine {
	readonly id: CaptionEngineType;
	readonly name: string;
	resolveExecutable(preferredPath?: string | null): Promise<string>;
	validateModel(modelPath?: string | null): Promise<string>;
	transcribe(request: TranscriptionRequest): Promise<TranscriptionResult>;
}

export async function resolveWhisperExecutablePath(preferredPath?: string | null): Promise<string> {
	const candidatePaths = [
		preferredPath?.trim() || null,
		...getBundledWhisperExecutableCandidates(),
		process.env["WHISPER_CPP_PATH"]?.trim() || null,
		process.platform === "darwin" ? "/opt/homebrew/bin/whisper-cli" : null,
		process.platform === "darwin" ? "/usr/local/bin/whisper-cli" : null,
		process.platform === "darwin" ? "/opt/homebrew/bin/whisper-cpp" : null,
		process.platform === "darwin" ? "/usr/local/bin/whisper-cpp" : null,
	].filter((value): value is string => Boolean(value));

	for (const candidate of candidatePaths) {
		const normalized = path.resolve(candidate);
		if (await isExecutableFile(normalized)) {
			return normalized;
		}
	}

	const pathCommand = process.platform === "win32" ? "where" : "which";
	const binaryNames =
		process.platform === "win32"
			? ["whisper-cli.exe", "whisper.exe", "main.exe"]
			: ["whisper-cli", "whisper-cpp", "whisper", "main"];

	for (const binaryName of binaryNames) {
		const result = spawnSync(pathCommand, [binaryName], { encoding: "utf-8" });
		if (result.status === 0) {
			const resolvedPath = result.stdout
				.split(/\r?\n/)
				.map((line) => line.trim())
				.find(Boolean);

			if (resolvedPath && (await isExecutableFile(resolvedPath))) {
				return resolvedPath;
			}
		}
	}

	throw new Error(
		`No Whisper runtime was found for ${process.platform}/${process.arch}. ` +
			"This Recordly build is missing its bundled caption runtime. Reinstall or update Recordly, or select a whisper-cli executable in Caption settings.",
	);
}

export async function resolveSherpaOnnxExecutablePath(
	preferredPath?: string | null,
): Promise<string> {
	const existing = await findExistingSherpaOnnxExecutable(preferredPath);
	if (existing) {
		return existing;
	}

	if (!preferredPath?.trim()) {
		console.log(
			"[auto-captions] sherpa-onnx runtime missing, automatically provisioning precompiled binary...",
		);
		const downloaded = await ensureSherpaOnnxRuntimeBinary();
		if (downloaded) {
			return downloaded;
		}
	}

	throw new Error(
		`No sherpa-onnx runtime was found for ${process.platform}/${process.arch}. ` +
			"Install sherpa-onnx or select a sherpa-onnx-offline executable in Caption settings.",
	);
}

export class WhisperEngineAdapter implements ITranscriptionEngine {
	readonly id = "whisper" as const;
	readonly name = "Whisper (whisper.cpp)";

	async resolveExecutable(preferredPath?: string | null): Promise<string> {
		const exePath = await resolveWhisperExecutablePath(preferredPath);
		await ensureReadableFile(exePath, { executable: true });
		return exePath;
	}

	async validateModel(modelPath?: string | null): Promise<string> {
		if (!modelPath?.trim()) {
			throw new Error("Select a Whisper model or download the small model first.");
		}
		const resolved = path.resolve(modelPath.trim());
		await ensureReadableFile(resolved);
		return resolved;
	}

	async transcribe(request: TranscriptionRequest): Promise<TranscriptionResult> {
		const whisperExecutablePath = await this.resolveExecutable(request.executablePath);
		const whisperModelPath = await this.validateModel(request.modelPath);

		const tempBase = path.join(
			app.getPath("temp"),
			`recordly-whisper-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
		);
		const outputBase = `${tempBase}-whisper`;
		const srtPath = `${outputBase}.srt`;
		const jsonPath = `${outputBase}.json`;

		try {
			const language =
				request.language && request.language.trim() ? request.language.trim() : "auto";
			const whisperBaseArgs = [
				"-m",
				whisperModelPath,
				"-f",
				request.audioWavPath,
				"-osrt",
				"-of",
				outputBase,
				"-l",
				language,
				"-np",
			];

			let jsonEnabled = true;
			try {
				await execFileAsync(whisperExecutablePath, [...whisperBaseArgs, "-ojf"], {
					timeout: 30 * 60 * 1000,
					maxBuffer: 20 * 1024 * 1024,
				});
			} catch (error) {
				if (isMissingWindowsWhisperRuntimeDependency(error)) {
					throw new Error(
						"Whisper could not start because the Microsoft Visual C++ x64 Redistributable is missing. Install it from https://aka.ms/vc14/vc_redist.x64.exe, then restart Recordly.",
					);
				}

				if (!shouldRetryWhisperWithoutJson(error)) {
					throw error;
				}

				jsonEnabled = false;
				console.warn(
					"[auto-captions] Whisper runtime does not support JSON full output, retrying with SRT only:",
					error,
				);
				await execFileAsync(whisperExecutablePath, whisperBaseArgs, {
					timeout: 30 * 60 * 1000,
					maxBuffer: 20 * 1024 * 1024,
				});
			}

			const timedCues = jsonEnabled
				? parseWhisperJsonCues(await fs.readFile(jsonPath, "utf-8").catch(() => ""))
				: [];

			const cues =
				timedCues.length > 0
					? timedCues
					: parseSrtCues(await fs.readFile(srtPath, "utf-8").catch(() => ""));

			if (cues.length === 0) {
				throw new Error("Whisper completed, but no caption cues were produced.");
			}

			return { cues, engine: "whisper" };
		} finally {
			await Promise.allSettled([
				fs.rm(srtPath, { force: true }),
				fs.rm(jsonPath, { force: true }),
			]);
		}
	}
}

export class ParakeetEngineAdapter implements ITranscriptionEngine {
	readonly id = "parakeet" as const;
	readonly name = "NVIDIA Parakeet-TDT (sherpa-onnx)";

	async resolveExecutable(preferredPath?: string | null): Promise<string> {
		let exePath: string | null = null;
		try {
			exePath = await resolveSherpaOnnxExecutablePath(preferredPath);
		} catch {
			console.log(
				"[auto-captions] sherpa-onnx runtime missing or preferred path invalid, automatically provisioning precompiled binary...",
			);
			exePath = await ensureSherpaOnnxRuntimeBinary();
		}

		await ensureReadableFile(exePath, { executable: true });
		return exePath;
	}

	async validateModel(modelPath?: string | null): Promise<string> {
		const resolved = await resolveParakeetModelFiles(modelPath);
		return resolved.modelDir;
	}

	async transcribe(request: TranscriptionRequest): Promise<TranscriptionResult> {
		const sherpaExecutablePath = await this.resolveExecutable(request.executablePath);
		const modelFiles = await resolveParakeetModelFiles(request.modelPath);

		const exeDir = path.dirname(sherpaExecutablePath);
		const parentDir = path.dirname(exeDir);
		const libDir = path.join(parentDir, "lib");
		const sep = path.delimiter;
		const extraPath =
			process.platform === "win32"
				? `${exeDir}${sep}${libDir}${sep}${process.env["PATH"] || ""}`
				: `${exeDir}${sep}${process.env["PATH"] || ""}`;

		const env: NodeJS.ProcessEnv = {
			...process.env,
			PATH: extraPath,
			...(process.platform === "linux"
				? {
						LD_LIBRARY_PATH: `${libDir}:${exeDir}:${process.env["LD_LIBRARY_PATH"] || ""}`,
					}
				: {}),
			...(process.platform === "darwin"
				? {
						DYLD_LIBRARY_PATH: `${libDir}:${exeDir}:${process.env["DYLD_LIBRARY_PATH"] || ""}`,
					}
				: {}),
		};

		const runSherpaOnWav = async (wavPath: string): Promise<string> => {
			const args = [
				`--encoder=${modelFiles.encoderPath}`,
				`--decoder=${modelFiles.decoderPath}`,
				`--joiner=${modelFiles.joinerPath}`,
				`--tokens=${modelFiles.tokensPath}`,
				"--num-threads=4",
				"--decoding-method=greedy_search",
				wavPath,
			];

			try {
				const result = await execFileAsync(sherpaExecutablePath, args, {
					env,
					timeout: 30 * 60 * 1000,
					maxBuffer: 30 * 1024 * 1024,
				});
				return result.stdout ?? "";
			} catch (error) {
				if (isMissingWindowsWhisperRuntimeDependency(error)) {
					throw new Error(
						"sherpa-onnx could not start because a required C++ / ONNX runtime dependency is missing.",
					);
				}
				throw error;
			}
		};

		// 1. Inspect audio duration prior to calling sherpa-onnx-offline
		let durationSec = 0;
		try {
			durationSec = await probeAudioDuration(request.audioWavPath);
		} catch (error) {
			console.warn(
				"[auto-captions] Failed to probe audio duration, attempting single-pass fallback:",
				error,
			);
		}

		// 2. Single-pass transcription if duration <= 25 seconds (or if unprobed)
		if (durationSec <= MAX_SINGLE_PASS_DURATION_SEC) {
			const stdout = await runSherpaOnWav(request.audioWavPath);
			const cues = parseParakeetJsonOutput(stdout);
			if (cues.length === 0) {
				throw new Error("Parakeet-TDT completed, but no caption cues were produced.");
			}
			return { cues, engine: "parakeet" };
		}

		// 3. Multi-chunk transcription if duration > 25 seconds
		console.log(
			`[auto-captions] Audio duration is ${durationSec.toFixed(1)}s (> ${MAX_SINGLE_PASS_DURATION_SEC}s). Slicing into consecutive chunks to avoid ONNX positional embedding overflow...`,
		);

		const ffmpegPath = getFfmpegBinaryPath();
		const silences = await detectSilenceIntervals({
			ffmpegPath,
			wavPath: request.audioWavPath,
		}).catch((err) => {
			console.warn(
				"[auto-captions] Silence detection before chunking failed, using fixed overlap fallback:",
				err,
			);
			return [];
		});

		const chunks = planAudioChunks(durationSec, silences);
		const tempChunkFiles: string[] = [];
		const chunkCuesList: CaptionCuePayload[][] = [];

		try {
			for (const chunk of chunks) {
				const tempChunkPath = path.join(
					app.getPath("temp"),
					`recordly-parakeet-chunk-${Date.now()}-${chunk.index}-${Math.random().toString(36).slice(2, 6)}.wav`,
				);
				tempChunkFiles.push(tempChunkPath);

				await sliceAudioChunk({
					ffmpegPath,
					inputWavPath: request.audioWavPath,
					outputWavPath: tempChunkPath,
					startSec: chunk.startSec,
					durationSec: chunk.durationSec,
				});

				const stdout = await runSherpaOnWav(tempChunkPath);
				const rawCues = parseParakeetJsonOutput(stdout);
				const adjusted = adjustCueOffsets(rawCues, chunk.startMs);
				chunkCuesList.push(adjusted);
			}
		} finally {
			// Clean up all temporary chunk audio files in the temp directory upon completion or error
			await Promise.allSettled(
				tempChunkFiles.map((chunkPath) => fs.rm(chunkPath, { force: true })),
			);
		}

		// 4. Merge and deduplicate timestamped cues from all chunks sequentially
		const cues = mergeAndDeduplicateChunkCues(chunkCuesList, chunks);
		if (cues.length === 0) {
			throw new Error("Parakeet-TDT completed, but no caption cues were produced.");
		}

		return { cues, engine: "parakeet" };
	}
}

export function getTranscriptionEngine(
	engine: CaptionEngineType = "whisper",
): ITranscriptionEngine {
	if (engine === "parakeet") {
		return new ParakeetEngineAdapter();
	}
	return new WhisperEngineAdapter();
}
