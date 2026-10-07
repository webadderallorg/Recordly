# 07 — LLM Provider Architecture

> Defines the AI/LLM provider abstraction, configuration, and security model.
>
> **Master reference:** `00-MASTER-ARCHITECTURE.md` Section 6, ADR-09.
> **API contracts:** `03-SHARED-CORE-AND-API.md`.

---

## 1. Existing AI Integration Analysis

### 1.1 Current Architecture (GRAFT-verified)

Recordly already has a well-structured AI provider system for caption generation:

| Component                     | Location                              | Purpose                |
|-------------------------------|---------------------------------------|------------------------|
| `LlmProviderConfig`          | `src/lib/llmSettings.ts`             | Renderer-side config   |
| `LlmProviderConfig`          | `electron/ipc/providers/types.ts`    | **Duplicated** in main |
| `TranscriptionProvider`      | `electron/ipc/providers/types.ts`    | Provider interface     |
| `TranscriptionRequest/Result`| `electron/ipc/providers/types.ts`    | Request/response types |
| `ProviderRegistry`           | `electron/ipc/providers/registry.ts` | Generic typed registry |
| `whisperLocalProvider.ts`    | `electron/ipc/providers/`            | Local Whisper binary   |
| `openaiWhisperProvider.ts`   | `electron/ipc/providers/`            | OpenAI Whisper API     |
| `setup.ts`                   | `electron/ipc/providers/`            | Provider initialization|
| `generate.ts`                | `electron/ipc/captions/`             | Caption generation flow|
| `whisper.ts`                 | `electron/ipc/captions/`             | Whisper CLI integration|
| `parser.ts`                  | `electron/ipc/captions/`             | Output parsing         |
| `segment.ts`                 | `electron/ipc/captions/`             | Caption segmentation   |
| `silence.ts`                 | `electron/ipc/captions/`             | Silence detection      |
| `output.ts`                  | `electron/ipc/captions/`             | Output formatting      |
| `mergeSources.ts`            | `electron/ipc/captions/`             | Multi-source merging   |
| `audioCandidates.ts`         | `electron/ipc/captions/`             | Audio file resolution  |

### 1.2 Current Provider Types

From `src/lib/llmSettings.ts`:

```typescript
export const TRANSCRIPTION_PROVIDERS = [
  { id: "whisper-local", label: "Whisper (Local Built-in)", requiresApiKey: false },
  { id: "openai-whisper", label: "OpenAI Whisper (Cloud API)", requiresApiKey: true },
  { id: "custom", label: "Custom LLM / OpenAI-Compatible Server", requiresApiKey: false },
] as const;

export const CUSTOM_API_MODES = [
  { id: "chat-multimodal", label: "Multimodal Chat Model (/chat/completions)" },
  { id: "audio-transcription", label: "Dedicated Whisper Endpoint (/audio/transcriptions)" },
] as const;
```

### 1.3 Current Issues

| Issue                                | Impact                              |
|--------------------------------------|-------------------------------------|
| Duplicated `LlmProviderConfig`       | Type drift between renderer and main|
| Provider logic in Electron main only | Cannot use on web or mobile         |
| API key stored via `appSettingsStore` | Not encrypted at rest               |
| No streaming support                 | Chat-multimodal lacks streaming     |
| No usage/cost tracking               | No visibility into API spend        |
| No retry policy                      | Single attempt on network failure   |

---

## 2. Provider Abstraction (Modernized)

### 2.1 Unified Provider Interface

```typescript
// packages/domain/src/types/llm.ts

export interface LlmProviderConfig {
  /** Provider ID: "whisper-local", "openai-whisper", "custom" */
  provider: string;
  /** API key (may be encrypted at rest) */
  apiKey: string;
  /** Model identifier, e.g. "whisper-1", "gemini-3.7-flash" */
  model: string;
  /** Custom API base URL for self-hosted endpoints */
  baseUrl: string | null;
  /** API mode for custom providers */
  apiMode: "audio-transcription" | "chat-multimodal";
}

export interface TranscriptionRequest {
  /** Path to audio file (desktop) or ArrayBuffer (web) */
  audioSource: string | ArrayBuffer;
  /** ISO 639-1 language code, or "auto" */
  language: string;
  /** Abort signal for cancellation */
  signal?: AbortSignal;
}

export interface TranscriptionResult {
  cues: CaptionCue[];
  supportsWordTimings: boolean;
  usage?: LlmUsage;
}

export interface LlmUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  estimatedCostUsd?: number;
  modelId: string;
  providerId: string;
  durationMs: number;
}
```

