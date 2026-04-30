import type { CaptionEditTarget } from "./captionEditing";
import type {
	AutoCaptionAnimation,
	AutoCaptionSettings,
	CaptionCue,
	CaptionCueWord,
} from "./types";

export type CaptionWordState = "spoken" | "active" | "upcoming";

export interface CaptionWordLayout {
	cueId: string;
	cueWordIndex: number;
	text: string;
	index: number;
	forcedBreakBefore: boolean;
	leadingSpace: boolean;
	startMs: number;
	endMs: number;
	hasRealTiming: boolean;
	state: CaptionWordState;
}

export interface CaptionLineLayout {
	words: CaptionWordLayout[];
	width: number;
	startWordIndex: number;
	endWordIndex: number;
}

interface CaptionPageLayout {
	lines: CaptionLineLayout[];
	startMs: number;
	endMs: number;
}

export interface ActiveCaptionLayout {
	cue: CaptionCue;
	blockKey: string;
	visibleLines: CaptionLineLayout[];
	hasWordTimings: boolean;
	activeWordIndex: number;
	activeWordProgress: number;
	editTarget: CaptionEditTarget;
	visiblePageIndex: number;
	opacity: number;
	translateY: number;
	scale: number;
}

type CaptionSourceWord = {
	cueId: string;
	cueWordIndex: number;
	text: string;
	forcedBreakBefore: boolean;
	leadingSpace?: boolean;
	startMs?: number;
	endMs?: number;
};

const CAPTION_ENTER_MS = 180;
const CAPTION_EXIT_MS = 140;
const CAPTION_BLOCK_GAP_BREAK_MS = 500;

function clamp(value: number, min: number, max: number) {
	return Math.min(max, Math.max(min, value));
}

function clamp01(value: number) {
	return clamp(value, 0, 1);
}

function splitCaptionWordsFromText(text: string) {
	const sourceLines = text
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line.length > 0);
	const words: CaptionSourceWord[] = [];

	sourceLines.forEach((line, lineIndex) => {
		line.split(/\s+/)
			.filter(Boolean)
			.forEach((word, wordIndex) => {
				words.push({
					cueId: "",
					cueWordIndex: words.length,
					text: word,
					forcedBreakBefore: lineIndex > 0 && wordIndex === 0,
				});
			});
	});

	return words;
}

function splitCaptionWords(cue: CaptionCue) {
	if (Array.isArray(cue.words) && cue.words.length > 0) {
		return cue.words
			.filter((word): word is CaptionCueWord =>
				Boolean(word && typeof word.text === "string"),
			)
			.map((word, cueWordIndex) => ({
				cueId: cue.id,
				cueWordIndex,
				text: word.text.trim(),
				forcedBreakBefore: false,
				leadingSpace: Boolean(word.leadingSpace),
				startMs: word.startMs,
				endMs: word.endMs,
			}))
			.filter((word) => word.text.length > 0);
	}

	return splitCaptionWordsFromText(cue.text).map((word) => ({
		...word,
		cueId: cue.id,
	}));
}

function getActiveCaptionCue(cues: CaptionCue[], timeMs: number) {
	for (const cue of cues) {
		if (timeMs >= cue.startMs && timeMs <= cue.endMs) {
			return cue;
		}
	}

	return null;
}

