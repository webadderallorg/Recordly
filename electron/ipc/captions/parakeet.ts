import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import type { CaptionCuePayload, CaptionWordPayload } from "../types";
import { buildCaptionTextFromWords } from "./parser";
import { assertParakeetModelDirectory } from "./parakeetModel";

export interface ParakeetResult {
	text: string;
	tokens: string[];
	timestamps: number[];
	durations: number[];
}

/** SentencePiece pieces carry real TDT start times and durations, in seconds. */
export function parseParakeetWords(result: ParakeetResult, offsetMs = 0): CaptionWordPayload[] {
	if (!result.tokens.length) {
		if (result.text.trim()) throw new Error("Parakeet returned text without word timings.");
		return [];
	}
	const words: CaptionWordPayload[] = [];
	let pendingSpace = false;
	for (let i = 0; i < result.tokens.length; i++) {
		const token = result.tokens[i];
		if (/^<[^>]+>$/.test(token)) continue;
		const start = result.timestamps[i];
		const duration = result.durations[i];
		if (!Number.isFinite(start) || !Number.isFinite(duration) || start < 0 || duration < 0) {
			throw new Error("Parakeet returned invalid token timings.");
		}
		const text = token.replace(/▁/g, " ");
		if (!text.trim()) {
			pendingSpace = pendingSpace || /\s/.test(text);
			continue;
		}
		const startMs = offsetMs + Math.round(start * 1000);
		const endMs = Math.max(startMs + 1, offsetMs + Math.round((start + duration) * 1000));
		// Closing punctuation belongs to the preceding word even if the tokenizer
		// emitted a separate space. It must not become its own highlighted word.
		const attachesPunctuation = /^[,.;:!?%)\]}’'…]+$/u.test(text.trim());
		if (words.length && (attachesPunctuation || (!pendingSpace && !/^\s/.test(text)))) {
			words[words.length - 1].text += attachesPunctuation ? text.trim() : text;
			words[words.length - 1].endMs = Math.max(words[words.length - 1].endMs, endMs);
		} else {
			words.push({
				text: text.trim(),
				startMs,
				endMs,
				...(words.length ? { leadingSpace: true } : {}),
			});
		}
		pendingSpace = /\s$/.test(text);
	}
	// A decoder can stretch its final token across trailing silence. Bound that
	// estimate after joining subwords so the whole word cannot linger indefinitely.
	return words.map((word) => ({ ...word, endMs: Math.min(word.endMs, word.startMs + 2500) }));
}

/** Reconcile overlapping decodes by a shared spoken word, rather than independent
 * timestamp cutoffs: estimates can move across a window boundary between decodes. */
export function mergeParakeetWindows(
	previous: CaptionWordPayload[],
	next: CaptionWordPayload[],
	seamMs: number,
): CaptionWordPayload[] {
	if (!previous.length) return next;
	if (!next.length) return previous;
	const normalize = (text: string) => text.toLocaleLowerCase().replace(/\p{P}/gu, "");
	let anchor: { left: number; right: number; score: number } | null = null;
	for (let left = previous.length - 1; left >= 0; left--) {
		if (previous[left].endMs < seamMs - 2000) break;
		for (let right = 0; right < next.length && next[right].startMs <= seamMs + 2000; right++) {
			const word = normalize(previous[left].text);
			if (
				!word ||
				word !== normalize(next[right].text) ||
				Math.abs(previous[left].startMs - next[right].startMs) > 1000
			)
				continue;
			let matches = 0;
			for (let delta = -2; delta <= 2; delta++) {
				if (
					previous[left + delta] &&
					next[right + delta] &&
					normalize(previous[left + delta].text) === normalize(next[right + delta].text)
				)
					matches++;
			}
			const score =
				matches * 100 -
				Math.abs(previous[left].startMs - next[right].startMs) * 100 -
				Math.abs(next[right].startMs - seamMs) * 0.001;
			if (!anchor || score > anchor.score) anchor = { left, right, score };
		}
	}
	if (anchor) return [...previous.slice(0, anchor.left), ...next.slice(anchor.right)];
	// With no shared words (e.g. a pause or disagreeing recognition), prefer the
	// prior decoder before the seam and the new decoder afterwards.
	return [
		...previous.filter((word) => (word.startMs + word.endMs) / 2 < seamMs),
		...next.filter((word) => (word.startMs + word.endMs) / 2 >= seamMs),
	];
}

