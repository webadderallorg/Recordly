import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { toast } from "@/components/ui/toast";
import { useAutoCaptionController } from "./useAutoCaptionController";

const state = vi.hoisted(() => ({
	refs: [] as { current: unknown }[],
	index: 0,
	effects: [] as (() => unknown)[],
}));
vi.mock("react", () => ({
	useCallback: (callback: unknown) => callback,
	useState: (initial: unknown) => {
		const index = state.index++;
		state.refs[index] ??= { current: typeof initial === "function" ? initial() : initial };
		return [
			state.refs[index].current,
			(value: unknown) => {
				state.refs[index].current = value;
			},
		];
	},
	useEffect: (effect: () => unknown) => state.effects.push(effect),
	useRef: (current: unknown) => {
		const index = state.index++;
		state.refs[index] ??= { current };
		return state.refs[index];
	},
}));
vi.mock("@/contexts/I18nContext", async () => {
	const { translateForLocale } = await import("@/i18n/messages");
	return {
		useScopedT:
			(namespace: string) =>
			(key: string, fallback?: string, vars?: Record<string, string | number>) =>
				translateForLocale("en", `${namespace}.${key}`, fallback, vars),
	};
});
vi.mock("@/components/ui/toast", () => ({
	toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() },
}));
beforeEach(() => {
	state.refs = [];
	state.index = 0;
	state.effects = [];
});
afterEach(() => vi.unstubAllGlobals());
function setup() {
	let complete!: (result: unknown) => void;
	const generateAutoCaptions = vi.fn(
		(_options: unknown) =>
			new Promise((resolve) => {
				complete = resolve;
			}),
	);
	vi.stubGlobal("window", { electronAPI: { generateAutoCaptions } });
	const params = {
		videoSourcePath: "/recordings/a.mp4",
		videoPath: "file:///recordings/a.mp4",
		whisperModelPath: "/models/old-small.bin",
		downloadedWhisperModelPath: "/models/parakeet-v3",
		whisperModelDownloadStatus: "downloaded",
		isGeneratingCaptions: false,
		autoCaptionSettings: { language: "en" },
		setIsGeneratingCaptions: vi.fn(),
		setWhisperModelPath: vi.fn(),
		setDownloadedWhisperModelPath: vi.fn(),
		setWhisperModelDownloadStatus: vi.fn(),
		setWhisperModelDownloadProgress: vi.fn(),
		setAutoCaptions: vi.fn(),
		setAutoCaptionSettings: vi.fn(),
		syncActiveVideoSource: vi.fn(),
		t: (key: string) => key,
	} as unknown as Parameters<typeof useAutoCaptionController>[0];
	const render = () => {
		state.index = 0;
		return useAutoCaptionController(params);
	};
	return {
		params,
		render,
		generateAutoCaptions,
		complete: (result: unknown) => complete(result),
	};
}
const cues = [{ id: "generated", startMs: 0, endMs: 1000, text: "Hello" }];
it("deduplicates requests and enables captions without resetting the active session", async () => {
	const test = setup();
	const controller = test.render();
	const pending = controller.handleGenerateAutoCaptions();
	await controller.handleGenerateAutoCaptions();
	expect(test.generateAutoCaptions).toHaveBeenCalledTimes(1);
	expect(test.generateAutoCaptions).toHaveBeenCalledWith({
		videoPath: "/recordings/a.mp4",
		captionModelId: "parakeet-v3",
		engine: "parakeet",
		parakeetModelPath: "/models/parakeet-v3",
		language: "auto",
	});
	test.complete({ success: true, cues });
	await pending;
	expect(test.params.setAutoCaptions).toHaveBeenCalledWith(cues);
	expect(test.params.setAutoCaptionSettings).toHaveBeenCalledOnce();
	expect(test.params.syncActiveVideoSource).not.toHaveBeenCalled();
	expect(test.params.setIsGeneratingCaptions).toHaveBeenLastCalledWith(false);
});
it("discards results after switching recordings", async () => {
	const test = setup();
	const pending = test.render().handleGenerateAutoCaptions();
	test.params.videoSourcePath = "/recordings/b.mp4";
	test.render();
	test.complete({ success: true, cues });
	await pending;
	expect(test.params.setAutoCaptions).not.toHaveBeenCalled();
	expect(test.params.setIsGeneratingCaptions).toHaveBeenLastCalledWith(false);
});
it("preserves existing captions on failure and permits retry", async () => {
	const test = setup();
	const controller = test.render();
	const pending = controller.handleGenerateAutoCaptions();
	test.complete({ success: false, error: "Transcription failed" });
	await pending;
	expect(test.params.setAutoCaptions).not.toHaveBeenCalled();
	const retry = controller.handleGenerateAutoCaptions();
	test.complete({ success: true, cues });
	await retry;
	expect(test.generateAutoCaptions).toHaveBeenCalledTimes(2);
	expect(test.params.setAutoCaptions).toHaveBeenCalledWith(cues);
});

