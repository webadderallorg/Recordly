import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import { promisify } from "node:util";
import { getFfmpegBinaryPath, getFfprobeBinaryPath } from "../ffmpeg/binary";
import type { CaptionCuePayload, CaptionWordPayload } from "../types";
import { buildCaptionTextFromWords } from "./parser";
import type { SilenceInterval } from "./silence";

const execFileAsync = promisify(execFile);

export const MAX_SINGLE_PASS_DURATION_SEC = 25;
export const TARGET_CHUNK_DURATION_SEC = 20;
export const OVERLAP_DURATION_SEC = 0.5;
export const MIN_SPLIT_SEC = 16;
export const MAX_SPLIT_SEC = 24.5;

export interface AudioChunk {
	index: number;
	startSec: number;
	endSec: number;
	durationSec: number;
	startMs: number;
	endMs: number;
	isSilenceBoundary: boolean;
}

/**
 * Parses duration in seconds from FFmpeg probe output (e.g. "Duration: 00:01:23.45").
 */
export function parseDurationFromFfmpegStderr(stderr: string): number | null {
	const match = stderr.match(/Duration:\s*(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)/i);
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

/**
 * Inspects audio file duration in seconds.
 * Tries ffprobe, falling back to ffmpeg stderr inspection and WAV file header calculation.
 */
export async function probeAudioDuration(audioPath: string): Promise<number> {
	// 1. Try ffprobe
	try {
		const ffprobePath = getFfprobeBinaryPath();
		const { stdout } = await execFileAsync(
			ffprobePath,
			[
				"-v",
				"error",
				"-show_entries",
				"format=duration",
				"-of",
				"default=noprint_wrappers=1:nokey=1",
				audioPath,
			],
			{ timeout: 15_000, maxBuffer: 1024 * 1024 },
		);
		const duration = Number.parseFloat(stdout.trim());
		if (Number.isFinite(duration) && duration > 0) {
			return duration;
		}
	} catch {
		// Fall through to ffmpeg probe
	}

	// 2. Try ffmpeg probe (ffmpeg exits with code 1 when no output file is given)
	try {
		const ffmpegPath = getFfmpegBinaryPath();
		let output = "";
		try {
			const res = await execFileAsync(ffmpegPath, ["-hide_banner", "-i", audioPath], {
				timeout: 15_000,
				maxBuffer: 2 * 1024 * 1024,
			});
			output = `${res.stdout}\n${res.stderr}`;
		} catch (error) {
			const procErr = error as { stdout?: unknown; stderr?: unknown };
			output = [procErr.stdout, procErr.stderr]
				.filter((v): v is string => typeof v === "string")
				.join("\n");
		}

		const parsed = parseDurationFromFfmpegStderr(output);
		if (parsed && parsed > 0) {
			return parsed;
		}
	} catch {
		// Fall through to WAV header
	}

	// 3. Fallback: WAV header inspection (RIFF WAVE PCM)
	try {
		const fd = await fs.open(audioPath, "r");
		try {
			const header = Buffer.alloc(44);
			await fd.read(header, 0, 44, 0);
			if (
				header.toString("ascii", 0, 4) === "RIFF" &&
				header.toString("ascii", 8, 12) === "WAVE"
			) {
				const byteRate = header.readUInt32LE(28);
				const stat = await fd.stat();
				if (byteRate > 0 && stat.size > 44) {
					const dataSize = stat.size - 44;
					const duration = dataSize / byteRate;
					if (Number.isFinite(duration) && duration > 0) {
						return duration;
					}
				}
			}
		} finally {
			await fd.close();
		}
	} catch {
		// Ignore WAV header errors
	}

	throw new Error(`Unable to determine audio duration for: ${audioPath}`);
}

/**
 * Plans consecutive audio chunks of <= 25 seconds duration (target 20s).
 * Prefers natural silence pause midpoints within [cursor + 16s, cursor + 24.5s] when available.
 * Falls back to 20-second fixed chunks with a 0.5-second overlap when no pause is found.
 */
export function planAudioChunks(
	durationSec: number,
	silences: SilenceInterval[] = [],
	startOffsetSec = 0,
): AudioChunk[] {
	const startOffsetMs = Math.round(startOffsetSec * 1000);
	if (durationSec <= MAX_SINGLE_PASS_DURATION_SEC) {
		return [
			{
				index: 0,
				startSec: startOffsetSec,
				endSec: startOffsetSec + durationSec,
				durationSec,
				startMs: startOffsetMs,
				endMs: Math.round((startOffsetSec + durationSec) * 1000),
				isSilenceBoundary: false,
			},
		];
	}

	const chunks: AudioChunk[] = [];
	let cursor = startOffsetSec;
	const totalEndSec = startOffsetSec + durationSec;
	let index = 0;

	while (cursor < totalEndSec) {
		const remainingSec = totalEndSec - cursor;
		// If remaining audio fits within safe single-pass limit, finish in one final chunk
		if (remainingSec <= MAX_SINGLE_PASS_DURATION_SEC) {
			const endSec = totalEndSec;
			const duration = endSec - cursor;
			chunks.push({
				index,
				startSec: cursor,
				endSec,
				durationSec: duration,
				startMs: Math.round(cursor * 1000),
				endMs: Math.round(endSec * 1000),
				isSilenceBoundary: false,
			});
			break;
		}

		const windowMinSec = cursor + MIN_SPLIT_SEC;
		const windowMaxSec = cursor + MAX_SPLIT_SEC;
		const windowMinMs = Math.round(windowMinSec * 1000);
		const windowMaxMs = Math.round(windowMaxSec * 1000);
		const targetSplitMs = Math.round((cursor + TARGET_CHUNK_DURATION_SEC) * 1000);

		// Find candidate silences overlapping [windowMinMs, windowMaxMs]
		const candidateSilences = silences.filter((s) => {
			const clampedStart = Math.max(s.startMs, windowMinMs);
			const clampedEnd = Math.min(s.endMs, windowMaxMs);
			return clampedEnd - clampedStart >= 250; // at least 250ms silence inside window
		});

		if (candidateSilences.length > 0) {
			let bestSilence = candidateSilences[0];
			let minDiff = Number.POSITIVE_INFINITY;
			for (const s of candidateSilences) {
				const midMs =
					(Math.max(s.startMs, windowMinMs) + Math.min(s.endMs, windowMaxMs)) / 2;
				const diff = Math.abs(midMs - targetSplitMs);
				if (diff < minDiff) {
					minDiff = diff;
					bestSilence = s;
				}
			}

			const sClampedStart = Math.max(bestSilence.startMs, windowMinMs);
			const sClampedEnd = Math.min(bestSilence.endMs, windowMaxMs);
			const splitMs = Math.round((sClampedStart + sClampedEnd) / 2);
			const splitSec = splitMs / 1000;
			const duration = splitSec - cursor;

			chunks.push({
				index,
				startSec: cursor,
				endSec: splitSec,
				durationSec: duration,
				startMs: Math.round(cursor * 1000),
				endMs: splitMs,
				isSilenceBoundary: true,
			});

			// Silence boundary split: no audio overlap required
			cursor = splitSec;
		} else {
			// No silence found: fixed 20-second chunk with 0.5-second overlap
			const endSec = cursor + TARGET_CHUNK_DURATION_SEC;
			chunks.push({
				index,
				startSec: cursor,
				endSec,
				durationSec: TARGET_CHUNK_DURATION_SEC,
				startMs: Math.round(cursor * 1000),
				endMs: Math.round(endSec * 1000),
				isSilenceBoundary: false,
			});

			// Advance by 19.5s (20s - 0.5s overlap)
			cursor = endSec - OVERLAP_DURATION_SEC;
		}

		index++;
	}

	return chunks;
}

/**
 * Extracts an audio slice into a 16kHz mono 16-bit PCM WAV chunk using FFmpeg.
 */
export async function sliceAudioChunk(options: {
	ffmpegPath: string;
	inputWavPath: string;
	outputWavPath: string;
	startSec: number;
	durationSec: number;
}): Promise<void> {
	await execFileAsync(
		options.ffmpegPath,
		[
			"-y",
			"-ss",
			options.startSec.toFixed(3),
			"-i",
			options.inputWavPath,
			"-t",
			options.durationSec.toFixed(3),
			"-vn",
			"-ac",
			"1",
			"-ar",
			"16000",
			"-af",
			"aresample=16000:async=1:first_pts=0,asetpts=PTS-STARTPTS",
			"-c:a",
			"pcm_s16le",
			options.outputWavPath,
		],
		{ timeout: 60_000, maxBuffer: 4 * 1024 * 1024 },
	);
}

/**
 * Adds an offset in milliseconds to cue and word timestamps.
 */
export function adjustCueOffsets(cues: CaptionCuePayload[], offsetMs: number): CaptionCuePayload[] {
	if (offsetMs === 0) return cues;
	return cues.map((cue) => {
		const adjustedWords = cue.words?.map((word) => ({
			...word,
			startMs: word.startMs + offsetMs,
			endMs: word.endMs + offsetMs,
		}));

		return {
			...cue,
			startMs: cue.startMs + offsetMs,
			endMs: cue.endMs + offsetMs,
			...(adjustedWords ? { words: adjustedWords } : {}),
		};
	});
}

function normalizeWord(text: string): string {
	return text
		.toLowerCase()
		.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "")
		.trim();
}

