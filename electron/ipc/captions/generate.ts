import { execFile, spawn, spawnSync } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { app } from "electron";
import { COMPANION_AUDIO_LAYOUTS } from "../constants";
import { getFfmpegBinaryPath } from "../ffmpeg/binary";
import { getBundledWhisperExecutableCandidates } from "../paths/binaries";
import { resolveRecordingSession } from "../project/session";
import { normalizeVideoSourcePath } from "../utils";
import { parseSrtCues, parseWhisperJsonCues, shouldRetryWhisperWithoutJson } from "./parser";
import { segmentCuesIntoPhrases } from "./segment";
import {
	parseSilenceIntervals,
	SILENCE_DETECT_MIN_S,
	SILENCE_NOISE_DB,
	type SilenceInterval,
} from "./silence";

const execFileAsync = promisify(execFile);

export type CaptionGenerationProgress = {
	stage: "preparing" | "extracting-audio" | "transcribing" | "finalizing";
	progress: number;
};

function clampProgress(progress: number) {
	return Math.min(100, Math.max(0, Math.round(progress)));
}

function emitProgress(
	onProgress: ((progress: CaptionGenerationProgress) => void) | undefined,
	progress: CaptionGenerationProgress,
) {
	onProgress?.({ ...progress, progress: clampProgress(progress.progress) });
}

export function parseWhisperProgressPercent(output: string) {
	const matches = [...output.matchAll(/progress\s*=\s*(\d{1,3}(?:\.\d+)?)%/gi)];
	const match = matches[matches.length - 1];
	if (!match) {
		return null;
	}

	return clampProgress(Number(match[1]));
}

function runWhisperCommand(
	whisperExecutablePath: string,
	args: string[],
	onProgress?: (progress: CaptionGenerationProgress) => void,
) {
	return new Promise<void>((resolve, reject) => {
		const child = spawn(whisperExecutablePath, args, { windowsHide: true });
		let recentOutput = "";
		let timedOut = false;
		let processError: Error | null = null;
		let forceKillTimeout: ReturnType<typeof setTimeout> | null = null;
		const timeout = setTimeout(
			() => {
				timedOut = true;
				child.kill();
				forceKillTimeout = setTimeout(() => {
					if (child.exitCode === null && child.signalCode === null) {
						child.kill("SIGKILL");
					}
				}, 5_000);
			},
			30 * 60 * 1000,
		);

		const clearWhisperTimeouts = () => {
			clearTimeout(timeout);
			if (forceKillTimeout) {
				clearTimeout(forceKillTimeout);
			}
		};

		const handleOutput = (chunk: Buffer) => {
			const output = chunk.toString("utf-8");
			recentOutput = `${recentOutput}${output}`.slice(-20_000);
			const whisperProgress = parseWhisperProgressPercent(recentOutput);
			if (whisperProgress !== null) {
				emitProgress(onProgress, {
					stage: "transcribing",
					progress: 15 + whisperProgress * 0.8,
				});
			}
		};

		child.stdout?.on("data", handleOutput);
		child.stderr?.on("data", handleOutput);
		child.on("error", (error) => {
			processError = error;
		});
		child.on("close", (code) => {
			clearWhisperTimeouts();
			if (timedOut) {
				reject(new Error("Whisper timed out after 30 minutes."));
				return;
			}
			if (processError) {
				reject(processError);
				return;
			}
			if (code === 0) {
				resolve();
				return;
			}

			reject(new Error(`Whisper exited with code ${code}. ${recentOutput.trim()}`.trim()));
		});
	});
}

function getWhisperBinaryNames() {
	return process.platform === "win32"
		? ["whisper-cli.exe", "whisper-cpp.exe", "whisper.exe", "main.exe"]
		: ["whisper-cli", "whisper-cpp", "whisper", "main"];
}

export function getWhisperExecutableCandidatesFromPath(candidatePath?: string | null) {
	const trimmedPath = candidatePath?.trim();
	if (!trimmedPath) {
		return [];
	}

	const resolvedPath = path.resolve(trimmedPath);
	const directorySearchPaths = [
		[],
		["bin"],
		["bin", "Release"],
		["build", "bin"],
		["build", "bin", "Release"],
	];
	const candidates = [
		resolvedPath,
		...directorySearchPaths.flatMap((segments) =>
			getWhisperBinaryNames().map((binaryName) =>
				path.join(resolvedPath, ...segments, binaryName),
			),
		),
	];

	return [...new Set(candidates)];
}

