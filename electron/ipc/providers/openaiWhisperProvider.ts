import fs from "node:fs/promises";
import path from "node:path";
import type { CaptionCuePayload, CaptionWordPayload } from "../types";
import type {
	LlmProviderConfig,
	TranscriptionProvider,
	TranscriptionRequest,
	TranscriptionResult,
} from "./types";

// ---------------------------------------------------------------------------
// OpenAI / OpenAI-Compatible Whisper & Multi-modal Provider
// ---------------------------------------------------------------------------

/** Maximum file size the API accepts (25 MB). */
const OPENAI_WHISPER_MAX_BYTES = 25 * 1024 * 1024;

const DEFAULT_BASE_URL = "https://api.openai.com/v1";

function cleanBaseUrl(rawUrl?: string | null): string {
	let url = (rawUrl || DEFAULT_BASE_URL).trim().replace(/\/+$/, "");
	url = url.replace(/\/audio\/transcriptions$/i, "");
	url = url.replace(/\/chat\/completions$/i, "");
	return url.replace(/\/+$/, "");
}

interface OpenAiVerboseJsonResponse {
	text?: string;
	language?: string;
	duration?: number;
	segments?: Array<{
		id?: number;
		start?: number;
		end?: number;
		text?: string;
		words?: Array<{
			word?: string;
			start?: number;
			end?: number;
		}>;
	}>;
	words?: Array<{
		word?: string;
		start?: number;
		end?: number;
	}>;
}

/**
 * Creates a transcription provider that uses either:
 * 1. Standard `/audio/transcriptions` endpoint (OpenAI Whisper, Groq, etc.)
 * 2. Fallback to `/chat/completions` for multimodal LLMs (Gemini, GPT-4o, etc.)
 *    when the server has no dedicated transcription models.
 *
 * Uses native `fetch()` — no SDK dependency required (Node 22+).
 */
export function createOpenAiWhisperProvider(config: {
	apiKey: string;
	model?: string;
	baseUrl?: string | null;
	apiMode?: "audio-transcription" | "chat-multimodal";
}): TranscriptionProvider {
	const apiKey = config.apiKey;
	const model = config.model || "whisper-1";
	const baseUrl = cleanBaseUrl(config.baseUrl);
	const apiMode = config.apiMode || "audio-transcription";

	return {
		id: "openai-whisper",
		label: "OpenAI Whisper API",
		requiresApiKey: true,

		async transcribe(request: TranscriptionRequest): Promise<TranscriptionResult> {
			// Pre-flight: check file size
			const stat = await fs.stat(request.audioPath);
			if (stat.size > OPENAI_WHISPER_MAX_BYTES) {
				throw new Error(
					`Audio file is ${(stat.size / (1024 * 1024)).toFixed(1)} MB, which exceeds the API limit of 25 MB. ` +
						"Use the local Whisper provider for large files, or trim the recording first.",
				);
			}

			const fileBuffer = await fs.readFile(request.audioPath);
			const fileName = path.basename(request.audioPath);

			// If explicitly set to chat-multimodal (for Gemini, GPT-4o, Claude, etc.)
			if (apiMode === "chat-multimodal") {
				return await transcribeViaChatCompletions(
					baseUrl,
					apiKey,
					model,
					fileBuffer,
					request.language,
					request.signal,
				);
			}

			// Dedicated Whisper audio endpoint
			try {
				return await transcribeViaAudioEndpoint(
					baseUrl,
					apiKey,
					model,
					fileBuffer,
					fileName,
					request.language,
					request.signal,
				);
			} catch (audioEndpointError) {
				const errorMsg =
					audioEndpointError instanceof Error
						? audioEndpointError.message
						: String(audioEndpointError);

				console.warn(
					`[openai-whisper] /audio/transcriptions failed (${errorMsg}), attempting multimodal chat fallback with ${model}...`,
				);
				try {
					return await transcribeViaChatCompletions(
						baseUrl,
						apiKey,
						model,
						fileBuffer,
						request.language,
						request.signal,
					);
				} catch {
					throw audioEndpointError;
				}
			}
		},

		async validateConfig(
			providerConfig: LlmProviderConfig,
		): Promise<{ valid: boolean; error?: string }> {
			try {
				const targetBase = cleanBaseUrl(providerConfig.baseUrl);
				const targetModel = (providerConfig.model || "").trim();
				const targetMode = providerConfig.apiMode || "chat-multimodal";

				if (!targetModel) {
					return { valid: false, error: "Model identifier is required." };
				}

				const headers: Record<string, string> = {
					"Content-Type": "application/json",
				};
				if (providerConfig.apiKey) {
					headers.Authorization = `Bearer ${providerConfig.apiKey}`;
				}

				const controller = new AbortController();
				const timeoutId = setTimeout(() => controller.abort(), 12000);

				try {
					if (targetMode === "chat-multimodal") {
						// Send a real minimal ping request with the exact model name to /chat/completions
						const testUrl = `${targetBase}/chat/completions`;
						const response = await fetch(testUrl, {
							method: "POST",
							headers,
							body: JSON.stringify({
								model: targetModel,
								messages: [{ role: "user", content: "ping" }],
								max_tokens: 1,
							}),
							signal: controller.signal,
						});

						if (!response.ok) {
							const errorText = await response.text().catch(() => "");
							let parsedMsg = "";
							try {
								const errJson = JSON.parse(errorText) as {
									error?: { message?: string } | string;
								};
								parsedMsg =
									typeof errJson.error === "object"
										? errJson.error?.message || ""
										: typeof errJson.error === "string"
											? errJson.error
											: "";
							} catch {
								parsedMsg = errorText;
							}

							if (response.status === 401 || response.status === 403) {
								return { valid: false, error: "API key is invalid or unauthorized." };
							}
							if (response.status === 404) {
								return {
									valid: false,
									error: parsedMsg || `Model '${targetModel}' or endpoint was not found (404).`,
								};
							}
							return {
								valid: false,
								error: parsedMsg || `Server returned HTTP ${response.status} (${response.statusText})`,
							};
						}

						return { valid: true };
					} else {
						// For audio-transcription endpoint: verify with /models or specific test
						const checkUrl = `${targetBase}/models`;
						const response = await fetch(checkUrl, {
							method: "GET",
							headers,
							signal: controller.signal,
						});

						if (response.status === 401 || response.status === 403) {
							return { valid: false, error: "API key is invalid or unauthorized." };
						}

						if (response.ok) {
							const modelsData = (await response.json().catch(() => null)) as {
								data?: Array<{ id: string }>;
							} | null;
							if (modelsData?.data && Array.isArray(modelsData.data)) {
								const exists = modelsData.data.some((m) => m.id === targetModel);
								if (!exists && modelsData.data.length > 0) {
									return {
										valid: false,
										error: `Model '${targetModel}' not found in available models on server.`,
									};
								}
							}
						}

						return { valid: true };
					}
				} finally {
					clearTimeout(timeoutId);
				}
			} catch (error) {
				const msg = error instanceof Error ? error.message : String(error);
				if (msg.includes("abort")) {
					return { valid: false, error: "Connection timed out (12s limit reached)." };
				}
				return {
					valid: false,
					error: `Could not reach endpoint: ${msg}`,
				};
			}
		},
	};
}