function flattenCaptionWords(cues: CaptionCue[]) {
	const flattened: Array<{
		cueId: string;
		cueWordIndex: number;
		text: string;
		forcedBreakBefore: boolean;
		leadingSpace: boolean;
		startMs: number;
		endMs: number;
		hasRealTiming: boolean;
	}> = [];

	cues.forEach((cue, cueIndex) => {
		const sourceWords = splitCaptionWords(cue);
		if (sourceWords.length === 0) {
			return;
		}

		const cueHasRealWordTimings = sourceWords.every(
			(word) =>
				isFiniteNumber(word.startMs) &&
				isFiniteNumber(word.endMs) &&
				word.endMs > word.startMs,
		);
		const cueDuration = Math.max(1, cue.endMs - cue.startMs);
		const fallbackWordDuration = cueDuration / sourceWords.length;
		const previousCue = cueIndex > 0 ? cues[cueIndex - 1] : null;
		const shouldForceCueBreak =
			previousCue !== null && cue.startMs - previousCue.endMs >= CAPTION_BLOCK_GAP_BREAK_MS;

		sourceWords.forEach((word, wordIndex) => {
			const fallbackStartMs = cue.startMs + fallbackWordDuration * wordIndex;
			const fallbackEndMs =
				wordIndex === sourceWords.length - 1
					? cue.endMs
					: cue.startMs + fallbackWordDuration * (wordIndex + 1);
			const startsMergedCue =
				wordIndex === 0 && !word.forcedBreakBefore && !shouldForceCueBreak;
			const leadingSpace =
				wordIndex === 0
					? flattened.length > 0 && startsMergedCue
					: (word.leadingSpace ?? true);

			flattened.push({
				cueId: cue.id,
				cueWordIndex: word.cueWordIndex,
				text: word.text,
				forcedBreakBefore:
					word.forcedBreakBefore || (wordIndex === 0 && shouldForceCueBreak),
				leadingSpace,
				startMs: cueHasRealWordTimings ? word.startMs! : fallbackStartMs,
				endMs: cueHasRealWordTimings
					? word.endMs!
					: Math.max(fallbackStartMs + 1, fallbackEndMs),
				hasRealTiming: cueHasRealWordTimings,
			});
		});
	});

	return flattened;
}

function getCaptionAnimationState(
	animationStyle: AutoCaptionAnimation,
	enterProgress: number,
	exitProgress: number,
) {
	const visibility = Math.min(enterProgress, exitProgress);

	switch (animationStyle) {
		case "none":
			return {
				opacity: 1,
				translateY: 0,
				scale: 1,
			};
		case "fade":
			return {
				opacity: 0.3 + visibility * 0.7,
				translateY: 0,
				scale: 1,
			};
		case "rise":
			return {
				opacity: 0.25 + visibility * 0.75,
				translateY: (1 - visibility) * 18,
				scale: 0.985 + visibility * 0.015,
			};
		case "pop":
		default:
			return {
				opacity: 0.35 + visibility * 0.65,
				translateY: (1 - visibility) * 8,
				scale: 0.94 + visibility * 0.06,
			};
	}
}

function buildCaptionPages(options: {
	lines: CaptionLineLayout[];
	words: CaptionWordLayout[];
	maxRows: number;
	hasWordTimings: boolean;
	cue: CaptionCue;
}) {
	const pages: CaptionPageLayout[] = [];
	const totalPages = Math.max(1, Math.ceil(options.lines.length / options.maxRows));
	let lineIndex = 0;
	let remainingLines = options.lines.length;

	for (let pageIndex = 0; pageIndex < totalPages; pageIndex += 1) {
		const remainingPages = totalPages - pageIndex;
		const pageSize = Math.min(
			options.maxRows,
			Math.max(1, Math.ceil(remainingLines / remainingPages)),
		);
		const pageLines = options.lines.slice(lineIndex, lineIndex + pageSize);
		if (pageLines.length === 0) {
			continue;
		}

		lineIndex += pageLines.length;
		remainingLines -= pageLines.length;

		if (options.hasWordTimings) {
			const firstWord = options.words[pageLines[0].startWordIndex];
			const lastWord = options.words[pageLines[pageLines.length - 1].endWordIndex];
			pages.push({
				lines: pageLines,
				startMs: firstWord?.startMs ?? options.cue.startMs,
				endMs: lastWord?.endMs ?? options.cue.endMs,
			});
			continue;
		}

		pages.push({
			lines: pageLines,
			startMs: 0,
			endMs: 0,
		});
	}

	if (!options.hasWordTimings) {
		const totalWords = Math.max(1, options.words.length);
		const cueDuration = Math.max(1, options.cue.endMs - options.cue.startMs);
		let elapsedMs = options.cue.startMs;

		pages.forEach((page, pageIndex) => {
			const pageWordCount = page.lines.reduce((count, line) => count + line.words.length, 0);
			const proportionalDuration = Math.round((cueDuration * pageWordCount) / totalWords);
			const nextElapsed =
				pageIndex === pages.length - 1
					? options.cue.endMs
					: Math.min(options.cue.endMs, elapsedMs + Math.max(1, proportionalDuration));

			page.startMs = elapsedMs;
			page.endMs = Math.max(elapsedMs + 1, nextElapsed);
			elapsedMs = page.endMs;
		});
	}

	for (let index = 0; index < pages.length - 1; index += 1) {
		pages[index].endMs = Math.max(pages[index].startMs + 1, pages[index + 1].startMs);
	}

	if (pages.length > 0) {
		pages[pages.length - 1].endMs = Math.max(
			pages[pages.length - 1].startMs + 1,
			options.cue.endMs,
		);
	}

	return pages;
}