### 2.2 Provider Registry (Preserving existing pattern)

The existing `ProviderRegistry<T>` pattern is well-designed and should
be preserved. It moves from Electron-only to the shared `CaptionAdapter`:

```typescript
// Existing pattern (electron/ipc/providers/registry.ts)
export class ProviderRegistry<T extends { id: string }> {
  register(provider: T): void;
  get(id: string): T | undefined;
  list(): T[];
  has(id: string): boolean;
}
```

This pattern should remain in `packages/domain/` as a reusable utility.

---

## 3. Provider Implementations

### 3.1 Local Whisper (Desktop Only)

```
Platform: Desktop only
Runtime: whisper binary sidecar
Input: 16kHz mono WAV file
Output: JSON with timed word segments
```

- Whisper binary is bundled as a Tauri sidecar.
- Model files stored in app data directory.
- Download progress reported via Tauri events.
- No API key required.

### 3.2 OpenAI Whisper API

```
Platform: Desktop + Web + Mobile
Endpoint: https://api.openai.com/v1/audio/transcriptions
Auth: Bearer token (user-provided API key)
Input: Audio file upload (multipart/form-data)
Output: JSON with timed segments
```

- On desktop: HTTP request from Rust (keeps API key server-side).
- On web: HTTP request from browser (API key in localStorage — user's choice).
- On mobile: HTTP request from app (API key in secure storage).

### 3.3 Custom OpenAI-Compatible

```
Platform: Desktop + Web + Mobile
Endpoint: User-configured base URL
Auth: Optional Bearer token
Modes:
  - audio-transcription: POST /audio/transcriptions
  - chat-multimodal: POST /chat/completions (with audio context)
```

Supports:
- Self-hosted Whisper (faster-whisper, whisper.cpp server).
- Groq Whisper API.
- Google Gemini (via chat-multimodal mode).
- Any OpenAI-compatible endpoint.

---

## 4. Configuration and Secrets

### 4.1 Secret Storage by Platform

| Platform | Storage Method                  | Encryption          |
|----------|---------------------------------|---------------------|
| Desktop  | `tauri-plugin-store` + OS keychain | OS credential store |
| Web      | `localStorage`                  | None (user's key)   |
| Mobile   | Secure Keychain / Keystore      | OS-level encryption |

### 4.2 Configuration Persistence

```typescript
// Shared configuration (packages/domain/)
export function normalizeLlmConfig(raw: unknown): LlmProviderConfig {
  // Existing normalization logic from src/lib/llmSettings.ts
  // Validates: provider, apiKey, model, baseUrl, apiMode
  // Returns safe defaults for missing/invalid fields
}
```

### 4.3 Security Rules

1. **Never log API keys.** Not in console, not in diagnostics, not in crash reports.
2. **Never include API keys in frontend bundles.** Build-time validation.
3. **Never store API keys in project files.** Project format has no key fields.
4. **Allow user-provided keys in browser.** Document the security trade-off.
5. **Use OS credential store on desktop.** via `tauri-plugin-keychain` or similar.
6. **Validate base URLs.** Prevent SSRF by allowing only `https://` URLs
   (except `http://localhost` for local services).

---

## 5. Streaming Responses

### 5.1 Current State

The existing `chat-multimodal` mode does not implement streaming.
It sends the full audio context and waits for a complete response.

### 5.2 Proposed Streaming Support

For chat-completions with large audio files:

```typescript
export interface StreamingTranscriptionProvider extends TranscriptionProvider {
  transcribeStream(
    request: TranscriptionRequest,
    onChunk: (chunk: TranscriptionChunk) => void,
  ): Promise<TranscriptionResult>;
}

export interface TranscriptionChunk {
  partialCues: CaptionCue[];
  done: boolean;
}
```

**Implementation priority: Low.** Streaming is not critical for transcription
since the entire audio file must be processed before meaningful captions are
available. Consider only if users report long wait times.

---

## 6. Error Handling

### 6.1 Provider Error Types

```typescript
export type LlmErrorCode =
  | "PROVIDER_NOT_FOUND"
  | "INVALID_API_KEY"
  | "RATE_LIMITED"
  | "MODEL_NOT_FOUND"
  | "AUDIO_TOO_LARGE"
  | "NETWORK_ERROR"
  | "TIMEOUT"
  | "CANCELLED"
  | "PROVIDER_ERROR"
  | "PARSE_ERROR";

export interface LlmError {
  code: LlmErrorCode;
  message: string;
  retryable: boolean;
  retryAfterMs?: number;
  details?: unknown;
}
```

### 6.2 Retry Policy

```typescript
export interface RetryPolicy {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  retryableErrors: LlmErrorCode[];
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxRetries: 2,
  baseDelayMs: 1000,
  maxDelayMs: 10000,
  retryableErrors: ["RATE_LIMITED", "NETWORK_ERROR", "TIMEOUT"],
};
```

---

## 7. Usage and Cost Tracking

### 7.1 Usage Metadata

Each transcription result includes optional usage data:

```typescript
export interface LlmUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  estimatedCostUsd?: number;
  modelId: string;
  providerId: string;
  durationMs: number;
}
```

### 7.2 Usage Aggregation (Optional)

- Store usage records in local settings (per-session or cumulative).
- Display estimated cost in the UI when available.
- No server-side aggregation for the initial implementation.

---

## 8. Testing Strategy

### 8.1 Unit Tests

- `normalizeLlmConfig()` — Input validation and defaults.
- `ProviderRegistry` — Registration, lookup, listing.
- Error code mapping and retry logic.

### 8.2 Integration Tests (existing)

- `electron/ipc/providers/openaiWhisperProvider.test.ts`
- `electron/ipc/providers/registry.test.ts`
- `electron/ipc/captions/generate.test.ts`
- `electron/ipc/captions/generation.test.ts`

These tests should be ported to the new package structure.

### 8.3 Mock Provider

```typescript
export function createMockTranscriptionProvider(
  cues: CaptionCue[] = []
): TranscriptionProvider {
  return {
    id: "mock",
    label: "Mock Provider",
    requiresApiKey: false,
    async transcribe() {
      return { cues, supportsWordTimings: true };
    },
  };
}
```

---

## 9. Future AI Capabilities

The current provider system is designed for transcription only. Future
AI-powered features may include:

| Feature                     | Provider Type      | Priority |
|-----------------------------|--------------------|----------|
| Auto-zoom suggestions       | Vision model       | Medium   |
| Auto-annotation              | Vision model       | Low      |
| Smart silence detection      | Audio model        | Low      |
| Content-aware trimming       | Multimodal model   | Low      |
| Auto-title generation        | Text model         | Low      |

The `ProviderRegistry` pattern generalizes well:

```typescript
// Future registries
export const zoomSuggestionProviders = new ProviderRegistry<ZoomSuggestionProvider>();
export const annotationProviders = new ProviderRegistry<AnnotationProvider>();
```

Each new AI capability should follow the same pattern:
- Define a provider interface with `id`, `label`, `requiresApiKey`.
- Use the same `LlmProviderConfig` for configuration where applicable.
- Register providers in the adaptation layer (desktop, web, mobile).

---

## 10. Architecture Decision

This document preserves the existing provider registry pattern (ADR-09 in
`09-ARCHITECTURE-DECISIONS.md`). The primary changes are:

1. **Eliminate the duplicated `LlmProviderConfig`** (renderer + main process).
2. **Move shared types to `packages/domain/`**.
3. **Expose providers through the `CaptionAdapter` interface**.
4. **Support web/mobile** by making HTTP calls from the appropriate context.
5. **Add usage tracking** for cost visibility.
6. **Add retry policies** for cloud providers.
