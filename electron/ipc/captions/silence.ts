import type { CaptionCuePayload, CaptionWordPayload } from "../types";
import { buildCaptionTextFromWords } from "./parser";

/**
 * Silence-aware caption re-segmentation.
 *
 * Whisper breaks speech on its own internal boundaries, not on real pauses, so cues can
 * cover silence and continuous speech gets chopped arbitrarily. We re-segment against
 * ground-truth silence from ffmpeg `silencedetect` instead:
 *   ffmpeg silencedetect (stderr) -> parseSilenceIntervals -> resegmentCuesBySilence
 *
 * A phrase only breaks at a long pause (>= splitSilenceMs) or at silence touching the
 * transcript edges (leading/trailing trim). Short pauses are absorbed; speech not separated
 * by a long pause is merged; a region with no speech is dropped (drops hallucinations).
 */

/** ffmpeg `silencedetect` noise floor. Quieter than this counts as silence. */
export const SILENCE_NOISE_DB = -30;
/** ffmpeg `silencedetect` minimum silence duration (seconds) it should report at all. */
export const SILENCE_DETECT_MIN_S = 0.5;

/** A pause must be at least this long (ms) to break one phrase into two. The "sensitivity" knob. */
const DEFAULT_SPLIT_SILENCE_MS = 1_500;
/** Padding (ms) kept around each phrase so captions don't feel clipped. */
const DEFAULT_EDGE_PAD_MS = 80;
/** Speech regions shorter than this (ms) are dropped as artifacts. */
const DEFAULT_MIN_SPEECH_MS = 150;

export interface SilenceInterval {
	startMs: number;
	/** `Number.POSITIVE_INFINITY` for a trailing silence that runs to end-of-audio. */
	endMs: number;
}

export interface ResegmentOptions {
	/** Minimum pause (ms) that splits a phrase. Higher = fewer splits. */
	splitSilenceMs?: number;
	/** Padding (ms) kept around each phrase. */
	edgePadMs?: number;
	/** Speech regions shorter than this (ms) are dropped. */
	minSpeechMs?: number;
}

interface Span {
	startMs: number;
	endMs: number;
}

interface CaptionPiece extends Span {
	text: string;
	words?: CaptionWordPayload[];
}

/**
 * Parse ffmpeg `silencedetect` stderr into ordered, non-overlapping silence intervals.
 * Lines look like:
 *   [silencedetect @ 0x..] silence_start: 12.34
 *   [silencedetect @ 0x..] silence_end: 15.67 | silence_duration: 3.33
 */
export function parseSilenceIntervals(stderr: string): SilenceInterval[] {
	const intervals: SilenceInterval[] = [];
	let pendingStartMs: number | null = null;

	for (const line of stderr.split(/\r?\n/)) {
		const startMatch = line.match(/silence_start:\s*(-?[\d.]+)/);
		if (startMatch) {
			pendingStartMs = Math.max(0, Math.round(Number.parseFloat(startMatch[1]) * 1000));
			continue;
		}

		const endMatch = line.match(/silence_end:\s*(-?[\d.]+)/);
		if (endMatch && pendingStartMs !== null) {
			const endMs = Math.round(Number.parseFloat(endMatch[1]) * 1000);
			if (endMs > pendingStartMs) {
				intervals.push({ startMs: pendingStartMs, endMs });
			}
			pendingStartMs = null;
		}
	}

	// A trailing silence_start with no matching end runs to the end of the audio.
	if (pendingStartMs !== null) {
		intervals.push({ startMs: pendingStartMs, endMs: Number.POSITIVE_INFINITY });
	}

	return intervals.sort((left, right) => left.startMs - right.startMs);
}