export async function ensureReadableFile(
	filePath: string,
	options?: { executable?: boolean; label?: string },
) {
	let stats: Awaited<ReturnType<typeof fs.stat>>;
	try {
		stats = await fs.stat(filePath);
	} catch (error) {
		if (!options?.label) {
			throw error;
		}
		throw new Error(`${options.label} was not found at ${filePath}.`);
	}

	if (!stats.isFile()) {
		throw new Error(
			options?.executable
				? "The selected Whisper executable is not a file."
				: `${options?.label ?? "The selected file"} is not a file.`,
		);
	}

	try {
		await fs.access(filePath, fsConstants.R_OK);
	} catch (error) {
		if (!options?.label) {
			throw error;
		}
		throw new Error(`${options.label} is not readable at ${filePath}.`);
	}
	if (options?.executable) {
		try {
			await fs.access(filePath, fsConstants.X_OK);
		} catch {
			throw new Error("The selected Whisper executable is not marked as executable.");
		}
	}
}

export async function isExecutableFile(filePath: string) {
	try {
		const stats = await fs.stat(filePath);
		if (!stats.isFile()) {
			return false;
		}
		await fs.access(filePath, fsConstants.R_OK | fsConstants.X_OK);
		return true;
	} catch {
		return false;
	}
}

export async function resolveWhisperExecutablePath(preferredPath?: string | null) {
	const candidatePaths = [
		...getWhisperExecutableCandidatesFromPath(preferredPath),
		...getWhisperExecutableCandidatesFromPath(process.env["WHISPER_CPP_PATH"]),
		...getWhisperExecutableCandidatesFromPath(
			process.platform === "win32" ? "C:\\Tools\\whisper" : null,
		),
		...getWhisperExecutableCandidatesFromPath(
			process.platform === "win32" ? "C:\\whisper" : null,
		),
		...getBundledWhisperExecutableCandidates(),
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

	for (const binaryName of getWhisperBinaryNames()) {
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
		"Whisper engine was not found. In Captions, choose the folder that contains whisper-cli, choose the whisper-cli executable, or set WHISPER_CPP_PATH to that location.",
	);
}

export async function resolveCaptionAudioCandidates(videoPath: string) {
	const candidates: Array<{ path: string; label: string }> = [];
	const seenPaths = new Set<string>();

	const pushCandidate = (candidatePath: string | null | undefined, label: string) => {
		const normalizedCandidatePath = normalizeVideoSourcePath(candidatePath);
		if (!normalizedCandidatePath || seenPaths.has(normalizedCandidatePath)) {
			return;
		}

		seenPaths.add(normalizedCandidatePath);
		candidates.push({ path: normalizedCandidatePath, label });
	};

	pushCandidate(videoPath, "recording");

	const requestedRecordingSession = await resolveRecordingSession(videoPath);
	pushCandidate(requestedRecordingSession?.webcamPath, "linked webcam recording");

	const basePath = videoPath.replace(/\.[^.]+$/u, "");
	for (const layout of COMPANION_AUDIO_LAYOUTS) {
		const companionPaths = [
			{ path: `${basePath}${layout.systemSuffix}`, label: "source system audio" },
			{ path: `${basePath}${layout.micSuffix}`, label: "source microphone audio" },
		];

		for (const companion of companionPaths) {
			try {
				const stats = await fs.stat(companion.path);
				if (stats.isFile() && stats.size > 0) {
					pushCandidate(companion.path, companion.label);
				}
			} catch {
				// Companion audio is optional and only used as a fallback.
			}
		}
	}

	return candidates;
}

export async function extractCaptionAudioSource(options: {
	videoPath: string;
	ffmpegPath: string;
	wavPath: string;
}) {
	const candidates = await resolveCaptionAudioCandidates(options.videoPath);
	const attemptedCandidates: Array<{
		path: string;
		label: string;
		readable: boolean;
		extractedAudio: boolean;
		error?: string;
	}> = [];

	for (const candidate of candidates) {
		try {
			await ensureReadableFile(candidate.path);
			await execFileAsync(
				options.ffmpegPath,
				[
					"-y",
					"-i",
					candidate.path,
					"-map",
					"0:a:0",
					"-vn",
					"-ac",
					"1",
					"-ar",
					"16000",
					"-c:a",
					"pcm_s16le",
					options.wavPath,
				],
				{ timeout: 5 * 60 * 1000, maxBuffer: 20 * 1024 * 1024 },
			);
			attemptedCandidates.push({ ...candidate, readable: true, extractedAudio: true });
			return candidate;
		} catch (error) {
			attemptedCandidates.push({
				...candidate,
				readable: true,
				extractedAudio: false,
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}

	console.warn(
		"[auto-captions] No audio source candidate could be extracted:",
		attemptedCandidates,
	);

	throw new Error(
		"No audio was found to transcribe in the saved recording file. Captions need an audio track. If this recording should have contained sound, the recording was saved without an audio stream.",
	);
}

export async function detectSilenceIntervals(options: {
	ffmpegPath: string;
	wavPath: string;
}): Promise<SilenceInterval[]> {
	// ffmpeg writes silencedetect results to stderr; the null muxer just runs the filter.
	const { stderr } = await execFileAsync(
		options.ffmpegPath,
		[
			"-hide_banner",
			"-nostats",
			"-i",
			options.wavPath,
			"-af",
			`silencedetect=noise=${SILENCE_NOISE_DB}dB:d=${SILENCE_DETECT_MIN_S}`,
			"-f",
			"null",
			"-",
		],
		{ timeout: 5 * 60 * 1000, maxBuffer: 20 * 1024 * 1024 },
	);

	return parseSilenceIntervals(stderr ?? "");
}

export async function generateAutoCaptionsFromVideo(options: {
	videoPath: string;
	whisperExecutablePath?: string;
	whisperModelPath: string;
	language?: string;
	onProgress?: (progress: CaptionGenerationProgress) => void;
}) {
	emitProgress(options.onProgress, { stage: "preparing", progress: 0 });
	const ffmpegPath = getFfmpegBinaryPath();
	const normalizedVideoPath = normalizeVideoSourcePath(options.videoPath);
	if (!normalizedVideoPath) {
		throw new Error("Missing source video path.");
	}

	const whisperExecutablePath = await resolveWhisperExecutablePath(options.whisperExecutablePath);
	const whisperModelPath = path.resolve(options.whisperModelPath);
	await ensureReadableFile(whisperExecutablePath, {
		executable: true,
		label: "Whisper runtime",
	});
	await ensureReadableFile(whisperModelPath, { label: "Whisper model file" });

	const tempBase = path.join(
		app.getPath("temp"),
		`recordly-captions-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
	);
	const wavPath = `${tempBase}.wav`;
	const outputBase = `${tempBase}-whisper`;
	const srtPath = `${outputBase}.srt`;
	const jsonPath = `${outputBase}.json`;

	try {
		emitProgress(options.onProgress, { stage: "extracting-audio", progress: 5 });
		const audioSource = await extractCaptionAudioSource({
			videoPath: normalizedVideoPath,
			ffmpegPath,
			wavPath,
		});
		emitProgress(options.onProgress, { stage: "transcribing", progress: 15 });

		const language =
			options.language && options.language.trim() ? options.language.trim() : "auto";
		const whisperBaseArgs = [
			"-m",
			whisperModelPath,
			"-f",
			wavPath,
			"-osrt",
			"-of",
			outputBase,
			"-l",
			language,
			"-pp",
		];

		let jsonEnabled = true;
		try {
			await runWhisperCommand(
				whisperExecutablePath,
				[...whisperBaseArgs, "-ojf"],
				options.onProgress,
			);
		} catch (error) {
			if (!shouldRetryWhisperWithoutJson(error)) {
				throw error;
			}

			jsonEnabled = false;
			console.warn(
				"[auto-captions] Whisper runtime does not support JSON full output, retrying with SRT only:",
				error,
			);
			emitProgress(options.onProgress, { stage: "transcribing", progress: 15 });
			await runWhisperCommand(whisperExecutablePath, whisperBaseArgs, options.onProgress);
		}

		emitProgress(options.onProgress, { stage: "finalizing", progress: 96 });
		const timedCues = jsonEnabled
			? parseWhisperJsonCues(await fs.readFile(jsonPath, "utf-8"))
			: [];
		if (jsonEnabled && timedCues.length === 0) {
			// JSON ran but yielded no word-timed cues (empty/malformed output). We fall back
			// to SRT, which has no word timings — captions are then split by sentence text and
			// silence rather than precise word timing. Surface it for diagnosis.
			console.warn(
				"[auto-captions] Whisper JSON produced no word-timed cues; falling back to SRT (no word timings).",
			);
		}
		const cues =
			timedCues.length > 0 ? timedCues : parseSrtCues(await fs.readFile(srtPath, "utf-8"));
		if (cues.length === 0) {
			throw new Error("Whisper completed, but no caption cues were produced.");
		}

		// Whisper cues run sentences together and don't break on pauses. Re-segment them
		// into one caption per sentence/phrase using Whisper's own word stream (punctuation
		// + pauses), backed by ground-truth acoustic silence (ffmpeg `silencedetect`).
		// Failure here must not block caption generation — fall back to raw.
		let cuesToReturn = cues;
		try {
			const silences = await detectSilenceIntervals({ ffmpegPath, wavPath });
			// An empty result is a valid resegmentation (e.g. every transcribed word fell
			// inside a long detected silence and was dropped as a hallucination), so take it
			// as-is. Only a thrown exception should fall back to the raw cues.
			cuesToReturn = segmentCuesIntoPhrases(cues, silences);
		} catch (error) {
			console.warn(
				"[auto-captions] Silence-aware re-segmentation failed, using raw cues:",
				error,
			);
		}

		emitProgress(options.onProgress, { stage: "finalizing", progress: 100 });
		return {
			cues: cuesToReturn,
			audioSourceLabel: audioSource.label,
		};
	} finally {
		await Promise.allSettled([
			fs.rm(wavPath, { force: true }),
			fs.rm(srtPath, { force: true }),
			fs.rm(jsonPath, { force: true }),
		]);
	}
}