function buildCaptionLines(options: {
	words: CaptionWordLayout[];
	maxWidthPx: number;
	measureText: (text: string) => number;
}) {
	const wordCount = options.words.length;
	const segmentWidths = options.words.map((word, index) => {
		if (index === 0) {
			return options.measureText(word.text);
		}

		return options.measureText(`${word.leadingSpace ? " " : ""}${word.text}`);
	});
	const plainWordWidths = options.words.map((word) => options.measureText(word.text));
	const bestCost = new Array<number>(wordCount + 1).fill(Number.POSITIVE_INFINITY);
	const nextBreak = new Array<number>(wordCount).fill(wordCount);

	bestCost[wordCount] = 0;

	for (let startIndex = wordCount - 1; startIndex >= 0; startIndex -= 1) {
		let lineWidth = plainWordWidths[startIndex];

		for (let endIndex = startIndex; endIndex < wordCount; endIndex += 1) {
			if (endIndex > startIndex) {
				if (options.words[endIndex].forcedBreakBefore) {
					break;
				}

				lineWidth += segmentWidths[endIndex];
			}

			if (lineWidth > options.maxWidthPx && endIndex > startIndex) {
				break;
			}

			const slack = Math.max(0, options.maxWidthPx - lineWidth);
			const fullness = options.maxWidthPx <= 0 ? 1 : lineWidth / options.maxWidthPx;
			const isLastLine = endIndex === wordCount - 1;
			const linePenalty = isLastLine
				? slack * slack * 0.18
				: slack * slack + (fullness < 0.72 ? (0.72 - fullness) * 26000 : 0);
			const candidateCost = linePenalty + bestCost[endIndex + 1];

			if (candidateCost < bestCost[startIndex]) {
				bestCost[startIndex] = candidateCost;
				nextBreak[startIndex] = endIndex + 1;
			}
		}
	}

	const lines: CaptionLineLayout[] = [];
	let startIndex = 0;

	while (startIndex < wordCount) {
		const endIndexExclusive = Math.max(startIndex + 1, nextBreak[startIndex]);
		const lineWords = options.words.slice(startIndex, endIndexExclusive).map((word, index) => ({
			...word,
			leadingSpace: index === 0 ? false : word.leadingSpace,
		}));
		const width = lineWords.reduce(
			(total, word, index) =>
				total +
				options.measureText(
					`${index === 0 ? "" : word.leadingSpace ? " " : ""}${word.text}`,
				),
			0,
		);

		lines.push({
			words: lineWords,
			width,
			startWordIndex: lineWords[0].index,
			endWordIndex: lineWords[lineWords.length - 1].index,
		});

		startIndex = endIndexExclusive;
	}

	return lines;
}

function getVisibleCaptionPageIndex(pages: CaptionPageLayout[], timeMs: number) {
	for (let index = 0; index < pages.length; index += 1) {
		if (timeMs >= pages[index].startMs && timeMs <= pages[index].endMs) {
			return index;
		}
	}

	return -1;
}

function getVisibleCaptionText(lines: CaptionLineLayout[]) {
	return lines
		.map((line) =>
			line.words
				.map((word, index) => `${index > 0 && word.leadingSpace ? " " : ""}${word.text}`)
				.join("")
				.trim(),
		)
		.filter(Boolean)
		.join(" ");
}

