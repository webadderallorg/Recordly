# Custom LLM Provider for Captions (Phase 1) — Extensible Core

## Goal
Add an **extensible LLM/AI provider system** to Recordly's caption pipeline. Phase 1 focuses on captions (speech-to-text transcription via external API). The core is designed so future phases can reuse the same provider registry for zoom-suggestion, auto-annotation, and other AI-driven features.

---

## Current Architecture (Baseline)

### Caption Pipeline Flow
```
User clicks "Generate Captions"
  → useAutoCaptionController.handleGenerateAutoCaptions()
  → IPC "generate-auto-captions"
  → generateAutoCaptionsFromVideo()
    → resolveCaptionAudioCandidates()          // find mic/system/video audio
    → generateCaptionsForSource()              // per-track transcription
      → extractCaptionAudioSource()            // ffmpeg → 16kHz mono WAV
      → executeWhisper()                       // spawn whisper-cli binary
      → readWhisperCaptionOutput()             // read JSON/SRT output files
      → detectSilenceIntervals()               // ffmpeg silencedetect
      → segmentCuesIntoPhrases()               // re-segment into natural phrases
    → mergeCaptionSources()                    // merge mic + system tracks
  → IPC response { cues: CaptionCuePayload[] }
```

### Key Types
- `CaptionCuePayload { id, startMs, endMs, text, words? }` — wire format (electron/ipc/types.ts)
- `CaptionWordPayload { text, startMs, endMs, leadingSpace? }` — word-level timing
- `AutoCaptionSettings` — renderer-side caption config (src/components/video-editor/types.ts)

### Settings Pattern
- Plain JSON files in `<USER_DATA_PATH>/app-settings.json`
- Generic key-value IPC: `loadAppSetting(key)` / `saveAppSetting(key, value)`
- No changes to IPC handlers needed for new keys

---

## Design Decisions

### 1. Provider Abstraction Layer
Create a `TranscriptionProvider` interface that abstracts the transcription step (audio → cues). Both Whisper (local) and API-based providers implement this interface.

```typescript
interface TranscriptionProvider {
  id: string;                           // "whisper-local" | "openai-whisper" | "google-stt" | ...
  label: string;                        // Display name
  requiresApiKey: boolean;
  transcribe(request: TranscriptionRequest): Promise<TranscriptionResult>;
  validateConfig?(config: LlmProviderConfig): Promise<{ valid: boolean; error?: string }>;
}

interface TranscriptionRequest {
  audioPath: string;                    // Path to extracted WAV (16kHz mono)
  language: string;                     // ISO language code
  signal?: AbortSignal;                // Cancellation
}

interface TranscriptionResult {
  cues: CaptionCuePayload[];           // Reuse existing wire type
  supportsWordTimings: boolean;
}
```

### 2. Provider Registry (Extensible Core for Future Use)
A simple registry pattern that maps provider IDs to implementations. Future phases add providers for other capabilities (zoom, annotation, etc.) using the same registry architecture.

```typescript
// electron/ipc/providers/registry.ts
class ProviderRegistry<T> {
  register(id: string, provider: T): void;
  get(id: string): T | undefined;
  list(): Array<{ id: string; provider: T }>;
}

// Singleton instances
export const transcriptionProviders = new ProviderRegistry<TranscriptionProvider>();
```

### 3. Provider Selection + API Key Storage
- New settings key: `"llmProviderConfig"` in `app-settings.json`
- API keys stored via `electron.safeStorage.encryptString()` for security
- Provider selection added to the existing caption settings UI section

### 4. Injection Point
The cleanest injection is inside `generateCaptionsForSource()` at `electron/ipc/captions/generate.ts:L232-L332`. The function currently hardcodes Whisper. After the change, it will:
1. Check the selected provider from settings
2. Extract audio (shared step — all providers need WAV)
3. Dispatch to the selected `TranscriptionProvider.transcribe()`
4. Continue with shared post-processing (silence detection + segmentation)

---

## Task List

### Phase 1A: Core Provider Infrastructure

#### Task 1: Create provider types and registry
**Files to create:**
- `electron/ipc/providers/types.ts` — `TranscriptionProvider`, `TranscriptionRequest`, `TranscriptionResult`, `LlmProviderConfig` interfaces
- `electron/ipc/providers/registry.ts` — Generic `ProviderRegistry<T>` class + `transcriptionProviders` singleton

