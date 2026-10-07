import { transcriptionProviders } from "./registry";
import { createWhisperLocalProvider } from "./whisperLocalProvider";

// ---------------------------------------------------------------------------
// Provider Registration
// ---------------------------------------------------------------------------

/**
 * Registers the built-in transcription providers. Called once during
 * IPC handler registration (see `handlers.ts`).
 *
 * The Whisper local provider is registered with a placeholder model path.
 * The actual model path is resolved per-request from the IPC options, so
 * the registration here establishes the provider's presence in the registry
 * for listing and UI purposes.
 *
 * API-based providers (OpenAI, etc.) are instantiated on-demand when the
 * user triggers caption generation with a non-local provider selected,
 * because they require API keys that are only available at runtime.
 */
export function registerTranscriptionProviders(): void {
	// Register a lightweight Whisper-local entry. The actual transcription
	// call creates a fully configured provider with the user's model path.
	transcriptionProviders.register({
		id: "whisper-local",
		label: "Whisper (Local)",
		requiresApiKey: false,
		async transcribe() {
			throw new Error(
				"whisper-local stub: use createWhisperLocalProvider() with per-request options.",
			);
		},
	});

	// Register the OpenAI stub for listing / UI purposes.
	transcriptionProviders.register({
		id: "openai-whisper",
		label: "OpenAI Whisper API",
		requiresApiKey: true,
		async transcribe() {
			throw new Error(
				"openai-whisper stub: use createOpenAiWhisperProvider() with API key at runtime.",
			);
		},
	});

	// Register the Custom OpenAI-compatible stub for listing / UI purposes.
	transcriptionProviders.register({
		id: "custom",
		label: "Custom (OpenAI-Compatible / Local AI)",
		requiresApiKey: false,
		async transcribe() {
			throw new Error(
				"custom stub: use createOpenAiWhisperProvider() with custom baseUrl/model at runtime.",
			);
		},
	});
}

export { createWhisperLocalProvider };
export { createOpenAiWhisperProvider } from "./openaiWhisperProvider";