type Stream = {
	acceptWaveform(wave: { sampleRate: number; samples: Float32Array }): void;
};
type Recognizer = {
	createStream(): Stream;
	decodeAsync(stream: Stream): Promise<ParakeetResult>;
};
type Sherpa = {
	OfflineRecognizer: { createAsync(config: unknown): Promise<Recognizer> };
};
const nodeRequire = createRequire(import.meta.url);

/** Read only the PCM data needed for each window, so long recordings stay bounded. */
async function getPcmData(file: fs.FileHandle) {
	const header = Buffer.alloc(12);
	await file.read(header, 0, 12, 0);
	if (
		!["RIFF", "RF64"].includes(header.toString("ascii", 0, 4)) ||
		header.toString("ascii", 8, 12) !== "WAVE"
	) {
		throw new Error("Caption audio is not a PCM WAV file.");
	}
	const size = (await file.stat()).size;
	let offset = 12;
	let validFormat = false;
	while (offset + 8 <= size) {
		const chunk = Buffer.alloc(8);
		await file.read(chunk, 0, 8, offset);
		const length = chunk.readUInt32LE(4);
		const name = chunk.toString("ascii", 0, 4);
		if (name === "fmt ") {
			if (length < 16) throw new Error("Invalid caption audio format.");
			const fmt = Buffer.alloc(16);
			await file.read(fmt, 0, 16, offset + 8);
			validFormat =
				fmt.readUInt16LE(0) === 1 &&
				fmt.readUInt16LE(2) === 1 &&
				fmt.readUInt32LE(4) === 16000 &&
				fmt.readUInt16LE(14) === 16;
		}
		if (name === "data") {
			if (!validFormat) throw new Error("Caption audio must be 16 kHz mono PCM16.");
			return {
				offset: offset + 8,
				samples: Math.floor(Math.min(length, size - offset - 8) / 2),
			};
		}
		offset += 8 + length + (length % 2);
	}
	throw new Error("Caption audio has no PCM data.");
}

export async function transcribeParakeetAudio(
	wavPath: string,
	modelPath: string,
): Promise<CaptionCuePayload[]> {
	await assertParakeetModelDirectory(modelPath);
	let sherpa: Sherpa;
	try {
		sherpa = nodeRequire("sherpa-onnx-node") as Sherpa;
	} catch (error) {
		throw new Error(
			`The bundled Parakeet runtime could not load (${process.platform}/${process.arch}). Reinstall Recordly. ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	// Both initialization and decoding use the native async API; neither blocks Electron's event loop.
	const recognizer = await sherpa.OfflineRecognizer.createAsync({
		featConfig: { sampleRate: 16000, featureDim: 80 },
		modelConfig: {
			transducer: {
				encoder: path.join(modelPath, "encoder.int8.onnx"),
				decoder: path.join(modelPath, "decoder.int8.onnx"),
				joiner: path.join(modelPath, "joiner.int8.onnx"),
			},
			tokens: path.join(modelPath, "tokens.txt"),
			numThreads: 2,
			provider: "cpu",
			modelType: "nemo_transducer",
		},
	});
	const file = await fs.open(wavPath, "r");
	try {
		const pcm = await getPcmData(file);
		let words: CaptionWordPayload[] = [];
		const windowSamples = 30 * 16000;
		const context = 2 * 16000;
		for (let core = 0; core < pcm.samples; core += windowSamples) {
			const start = Math.max(0, core - context);
			const end = Math.min(pcm.samples, core + windowSamples + context);
			const bytes = Buffer.alloc((end - start) * 2);
			const { bytesRead } = await file.read(bytes, 0, bytes.length, pcm.offset + start * 2);
			if (bytesRead !== bytes.length)
				throw new Error("Caption audio was truncated during transcription.");
			const samples = new Float32Array(end - start);
			for (let i = 0; i < samples.length; i++) samples[i] = bytes.readInt16LE(i * 2) / 32768;
			const stream = recognizer.createStream();
			stream.acceptWaveform({ sampleRate: 16000, samples });
			const result = await recognizer.decodeAsync(stream);
			const chunkWords = parseParakeetWords(result, start / 16);
			words = mergeParakeetWindows(words, chunkWords, core / 16);
		}
		words = words
			.filter((word) => word.startMs < pcm.samples / 16)
			.map((word, index) => ({
				...word,
				endMs: Math.min(word.endMs, pcm.samples / 16),
				...(index > 0 ? { leadingSpace: true } : {}),
			}));
		if (!words.length) return [];
		return [
			{
				id: "caption-1",
				startMs: words[0].startMs,
				endMs: words[words.length - 1].endMs,
				text: buildCaptionTextFromWords(words),
				words,
			},
		];
	} finally {
		await file.close();
	}
}
