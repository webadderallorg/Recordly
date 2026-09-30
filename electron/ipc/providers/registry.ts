import type { TranscriptionProvider } from "./types";

// ---------------------------------------------------------------------------
// Generic Provider Registry
// ---------------------------------------------------------------------------

/**
 * A simple typed registry that maps string IDs to provider implementations.
 * Used as the extensible core for transcription (Phase 1) and future
 * AI-driven capabilities (zoom suggestion, auto-annotation, etc.).
 */
export class ProviderRegistry<T extends { id: string }> {
	private readonly providers = new Map<string, T>();

	/** Register a provider. Overwrites any existing provider with the same ID. */
	register(provider: T): void {
		this.providers.set(provider.id, provider);
	}

	/** Retrieve a provider by ID, or `undefined` if not registered. */
	get(id: string): T | undefined {
		return this.providers.get(id);
	}

	/** List all registered providers in insertion order. */
	list(): T[] {
		return [...this.providers.values()];
	}

	/** Check whether a provider with the given ID is registered. */
	has(id: string): boolean {
		return this.providers.has(id);
	}
}

// ---------------------------------------------------------------------------
// Singleton Registries
// ---------------------------------------------------------------------------

/** Registry for caption-transcription providers (Whisper local, OpenAI API, etc.). */
export const transcriptionProviders = new ProviderRegistry<TranscriptionProvider>();