export function buildActiveCaptionLayout(options: {
	cues: CaptionCue[];
	timeMs: number;
	settings: AutoCaptionSettings;
	maxWidthPx: number;
	measureText: (text: string) => number;
}) {
	const sourceWords = flattenCaptionWords(options.cues);
	if (sourceWords.length === 0) {
		return null;
	}

	let activeWordIndex = -1;
	activeWordIndex = sourceWords.findIndex(
		(word) => options.timeMs >= word.startMs && options.timeMs < word.endMs,
	);
	if (activeWordIndex < 0) {
		activeWordIndex = sourceWords.findIndex((word) => options.timeMs < word.startMs);
		activeWordIndex =
			activeWordIndex < 0
				? sourceWords.length - 1
				: clamp(activeWordIndex - 1, 0, sourceWords.length - 1);
	}
	const maxRows = clamp(Math.round(options.settings.maxRows || 1), 1, 4);

	const words: CaptionWordLayout[] = sourceWords.map((word, index) => {
		return {
			cueId: word.cueId,
			cueWordIndex: word.cueWordIndex,
			text: word.text,
			index,
			forcedBreakBefore: word.forcedBreakBefore,
			leadingSpace: word.leadingSpace,
			startMs: word.startMs,
			endMs: word.endMs,
			hasRealTiming: word.hasRealTiming,
			state:
				index < activeWordIndex
					? "spoken"
					: index === activeWordIndex
						? "active"
						: "upcoming",
		};
	});

	const lines = buildCaptionLines({
		words,
		maxWidthPx: options.maxWidthPx,
		measureText: options.measureText,
	});

	const pages = buildCaptionPages({
		lines,
		words,
		maxRows,
		hasWordTimings: true,
		cue: {
			id: sourceWords[0].cueId,
			startMs: sourceWords[0].startMs,
			endMs: sourceWords[sourceWords.length - 1].endMs,
			text: "",
		},
	});
	const visiblePageIndex = getVisibleCaptionPageIndex(pages, options.timeMs);
	if (visiblePageIndex < 0) {
		return null;
	}
	const visiblePage = pages[visiblePageIndex] ?? null;
	const visibleLines = visiblePage?.lines ?? lines.slice(0, maxRows);
	const activeWord = activeWordIndex >= 0 ? words[activeWordIndex] : null;
	const activeWordProgress = activeWord
		? clamp01(
				(options.timeMs - activeWord.startMs) /
					Math.max(1, activeWord.endMs - activeWord.startMs),
			)
		: 0;
	const animationStartMs = visiblePage?.startMs ?? sourceWords[0].startMs;
	const animationEndMs = visiblePage?.endMs ?? sourceWords[sourceWords.length - 1].endMs;
	const pageStartWordIndex = visibleLines[0]?.startWordIndex ?? 0;
	const visibleWords = visibleLines.flatMap((line) => line.words);
	const visibleHasWordTimings = visibleWords.every((word) => word.hasRealTiming);
	const pageCueId = sourceWords[pageStartWordIndex]?.cueId ?? sourceWords[0].cueId;
	const activeCue =
		getActiveCaptionCue(options.cues, options.timeMs) ??
		options.cues.find((candidate) => candidate.id === pageCueId) ??
		options.cues[0];
	const enterProgress = clamp01((options.timeMs - animationStartMs) / CAPTION_ENTER_MS);
	const exitProgress = clamp01((animationEndMs - options.timeMs) / CAPTION_EXIT_MS);
	const animation = getCaptionAnimationState(
		options.settings.animationStyle,
		enterProgress,
		exitProgress,
	);

	return {
		cue: activeCue,
		blockKey: `${Math.round(animationStartMs)}-${Math.round(animationEndMs)}`,
		visibleLines,
		hasWordTimings: visibleHasWordTimings,
		activeWordIndex,
		activeWordProgress,
		editTarget: {
			id: `${Math.round(animationStartMs)}-${Math.round(animationEndMs)}:${visibleWords
				.map((word) => `${word.cueId}:${word.cueWordIndex}`)
				.join("|")}`,
			startMs: animationStartMs,
			endMs: animationEndMs,
			text: getVisibleCaptionText(visibleLines),
			words: visibleWords.map((word) => ({
				cueId: word.cueId,
				cueWordIndex: word.cueWordIndex,
				startMs: word.startMs,
				endMs: word.endMs,
				text: word.text,
				leadingSpace: word.leadingSpace,
			})),
		},
		visiblePageIndex,
		opacity: animation.opacity,
		translateY: animation.translateY,
		scale: animation.scale,
	} satisfies ActiveCaptionLayout;
}

function isFiniteNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}