it("downloads speech files and generates captions from one request", async () => {
	const test = setup();
	test.params.downloadedWhisperModelPath = null;
	test.params.whisperModelDownloadStatus = "idle";
	window.electronAPI.downloadCaptionModel = vi.fn(async () => ({
		success: true,
		path: "/installed/parakeet-v3",
	}));
	const pending = test.render().handleGenerateAutoCaptions();
	await vi.waitFor(() => expect(test.generateAutoCaptions).toHaveBeenCalledOnce());
	expect(window.electronAPI.downloadCaptionModel).toHaveBeenCalledWith("parakeet-v3");
	expect(test.generateAutoCaptions).toHaveBeenCalledWith(
		expect.objectContaining({ parakeetModelPath: "/installed/parakeet-v3" }),
	);
	expect(test.params.setWhisperModelDownloadStatus).toHaveBeenLastCalledWith("downloaded");
	test.complete({ success: true, cues });
	await pending;
	expect(test.params.setAutoCaptions).toHaveBeenCalledWith(cues);
});

it("keeps existing captions after a failed first download and permits retry", async () => {
	const test = setup();
	test.params.downloadedWhisperModelPath = null;
	test.params.whisperModelDownloadStatus = "idle";
	window.electronAPI.downloadCaptionModel = vi
		.fn()
		.mockResolvedValueOnce({ success: false, error: "Offline" })
		.mockResolvedValueOnce({ success: true, path: "/installed/parakeet-v3" });
	const controller = test.render();
	await controller.handleGenerateAutoCaptions();
	expect(test.generateAutoCaptions).not.toHaveBeenCalled();
	expect(test.params.setAutoCaptions).not.toHaveBeenCalled();
	expect(test.params.setWhisperModelDownloadStatus).toHaveBeenLastCalledWith("error");
	expect(toast.error).toHaveBeenLastCalledWith("Failed to download caption model", {
		description: "Offline",
	});
	expect(test.params.setIsGeneratingCaptions).toHaveBeenLastCalledWith(false);
	const retry = controller.handleGenerateAutoCaptions();
	await vi.waitFor(() => expect(test.generateAutoCaptions).toHaveBeenCalledOnce());
	test.complete({ success: true, cues });
	await retry;
	expect(test.params.setAutoCaptions).toHaveBeenCalledWith(cues);
});

it("deduplicates first-use downloads and does not transcribe a recording that changed meanwhile", async () => {
	const test = setup();
	test.params.downloadedWhisperModelPath = null;
	test.params.whisperModelDownloadStatus = "idle";
	let finishDownload!: (value: { success: boolean; path: string }) => void;
	window.electronAPI.downloadCaptionModel = vi.fn(
		() =>
			new Promise((resolve) => {
				finishDownload = resolve;
			}),
	);
	window.electronAPI.setAppSetting = vi.fn(() => true);
	const controller = test.render();
	const pending = controller.handleGenerateAutoCaptions();
	await controller.handleGenerateAutoCaptions();
	controller.handleCaptionModelChange("whisper-base");
	expect(window.electronAPI.downloadCaptionModel).toHaveBeenCalledOnce();
	expect(window.electronAPI.setAppSetting).not.toHaveBeenCalled();
	test.params.videoSourcePath = "/recordings/b.mp4";
	test.render();
	finishDownload({ success: true, path: "/installed/parakeet-v3" });
	await pending;
	expect(test.generateAutoCaptions).not.toHaveBeenCalled();
	expect(test.params.syncActiveVideoSource).not.toHaveBeenCalled();
	expect(test.params.setAutoCaptions).not.toHaveBeenCalled();
	expect(test.params.setIsGeneratingCaptions).toHaveBeenLastCalledWith(false);
});