// ---------------------------------------------------------------------------
// Standard /audio/transcriptions
// ---------------------------------------------------------------------------

async function transcribeViaAudioEndpoint(
	baseUrl: string,
	apiKey: string,
	model: string,
	fileBuffer: Buffer,
	fileName: string,
	language?: string,
	signal?: AbortSignal,
): Promise<TranscriptionResult> {
	const formData = new FormData();
	formData.append("file", new Blob([new Uint8Array(fileBuffer)]), fileName);
	formData.append("model", model);
	formData.append("response_format", "verbose_json");
	formData.append("timestamp_granularities[]", "word");
	formData.append("timestamp_granularities[]", "segment");

	if (language && language !== "auto") {
		formData.append("language", language);
	}

	const url = `${baseUrl}/audio/transcriptions`;
	const headers: Record<string, string> = {};
	if (apiKey) {
		headers.Authorization = `Bearer ${apiKey}`;
	}

	const response = await fetch(url, {
		method: "POST",
		headers,
		body: formData,
		signal,
	});

	if (!response.ok) {
		const errorBody = await response.text().catch(() => "");
		if (response.status === 401) {
			throw new Error("API key is invalid or expired. Check your API key in caption settings.");
		}
		if (response.status === 429) {
			throw new Error("API rate limit reached. Wait a moment and try again.");
		}
		throw new Error(
			`OpenAI Whisper API error (${response.status}): ${errorBody || response.statusText}`,
		);
	}

	const json = (await response.json()) as OpenAiVerboseJsonResponse;
	return parseOpenAiVerboseJson(json);
}

// ---------------------------------------------------------------------------
// Multimodal /chat/completions Fallback
// ---------------------------------------------------------------------------

