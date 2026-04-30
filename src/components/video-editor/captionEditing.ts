import type { CaptionCue, CaptionCueWord } from "./types";

export interface CaptionEditWordRef {
	cueId: string;
	cueWordIndex: number;
	startMs: number;
	endMs: number;
	text: string;
	leadingSpace: boolean;
}

export interface CaptionEditTarget {
	id: string;
	startMs: number;
	endMs: number;
	text: string;
	words: CaptionEditWordRef[];
}

export function normalizeCaptionEditText(text: string) {
	return text.trim().replace(/\s+/g, " ");
}

function buildCaptionWordsForEditedText(
	text: string,
	startMs: number,
	endMs: number,
): CaptionCueWord[] {
	const normalizedText = normalizeCaptionEditText(text);
	const tokens = normalizedText.match(/\S+/g) ?? [];
	const normalizedStartMs = Math.max(0, Math.round(startMs));
	const normalizedEndMs = Math.max(normalizedStartMs + 1, Math.round(endMs));
	const durationMs = normalizedEndMs - normalizedStartMs;

	return tokens.map((token, index) => {
		const wordStartMs = Math.min(
			normalizedEndMs - 1,
			Math.max(
				normalizedStartMs,
				Math.round(normalizedStartMs + (durationMs * index) / tokens.length),
			),
		);
		const nextBoundaryMs =
			index === tokens.length - 1
				? normalizedEndMs
				: Math.round(normalizedStartMs + (durationMs * (index + 1)) / tokens.length);
		const wordEndMs = Math.min(normalizedEndMs, Math.max(wordStartMs + 1, nextBoundaryMs));

		return {
			text: token,
			startMs: wordStartMs,
			endMs: wordEndMs,
			...(index > 0 ? { leadingSpace: true } : {}),
		};
	});
}

function normalizeCaptionWords(cue: CaptionCue): CaptionCueWord[] {
	const sourceWords =
		Array.isArray(cue.words) && cue.words.length > 0
			? cue.words
			: buildCaptionWordsForEditedText(cue.text, cue.startMs, cue.endMs);

	return sourceWords
		.filter((word): word is CaptionCueWord => Boolean(word && typeof word.text === "string"))
		.map((word) => {
			const startMs = Math.max(
				cue.startMs,
				Math.min(cue.endMs - 1, Math.round(word.startMs)),
			);
			const endMs = Math.max(startMs + 1, Math.min(cue.endMs, Math.round(word.endMs)));

			return {
				text: normalizeCaptionEditText(word.text),
				startMs,
				endMs,
				...(word.leadingSpace ? { leadingSpace: true } : {}),
			};
		})
		.filter((word) => word.text.length > 0);
}

function captionWordsToText(words: CaptionCueWord[]) {
	return words
		.map((word, index) => `${index > 0 && word.leadingSpace ? " " : ""}${word.text}`)
		.join("")
		.trim();
}

function normalizeCaptionWordSpacing(words: CaptionCueWord[]): CaptionCueWord[] {
	return words
		.slice()
		.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs)
		.map((word, index) => ({
			text: word.text,
			startMs: word.startMs,
			endMs: word.endMs,
			...(index > 0 ? { leadingSpace: true } : {}),
		}));
}

function shouldPreserveCaptionWords(cue: CaptionCue) {
	return Array.isArray(cue.words) && cue.words.length > 0;
}