it("resolves the selected managed installation instead of a stale saved path", async () => {
	const test = setup();
	window.electronAPI.onCaptionModelDownloadProgress = vi.fn(() => () => {});
	window.electronAPI.getCaptionModelStatus = vi.fn(async () => ({
		success: true,
		exists: true,
		path: "/installed/parakeet-v3",
	}));
	test.render();
	state.effects[0]();
	expect(test.params.setWhisperModelPath).toHaveBeenCalledWith(null);
	await Promise.resolve();
	expect(test.params.setWhisperModelPath).toHaveBeenLastCalledWith("/installed/parakeet-v3");
	expect(test.params.setDownloadedWhisperModelPath).toHaveBeenLastCalledWith(
		"/installed/parakeet-v3",
	);
});

it("persists a multilingual model selection and routes generation to Whisper", async () => {
	const test = setup();
	window.electronAPI.setAppSetting = vi.fn(() => true);
	test.render().handleCaptionModelChange("whisper-base");
	expect(window.electronAPI.setAppSetting).toHaveBeenCalledWith(
		"recordly.captions.model",
		"whisper-base",
	);
	test.params.downloadedWhisperModelPath = "/installed/ggml-base.bin";
	const pending = test.render().handleGenerateAutoCaptions();
	expect(test.generateAutoCaptions).toHaveBeenCalledWith(
		expect.objectContaining({
			captionModelId: "whisper-base",
			engine: "whisper",
			whisperModelPath: "/installed/ggml-base.bin",
			language: "auto",
		}),
	);
	expect(test.generateAutoCaptions.mock.calls[0][0]).not.toHaveProperty("parakeetModelPath");
	test.complete({ success: true, cues });
	await pending;
});

it("ignores a stale status result after switching models", async () => {
	const test = setup();
	let resolveOld!: (value: unknown) => void;
	window.electronAPI.onCaptionModelDownloadProgress = vi.fn(() => () => {});
	window.electronAPI.getCaptionModelStatus = vi.fn((id) =>
		id === "parakeet-v3"
			? new Promise((resolve) => {
					resolveOld = resolve;
				})
			: Promise.resolve({ success: true, exists: true, path: "/installed/ggml-small.bin" }),
	) as typeof window.electronAPI.getCaptionModelStatus;
	const controller = test.render();
	const cleanup = state.effects[0]() as () => void;
	controller.handleCaptionModelChange("whisper-small");
	cleanup();
	test.render();
	state.effects.at(-1)!();
	await Promise.resolve();
	resolveOld({ success: true, exists: true, path: "/old/parakeet" });
	await Promise.resolve();
	expect(test.params.setDownloadedWhisperModelPath).toHaveBeenLastCalledWith(
		"/installed/ggml-small.bin",
	);
});

it("blocks generation and switching while a model deletion is pending", async () => {
	const test = setup();
	let finishDelete!: (result: { success: boolean }) => void;
	window.electronAPI.deleteCaptionModel = vi.fn(
		() =>
			new Promise((resolve) => {
				finishDelete = resolve;
			}),
	);
	window.electronAPI.setAppSetting = vi.fn(() => true);
	const controller = test.render();
	const pending = controller.handleDeleteWhisperSmallModel();
	await controller.handleGenerateAutoCaptions();
	controller.handleCaptionModelChange("whisper-base");
	expect(test.generateAutoCaptions).not.toHaveBeenCalled();
	expect(window.electronAPI.setAppSetting).not.toHaveBeenCalled();
	finishDelete({ success: true });
	await pending;
	expect(test.params.setDownloadedWhisperModelPath).toHaveBeenLastCalledWith(null);
});
