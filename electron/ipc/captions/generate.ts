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
import { getCaptionCompanionAudioCandidates } from "./audioCandidates";
import { segmentCuesIntoPhrases } from "./segment";
import { getTranscriptionEngine } from "./engine";
import { detectSilenceIntervals } from "./silence";

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

	pushCandidate(videoPath, "recording");
	const companionAudio = await getUsableCompanionAudioCandidates(videoPath);
	for (const candidate of getCaptionCompanionAudioCandidates(companionAudio)) {
		pushCandidate(candidate.path, candidate.label);
	}

	const requestedRecordingSession = await resolveRecordingSession(videoPath);
	pushCandidate(requestedRecordingSession?.webcamPath, "linked webcam recording");

	return candidates;
}

export interface ExtractedCaptionAudioResult {
	path: string;
	label: string;
	startDelayMs: number;
	audioStartMs: number;
	effectiveTimelineOffsetMs: number;
}

export async function extractCaptionAudioSource(options: {
	videoPath: string;
	ffmpegPath: string;
	wavPath: string;
	startSec?: number;
	durationSec?: number;
	clipStartMs?: number;
	clipEndMs?: number;
}): Promise<ExtractedCaptionAudioResult> {
	const candidates = await resolveCaptionAudioCandidates(options.videoPath);
	const attemptedCandidates: Array<{
		path: string;
		label: string;
		readable: boolean;
		extractedAudio: boolean;
		error?: string;
	}> = [];

	const requestedClipStartMs =
		typeof options.clipStartMs === "number" &&
		Number.isFinite(options.clipStartMs) &&
		options.clipStartMs > 0
			? Math.round(options.clipStartMs)
			: typeof options.startSec === "number" &&
					Number.isFinite(options.startSec) &&
					options.startSec > 0
				? Math.round(options.startSec * 1000)
				: 0;

	const requestedClipEndMs =
		typeof options.clipEndMs === "number" &&
		Number.isFinite(options.clipEndMs) &&
		options.clipEndMs > requestedClipStartMs
			? Math.round(options.clipEndMs)
			: typeof options.durationSec === "number" &&
					Number.isFinite(options.durationSec) &&
					options.durationSec > 0
				? requestedClipStartMs + Math.round(options.durationSec * 1000)
				: undefined;

	for (const candidate of candidates) {
		try {
			await ensureReadableFile(candidate.path);
			const startDelayMs = (await getCompanionAudioStartDelayMs(candidate.path)) ?? 0;
			const audioStartMs = Math.max(0, requestedClipStartMs - startDelayMs);
			const audioStartSec = audioStartMs > 0 ? audioStartMs / 1000 : undefined;

			let audioDurationSec: number | undefined;
			if (typeof requestedClipEndMs === "number") {
				const audioEndMs = Math.max(0, requestedClipEndMs - startDelayMs);
				if (audioEndMs > audioStartMs) {
					audioDurationSec = (audioEndMs - audioStartMs) / 1000;
				}
			}

			const ffmpegArgs = [
				"-y",
				...(typeof audioStartSec === "number" ? ["-ss", audioStartSec.toFixed(3)] : []),
				"-i",
				candidate.path,
				...(typeof audioDurationSec === "number"
					? ["-t", audioDurationSec.toFixed(3)]
					: []),
				"-map",
				"0:a:0",
				"-vn",
				"-ac",
				"1",
				"-ar",
				"16000",
				"-af",
				"aresample=16000:async=1:first_pts=0,asetpts=PTS-STARTPTS",
				"-c:a",
				"pcm_s16le",
				options.wavPath,
			];
			await execFileAsync(options.ffmpegPath, ffmpegArgs, {
				timeout: 5 * 60 * 1000,
				maxBuffer: 20 * 1024 * 1024,
			});
			attemptedCandidates.push({ ...candidate, readable: true, extractedAudio: true });
			return {
				...candidate,
				startDelayMs,
				audioStartMs,
				effectiveTimelineOffsetMs: startDelayMs + audioStartMs,
			};
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

export { detectSilenceIntervals };

export async function generateAutoCaptionsFromVideo(options: {
	videoPath: string;
	engine?: "whisper" | "parakeet";
	whisperExecutablePath?: string;
	whisperModelPath?: string;
	parakeetExecutablePath?: string;
	parakeetModelPath?: string;
	language?: string;
	startSec?: number;
	durationSec?: number;
	clipStartMs?: number;
	clipEndMs?: number;
}) {
	const ffmpegPath = getFfmpegBinaryPath();
	const normalizedVideoPath = normalizeVideoSourcePath(options.videoPath);
	if (!normalizedVideoPath) {
		throw new Error("Missing source video path.");
	}

	const clipStartMs =
		typeof options.clipStartMs === "number" &&
		Number.isFinite(options.clipStartMs) &&
		options.clipStartMs > 0
			? Math.round(options.clipStartMs)
			: typeof options.startSec === "number" &&
					Number.isFinite(options.startSec) &&
					options.startSec > 0
				? Math.round(options.startSec * 1000)
				: 0;

	const startSec = clipStartMs > 0 ? clipStartMs / 1000 : undefined;
	const durationSec =
		typeof options.clipEndMs === "number" &&
		Number.isFinite(options.clipEndMs) &&
		options.clipEndMs > clipStartMs
			? (options.clipEndMs - clipStartMs) / 1000
			: typeof options.durationSec === "number" &&
					Number.isFinite(options.durationSec) &&
					options.durationSec > 0
				? options.durationSec
				: undefined;

	const engineType = options.engine ?? "whisper";
	const transcriptionEngine = getTranscriptionEngine(engineType);

	const tempBase = path.join(
		app.getPath("temp"),
		`recordly-captions-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
	);
	const wavPath = `${tempBase}.wav`;

	try {
		const audioSource = await extractCaptionAudioSource({
			videoPath: normalizedVideoPath,
			ffmpegPath,
			wavPath,
			startSec,
			durationSec,
			clipStartMs,
			clipEndMs: options.clipEndMs,
		});

		const transcriptionResult = await transcriptionEngine.transcribe({
			videoPath: normalizedVideoPath,
			audioWavPath: wavPath,
			language: options.language,
			executablePath:
				engineType === "parakeet"
					? options.parakeetExecutablePath
					: options.whisperExecutablePath,
			modelPath:
				engineType === "parakeet" ? options.parakeetModelPath : options.whisperModelPath,
		});

		const cues = transcriptionResult.cues;
		if (cues.length === 0) {
			throw new Error(
				`${transcriptionEngine.name} completed, but no caption cues were produced.`,
			);
		}

		// Re-segment raw cues into phrases using ground-truth acoustic silence
		let cuesToReturn = cues;
		try {
			const silences = await detectSilenceIntervals({ ffmpegPath, wavPath });
			cuesToReturn = segmentCuesIntoPhrases(cues, silences);
		} catch (error) {
			console.warn(
				"[auto-captions] Silence-aware re-segmentation failed, using raw cues:",
				error,
			);
		}

		// Shift cue timestamps to match timeline coordinate space
		// (accounting for clip start and companion audio start delay)
		if (audioSource.effectiveTimelineOffsetMs > 0) {
			const offsetMs = audioSource.effectiveTimelineOffsetMs;
			cuesToReturn = cuesToReturn.map((cue) => {
				const words = cue.words?.map((word) => ({
					...word,
					startMs: word.startMs + offsetMs,
					endMs: word.endMs + offsetMs,
				}));
				return {
					...cue,
					startMs: cue.startMs + offsetMs,
					endMs: cue.endMs + offsetMs,
					...(words ? { words } : {}),
				};
			});
		}

		return {
			cues: cuesToReturn,
			audioSourceLabel: audioSource.label,
			engine: engineType,
		};
	} finally {
		await fs.rm(wavPath, { force: true }).catch(() => undefined);
	}
}