export function updateCaptionCuesForEditedTarget(
	cues: CaptionCue[],
	target: CaptionEditTarget,
	text: string,
): CaptionCue[] {
	const normalizedText = normalizeCaptionEditText(text);
	if (!normalizedText || target.words.length === 0) {
		return cues;
	}

	const targetWordsByCue = new Map<string, CaptionEditWordRef[]>();
	for (const word of target.words) {
		const words = targetWordsByCue.get(word.cueId) ?? [];
		words.push(word);
		targetWordsByCue.set(word.cueId, words);
	}

	const tokens = normalizedText.match(/\S+/g) ?? [];
	const targetCueIds = new Set(targetWordsByCue.keys());
	const cueSegments = cues
		.filter((cue) => targetCueIds.has(cue.id))
		.map((cue) => {
			const words = targetWordsByCue.get(cue.id) ?? [];
			return {
				cue,
				startMs: Math.min(...words.map((word) => word.startMs)),
				endMs: Math.max(...words.map((word) => word.endMs)),
			};
		})
		.filter((segment) => Number.isFinite(segment.startMs) && Number.isFinite(segment.endMs));
	const editedWordsByCue = new Map<string, CaptionCueWord[]>();
	const tokenCountsByCue = distributeEditedTokensAcrossCueSegments(tokens.length, cueSegments);
	let tokenCursor = 0;

	for (const segment of cueSegments) {
		const tokenCount = tokenCountsByCue.get(segment.cue.id) ?? 0;
		if (tokenCount <= 0) {
			continue;
		}

		const segmentTokens = tokens.slice(tokenCursor, tokenCursor + tokenCount);
		tokenCursor += tokenCount;
		editedWordsByCue.set(
			segment.cue.id,
			buildCaptionWordsForEditedText(segmentTokens.join(" "), segment.startMs, segment.endMs),
		);
	}

	return cues.map((cue) => {
		const targetWords = targetWordsByCue.get(cue.id);
		if (!targetWords) {
			return cue;
		}

		const targetIndexes = new Set(targetWords.map((word) => word.cueWordIndex));
		const existingWords = normalizeCaptionWords(cue);
		const keptWords = existingWords.filter((_, index) => !targetIndexes.has(index));
		const nextWords = normalizeCaptionWordSpacing([
			...keptWords,
			...(editedWordsByCue.get(cue.id) ?? []),
		]);
		const shouldKeepWords = shouldPreserveCaptionWords(cue);

		return {
			id: cue.id,
			startMs: cue.startMs,
			endMs: cue.endMs,
			text: captionWordsToText(nextWords),
			...(shouldKeepWords && nextWords.length > 0 ? { words: nextWords } : {}),
		};
	});
}

function distributeEditedTokensAcrossCueSegments(
	tokenCount: number,
	segments: Array<{ cue: CaptionCue; startMs: number; endMs: number }>,
) {
	const tokenCountsByCue = new Map<string, number>();
	if (tokenCount <= 0 || segments.length === 0) {
		return tokenCountsByCue;
	}

	if (tokenCount < segments.length) {
		const largestSegments = [...segments]
			.sort((a, b) => b.endMs - b.startMs - (a.endMs - a.startMs))
			.slice(0, tokenCount);
		const selectedCueIds = new Set(largestSegments.map((segment) => segment.cue.id));
		for (const segment of segments) {
			tokenCountsByCue.set(segment.cue.id, selectedCueIds.has(segment.cue.id) ? 1 : 0);
		}
		return tokenCountsByCue;
	}

	const baseTokenCount = 1;
	const remainingTokens = tokenCount - segments.length;
	const totalDuration = Math.max(
		1,
		segments.reduce(
			(total, segment) => total + Math.max(1, segment.endMs - segment.startMs),
			0,
		),
	);
	const weightedCounts = segments.map((segment) => {
		const exactCount =
			(Math.max(1, segment.endMs - segment.startMs) / totalDuration) * remainingTokens;
		const extraCount = Math.floor(exactCount);
		return {
			segment,
			count: baseTokenCount + extraCount,
			remainder: exactCount - extraCount,
		};
	});
	let assignedTokens = weightedCounts.reduce((total, item) => total + item.count, 0);

	for (const item of [...weightedCounts].sort((a, b) => b.remainder - a.remainder)) {
		if (assignedTokens >= tokenCount) {
			break;
		}

		item.count += 1;
		assignedTokens += 1;
	}

	for (const item of weightedCounts) {
		tokenCountsByCue.set(item.segment.cue.id, item.count);
	}

	return tokenCountsByCue;
}
