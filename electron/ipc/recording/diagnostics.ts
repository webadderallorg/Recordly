import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import { promisify } from "node:util";
import { COMPANION_AUDIO_LAYOUTS } from "../constants";
import { getFfmpegBinaryPath, getFfprobeBinaryPath } from "../ffmpeg/binary";
import { lastNativeCaptureDiagnostics, setLastNativeCaptureDiagnostics } from "../state";
import type { CompanionAudioCandidate, NativeCaptureDiagnostics } from "../types";
import { parseJsonWithByteOrderMark } from "../utils";

const execFileAsync = promisify(execFile);
export const MIN_VALID_RECORDED_VIDEO_BYTES = 1024;
export const RECORDING_AUDIO_MUX_MIN_TIMEOUT_MS = 5 * 60 * 1000;
export const RECORDING_AUDIO_MUX_MAX_TIMEOUT_MS = 2 * 60 * 60 * 1000;

type CompanionAudioTimingMetadata = {
	startDelayMs?: number;
};

export type VideoStreamDurationProbe = {
	durationSeconds: number | null;
	frameCount: number | null;
	frameRate: number | null;
};

export type RecordingDiagnosticsSnapshot = {
	backend: NativeCaptureDiagnostics["backend"];
	phase:
		| `${NativeCaptureDiagnostics["phase"]}`
		| "pad"
		| "mic-sidecar"
		| "mux-start"
		| "mux-complete"
		| "mux-error";
	expectedDurationMs?: number | null;
	outputPath?: string | null;
	systemAudioPath?: string | null;
	microphonePath?: string | null;
	processOutput?: string;
	error?: string;
	details?: Record<string, unknown>;
};

type RecordingDiagnosticsLog = {
	version: 1;
	createdAt: string;
	updatedAt: string;
	videoPath: string;
	diagnosticsPath: string;
	events: unknown[];
	latest?: unknown;
};

export function recordNativeCaptureDiagnostics(
	diagnostics: Omit<NativeCaptureDiagnostics, "timestamp">,
) {
	setLastNativeCaptureDiagnostics({
		timestamp: new Date().toISOString(),
		...diagnostics,
	});

	return lastNativeCaptureDiagnostics;
}

export async function getFileSizeIfPresent(filePath: string | null | undefined) {
	if (!filePath) {
		return null;
	}

	try {
		const stat = await fs.stat(filePath);
		return stat.size;
	} catch {
		return null;
	}
}

export function parseFfmpegDurationSeconds(stderr: string) {
	const match = stderr.match(/Duration:\s+(\d+):(\d+):(\d+(?:\.\d+)?)/i);
	if (!match) {
		return null;
	}

	const hours = Number(match[1]);
	const minutes = Number(match[2]);
	const seconds = Number(match[3]);
	if (![hours, minutes, seconds].every(Number.isFinite)) {
		return null;
	}

	return hours * 3600 + minutes * 60 + seconds;
}

export function getRecordingAudioMuxTimeoutMs(durationSeconds: number) {
	if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
		return RECORDING_AUDIO_MUX_MIN_TIMEOUT_MS;
	}

	const realtimeMuxBudgetMs = Math.ceil(durationSeconds * 1000) + 60 * 1000;
	return Math.min(
		RECORDING_AUDIO_MUX_MAX_TIMEOUT_MS,
		Math.max(RECORDING_AUDIO_MUX_MIN_TIMEOUT_MS, realtimeMuxBudgetMs),
	);
}

/** Probe the duration of a media file (in seconds) using the container header. */
export async function probeMediaDurationSeconds(filePath: string): Promise<number> {
	const ffmpegPath = getFfmpegBinaryPath();
	try {
		await execFileAsync(ffmpegPath, ["-i", filePath, "-hide_banner"], { timeout: 5000 });
	} catch (error) {
		const stderr = (error as NodeJS.ErrnoException & { stderr?: string })?.stderr ?? "";
		const duration = parseFfmpegDurationSeconds(stderr);
		if (duration !== null) {
			return duration;
		}
	}
	return 0;
}

