import { execFile, spawnSync } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { app } from "electron";
import { getFfmpegBinaryPath } from "../ffmpeg/binary";
import { getBundledWhisperExecutableCandidates } from "../paths/binaries";
import { resolveRecordingSession } from "../project/session";
import { getCompanionAudioFallbackInfo } from "../recording/diagnostics";
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

export async function ensureReadableFile(filePath: string, options?: { executable?: boolean }) {
	await fs.access(filePath, fsConstants.R_OK);
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
		await fs.access(filePath, fsConstants.R_OK | fsConstants.X_OK);
		return true;
	} catch {
		return false;
	}
}

export async function resolveWhisperExecutablePath(preferredPath?: string | null) {
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
		"No Whisper runtime was found. Recordly looked for a bundled binary first, then checked common system install locations.",
	);
}

export async function resolveCaptionAudioCandidates(videoPath: string) {
	const candidates: Array<{
		path: string;
		label: string;
		startDelayMs?: number;
		secondaryPath?: string;
		secondaryStartDelayMs?: number;
	}> = [];
	const seenPaths = new Set<string>();

	const pushCandidate = (
		candidatePath: string | null | undefined,
		label: string,
		startDelayMs?: number,
		secondaryPath?: string,
		secondaryStartDelayMs?: number,
	) => {
		const normalizedCandidatePath = normalizeVideoSourcePath(candidatePath);
		const normalizedSecondaryPath = normalizeVideoSourcePath(secondaryPath);
		if (!normalizedCandidatePath) {
			return;
		}
		const candidateKey = normalizedSecondaryPath
			? `${normalizedCandidatePath}\0${normalizedSecondaryPath}`
			: normalizedCandidatePath;
		if (seenPaths.has(candidateKey)) {
			return;
		}

		seenPaths.add(candidateKey);
		candidates.push({
			path: normalizedCandidatePath,
			label,
			...(Number.isFinite(startDelayMs) && (startDelayMs ?? 0) > 0 ? { startDelayMs } : {}),
			...(normalizedSecondaryPath ? { secondaryPath: normalizedSecondaryPath } : {}),
			...(Number.isFinite(secondaryStartDelayMs) && (secondaryStartDelayMs ?? 0) > 0
				? { secondaryStartDelayMs }
				: {}),
		});
	};

	const companionAudio = await getCompanionAudioFallbackInfo(videoPath);
	const companionPaths = companionAudio.candidatePaths ?? companionAudio.paths;
	const systemPath = companionPaths.find((path) => path.toLowerCase().includes(".system."));
	const microphonePath = companionPaths.find((path) => path.toLowerCase().includes(".mic."));
	if (systemPath && microphonePath) {
		pushCandidate(
			systemPath,
			"system and microphone recording",
			companionAudio.startDelayMsByPath[systemPath],
			microphonePath,
			companionAudio.startDelayMsByPath[microphonePath],
		);
	} else if (microphonePath) {
		pushCandidate(
			microphonePath,
			"microphone recording",
			companionAudio.startDelayMsByPath[microphonePath],
		);
	}

	pushCandidate(videoPath, "recording");

	for (const companionPath of companionPaths) {
		if (companionPath.toLowerCase().includes(".system.")) {
			pushCandidate(
				companionPath,
				"system audio recording",
				companionAudio.startDelayMsByPath[companionPath],
			);
		}
	}

	for (const companionPath of companionPaths) {
		if (companionPath.toLowerCase().includes(".mic.")) {
			pushCandidate(
				companionPath,
				"microphone recording",
				companionAudio.startDelayMsByPath[companionPath],
			);
		}
	}

	const requestedRecordingSession = await resolveRecordingSession(videoPath);
	pushCandidate(requestedRecordingSession?.webcamPath, "linked webcam recording");

	return candidates;
}

export function parseMaxVolumeDb(output: string) {
	const match = output.match(/max_volume:\s*(-inf|[-+]?\d+(?:\.\d+)?)\s*dB/i);
	if (!match || match[1].toLowerCase() === "-inf") {
		return match ? Number.NEGATIVE_INFINITY : null;
	}

	const value = Number(match[1]);
	return Number.isFinite(value) ? value : null;
}

async function hasAudibleCaptionAudio(ffmpegPath: string, wavPath: string) {
	const { stderr } = await execFileAsync(
		ffmpegPath,
		["-hide_banner", "-i", wavPath, "-af", "volumedetect", "-f", "null", "-"],
		{ timeout: 5 * 60 * 1000, maxBuffer: 20 * 1024 * 1024 },
	);
	const maxVolumeDb = parseMaxVolumeDb(stderr);
	return maxVolumeDb === null || maxVolumeDb > -60;
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
			if (candidate.secondaryPath) {
				await ensureReadableFile(candidate.secondaryPath);
			}
			const mixedAudioFilter = candidate.secondaryPath
				? [
						`[0:a]adelay=${Math.round(candidate.startDelayMs ?? 0)}:all=1[primary]`,
						`[1:a]adelay=${Math.round(candidate.secondaryStartDelayMs ?? 0)}:all=1[secondary]`,
						"[primary][secondary]amix=inputs=2:duration=longest:normalize=0[mixed]",
					].join(";")
				: null;
			await execFileAsync(
				options.ffmpegPath,
				[
					"-y",
					"-i",
					candidate.path,
					...(candidate.secondaryPath ? ["-i", candidate.secondaryPath] : []),
					...(mixedAudioFilter
						? ["-filter_complex", mixedAudioFilter, "-map", "[mixed]"]
						: ["-map", "0:a:0"]),
					"-vn",
					"-ac",
					"1",
					"-ar",
					"16000",
					...(!mixedAudioFilter && candidate.startDelayMs
						? ["-af", `adelay=${Math.round(candidate.startDelayMs)}:all=1`]
						: []),
					"-c:a",
					"pcm_s16le",
					options.wavPath,
				],
				{ timeout: 5 * 60 * 1000, maxBuffer: 20 * 1024 * 1024 },
			);
			if (!(await hasAudibleCaptionAudio(options.ffmpegPath, options.wavPath))) {
				throw new Error("Extracted audio is silent");
			}
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
}) {
	const ffmpegPath = getFfmpegBinaryPath();
	const normalizedVideoPath = normalizeVideoSourcePath(options.videoPath);
	if (!normalizedVideoPath) {
		throw new Error("Missing source video path.");
	}

	const whisperExecutablePath = await resolveWhisperExecutablePath(options.whisperExecutablePath);
	const whisperModelPath = path.resolve(options.whisperModelPath);
	await ensureReadableFile(whisperExecutablePath, { executable: true });
	await ensureReadableFile(whisperModelPath);

	const tempBase = path.join(
		app.getPath("temp"),
		`recordly-captions-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
	);
	const wavPath = `${tempBase}.wav`;
	const outputBase = `${tempBase}-whisper`;
	const srtPath = `${outputBase}.srt`;
	const jsonPath = `${outputBase}.json`;

	try {
		const audioSource = await extractCaptionAudioSource({
			videoPath: normalizedVideoPath,
			ffmpegPath,
			wavPath,
		});

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
			"-np",
		];

		let jsonEnabled = true;
		try {
			await execFileAsync(whisperExecutablePath, [...whisperBaseArgs, "-ojf"], {
				timeout: 30 * 60 * 1000,
				maxBuffer: 20 * 1024 * 1024,
			});
		} catch (error) {
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
