import type { CaptionCuePayload } from "../types";

// ---------------------------------------------------------------------------
// LLM / AI Provider Configuration
// ---------------------------------------------------------------------------

export interface LlmProviderConfig {
	/** Provider identifier, e.g. "whisper-local", "openai-whisper", "custom". */
	provider: string;
	/** Encrypted API key (empty for local providers). */
	apiKey: string;
	/** Model identifier, e.g. "whisper-1", "gemini-3.7-flash". */
	model: string;
	/** Custom API base URL for self-hosted / compatible endpoints. */
	baseUrl: string | null;
	/** Target mode: audio endpoint vs multimodal chat completions */
	apiMode?: "audio-transcription" | "chat-multimodal";
}

// ---------------------------------------------------------------------------
// Transcription Provider (Caption Generation)
// ---------------------------------------------------------------------------

export interface TranscriptionRequest {
	/** Absolute path to 16 kHz mono WAV audio file. */
	audioPath: string;
	/** ISO 639-1 language code, or "auto" for auto-detection. */
	language: string;
	/** Optional abort signal for cancellation. */
	signal?: AbortSignal;
}

export interface TranscriptionResult {
	/** Caption cues in the standard Recordly wire format. */
	cues: CaptionCuePayload[];
	/** Whether the provider returned per-word start/end timings. */
	supportsWordTimings: boolean;
}

export interface TranscriptionProvider {
	/** Unique stable identifier, e.g. "whisper-local", "openai-whisper". */
	id: string;
	/** Human-readable display name. */
	label: string;
	/** Whether this provider requires an API key to function. */
	requiresApiKey: boolean;
	/** Run transcription and return caption cues. */
	transcribe(request: TranscriptionRequest): Promise<TranscriptionResult>;
	/** Optional: validate the provider configuration before use. */
	validateConfig?(config: LlmProviderConfig): Promise<{ valid: boolean; error?: string }>;
}