function wordsMatch(w1: CaptionWordPayload, w2: CaptionWordPayload): boolean {
	const t1 = normalizeWord(w1.text);
	const t2 = normalizeWord(w2.text);
	if (!t1 || !t2) return false;
	const minLen = Math.min(t1.length, t2.length);
	const isSubword = t1 === t2 || (minLen >= 3 && (t1.startsWith(t2) || t2.startsWith(t1)));
	const timeOverlap = Math.max(w1.startMs, w2.startMs) < Math.min(w1.endMs, w2.endMs) + 150;
	const startDiff = Math.abs(w1.startMs - w2.startMs);
	return isSubword && (timeOverlap || startDiff <= 400);
}

/**
 * Merges words from multiple consecutive chunks, eliminating duplicates in overlap windows.
 */
export function mergeAndDeduplicateWords(
	wordRuns: CaptionWordPayload[][],
	chunks: AudioChunk[],
): CaptionWordPayload[] {
	if (wordRuns.length === 0) return [];
	if (wordRuns.length === 1) return wordRuns[0];

	let merged: CaptionWordPayload[] = [...wordRuns[0]];

	for (let i = 1; i < wordRuns.length; i++) {
		const currentWords = wordRuns[i];
		if (currentWords.length === 0) continue;
		if (merged.length === 0) {
			merged = [...currentWords];
			continue;
		}

		const prevChunk = chunks[i - 1];
		const currChunk = chunks[i];
		const hasAudioOverlap = Boolean(
			prevChunk && currChunk && currChunk.startMs < prevChunk.endMs,
		);

		if (!hasAudioOverlap) {
			merged.push(...currentWords);
			continue;
		}

		const overlapStartMs = currChunk.startMs;
		const overlapEndMs = prevChunk.endMs;
		const overlapMidpointMs = Math.round((overlapStartMs + overlapEndMs) / 2);

		const filteredCurrentWords: CaptionWordPayload[] = [];

		for (const currWord of currentWords) {
			if (currWord.startMs >= overlapEndMs) {
				filteredCurrentWords.push(currWord);
				continue;
			}

			const duplicateIndex = merged.findIndex(
				(mw) => mw.endMs > overlapStartMs - 200 && wordsMatch(mw, currWord),
			);

			if (duplicateIndex !== -1) {
				const existing = merged[duplicateIndex];
				const normExisting = normalizeWord(existing.text);
				const normCurr = normalizeWord(currWord.text);
				if (normCurr.length > normExisting.length) {
					merged[duplicateIndex] = {
						...currWord,
						startMs: Math.min(existing.startMs, currWord.startMs),
						endMs: Math.max(existing.endMs, currWord.endMs),
					};
				}
				continue;
			}

			const wordCenter = (currWord.startMs + currWord.endMs) / 2;
			if (wordCenter < overlapMidpointMs) {
				const timeCoveredInMerged = merged.some(
					(mw) =>
						Math.max(mw.startMs, currWord.startMs) < Math.min(mw.endMs, currWord.endMs),
				);
				if (!timeCoveredInMerged) {
					filteredCurrentWords.push(currWord);
				}
			} else {
				filteredCurrentWords.push(currWord);
			}
		}

		merged.push(...filteredCurrentWords);
	}

	merged.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);

	const sanitized: CaptionWordPayload[] = [];
	for (let k = 0; k < merged.length; k++) {
		const word = { ...merged[k] };
		if (sanitized.length > 0) {
			const prev = sanitized[sanitized.length - 1];
			if (word.startMs < prev.endMs) {
				prev.endMs = Math.min(prev.endMs, word.startMs);
				if (prev.endMs <= prev.startMs) {
					prev.endMs = prev.startMs + 50;
					word.startMs = Math.max(word.startMs, prev.endMs);
				}
			}
			word.leadingSpace = word.leadingSpace !== false;
		} else {
			word.leadingSpace = false;
		}

		if (word.endMs <= word.startMs) {
			word.endMs = word.startMs + 50;
		}

		sanitized.push(word);
	}

	return sanitized;
}

