import {
	captionWordsToText,
	normalizeCaptionWordSpacing,
	normalizeCaptionWords,
} from "./captionEditing";
import type { CaptionCue, CaptionCueWord } from "./types";

export interface CaptionRetimeSpan {
	startMs: number;
	endMs: number;
}

function sortCaptionCues(cues: CaptionCue[]): CaptionCue[] {
	return [...cues].sort(
		(left, right) => left.startMs - right.startMs || left.endMs - right.endMs,
	);
}

function createCaptionCueId(): string {
	return `caption-${globalThis.crypto.randomUUID()}`;
}

/**
 * Build a new caption cue with a generated id. Word timings are intentionally
 * omitted — the renderer derives placeholder per-word timings from the text
 * until the user adds real ones.
 */
export function createCaptionCue(params: {
	startMs: number;
	endMs: number;
	text?: string;
}): CaptionCue {
	const startMs = Math.round(params.startMs);
	return {
		id: createCaptionCueId(),
		startMs,
		// Preserve the minimum-duration invariant (endMs > startMs) for every caller.
		endMs: Math.max(startMs + 1, Math.round(params.endMs)),
		text: params.text ?? "",
	};
}

/** Insert a cue and keep the list ordered, matching the other cue operations. */
export function addCue(cues: CaptionCue[], cue: CaptionCue): CaptionCue[] {
	return sortCaptionCues([...cues, cue]);
}

function rescaleWordsIntoSpan(
	words: CaptionCueWord[],
	oldStartMs: number,
	oldEndMs: number,
	newStartMs: number,
	newEndMs: number,
): CaptionCueWord[] {
	const oldSpan = oldEndMs - oldStartMs;
	const newSpan = newEndMs - newStartMs;
	const factor = oldSpan > 0 ? newSpan / oldSpan : 0;

	let cursorMs = newStartMs;
	const rescaled: CaptionCueWord[] = [];

	words.forEach((word, index) => {
		const mappedStartMs =
			oldSpan > 0
				? newStartMs + (word.startMs - oldStartMs) * factor
				: newStartMs + (newSpan * index) / Math.max(1, words.length);
		const mappedEndMs =
			oldSpan > 0
				? newStartMs + (word.endMs - oldStartMs) * factor
				: newStartMs + (newSpan * (index + 1)) / Math.max(1, words.length);

		const startMs = Math.min(newEndMs - 1, Math.max(cursorMs, Math.round(mappedStartMs)));
		const endMs = Math.min(newEndMs, Math.max(startMs + 1, Math.round(mappedEndMs)));
		cursorMs = endMs;

		rescaled.push({
			text: word.text,
			startMs,
			endMs,
			...(word.leadingSpace ? { leadingSpace: true } : {}),
		});
	});

	return normalizeCaptionWordSpacing(rescaled);
}

export function retimeCue(cues: CaptionCue[], id: string, span: CaptionRetimeSpan): CaptionCue[] {
	const sorted = sortCaptionCues(cues);
	const index = sorted.findIndex((cue) => cue.id === id);
	if (index < 0) {
		return cues;
	}

	const cue = sorted[index];
	const newStartMs = Math.max(0, Math.round(span.startMs));
	const requestedEndMs = Math.max(newStartMs + 1, Math.round(span.endMs));

	const words =
		Array.isArray(cue.words) && cue.words.length > 0 ? normalizeCaptionWords(cue) : [];
	// Each word needs a monotonic, non-overlapping range of at least 1ms, so the span must
	// be at least as long as the word count. A shorter span would force later words to pile
	// up and overlap/reorder, so widen the end to the minimum viable span in that case.
	const newEndMs =
		words.length > 0 ? Math.max(requestedEndMs, newStartMs + words.length) : requestedEndMs;

	if (newStartMs === cue.startMs && newEndMs === cue.endMs) {
		return cues;
	}

	const nextWords =
		words.length > 0
			? rescaleWordsIntoSpan(words, cue.startMs, cue.endMs, newStartMs, newEndMs)
			: null;

	const nextCueValue: CaptionCue = {
		id: cue.id,
		startMs: newStartMs,
		endMs: newEndMs,
		text: nextWords ? captionWordsToText(nextWords) : cue.text,
		...(nextWords ? { words: nextWords } : {}),
	};

	const nextCues = sorted.map((value, valueIndex) =>
		valueIndex === index ? nextCueValue : value,
	);
	return sortCaptionCues(nextCues);
}

export function splitCue(cues: CaptionCue[], id: string, atMs: number): CaptionCue[] {
	const sorted = sortCaptionCues(cues);
	const index = sorted.findIndex((cue) => cue.id === id);
	if (index < 0) {
		return cues;
	}

	const cue = sorted[index];
	const words = normalizeCaptionWords(cue);
	if (words.length < 2) {
		return cues;
	}

	let splitIndex = 1;
	let nearestDistance = Number.POSITIVE_INFINITY;
	for (let candidate = 1; candidate < words.length; candidate += 1) {
		const boundaryMs = (words[candidate - 1].endMs + words[candidate].startMs) / 2;
		const distance = Math.abs(boundaryMs - atMs);
		if (distance < nearestDistance) {
			nearestDistance = distance;
			splitIndex = candidate;
		}
	}

	const leftWords = normalizeCaptionWordSpacing(words.slice(0, splitIndex));
	const rightWords = normalizeCaptionWordSpacing(words.slice(splitIndex));

	const leftCue: CaptionCue = {
		id: cue.id,
		startMs: cue.startMs,
		endMs: leftWords[leftWords.length - 1].endMs,
		text: captionWordsToText(leftWords),
		words: leftWords,
	};
	const rightCue: CaptionCue = {
		id: createCaptionCueId(),
		startMs: rightWords[0].startMs,
		endMs: cue.endMs,
		text: captionWordsToText(rightWords),
		words: rightWords,
	};

	const nextCues = sorted.flatMap((value, valueIndex) =>
		valueIndex === index ? [leftCue, rightCue] : [value],
	);
	return sortCaptionCues(nextCues);
}

export function mergeCues(cues: CaptionCue[], idA: string, idB: string): CaptionCue[] {
	const sorted = sortCaptionCues(cues);
	const indexA = sorted.findIndex((cue) => cue.id === idA);
	const indexB = sorted.findIndex((cue) => cue.id === idB);
	if (indexA < 0 || indexB < 0 || Math.abs(indexA - indexB) !== 1) {
		return cues;
	}

	const leftIndex = Math.min(indexA, indexB);
	const left = sorted[leftIndex];
	const right = sorted[leftIndex + 1];
	const mergedWords = normalizeCaptionWordSpacing([
		...normalizeCaptionWords(left),
		...normalizeCaptionWords(right),
	]);

	const mergedCue: CaptionCue = {
		id: left.id,
		startMs: left.startMs,
		endMs: right.endMs,
		text: captionWordsToText(mergedWords),
		words: mergedWords,
	};

	const nextCues = sorted.flatMap((value, valueIndex) => {
		if (valueIndex === leftIndex) {
			return [mergedCue];
		}
		if (valueIndex === leftIndex + 1) {
			return [];
		}
		return [value];
	});
	return sortCaptionCues(nextCues);
}

export function deleteCue(cues: CaptionCue[], id: string): CaptionCue[] {
	const next = cues.filter((cue) => cue.id !== id);
	return next.length === cues.length ? cues : sortCaptionCues(next);
}
