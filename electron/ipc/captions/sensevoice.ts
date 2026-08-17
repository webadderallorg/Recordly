import fs from "node:fs/promises";
import path from "node:path";
import * as sherpa from "sherpa-onnx";
import type { CaptionEngine, CaptionCuePayload, GenerateCaptionOptions, GenerateCaptionResult } from "./engine";

function mapLanguage(language: string): string {
	switch (language) {
		case "zh": case "yue": case "ja": case "ko": case "en":
			return language;
		default:
			return "auto";
	}
}

/**
 * Merge BPE subword tokens into readable words with timing spans.
 * Returns [{text, startMs, endMs}, ...] for use by the existing phrase segmenter.
 */
function tokensToWords(tokens: string[], timestamps: number[]): Array<{ text: string; startMs: number; endMs: number }> {
	if (tokens.length === 0 || timestamps.length === 0) return [];

	const words: Array<{ text: string; startMs: number; endMs: number }> = [];
	let buffer = "";
	let startMs = Math.round(timestamps[0] * 1000);

	for (let i = 0; i < tokens.length; i++) {
		const tok = tokens[i];
		const tsMs = Math.round(timestamps[i] * 1000);

		// BPE subword: "hel" + "lo" → "hello"
		const isSubword =
			buffer.length > 0 &&
			!tok.startsWith(" ") &&
			!/[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/.test(tok) &&
			!/[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/.test(buffer.slice(-1));

		if (isSubword) {
			buffer += tok;
			continue;
		}

		// Compute endMs as midpoint between this word's start and the next token's start.
		// This creates real gaps the segmenter can use.
		const nextTsMs =
			i + 1 < tokens.length ? Math.round(timestamps[i + 1] * 1000) : tsMs + 200;
		const endMs = Math.round((tsMs + nextTsMs) / 2);

		// Finalize previous word
		if (buffer) {
			words.push({ text: buffer, startMs, endMs });
		}

		// Start new word
		if (tok.startsWith(" ")) {
			buffer = tok.slice(1);
		} else {
			buffer = tok;
		}
		startMs = endMs;
	}

	// Finalize last word
	if (buffer) {
		const lastTs = Math.round(timestamps[tokens.length - 1] * 1000);
		words.push({ text: buffer, startMs, endMs: lastTs + 200 });
	}

	return words;
}

export class SenseVoiceEngine implements CaptionEngine {
	readonly engineType = "sensevoice";

	async generate(options: GenerateCaptionOptions): Promise<GenerateCaptionResult> {
		const { audioPath, modelPath, language } = options;
		const modelDir = path.dirname(modelPath);
		const tokensPath = path.join(modelDir, "tokens.txt");

		try {
			await fs.access(audioPath);
		} catch {
			return { success: false, cues: [], error: `Audio file not found: ${audioPath}` };
		}
		try {
			await fs.access(tokensPath);
		} catch {
			return { success: false, cues: [], error: `Tokenizer file not found: ${tokensPath}` };
		}

		const svLanguage = mapLanguage(language || "auto");

		const recognizer = sherpa.createOfflineRecognizer({
			featConfig: { sampleRate: 16000, featureDim: 80 },
			modelConfig: {
				senseVoice: {
					model: modelPath,
					language: svLanguage,
					useInverseTextNormalization: 1,
				},
				tokens: tokensPath,
			},
			decodingMethod: "greedy_search",
		});

		const wave = sherpa.readWave(audioPath);

		let resultText = "";
		let resultTokens: string[] = [];
		let resultTimestamps: number[] = [];
		let recognizerError: string | null = null;

		const stream = recognizer.createStream();
		try {
			stream.acceptWaveform(wave.sampleRate, wave.samples);
			recognizer.decode(stream);
			const raw = recognizer.getResult(stream) as Record<string, unknown>;
			resultText = (raw.text as string) ?? "";
			resultTokens = (raw.tokens as string[]) ?? [];
			resultTimestamps = (raw.timestamps as number[]) ?? [];
		} catch (error) {
			recognizerError = error instanceof Error ? error.message : String(error);
		} finally {
			stream.free();
		}
		recognizer.free();

		if (recognizerError) {
			return { success: false, cues: [], error: `SenseVoice: ${recognizerError}` };
		}

		const text = resultText.trim();
		if (!text) {
			return {
				success: false,
				cues: [],
				error: "SenseVoice produced no recognizable text. Try a different language setting.",
			};
		}

		// Build cues directly from word timestamps.
		// Split at pauses (≥1s) or at ~12 char cap for standard subtitle length.
		const words = tokensToWords(resultTokens, resultTimestamps);
		const cues: CaptionCuePayload[] = [];

		if (words.length > 0) {
			let segStartMs = words[0].startMs;
			let segText = "";

			for (let i = 0; i < words.length; i++) {
				const w = words[i];
				const gapToPrev = i > 0 ? w.startMs - words[i - 1].endMs : 0;

				if (segText.length > 0 && (gapToPrev >= 1000 || segText.length + w.text.length > 15)) {
					let t = segText.trim();
					cues.push({
						id: `cue-${cues.length}`,
						text: t,
						startMs: segStartMs,
						endMs: words[i - 1].endMs,
					});
					segStartMs = w.startMs;
					segText = "";
				}
				segText += w.text;
			}

			// Last segment
			if (segText.length > 0) {
				let t = segText.trim();
				cues.push({
					id: `cue-${cues.length}`,
					text: t,
					startMs: segStartMs,
					endMs: words[words.length - 1].endMs,
				});
			}
			return { success: true, cues, message: "SenseVoice transcription complete." };
		}

		// Fallback: no word timings, single cue
		return {
			success: true,
			cues: [
				{
					id: "cue-0",
					text,
					startMs: 0,
					endMs: text.length * 80,
					words: [{ text, startMs: 0, endMs: text.length * 80 }],
				},
			],
			message: "SenseVoice transcription complete (no timestamps).",
		};
	}
}
