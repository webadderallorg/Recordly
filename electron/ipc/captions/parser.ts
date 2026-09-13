import type {
	CaptionCuePayload,
	CaptionWordPayload,
	WhisperJsonSegment,
	WhisperJsonToken,
} from "../types";

// Control tokens such as [_BEG_] and [_TT_612] carry no speech and have zero-length offsets.
const WHISPER_SPECIAL_TOKEN = /^\s*\[_[A-Z0-9_]+\]\s*$/;

// DTW timestamps land ~150 ms after the audible word onset (measured against isolated
// speech bursts in real recordings), so shift them earlier to keep captions on the audio.
export const DTW_ONSET_LAG_MS = 150;

function isFiniteNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

export function buildCaptionTextFromWords(words: CaptionWordPayload[]): string {
	return words
		.map((word, index) => `${index > 0 && word.leadingSpace ? " " : ""}${word.text}`)
		.join("")
		.trim();
}

type TimedToken = {
	text: string;
	startMs: number;
	endMs: number;
};

type RawSpeechToken = {
	text: string;
	fromMs: number | null;
	toMs: number | null;
	dtwMs: number | null;
};

function readSpeechTokens(tokens: unknown[]): RawSpeechToken[] {
	return tokens.flatMap((token) => {
		if (!token || typeof token !== "object") {
			return [];
		}
		const tokenData = token as WhisperJsonToken;
		const text = typeof tokenData.text === "string" ? tokenData.text : "";
		if (!text || WHISPER_SPECIAL_TOKEN.test(text)) {
			return [];
		}
		return [
			{
				text,
				fromMs: isFiniteNumber(tokenData.offsets?.from)
					? Math.round(tokenData.offsets.from)
					: null,
				toMs: isFiniteNumber(tokenData.offsets?.to)
					? Math.round(tokenData.offsets.to)
					: null,
				// whisper.cpp reports t_dtw in centiseconds and -1 when DTW is disabled.
				dtwMs:
					isFiniteNumber(tokenData.t_dtw) && tokenData.t_dtw >= 0
						? tokenData.t_dtw * 10
						: null,
			},
		];
	});
}

/** DTW onsets for every token (shifted by the measured lag), each ending at the next onset. */
function timeTokensWithDtw(tokens: RawSpeechToken[]): TimedToken[] {
	let previousStartMs = 0;
	const starts = tokens.map((token) => {
		previousStartMs = Math.max(previousStartMs, (token.dtwMs ?? 0) - DTW_ONSET_LAG_MS);
		return previousStartMs;
	});
	return tokens.map((token, index) => {
		const nextStartMs = starts[index + 1] ?? token.toMs ?? starts[index];
		return {
			text: token.text,
			startMs: starts[index],
			endMs: Math.max(nextStartMs, starts[index] + 1),
		};
	});
}

function timeTokensWithOffsets(tokens: RawSpeechToken[]): TimedToken[] | null {
	const timed: TimedToken[] = [];
	for (const token of tokens) {
		if (token.fromMs == null || token.toMs == null || token.toMs < token.fromMs) {
			return null;
		}
		// whisper.cpp emits zero-length timings for some short tokens; keep the word.
		timed.push({
			text: token.text,
			startMs: token.fromMs,
			endMs: Math.max(token.toMs, token.fromMs + 1),
		});
	}
	return timed;
}

function assembleWords(tokens: TimedToken[]): CaptionWordPayload[] {
	const words: CaptionWordPayload[] = [];
	let nextLeadingSpace = false;

	for (const token of tokens) {
		for (const part of token.text.match(/\s+|[^\s]+/g) ?? []) {
			if (/^\s+$/.test(part)) {
				nextLeadingSpace = words.length > 0;
				continue;
			}

			const previousWord = words.length > 0 ? words[words.length - 1] : null;
			if (!previousWord || nextLeadingSpace) {
				words.push({
					text: part,
					startMs: token.startMs,
					endMs: token.endMs,
					...(words.length > 0 && nextLeadingSpace ? { leadingSpace: true } : {}),
				});
			} else {
				previousWord.text += part;
				previousWord.endMs = Math.max(previousWord.endMs, token.endMs);
			}
			nextLeadingSpace = false;
		}
	}

	return words.filter((word) => word.text.trim().length > 0);
}