/** Subtract a set of (sorted, non-overlapping) intervals from [startMs, endMs]. */
function subtractIntervals(startMs: number, endMs: number, intervals: Span[]): Span[] {
	const spans: Span[] = [];
	let cursor = startMs;

	for (const interval of intervals) {
		if (interval.endMs <= startMs || interval.startMs >= endMs) {
			continue;
		}
		const clippedStart = Math.max(interval.startMs, startMs);
		if (clippedStart > cursor) {
			spans.push({ startMs: cursor, endMs: clippedStart });
		}
		cursor = Math.max(cursor, Math.min(interval.endMs, endMs));
	}

	if (cursor < endMs) {
		spans.push({ startMs: cursor, endMs });
	}

	return spans;
}

function nearestRegionIndex(regions: Span[], timeMs: number): number {
	let bestIndex = 0;
	let bestDistance = Number.POSITIVE_INFINITY;
	regions.forEach((region, index) => {
		const distance =
			timeMs < region.startMs
				? region.startMs - timeMs
				: timeMs > region.endMs
					? timeMs - region.endMs
					: 0;
		if (distance < bestDistance) {
			bestDistance = distance;
			bestIndex = index;
		}
	});
	return bestIndex;
}

function joinText(existing: string, addition: string): string {
	return [existing, addition]
		.map((part) => part.trim())
		.filter(Boolean)
		.join(" ");
}

/**
 * Distribute a cue's plain text across the regions it overlaps, proportionally to how much
 * of the cue's duration falls in each region. Used only when a single Whisper cue straddles
 * a long pause (rare) and has no word timing.
 */
function splitTextProportionally(text: string, overlaps: Span[]): string[] {
	const tokens = text.trim().split(/\s+/).filter(Boolean);
	if (tokens.length === 0) {
		return overlaps.map(() => "");
	}

	const totalDurationMs =
		overlaps.reduce((sum, span) => sum + (span.endMs - span.startMs), 0) || 1;
	const result: string[] = [];
	let cursor = 0;

	overlaps.forEach((span, index) => {
		const isLast = index === overlaps.length - 1;
		const share = (span.endMs - span.startMs) / totalDurationMs;
		const count = isLast
			? tokens.length - cursor
			: Math.min(tokens.length - cursor, Math.round(tokens.length * share));
		result.push(tokens.slice(cursor, cursor + count).join(" "));
		cursor += count;
	});

	if (cursor < tokens.length) {
		result[result.length - 1] = joinText(
			result[result.length - 1],
			tokens.slice(cursor).join(" "),
		);
	}

	return result;
}

/** Pad spans toward neighbors by at most half the silent gap, so cues never overlap. */
export function padSpans(spans: Span[], edgePadMs: number): void {
	for (let index = 0; index < spans.length; index += 1) {
		const prevEndMs = index > 0 ? spans[index - 1].endMs : null;
		const nextStartMs = index < spans.length - 1 ? spans[index + 1].startMs : null;
		const rawStart = spans[index].startMs;
		const rawEnd = spans[index].endMs;

		const leftPad =
			prevEndMs === null
				? Math.min(edgePadMs, rawStart)
				: Math.min(edgePadMs, Math.floor(Math.max(0, rawStart - prevEndMs) / 2));
		const rightPad =
			nextStartMs === null
				? edgePadMs
				: Math.min(edgePadMs, Math.floor(Math.max(0, nextStartMs - rawEnd) / 2));

		spans[index].startMs = Math.max(0, Math.round(rawStart - leftPad));
		spans[index].endMs = Math.max(spans[index].startMs + 1, Math.round(rawEnd + rightPad));
	}
}

/**
 * Re-segment Whisper cues against detected silence into phrases that only break on long
 * pauses. Returns sorted, non-overlapping cues with fresh ids. If no silence is detected
 * the cues are merged into a single trimmed phrase (continuous speech).
 */
