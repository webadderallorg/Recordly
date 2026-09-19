import type {
	CaptionCuePayload,
	CaptionWordPayload,
	SherpaOnnxRecognitionResult,
	WhisperJsonSegment,
	WhisperJsonToken,
} from "../types";

function isFiniteNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

export function buildCaptionTextFromWords(words: CaptionWordPayload[]): string {
	return words
		.map((word, index) => `${index > 0 && word.leadingSpace ? " " : ""}${word.text}`)
		.join("")
		.trim();
}

export function parseWhisperJsonWords(tokens: unknown): CaptionWordPayload[] {
	if (!Array.isArray(tokens)) {
		return [];
	}

	const words: CaptionWordPayload[] = [];
	let nextLeadingSpace = false;

	for (const token of tokens) {
		if (!token || typeof token !== "object") {
			continue;
		}

		const tokenData = token as WhisperJsonToken;
		const tokenText = typeof tokenData.text === "string" ? tokenData.text : "";
		if (!tokenText) {
			continue;
		}

		const tokenStartMs = isFiniteNumber(tokenData.offsets?.from)
			? Math.round(tokenData.offsets.from)
			: null;
		const tokenEndMs = isFiniteNumber(tokenData.offsets?.to)
			? Math.round(tokenData.offsets.to)
			: null;
		const parts = tokenText.match(/\s+|[^\s]+/g) ?? [];

		for (const part of parts) {
			if (/^\s+$/.test(part)) {
				nextLeadingSpace = words.length > 0;
				continue;
			}

			if (tokenStartMs == null || tokenEndMs == null || tokenEndMs <= tokenStartMs) {
				return [];
			}

			const previousWord = words.length > 0 ? words[words.length - 1] : null;
			if (!previousWord || nextLeadingSpace) {
				words.push({
					text: part,
					startMs: tokenStartMs,
					endMs: tokenEndMs,
					...(words.length > 0 && nextLeadingSpace ? { leadingSpace: true } : {}),
				});
			} else {
				previousWord.text += part;
				previousWord.endMs = Math.max(previousWord.endMs, tokenEndMs);
			}

			nextLeadingSpace = false;
		}
	}

	return words.filter((word) => word.text.trim().length > 0);
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

export function parseParakeetJsonWords(
	tokens: unknown,
	timestamps: unknown,
	durations: unknown,
): CaptionWordPayload[] {
	if (!Array.isArray(tokens) || !Array.isArray(timestamps)) {
		return [];
	}

	const words: CaptionWordPayload[] = [];
	const numTokens = Math.min(tokens.length, timestamps.length);
	const durationArr = Array.isArray(durations) ? durations : [];

	for (let i = 0; i < numTokens; i++) {
		const rawToken = tokens[i];
		if (typeof rawToken !== "string" || !rawToken) {
			continue;
		}

		// Handle byte escapes like "<0xXX>" if any
		let tokenStr = rawToken;
		if (tokenStr.startsWith("<0x") && tokenStr.endsWith(">")) {
			try {
				const hex = tokenStr.slice(3, -1);
				tokenStr = String.fromCharCode(Number.parseInt(hex, 16));
			} catch {
				continue;
			}
		}

		const rawStartSec = timestamps[i];
		if (typeof rawStartSec !== "number" || !Number.isFinite(rawStartSec)) {
			continue;
		}
		const startMs = Math.round(rawStartSec * 1000);

		const rawDurationSec = durationArr[i];
		let endMs: number;
		if (
			typeof rawDurationSec === "number" &&
			Number.isFinite(rawDurationSec) &&
			rawDurationSec > 0
		) {
			endMs = startMs + Math.round(rawDurationSec * 1000);
		} else if (
			i + 1 < timestamps.length &&
			typeof timestamps[i + 1] === "number" &&
			Number.isFinite(timestamps[i + 1])
		) {
			endMs = Math.max(startMs + 50, Math.round(timestamps[i + 1] * 1000));
		} else {
			endMs = startMs + 200;
		}

		// SentencePiece uses U+2581 (lower one eighth block:  ) or space to denote word start
		const isWordStart = tokenStr.startsWith("\u2581") || tokenStr.startsWith(" ");
		const cleanText = tokenStr.replace(/^[\u2581\s]+/, "");

		if (!cleanText) {
			continue;
		}

		if (words.length === 0 || isWordStart) {
			words.push({
				text: cleanText,
				startMs,
				endMs,
				...(words.length > 0 ? { leadingSpace: true } : {}),
			});
		} else {
			// Subword continuation
			const prevWord = words[words.length - 1];
			prevWord.text += cleanText;
			prevWord.endMs = Math.max(prevWord.endMs, endMs);
		}
	}

	return words.filter((w) => w.text.trim().length > 0);
}

export function parseParakeetJsonOutput(content: string): CaptionCuePayload[] {
	try {
		// Find JSON substring in case sherpa-onnx emitted logs or status to stdout
		const firstBrace = content.indexOf("{");
		const lastBrace = content.lastIndexOf("}");
		if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
			return [];
		}

		const jsonString = content.slice(firstBrace, lastBrace + 1);
		const parsed = JSON.parse(jsonString) as SherpaOnnxRecognitionResult;

		const fullText = typeof parsed.text === "string" ? parsed.text.trim() : "";
		const words = parseParakeetJsonWords(parsed.tokens, parsed.timestamps, parsed.durations);

		if (words.length === 0) {
			if (!fullText) return [];
			return [
				{
					id: "caption-1",
					startMs: 0,
					endMs: 3000,
					text: fullText,
				},
			];
		}

		const text = buildCaptionTextFromWords(words) || fullText;
		return [
			{
				id: "caption-1",
				startMs: words[0].startMs,
				endMs: words[words.length - 1].endMs,
				text,
				words,
			},
		];
	} catch (error) {
		console.warn("[auto-captions] Failed to parse Parakeet JSON output:", error);
		return [];
	}
}
