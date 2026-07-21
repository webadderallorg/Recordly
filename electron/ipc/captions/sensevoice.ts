import fs from "node:fs/promises";
import path from "node:path";
import * as sherpa from "sherpa-onnx";
import type { CaptionEngine, CaptionCuePayload, GenerateCaptionOptions, GenerateCaptionResult } from "./engine";

/**
 * Minimum gap in seconds between tokens to split into separate cues.
 */
const CUE_SPLIT_GAP_S = 1.0;

function mapLanguage(language: string): string {
	switch (language) {
		case "zh": case "yue": case "ja": case "ko": case "en":
			return language;
		default:
			return "auto";
	}
}

/**
 * Group tokens by timing gaps, merge subword pieces into readable text.
 */
function buildCuesFromTimestamps(
	tokens: string[],
	timestamps: number[],
): CaptionCuePayload[] {
	if (tokens.length === 0 || timestamps.length === 0) return [];

	const cues: CaptionCuePayload[] = [];
	let groupStartIdx = 0;

	for (let i = 1; i <= timestamps.length; i++) {
		// Split at large gaps OR at the end of tokens
		const gapTooBig = i < timestamps.length && timestamps[i] - timestamps[i - 1] >= CUE_SPLIT_GAP_S;
		if (gapTooBig || i === timestamps.length) {
			// Merge tokens in this group into readable text
			let text = "";
			for (let j = groupStartIdx; j < i; j++) {
				const tok = tokens[j];
				// BPE tokens: "hel" "lo" " " "hell" "o" -> "hello hello"
				if (tok.startsWith(" ")) {
					text += " ";
					text += tok.slice(1);
				} else if (!text.endsWith(" ") && text.length > 0 && /[\u4e00-\u9fff]/.test(tok)) {
					// Chinese chars: no space between them
					text += tok;
				} else if (/[\u4e00-\u9fff]/.test(tok) && /[a-zA-Z]/.test(text.slice(-1))) {
					// English → Chinese transition
					text += tok;
				} else if (text.length > 0 && /[a-zA-Z]/.test(text.slice(-1)) && /[a-zA-Z]/.test(tok)) {
					// BPE subword merge
					text += tok;
				} else {
					text += tok;
				}
			}

			const trimmed = text.trim();
			if (trimmed) {
				cues.push({
					id: `cue-${cues.length}`,
					text: trimmed,
					startMs: Math.round(timestamps[groupStartIdx] * 1000),
					endMs: Math.round(timestamps[i - 1] * 1000),
				});
			}
			groupStartIdx = i;
		}
	}

	return cues;
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
					useInverseTextNormalization: 0,
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
			const result = recognizer.getResult(stream);
			const raw = result as Record<string, unknown>;
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

		const cues = buildCuesFromTimestamps(resultTokens, resultTimestamps);

		return {
			success: true,
			cues,
			message: `Generated ${cues.length} caption${cues.length === 1 ? "" : "s"}.`,
		};
	}
}