function parsePositiveNumber(value: unknown) {
	const parsed =
		typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
	return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parsePositiveInteger(value: unknown) {
	const parsed = parsePositiveNumber(value);
	return parsed === null ? null : Math.max(0, Math.round(parsed));
}

function parseFrameRate(value: unknown) {
	if (typeof value !== "string") {
		return null;
	}
	const [numeratorRaw, denominatorRaw] = value.split("/");
	const numerator = Number(numeratorRaw);
	const denominator = Number(denominatorRaw);
	if (
		!Number.isFinite(numerator) ||
		!Number.isFinite(denominator) ||
		numerator <= 0 ||
		denominator <= 0
	) {
		return null;
	}

	return numerator / denominator;
}

export function parseFfprobeVideoStreamDuration(output: string): VideoStreamDurationProbe | null {
	const parsed = JSON.parse(output) as {
		streams?: Array<{
			duration?: unknown;
			nb_frames?: unknown;
			nb_read_frames?: unknown;
			avg_frame_rate?: unknown;
			r_frame_rate?: unknown;
		}>;
	};
	const stream = parsed.streams?.[0];
	if (!stream) {
		return null;
	}

	const frameRate = parseFrameRate(stream.avg_frame_rate) ?? parseFrameRate(stream.r_frame_rate);
	const frameCount =
		parsePositiveInteger(stream.nb_read_frames) ?? parsePositiveInteger(stream.nb_frames);
	const streamDuration = parsePositiveNumber(stream.duration);
	const frameDerivedDuration =
		frameCount !== null && frameRate !== null && frameRate > 0 ? frameCount / frameRate : null;

	return {
		durationSeconds: streamDuration ?? frameDerivedDuration,
		frameCount,
		frameRate,
	};
}

export async function probeVideoStreamDuration(
	filePath: string,
): Promise<VideoStreamDurationProbe | null> {
	try {
		const result = await execFileAsync(
			getFfprobeBinaryPath(),
			[
				"-v",
				"error",
				"-select_streams",
				"v:0",
				"-count_frames",
				"-show_entries",
				"stream=duration,nb_frames,nb_read_frames,avg_frame_rate,r_frame_rate",
				"-of",
				"json",
				filePath,
			],
			{ timeout: 30000, maxBuffer: 2 * 1024 * 1024 },
		);
		const stdout = typeof result === "string" ? result : result.stdout;
		return parseFfprobeVideoStreamDuration(stdout);
	} catch {
		return null;
	}
}

export async function probeVideoStreamDurationSeconds(filePath: string): Promise<number> {
	const probe = await probeVideoStreamDuration(filePath);
	return probe?.durationSeconds && probe.durationSeconds > 0
		? probe.durationSeconds
		: probeMediaDurationSeconds(filePath);
}

export function getRecordingDiagnosticsPath(videoPath: string) {
	return `${videoPath.replace(/\.[^.]+$/u, "")}.recording-diagnostics.json`;
}

function truncateDiagnosticsText(value: string | undefined, maxLength = 12000) {
	if (!value || value.length <= maxLength) {
		return value;
	}

	return `${value.slice(-maxLength)}\n[recordly: truncated to last ${maxLength} chars]`;
}

async function describeMediaFile(filePath: string | null | undefined) {
	if (!filePath) {
		return null;
	}

	try {
		const stat = await fs.stat(filePath);
		if (!stat.isFile()) {
			return {
				path: filePath,
				exists: false,
			};
		}

		return {
			path: filePath,
			exists: true,
			sizeBytes: stat.size,
			containerDurationSeconds: await probeMediaDurationSeconds(filePath),
		};
	} catch {
		return {
			path: filePath,
			exists: false,
		};
	}
}

async function describeVideoFile(filePath: string | null | undefined) {
	const media = await describeMediaFile(filePath);
	if (!media?.exists || !filePath) {
		return media;
	}

	return {
		...media,
		stream: await probeVideoStreamDuration(filePath),
	};
}

async function describeAudioFile(filePath: string | null | undefined) {
	const media = await describeMediaFile(filePath);
	if (!media?.exists || !filePath) {
		return media;
	}

	const startDelayMs = await getCompanionAudioStartDelayMs(filePath);
	return {
		...media,
		startDelayMs,
	};
}

export async function writeRecordingDiagnosticsSnapshot(
	videoPath: string,
	snapshot: RecordingDiagnosticsSnapshot,
) {
	const diagnosticsPath = getRecordingDiagnosticsPath(videoPath);
	const now = new Date().toISOString();
	let existing: RecordingDiagnosticsLog | null = null;

	try {
		const raw = await fs.readFile(diagnosticsPath, "utf8");
		const parsed = parseJsonWithByteOrderMark<RecordingDiagnosticsLog | null>(raw);
		if (parsed?.version === 1 && Array.isArray(parsed.events)) {
			existing = parsed;
		}
	} catch {
		// First diagnostics event for this recording.
	}

	const event = {
		timestamp: now,
		...snapshot,
		processOutput: truncateDiagnosticsText(snapshot.processOutput),
		media: {
			video: await describeVideoFile(videoPath),
			systemAudio: await describeAudioFile(snapshot.systemAudioPath),
			microphone: await describeAudioFile(snapshot.microphonePath),
		},
	};
	const log: RecordingDiagnosticsLog = existing ?? {
		version: 1,
		createdAt: now,
		updatedAt: now,
		videoPath,
		diagnosticsPath,
		events: [],
	};
	log.updatedAt = now;
	log.videoPath = videoPath;
	log.diagnosticsPath = diagnosticsPath;
	log.events.push(event);
	log.latest = event;

	await fs.writeFile(diagnosticsPath, JSON.stringify(log, null, 2), "utf8");
	return diagnosticsPath;
}

export async function getUsableCompanionAudioCandidates(
	videoPath: string,
): Promise<CompanionAudioCandidate[]> {
	const basePath = videoPath.replace(/\.[^.]+$/u, "");
	const candidates: CompanionAudioCandidate[] = [];

	for (const layout of COMPANION_AUDIO_LAYOUTS) {
		const systemPath = `${basePath}${layout.systemSuffix}`;
		const micPath = `${basePath}${layout.micSuffix}`;
		const usablePaths: string[] = [];

		for (const companionPath of [systemPath, micPath]) {
			try {
				const stat = await fs.stat(companionPath);
				if (stat.size > 0) {
					usablePaths.push(companionPath);
				}
			} catch {
				// Missing companion audio is expected for many recordings.
			}
		}

		if (usablePaths.length > 0) {
			candidates.push({
				platform: layout.platform,
				systemPath,
				micPath,
				usablePaths,
			});
		}
	}

	return candidates;
}

async function readCompanionAudioTimingMetadata(
	companionPath: string,
): Promise<CompanionAudioTimingMetadata | null> {
	try {
		const raw = await fs.readFile(`${companionPath}.json`, "utf8");
		const parsed = parseJsonWithByteOrderMark<CompanionAudioTimingMetadata | null>(raw);
		if (!parsed || typeof parsed !== "object") {
			return null;
		}

		return parsed;
	} catch {
		return null;
	}
}

export async function getCompanionAudioStartDelayMs(companionPath: string) {
	const metadata = await readCompanionAudioTimingMetadata(companionPath);
	const startDelayMs = metadata?.startDelayMs;
	if (!Number.isFinite(startDelayMs) || (startDelayMs ?? 0) < 0) {
		return null;
	}

	return Math.round(startDelayMs ?? 0);
}

export async function hasEmbeddedAudioStream(videoPath: string) {
	const ffmpegPath = getFfmpegBinaryPath();
	let stderr = "";

	try {
		const result = await execFileAsync(
			ffmpegPath,
			["-hide_banner", "-i", videoPath, "-map", "0:a:0", "-frames:a", "1", "-f", "null", "-"],
			{ timeout: 20000, maxBuffer: 10 * 1024 * 1024 },
		);
		stderr = result.stderr;
	} catch (error) {
		stderr = (error as NodeJS.ErrnoException & { stderr?: string }).stderr ?? "";
	}

	return /Stream #.*Audio:/i.test(stderr);
}

export async function getCompanionAudioFallbackPaths(videoPath: string) {
	const { paths } = await getCompanionAudioFallbackInfo(videoPath);
	return paths;
}

export async function getCompanionAudioFallbackInfo(videoPath: string) {
	const companionCandidates = await getUsableCompanionAudioCandidates(videoPath);
	if (companionCandidates.length === 0) {
		return { paths: [], startDelayMsByPath: {} };
	}

	let paths: string[];
	if (await hasEmbeddedAudioStream(videoPath)) {
		const microphoneCompanionPaths = Array.from(
			new Set(
				companionCandidates.flatMap((candidate) =>
					candidate.usablePaths.filter(
						(companionPath) => companionPath === candidate.micPath,
					),
				),
			),
		);
		if (microphoneCompanionPaths.length === 0) {
			return { paths: [], startDelayMsByPath: {} };
		}

		paths = [videoPath, ...microphoneCompanionPaths];
	} else {
		paths = Array.from(
			new Set(companionCandidates.flatMap((candidate) => candidate.usablePaths)),
		);
	}

	const metadataEntries = await Promise.all(
		paths.map(async (audioPath) => {
			const startDelayMs = await getCompanionAudioStartDelayMs(audioPath);
			if (!Number.isFinite(startDelayMs)) {
				return null;
			}

			return [audioPath, startDelayMs] as const;
		}),
	);

	return {
		paths,
		startDelayMsByPath: Object.fromEntries(
			metadataEntries.filter((entry): entry is readonly [string, number] => entry !== null),
		),
	};
}

export async function validateRecordedVideo(videoPath: string) {
	const stat = await fs.stat(videoPath);
	if (!stat.isFile()) {
		throw new Error(`Recorded output is not a file: ${videoPath}`);
	}

	if (stat.size <= 0) {
		throw new Error(`Recorded output is empty: ${videoPath}`);
	}

	if (stat.size < MIN_VALID_RECORDED_VIDEO_BYTES) {
		throw new Error(
			`Recorded output is too small to contain playable video (${stat.size} bytes): ${videoPath}`,
		);
	}

	const ffmpegPath = getFfmpegBinaryPath();
	let stderr = "";

	try {
		const result = await execFileAsync(
			ffmpegPath,
			["-hide_banner", "-i", videoPath, "-map", "0:v:0", "-frames:v", "1", "-f", "null", "-"],
			{ timeout: 20000, maxBuffer: 10 * 1024 * 1024 },
		);
		stderr = result.stderr;
	} catch (error) {
		const execError = error as NodeJS.ErrnoException & { stderr?: string };
		const output = execError.stderr?.trim();
		throw new Error(output || `Recorded output could not be decoded: ${videoPath}`);
	}

	if (!/Stream #.*Video:/i.test(stderr)) {
		throw new Error(`Recorded output does not contain a readable video stream: ${videoPath}`);
	}

	const durationSeconds = parseFfmpegDurationSeconds(stderr);
	if (durationSeconds === null || durationSeconds <= 0) {
		throw new Error(`Recorded output has an invalid duration: ${videoPath}`);
	}

	return {
		fileSizeBytes: stat.size,
		durationSeconds,
	};
}
