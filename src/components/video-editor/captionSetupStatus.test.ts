import { describe, expect, it } from "vitest";

import { getCaptionSetupStatus } from "./captionSetupStatus";

const READY_INPUT = {
	captionCueCount: 0,
	captionsEnabled: true,
	whisperModelPath: "/models/ggml-small.bin",
	whisperExecutablePath: "/tools/whisper/whisper-cli",
	captionFfmpegPath: "/tools/ffmpeg",
	captionFfmpegError: null,
	captionGenerationError: null,
	isGeneratingCaptions: false,
};

describe("getCaptionSetupStatus", () => {
	it("guides the user to choose or download a model first", () => {
		const status = getCaptionSetupStatus({
			...READY_INPUT,
			whisperModelPath: null,
		});

		expect(status.id).toBe("missing-model");
		expect(status.canGenerate).toBe(false);
		expect(status.tone).toBe("setup");
	});

	it("treats an invalid selected runtime as an engine setup issue", () => {
		const status = getCaptionSetupStatus({
			...READY_INPUT,
			captionGenerationError: "Whisper runtime is not marked as executable.",
		});

		expect(status.id).toBe("missing-engine");
		expect(status.isMissingEngineError).toBe(true);
		expect(status.canGenerate).toBe(false);
	});

	it("surfaces FFmpeg failures after model and engine are ready", () => {
		const status = getCaptionSetupStatus({
			...READY_INPUT,
			captionFfmpegPath: null,
			captionFfmpegError: "FFmpeg binary is unavailable.",
		});

		expect(status.id).toBe("missing-ffmpeg");
		expect(status.isMissingFfmpegError).toBe(true);
		expect(status.tone).toBe("error");
	});

	it("keeps generation available for no-audio errors so a changed source can be retried", () => {
		const status = getCaptionSetupStatus({
			...READY_INPUT,
			captionGenerationError: "No audio was found to transcribe.",
		});

		expect(status.id).toBe("missing-audio");
		expect(status.isMissingAudioError).toBe(true);
		expect(status.canGenerate).toBe(true);
	});

	it("explains when generated captions exist but are hidden", () => {
		const status = getCaptionSetupStatus({
			...READY_INPUT,
			captionCueCount: 4,
			captionsEnabled: false,
		});

		expect(status.id).toBe("captions-hidden");
		expect(status.canGenerate).toBe(true);
		expect(status.tone).toBe("setup");
	});

	it("marks captions as ready when cues exist and the preview toggle is enabled", () => {
		const status = getCaptionSetupStatus({
			...READY_INPUT,
			captionCueCount: 4,
			captionsEnabled: true,
		});

		expect(status.id).toBe("ready-with-captions");
		expect(status.canGenerate).toBe(true);
		expect(status.tone).toBe("ready");
	});
});