export function resegmentCuesBySilence(
	cues: CaptionCuePayload[],
	silences: SilenceInterval[],
	options: ResegmentOptions = {},
): CaptionCuePayload[] {
	const splitSilenceMs = options.splitSilenceMs ?? DEFAULT_SPLIT_SILENCE_MS;
	const edgePadMs = options.edgePadMs ?? DEFAULT_EDGE_PAD_MS;
	const minSpeechMs = options.minSpeechMs ?? DEFAULT_MIN_SPEECH_MS;

	if (cues.length === 0) {
		return [];
	}

	const sortedCues = [...cues].sort(
		(left, right) => left.startMs - right.startMs || left.endMs - right.endMs,
	);
	const transcriptStartMs = sortedCues[0].startMs;
	const transcriptEndMs = sortedCues.reduce(
		(max, cue) => Math.max(max, cue.endMs),
		transcriptStartMs,
	);

	// Boundaries = long pauses, plus any silence touching the transcript edges (so leading
	// and trailing silence is always trimmed even if short).
	const boundaries: Span[] = silences
		.map((silence) => ({
			startMs: Math.max(silence.startMs, transcriptStartMs),
			endMs: Math.min(silence.endMs, transcriptEndMs),
		}))
		.filter((span) => span.endMs > span.startMs)
		.filter(
			(span) =>
				span.endMs - span.startMs >= splitSilenceMs ||
				span.startMs <= transcriptStartMs ||
				span.endMs >= transcriptEndMs,
		)
		.sort((left, right) => left.startMs - right.startMs);

	const regions = subtractIntervals(transcriptStartMs, transcriptEndMs, boundaries).filter(
		(region) => region.endMs - region.startMs >= minSpeechMs,
	);
	if (regions.length === 0) {
		return [];
	}

	const regionTexts = regions.map(() => "");
	const regionWords: CaptionWordPayload[][] = regions.map(() => []);

	for (const cue of sortedCues) {
		const overlapping = regions
			.map((region, index) => ({ region, index }))
			.filter(({ region }) => cue.startMs < region.endMs && cue.endMs > region.startMs);
		if (overlapping.length === 0) {
			continue;
		}

		const words = Array.isArray(cue.words) ? (cue.words as CaptionWordPayload[]) : [];
		if (words.length > 0) {
			for (const word of words) {
				const center = (word.startMs + word.endMs) / 2;
				const match = overlapping.find(
					({ region }) => center >= region.startMs && center <= region.endMs,
				);
				const targetIndex =
					match?.index ??
					overlapping[
						nearestRegionIndex(
							overlapping.map((entry) => entry.region),
							center,
						)
					].index;
				regionWords[targetIndex].push(word);
			}
			continue;
		}

		if (overlapping.length === 1) {
			const { index } = overlapping[0];
			regionTexts[index] = joinText(regionTexts[index], cue.text);
			continue;
		}

		const overlaps = overlapping.map(({ region }) => ({
			startMs: Math.max(cue.startMs, region.startMs),
			endMs: Math.min(cue.endMs, region.endMs),
		}));
		const texts = splitTextProportionally(cue.text, overlaps);
		overlapping.forEach(({ index }, position) => {
			regionTexts[index] = joinText(regionTexts[index], texts[position]);
		});
	}

	const pieces = regions
		.map((region, index): CaptionPiece => {
			const words = regionWords[index]
				.slice()
				.sort((left, right) => left.startMs - right.startMs || left.endMs - right.endMs);
			if (words.length > 0) {
				return {
					startMs: words[0].startMs,
					endMs: words[words.length - 1].endMs,
					text: buildCaptionTextFromWords(words),
					words,
				};
			}
			return {
				startMs: region.startMs,
				endMs: region.endMs,
				text: regionTexts[index].trim(),
			};
		})
		.filter((piece) => piece.text.trim().length > 0);

	pieces.sort((left, right) => left.startMs - right.startMs || left.endMs - right.endMs);
	padSpans(pieces, edgePadMs);

	return pieces.map((piece, index) => ({
		id: `caption-${index + 1}`,
		startMs: piece.startMs,
		endMs: piece.endMs,
		text: piece.text,
		...(piece.words && piece.words.length > 0 ? { words: piece.words } : {}),
	}));
}