/**
 * Merges and deduplicates cues from all chunks sequentially so they seamlessly
 * feed into segmentCuesIntoPhrases.
 */
export function mergeAndDeduplicateChunkCues(
	chunkCuesList: CaptionCuePayload[][],
	chunks: AudioChunk[],
): CaptionCuePayload[] {
	const allCues = chunkCuesList.flat();
	if (allCues.length === 0) return [];

	const hasWords = allCues.some((c) => Array.isArray(c.words) && c.words.length > 0);
	if (hasWords) {
		const wordRuns: CaptionWordPayload[][] = chunkCuesList.map((chunkCues, chunkIndex) => {
			const words: CaptionWordPayload[] = [];
			const chunk = chunks[chunkIndex];
			const chunkStartMs = chunk ? chunk.startMs : 0;
			for (const cue of chunkCues) {
				if (cue.words && cue.words.length > 0) {
					for (const word of cue.words) {
						// Ensure word timestamps strictly anchor to chunk's absolute timeline offset
						const needsOffset = chunkStartMs > 0 && word.startMs < chunkStartMs;
						words.push({
							...word,
							startMs: needsOffset ? word.startMs + chunkStartMs : word.startMs,
							endMs: needsOffset ? word.endMs + chunkStartMs : word.endMs,
						});
					}
				} else if (cue.text?.trim()) {
					// Chunks returning only wordless cues retain transcript text positioned by chunk.startMs
					const chunkEndMs = chunk ? chunk.endMs : cue.endMs + chunkStartMs;
					const tokens = cue.text.trim().split(/\s+/).filter(Boolean);
					if (tokens.length > 0) {
						const totalSpanMs = Math.max(
							chunkEndMs - chunkStartMs,
							tokens.length * 200,
						);
						const wordDuration = Math.max(50, Math.floor(totalSpanMs / tokens.length));
						tokens.forEach((token, idx) => {
							const wStart = chunkStartMs + idx * wordDuration;
							const wEnd = Math.min(chunkEndMs, wStart + wordDuration);
							words.push({
								text: token,
								startMs: wStart,
								endMs: Math.max(wStart + 50, wEnd),
								leadingSpace: true,
							});
						});
					}
				}
			}
			return words;
		});

		const mergedWords = mergeAndDeduplicateWords(wordRuns, chunks);
		if (mergedWords.length === 0) return [];

		const text = buildCaptionTextFromWords(mergedWords);
		return [
			{
				id: "caption-1",
				startMs: mergedWords[0].startMs,
				endMs: mergedWords[mergedWords.length - 1].endMs,
				text,
				words: mergedWords,
			},
		];
	}

	// Fallback for wordless captions
	return allCues.map((cue, index) => {
		const chunk = chunks[index];
		const chunkStartMs = chunk ? chunk.startMs : 0;
		const needsOffset = chunkStartMs > 0 && cue.startMs < chunkStartMs;
		return {
			...cue,
			id: `caption-${index + 1}`,
			startMs: needsOffset ? cue.startMs + chunkStartMs : cue.startMs,
			endMs: needsOffset ? cue.endMs + chunkStartMs : cue.endMs,
		};
	});
}
