import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { app } from "electron";
import { getFfmpegBinaryPath } from "../ffmpeg/binary";
import { resolveRecordingSession } from "../project/session";
import {
	getCompanionAudioStartDelayMs,
	getUsableCompanionAudioCandidates,
} from "../recording/diagnostics";
import { normalizeVideoSourcePath } from "../utils";
import { type CaptionAudioCandidate, getCaptionCompanionAudioCandidates } from "./audioCandidates";
import { mergeCaptionSources } from "./mergeSources";
import { segmentCuesIntoPhrases } from "./segment";
import {
	parseSilenceIntervals,
	SILENCE_DETECT_MIN_S,
	SILENCE_NOISE_DB,
	type SilenceInterval,
} from "./silence";
import {
	createWhisperLocalProvider,
	ensureReadableFile,
	isExecutableFile,
	resolveWhisperExecutablePath,
} from "../providers/whisperLocalProvider";
import { createOpenAiWhisperProvider } from "../providers/openaiWhisperProvider";
import type { TranscriptionProvider } from "../providers/types";

export { ensureReadableFile, isExecutableFile, resolveWhisperExecutablePath };

const execFileAsync = promisify(execFile);

class NoCaptionAudioError extends Error {}

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
	candidates?: CaptionAudioCandidate[];
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
	provider?: string;
	providerApiKey?: string;
	providerModel?: string;
	providerBaseUrl?: string | null;
	providerApiMode?: "audio-transcription" | "chat-multimodal";
}) {
	const ffmpegPath = getFfmpegBinaryPath();
	const normalizedVideoPath = normalizeVideoSourcePath(options.videoPath);
	if (!normalizedVideoPath) {
		throw new Error("Missing source video path.");
	}

	// ------------------------------------------------------------------
	// Resolve the transcription provider
	// ------------------------------------------------------------------
	const providerId = options.provider || "whisper-local";
	let transcriptionProvider: TranscriptionProvider;

	if (providerId === "openai-whisper" || providerId === "custom") {
		if (providerId === "openai-whisper" && !options.providerApiKey) {
			throw new Error(
				"An API key is required for the OpenAI Whisper provider. Set one in Settings.",
			);
		}
		transcriptionProvider = createOpenAiWhisperProvider({
			apiKey: options.providerApiKey || "",
			model: options.providerModel,
			baseUrl: options.providerBaseUrl,
			apiMode: options.providerApiMode,
		});
	} else {
		// Default: local Whisper
		transcriptionProvider = createWhisperLocalProvider({
			whisperExecutablePath: options.whisperExecutablePath,
			whisperModelPath: options.whisperModelPath,
		});
	}

	// ------------------------------------------------------------------
	// Shared audio extraction (all providers need a WAV file)
	// ------------------------------------------------------------------
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
			candidates: options.candidates,
		});

		const language =
			options.language && options.language.trim() ? options.language.trim() : "auto";

		// ------------------------------------------------------------------
		// Dispatch to the selected provider
		// ------------------------------------------------------------------
		const result = await transcriptionProvider.transcribe({
			audioPath: wavPath,
			language,
		});

		// ------------------------------------------------------------------
		// Shared post-processing: silence-aware re-segmentation
		// ------------------------------------------------------------------
		// Whisper cues run sentences together and don't break on pauses. Re-segment them
		// into one caption per sentence/phrase using Whisper's own word stream (punctuation
		// + pauses), backed by ground-truth acoustic silence (ffmpeg `silencedetect`).
		// Failure here must not block caption generation — fall back to raw.
		let cuesToReturn = result.cues;
		try {
			const silences = await detectSilenceIntervals({ ffmpegPath, wavPath });
			// An empty result is a valid resegmentation (e.g. every transcribed word fell
			// inside a long detected silence and was dropped as a hallucination), so take it
			// as-is. Only a thrown exception should fall back to the raw cues.
			cuesToReturn = segmentCuesIntoPhrases(result.cues, silences);
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
		await Promise.allSettled([fs.rm(wavPath, { force: true })]);
	}
}

export async function generateAutoCaptionsFromVideo(options: {
	videoPath: string;
	whisperExecutablePath?: string;
	whisperModelPath: string;
	language?: string;
	provider?: string;
	providerApiKey?: string;
	providerModel?: string;
	providerBaseUrl?: string | null;
	providerApiMode?: "audio-transcription" | "chat-multimodal";
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