async function transcribeViaChatCompletions(
	baseUrl: string,
	apiKey: string,
	model: string,
	fileBuffer: Buffer,
	language?: string,
	signal?: AbortSignal,
): Promise<TranscriptionResult> {
	const base64Audio = fileBuffer.toString("base64");
	const prompt = `You are an accurate audio transcriber. Transcribe this audio recording into timed caption cues.
Language: ${language && language !== "auto" ? language : "auto-detect"}.
Output format: Output ONLY a JSON array of caption objects without markdown code blocks, following this exact schema:
[
  {
    "id": "cue-0",
    "startMs": 0,
    "endMs": 2500,
    "text": "hello world",
    "words": [
      { "text": "hello", "startMs": 0, "endMs": 1000 },
      { "text": "world", "startMs": 1000, "endMs": 2500, "leadingSpace": true }
    ]
  }
]`;

	const headers: Record<string, string> = {
		"Content-Type": "application/json",
	};
	if (apiKey) {
		headers.Authorization = `Bearer ${apiKey}`;
	}

	const response = await fetch(`${baseUrl}/chat/completions`, {
		method: "POST",
		headers,
		body: JSON.stringify({
			model,
			messages: [
				{
					role: "user",
					content: [
						{ type: "text", text: prompt },
						{
							type: "input_audio",
							input_audio: {
								data: base64Audio,
								format: "wav",
							},
						},
					],
				},
			],
			temperature: 0.1,
		}),
		signal,
	});

	if (!response.ok) {
		const errorBody = await response.text().catch(() => "");
		throw new Error(`Chat fallback error (${response.status}): ${errorBody || response.statusText}`);
	}

	const completion = (await response.json()) as {
		choices?: Array<{ message?: { content?: string } }>;
	};
	const rawContent = completion.choices?.[0]?.message?.content?.trim() || "";
	const jsonContent = rawContent.replace(/^```json\s*/i, "").replace(/```$/i, "").trim();

	const parsed = JSON.parse(jsonContent) as CaptionCuePayload[];
	if (Array.isArray(parsed)) {
		return {
			cues: parsed,
			supportsWordTimings: parsed.some((c) => c.words && c.words.length > 0),
		};
	}

	throw new Error("Chat model did not return a valid cue array.");
}

// ---------------------------------------------------------------------------
// Response Parsing
// ---------------------------------------------------------------------------

function parseOpenAiVerboseJson(json: OpenAiVerboseJsonResponse): TranscriptionResult {
	const cues: CaptionCuePayload[] = [];
	let cueIndex = 0;

	// Prefer segment-level with word-level timings
	const segments = json.segments ?? [];
	const topLevelWords = json.words ?? [];

	if (segments.length > 0) {
		for (const segment of segments) {
			if (!segment.text?.trim()) continue;

			const startMs = Math.round((segment.start ?? 0) * 1000);
			const endMs = Math.round((segment.end ?? 0) * 1000);

			const words: CaptionWordPayload[] = [];
			if (segment.words && segment.words.length > 0) {
				for (const word of segment.words) {
					if (!word.word) continue;
					const cleanWord = word.word.trim();
					if (!cleanWord) continue;
					words.push({
						text: cleanWord,
						startMs: Math.round((word.start ?? 0) * 1000),
						endMs: Math.round((word.end ?? 0) * 1000),
						leadingSpace: word.word.startsWith(" "),
					});
				}
			}

			cues.push({
				id: `openai-cue-${cueIndex++}`,
				startMs,
				endMs,
				text: segment.text.trim(),
				...(words.length > 0 ? { words } : {}),
			});
		}
	} else if (topLevelWords.length > 0) {
		const grouped = groupWordsIntoCues(topLevelWords);
		for (const group of grouped) {
			cues.push({
				id: `openai-cue-${cueIndex++}`,
				...group,
			});
		}
	} else if (json.text?.trim()) {
		cues.push({
			id: `openai-cue-${cueIndex++}`,
			startMs: 0,
			endMs: Math.round((json.duration ?? 0) * 1000),
			text: json.text.trim(),
		});
	}

	return {
		cues,
		supportsWordTimings: cues.some((c) => c.words && c.words.length > 0),
	};
}

function groupWordsIntoCues(
	words: Array<{ word?: string; start?: number; end?: number }>,
): Array<{ startMs: number; endMs: number; text: string; words: CaptionWordPayload[] }> {
	const result: Array<{
		startMs: number;
		endMs: number;
		text: string;
		words: CaptionWordPayload[];
	}> = [];

	let currentWords: CaptionWordPayload[] = [];
	let groupStartMs = 0;

	const flushGroup = () => {
		if (currentWords.length === 0) return;
		const text = currentWords
			.map((w, i) => `${i > 0 && w.leadingSpace ? " " : ""}${w.text}`)
			.join("")
			.trim();
		result.push({
			startMs: groupStartMs,
			endMs: currentWords[currentWords.length - 1].endMs,
			text,
			words: currentWords,
		});
		currentWords = [];
	};

	for (const word of words) {
		if (!word.word) continue;
		const cleanWord = word.word.trim();
		if (!cleanWord) continue;

		const wStartMs = Math.round((word.start ?? 0) * 1000);
		const wEndMs = Math.round((word.end ?? 0) * 1000);

		if (currentWords.length === 0) {
			groupStartMs = wStartMs;
		}

		currentWords.push({
			text: cleanWord,
			startMs: wStartMs,
			endMs: wEndMs,
			leadingSpace: word.word.startsWith(" "),
		});

		const isSentenceEnd = /[.!?]$/.test(cleanWord);
		const windowMs = wEndMs - groupStartMs;
		if (isSentenceEnd || windowMs > 5000) {
			flushGroup();
		}
	}

	flushGroup();
	return result;
}
