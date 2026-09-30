import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// Mock modules before importing the provider
vi.mock("node:fs/promises", () => ({
	default: {
		stat: vi.fn(),
		readFile: vi.fn(),
	},
}));

import fs from "node:fs/promises";
import { createOpenAiWhisperProvider } from "./openaiWhisperProvider";

describe("OpenAI Whisper Provider", () => {
	const mockApiKey = "sk-test-key-123";

	beforeEach(() => {
		vi.restoreAllMocks();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("has the correct ID and metadata", () => {
		const provider = createOpenAiWhisperProvider({ apiKey: mockApiKey });
		expect(provider.id).toBe("openai-whisper");
		expect(provider.label).toBe("OpenAI Whisper API");
		expect(provider.requiresApiKey).toBe(true);
	});

	it("rejects files larger than 25 MB", async () => {
		const provider = createOpenAiWhisperProvider({ apiKey: mockApiKey });
		vi.mocked(fs.stat).mockResolvedValue({ size: 30 * 1024 * 1024 } as Awaited<
			ReturnType<typeof fs.stat>
		>);

		await expect(
			provider.transcribe({ audioPath: "/tmp/large.wav", language: "en" }),
		).rejects.toThrow("exceeds the API limit of 25 MB");
	});

	it("sends correct request format and parses verbose_json response", async () => {
		const provider = createOpenAiWhisperProvider({ apiKey: mockApiKey, model: "whisper-1" });

		vi.mocked(fs.stat).mockResolvedValue({ size: 1024 } as Awaited<
			ReturnType<typeof fs.stat>
		>);
		vi.mocked(fs.readFile).mockResolvedValue(Buffer.from("fake wav data"));

		const mockResponse: Record<string, unknown> = {
			text: "Hello world",
			duration: 2.5,
			segments: [
				{
					id: 0,
					start: 0.0,
					end: 2.5,
					text: "Hello world",
					words: [
						{ word: "Hello", start: 0.0, end: 1.0 },
						{ word: " world", start: 1.0, end: 2.5 },
					],
				},
			],
		};

		const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => mockResponse,
		} as Response);

		const result = await provider.transcribe({
			audioPath: "/tmp/test.wav",
			language: "en",
		});

		// Verify fetch was called with correct URL and headers
		expect(fetchSpy).toHaveBeenCalledTimes(1);
		const [url, options] = fetchSpy.mock.calls[0] as [string, RequestInit];
		expect(url).toBe("https://api.openai.com/v1/audio/transcriptions");
		expect((options.headers as Record<string, string>).Authorization).toBe(
			`Bearer ${mockApiKey}`,
		);
		expect(options.method).toBe("POST");

		// Verify parsed result
		expect(result.cues).toHaveLength(1);
		expect(result.cues[0].text).toBe("Hello world");
		expect(result.cues[0].startMs).toBe(0);
		expect(result.cues[0].endMs).toBe(2500);
		expect(result.cues[0].words).toHaveLength(2);
		expect(result.cues[0].words?.[0].text).toBe("Hello");
		expect(result.cues[0].words?.[1].text).toBe("world");
		expect(result.cues[0].words?.[1].leadingSpace).toBe(true);
		expect(result.supportsWordTimings).toBe(true);
	});

	it("handles 401 authentication error", async () => {
		const provider = createOpenAiWhisperProvider({ apiKey: "bad-key" });

		vi.mocked(fs.stat).mockResolvedValue({ size: 1024 } as Awaited<
			ReturnType<typeof fs.stat>
		>);
		vi.mocked(fs.readFile).mockResolvedValue(Buffer.from("fake wav data"));

		vi.spyOn(globalThis, "fetch").mockResolvedValue({
			ok: false,
			status: 401,
			text: async () => "Unauthorized",
		} as Response);

		await expect(
			provider.transcribe({ audioPath: "/tmp/test.wav", language: "en" }),
		).rejects.toThrow("invalid or expired");
	});

	it("handles 429 rate limit error", async () => {
		const provider = createOpenAiWhisperProvider({ apiKey: mockApiKey });

		vi.mocked(fs.stat).mockResolvedValue({ size: 1024 } as Awaited<
			ReturnType<typeof fs.stat>
		>);
		vi.mocked(fs.readFile).mockResolvedValue(Buffer.from("fake wav data"));

		vi.spyOn(globalThis, "fetch").mockResolvedValue({
			ok: false,
			status: 429,
			text: async () => "Rate limited",
		} as Response);

		await expect(
			provider.transcribe({ audioPath: "/tmp/test.wav", language: "en" }),
		).rejects.toThrow("rate limit");
	});

	it("uses custom base URL when provided", async () => {
		const provider = createOpenAiWhisperProvider({
			apiKey: mockApiKey,
			baseUrl: "https://custom.api.example.com/v1",
		});

		vi.mocked(fs.stat).mockResolvedValue({ size: 1024 } as Awaited<
			ReturnType<typeof fs.stat>
		>);
		vi.mocked(fs.readFile).mockResolvedValue(Buffer.from("fake wav data"));

		const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({ text: "test", segments: [] }),
		} as Response);

		await provider.transcribe({ audioPath: "/tmp/test.wav", language: "auto" });

		const [url] = fetchSpy.mock.calls[0] as [string, RequestInit];
		expect(url).toBe("https://custom.api.example.com/v1/audio/transcriptions");
	});

	it("validates config: reports invalid key on 401 response", async () => {
		const provider = createOpenAiWhisperProvider({ apiKey: mockApiKey });
		vi.spyOn(globalThis, "fetch").mockResolvedValue({
			ok: false,
			status: 401,
			statusText: "Unauthorized",
			text: async () => "Unauthorized",
		} as Response);

		const result = await provider.validateConfig!({
			provider: "openai-whisper",
			apiKey: "invalid-key",
			model: "whisper-1",
			baseUrl: null,
		});
		expect(result.valid).toBe(false);
		expect(result.error).toContain("invalid or unauthorized");
	});
});