#### Task 2: Wrap existing Whisper pipeline as a provider
**File to create:**
- `electron/ipc/providers/whisperLocalProvider.ts`
  - Implements `TranscriptionProvider`
  - Extracts the whisper-specific logic from `generateCaptionsForSource()`: `resolveWhisperExecutablePath()`, `executeWhisper()`, `readWhisperCaptionOutput()` + JSON/SRT parsing
  - `requiresApiKey: false`
  - Returns `{ cues, supportsWordTimings: true }` for JSON mode, `false` for SRT fallback

#### Task 3: Create OpenAI Whisper API provider
**File to create:**
- `electron/ipc/providers/openaiWhisperProvider.ts`
  - Implements `TranscriptionProvider`
  - Uses OpenAI `/v1/audio/transcriptions` endpoint with `response_format: "verbose_json"` for word-level timings
  - Reads audio file, sends as multipart form upload
  - Converts OpenAI response format → `CaptionCuePayload[]`
  - `requiresApiKey: true`
  - `validateConfig()`: test API key with a lightweight request
  - **No SDK dependency** — uses native `fetch()` (Node 22 built-in)
  - Supports `model: "whisper-1"` (configurable)

#### Task 4: Register providers at startup
**File to modify:**
- `electron/ipc/handlers.ts` — Add `registerProviders()` call that registers `whisperLocalProvider` and `openaiWhisperProvider` into the `transcriptionProviders` registry

### Phase 1B: Settings & Configuration

#### Task 5: Create LLM provider settings module
**File to create:**
- `src/lib/llmSettings.ts`
  - `LlmProviderConfig` interface: `{ provider: string; apiKey: string; model: string; baseUrl: string | null }`
  - `DEFAULT_LLM_CONFIG` with `provider: "whisper-local"`
  - `normalizeLlmConfig(candidate: unknown): LlmProviderConfig`
  - `loadLlmConfig()` / `saveLlmConfig(partial)` using existing `loadAppSetting`/`saveAppSetting`

#### Task 6: Add API key encryption IPC
**Files to modify:**
- `electron/preload.ts` — Add `encryptSecret(value)` / `decryptSecret(encrypted)` to `electronAPI`
- `electron/ipc/register/settings.ts` — Add IPC handlers wrapping `safeStorage.encryptString()`/`decryptString()`
- `electron/electron-env.d.ts` — Update `ElectronAPI` type declarations

#### Task 7: Add provider config to auto-caption IPC options
**File to modify:**
- `electron/ipc/types.ts` — Add optional `provider?: string` and `apiKey?: string` fields to the generate-auto-captions options type
- `electron/ipc/register/captions.ts` — Pass provider selection through to `generateAutoCaptionsFromVideo()`

### Phase 1C: Pipeline Integration

#### Task 8: Refactor `generateCaptionsForSource()` to use provider dispatch
**File to modify:**
- `electron/ipc/captions/generate.ts`
  - At `L232-L332`: replace hardcoded Whisper logic with:
    1. Resolve provider from `transcriptionProviders.get(options.provider ?? "whisper-local")`
    2. Keep shared `extractCaptionAudioSource()` step
    3. Call `provider.transcribe({ audioPath, language })`
    4. Keep shared `detectSilenceIntervals()` + `segmentCuesIntoPhrases()` post-processing
  - Preserve backward compatibility: if no provider specified, defaults to `"whisper-local"`

### Phase 1D: UI Integration

#### Task 9: Add provider selection to caption settings UI
**Files to modify:**
- `src/components/video-editor/SettingsSections.tsx` — Add a "Transcription Provider" dropdown in the Captions section (above the existing whisper model/binary selectors)
- When `provider !== "whisper-local"`: hide whisper-specific selectors (model picker, binary picker), show API key input and model selector
- Use existing `<Select>` and `<Input>` components from `src/components/ui/`

#### Task 10: Update `useAutoCaptionController` to pass provider config
**File to modify:**
- `src/components/video-editor/captions/useAutoCaptionController.ts`
  - In `handleGenerateAutoCaptions()` (L158-L231): load LLM config, include `provider` and `apiKey` in the IPC call options

### Phase 1E: Testing & Validation

