import { loadAppSetting, saveAppSetting } from "./appSettings";

// ---------------------------------------------------------------------------
// LLM Provider Configuration (Renderer-Side)
// ---------------------------------------------------------------------------

export interface LlmProviderConfig {
	/** Selected provider type: "whisper-local", "openai-whisper", "custom". */
	provider: string;
	/** Encrypted API key (empty for local providers). */
	apiKey: string;
	/** Model identifier, e.g. "whisper-1", "gemini-3.7-flash", "gpt-4o". */
	model: string;
	/** Custom API base URL for self-hosted / compatible endpoints. */
	baseUrl: string | null;
	/** Mode of the custom API: "audio-transcription" (dedicated whisper endpoint) or "chat-multimodal" (LLM chat/completions with audio). */
	apiMode: "audio-transcription" | "chat-multimodal";
}

const SETTINGS_KEY = "llmProviderConfig";

export const DEFAULT_LLM_CONFIG: LlmProviderConfig = {
	provider: "whisper-local",
	apiKey: "",
	model: "whisper-1",
	baseUrl: null,
	apiMode: "chat-multimodal",
};

export const TRANSCRIPTION_PROVIDERS = [
	{ id: "whisper-local", label: "Local Whisper", requiresApiKey: false },
	{ id: "openai-whisper", label: "OpenAI Whisper", requiresApiKey: true },
	{ id: "custom", label: "Custom LLM", requiresApiKey: false },
] as const;

export const CUSTOM_API_MODES = [
	{
		id: "chat-multimodal",
		label: "Multimodal Chat Model",
		description: "Uses Gemini, GPT-4o, Claude, etc. with audio context to generate timed captions",
	},
	{
		id: "audio-transcription",
		label: "Dedicated Whisper Endpoint",
		description: "Standard Whisper API endpoint (Groq, faster-whisper, OpenAI)",
	},
] as const;

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

function isNonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.length > 0;
}

export function normalizeLlmConfig(candidate: unknown): LlmProviderConfig {
	if (!candidate || typeof candidate !== "object") {
		return { ...DEFAULT_LLM_CONFIG };
	}

	const raw = candidate as Record<string, unknown>;
	const apiMode =
		raw.apiMode === "audio-transcription" || raw.apiMode === "chat-multimodal"
			? raw.apiMode
			: DEFAULT_LLM_CONFIG.apiMode;

	return {
		provider: isNonEmptyString(raw.provider) ? raw.provider : DEFAULT_LLM_CONFIG.provider,
		apiKey: typeof raw.apiKey === "string" ? raw.apiKey : DEFAULT_LLM_CONFIG.apiKey,
		model: isNonEmptyString(raw.model) ? raw.model : DEFAULT_LLM_CONFIG.model,
		baseUrl:
			typeof raw.baseUrl === "string" && raw.baseUrl.length > 0
				? raw.baseUrl
				: DEFAULT_LLM_CONFIG.baseUrl,
		apiMode,
	};
}

// ---------------------------------------------------------------------------
// Persistence (via the existing app-settings key-value store)
// ---------------------------------------------------------------------------

export function loadLlmConfig(): LlmProviderConfig {
	const stored = loadAppSetting<unknown>(SETTINGS_KEY);
	return normalizeLlmConfig(stored);
}

export function saveLlmConfig(patch: Partial<LlmProviderConfig>): void {
	const current = loadLlmConfig();
	const merged = normalizeLlmConfig({ ...current, ...patch });
	saveAppSetting(SETTINGS_KEY, merged);
}