export function parseWhisperJsonWords(tokens: unknown): CaptionWordPayload[] {
	if (!Array.isArray(tokens)) {
		return [];
	}

	const speechTokens = readSpeechTokens(tokens);
	const hasCompleteDtw =
		speechTokens.length > 0 && speechTokens.every((token) => token.dtwMs !== null);
	const timedTokens = hasCompleteDtw
		? timeTokensWithDtw(speechTokens)
		: timeTokensWithOffsets(speechTokens);

	return timedTokens ? assembleWords(timedTokens) : [];
}

export function parseWhisperJsonCues(content: string): CaptionCuePayload[] {
	try {
		const parsed = JSON.parse(content) as {
			transcription?: unknown;
		};

		if (!Array.isArray(parsed.transcription)) {
			return [];
		}

		return parsed.transcription
			.map((segment, index) => {
				if (!segment || typeof segment !== "object") {
					return null;
				}

				const segmentData = segment as WhisperJsonSegment;
				const startMs = isFiniteNumber(segmentData.offsets?.from)
					? Math.round(segmentData.offsets.from)
					: null;
				const endMs = isFiniteNumber(segmentData.offsets?.to)
					? Math.round(segmentData.offsets.to)
					: null;
				const segmentText =
					typeof segmentData.text === "string" ? segmentData.text.trim() : "";

				if (startMs == null || endMs == null || endMs <= startMs) {
					return null;
				}

				const words = parseWhisperJsonWords(segmentData.tokens);
				const text = words.length > 0 ? buildCaptionTextFromWords(words) : segmentText;

				if (!text) {
					return null;
				}

				return {
					id: `caption-${index + 1}`,
					startMs,
					endMs,
					text,
					...(words.length > 0 ? { words } : {}),
				};
			})
			.filter((cue): cue is CaptionCuePayload => cue != null);
	} catch (error) {
		console.warn("[auto-captions] Failed to parse Whisper JSON output:", error);
		return [];
	}
}

export function parseSrtTimestamp(value: string): number | null {
	const match = value.trim().match(/^(\d{2}):(\d{2}):(\d{2}),(\d{3})$/);
	if (!match) {
		return null;
	}

	const [, hours, minutes, seconds, milliseconds] = match;
	return (
		Number(hours) * 60 * 60 * 1000 +
		Number(minutes) * 60 * 1000 +
		Number(seconds) * 1000 +
		Number(milliseconds)
	);
}

export function parseSrtCues(content: string): CaptionCuePayload[] {
	return content
		.split(/\r?\n\r?\n/)
		.map((block, index) => {
			const lines = block.split(/\r?\n/).map((line) => line.trim());
			const timingLine = lines.find((line) => line.includes("-->"));
			if (!timingLine) {
				return null;
			}

			const [rawStart, rawEnd] = timingLine.split("-->").map((part) => part.trim());
			const startMs = parseSrtTimestamp(rawStart);
			const endMs = parseSrtTimestamp(rawEnd);
			if (startMs == null || endMs == null || endMs <= startMs) {
				return null;
			}

			const text = lines
				.slice(lines.indexOf(timingLine) + 1)
				.filter((line) => line.length > 0)
				.join("\n")
				.trim();

			if (!text) {
				return null;
			}

			return {
				id: `caption-${index + 1}`,
				startMs,
				endMs,
				text,
			};
		})
		.filter((cue): cue is CaptionCuePayload => cue != null);
}

export function shouldRetryWhisperWithoutJson(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	return /unknown argument|output-json-full|output-json|ojf|\boj\b/i.test(message);
}
