import { execFile, spawnSync } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { app } from "electron";
import { getFfmpegBinaryPath } from "../ffmpeg/binary";
import { getBundledWhisperExecutableCandidates } from "../paths/binaries";
import { resolveRecordingSession } from "../project/session";
import {
	getCompanionAudioStartDelayMs,
	getUsableCompanionAudioCandidates,
} from "../recording/diagnostics";
import { normalizeVideoSourcePath } from "../utils";
import { type CaptionAudioCandidate, getCaptionCompanionAudioCandidates } from "./audioCandidates";
import { shouldRetryWhisperWithoutJson } from "./parser";
import { readWhisperCaptionOutput } from "./output";
import { isMissingWindowsWhisperRuntimeDependency } from "./runtimeErrors";
import { mergeCaptionSources } from "./mergeSources";
import { segmentCuesIntoPhrases } from "./segment";
import {
	parseSilenceIntervals,
	SILENCE_DETECT_MIN_S,
	SILENCE_NOISE_DB,
	type SilenceInterval,
} from "./silence";

const execFileAsync = promisify(execFile);

class NoCaptionAudioError extends Error {}

async function executeWhisper(whisperExecutablePath: string, args: string[]) {
	try {
		await execFileAsync(whisperExecutablePath, args, {
			timeout: 30 * 60 * 1000,
			maxBuffer: 20 * 1024 * 1024,
		});
	} catch (error) {
		if (isMissingWindowsWhisperRuntimeDependency(error)) {
			throw new Error(
				"Whisper could not start because the Microsoft Visual C++ x64 Redistributable is missing. Install it from https://aka.ms/vc14/vc_redist.x64.exe, then restart Recordly.",
			);
		}
		throw error;
	}
}

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
		`No Whisper runtime was found for ${process.platform}/${process.arch}. ` +
			"This Recordly build is missing its bundled caption runtime. Reinstall or update Recordly, or select a whisper-cli executable in Caption settings.",
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

	const companionAudio = await getUsableCompanionAudioCandidates(videoPath);
	const companions = getCaptionCompanionAudioCandidates(companionAudio);
	for (const candidate of companions.filter(
		(candidate) => candidate.label === "microphone audio sidecar",
	)) {
		pushCandidate(candidate.path, candidate.label);
	}
	pushCandidate(videoPath, "recording");
	for (const candidate of companions) {
		pushCandidate(candidate.path, candidate.label);
	}

	const requestedRecordingSession = await resolveRecordingSession(videoPath);
	pushCandidate(requestedRecordingSession?.webcamPath, "linked webcam recording");

	return candidates;
}

export async function extractCaptionAudioSource(options: {
	videoPath: string;
	ffmpegPath: string;
	wavPath: string;
	candidates?: CaptionAudioCandidate[];
}) {
	const candidates =
		options.candidates ?? (await resolveCaptionAudioCandidates(options.videoPath));
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
			const delayMs = candidate.label.endsWith("audio sidecar")
				? ((await getCompanionAudioStartDelayMs(candidate.path)) ?? 0)
				: 0;
			await execFileAsync(
				options.ffmpegPath,
				[
					"-y",
					"-i",
					candidate.path,
					"-map",
					"0:a:0",
					"-vn",
					...(delayMs > 0 ? ["-af", `adelay=${delayMs}:all=1`] : []),
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

	throw new NoCaptionAudioError(
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

async function generateCaptionsForSource(options: {
	videoPath: string;
	whisperExecutablePath?: string;
	whisperModelPath: string;
	language?: string;
	candidates: CaptionAudioCandidate[];
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
			candidates: options.candidates,
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
			// Do not carry a hallucinated phrase through later decoding windows.
			"-mc",
			"0",
		];

		let jsonEnabled = true;
		try {
			await executeWhisper(whisperExecutablePath, [...whisperBaseArgs, "-ojf"]);
		} catch (error) {
			if (!shouldRetryWhisperWithoutJson(error)) {
				throw error;
			}

			jsonEnabled = false;
			console.warn(
				"[auto-captions] Whisper runtime does not support JSON full output, retrying with SRT only:",
				error,
			);
			await executeWhisper(whisperExecutablePath, whisperBaseArgs);
		}

		const cues = await readWhisperCaptionOutput(outputBase, jsonEnabled);

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

export async function generateAutoCaptionsFromVideo(options: {
	videoPath: string;
	whisperExecutablePath?: string;
	whisperModelPath: string;
	language?: string;
}) {
	const candidates = await resolveCaptionAudioCandidates(options.videoPath);
	const microphone = candidates.filter((source) => source.label === "microphone audio sidecar");
	const system = candidates.filter((source) => source.label === "system audio sidecar");
	const secondary = candidates.filter(
		(source) => !microphone.includes(source) && !system.includes(source),
	);
	if (microphone.length === 0) {
		return generateCaptionsForSource({ ...options, candidates: [...system, ...secondary] });
	}
	// Decode independently so simultaneous voices do not confuse recognition. The
	// sidecar replaces embedded system audio to avoid transcribing it twice.
	const transcribeTrack = async (sources: CaptionAudioCandidate[]) => {
		try {
			return (await generateCaptionsForSource({ ...options, candidates: sources })).cues;
		} catch (error) {
			if (!(error instanceof NoCaptionAudioError)) throw error;
			return null;
		}
	};
	const micCues = await transcribeTrack(microphone);
	const systemCues = await transcribeTrack([...system, ...secondary]);
	if (micCues === null && systemCues === null)
		throw new NoCaptionAudioError("No audio could be extracted from the recording.");
	return {
		cues: mergeCaptionSources(micCues ?? [], systemCues ?? []),
		audioSourceLabel: "microphone and system audio",
	};
}