#### Task 11: Unit tests for provider registry
**File to create:**
- `electron/ipc/providers/registry.test.ts` — register, get, list, unknown-id behavior

#### Task 12: Unit tests for OpenAI provider
**File to create:**
- `electron/ipc/providers/openaiWhisperProvider.test.ts` — mock fetch, verify request format, verify response parsing to `CaptionCuePayload[]`, error handling (401, 429, timeout)

#### Task 13: Unit tests for provider dispatch in generate.ts
**File to modify:**
- `electron/ipc/captions/generate.test.ts` — add cases for provider selection, fallback to whisper-local when unspecified

#### Task 14: Integration smoke test
- Verify `npm run dev` starts without errors
- Verify caption generation still works with default Whisper provider (no regression)
- Verify provider dropdown appears in settings
- Verify API key field appears when non-local provider is selected

---

## File Impact Summary

### New Files (7)
| File | Purpose |
|---|---|
| `electron/ipc/providers/types.ts` | Provider interfaces & config types |
| `electron/ipc/providers/registry.ts` | Generic provider registry |
| `electron/ipc/providers/whisperLocalProvider.ts` | Wrap existing Whisper as provider |
| `electron/ipc/providers/openaiWhisperProvider.ts` | OpenAI Whisper API provider |
| `src/lib/llmSettings.ts` | LLM settings load/save/normalize |
| `electron/ipc/providers/registry.test.ts` | Registry unit tests |
| `electron/ipc/providers/openaiWhisperProvider.test.ts` | OpenAI provider unit tests |

### Modified Files (8)
| File | Change |
|---|---|
| `electron/ipc/captions/generate.ts` | Refactor `generateCaptionsForSource()` to use provider dispatch |
| `electron/ipc/captions/generate.test.ts` | Add provider dispatch test cases |
| `electron/ipc/handlers.ts` | Add `registerProviders()` call |
| `electron/ipc/types.ts` | Add provider fields to IPC options |
| `electron/ipc/register/captions.ts` | Pass provider through to generation |
| `electron/ipc/register/settings.ts` | Add safeStorage IPC handlers |
| `electron/preload.ts` | Add encrypt/decrypt API + update type declarations |
| `electron/electron-env.d.ts` | Update `ElectronAPI` type |
| `src/components/video-editor/SettingsSections.tsx` | Provider selection UI |
| `src/components/video-editor/captions/useAutoCaptionController.ts` | Load & pass provider config |

---

## Future Phases (Out of Scope)

These are documented for architectural awareness but **not implemented** in Phase 1:

- **Phase 2: Auto-Zoom via LLM** — Add a `ZoomSuggestionProvider` capability to the registry. LLM analyzes cursor telemetry + click events to suggest zoom regions.
- **Phase 3: Auto-Annotation** — LLM generates annotation callouts based on screen content and cursor activity.
- **Phase 4: Multi-Provider UI** — Settings panel for managing multiple provider configs, per-feature provider selection, cost/usage tracking.
- **Phase 5: Custom/Self-Hosted Providers** — Support for custom OpenAI-compatible endpoints (Ollama, vLLM, etc.) via the `baseUrl` field already in `LlmProviderConfig`.

---

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| API key stored insecurely | Use `electron.safeStorage` encryption; keys never leave main process in plaintext |
| OpenAI API file size limits (25MB for Whisper) | Check file size before upload; fall back to local Whisper with user notification for large files |
| Network failures during API transcription | Wrap in try/catch; surface clear error to UI; existing Whisper always available as fallback |
| Breaking existing Whisper pipeline | Whisper provider wraps existing functions unchanged; default provider is `"whisper-local"` |
| Word timing accuracy differs between providers | `TranscriptionResult.supportsWordTimings` flag; UI can adjust caption animation behavior based on timing granularity |

---

## Validation Checklist

- [ ] `npm run typecheck` passes
- [ ] `npm test` passes (all existing + new tests)
- [ ] Caption generation with default Whisper provider works unchanged
- [ ] Provider dropdown renders in caption settings
- [ ] Selecting OpenAI provider shows API key input, hides Whisper binary/model selectors
- [ ] API key is encrypted in `app-settings.json`
- [ ] OpenAI provider transcribes audio and produces captions with word timings
- [ ] Cancellation / error handling works for both providers
- [ ] No new dependencies added (uses native `fetch()`)
