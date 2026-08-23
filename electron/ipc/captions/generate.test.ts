import { beforeEach, describe, expect, it, vi } from "vitest";

const { getCompanionAudioFallbackInfoMock, resolveRecordingSessionMock } = vi.hoisted(() => ({
	getCompanionAudioFallbackInfoMock: vi.fn(),
	resolveRecordingSessionMock: vi.fn(),
}));

vi.mock("electron", () => ({ app: { getPath: () => "/tmp" } }));
vi.mock("../recording/diagnostics", () => ({
	getCompanionAudioFallbackInfo: getCompanionAudioFallbackInfoMock,
}));
vi.mock("../project/session", () => ({
	resolveRecordingSession: resolveRecordingSessionMock,
}));

import { parseMaxVolumeDb, resolveCaptionAudioCandidates } from "./generate";

describe("resolveCaptionAudioCandidates", () => {
	beforeEach(() => {
		getCompanionAudioFallbackInfoMock.mockReset();
		resolveRecordingSessionMock.mockReset();
		resolveRecordingSessionMock.mockResolvedValue(null);
	});

	it("falls back from the recording to system and microphone sidecars", async () => {
		const videoPath = "/recordings/recording.mp4";
		getCompanionAudioFallbackInfoMock.mockResolvedValue({
			paths: [videoPath, "/recordings/recording.system.m4a", "/recordings/recording.mic.wav"],
			candidatePaths: ["/recordings/recording.system.m4a", "/recordings/recording.mic.wav"],
			startDelayMsByPath: { "/recordings/recording.mic.wav": 125 },
		});

		await expect(resolveCaptionAudioCandidates(videoPath)).resolves.toEqual([
			{
				path: "/recordings/recording.system.m4a",
				label: "system and microphone recording",
				secondaryPath: "/recordings/recording.mic.wav",
				secondaryStartDelayMs: 125,
			},
			{ path: videoPath, label: "recording" },
			{ path: "/recordings/recording.system.m4a", label: "system audio recording" },
			{
				path: "/recordings/recording.mic.wav",
				label: "microphone recording",
				startDelayMs: 125,
			},
		]);
	});

	it("falls back to the recording and linked webcam without sidecars", async () => {
		getCompanionAudioFallbackInfoMock.mockResolvedValue({
			paths: [],
			startDelayMsByPath: {},
		});
		resolveRecordingSessionMock.mockResolvedValue({ webcamPath: "/recordings/webcam.mp4" });

		await expect(resolveCaptionAudioCandidates("/recordings/recording.mp4")).resolves.toEqual([
			{ path: "/recordings/recording.mp4", label: "recording" },
			{ path: "/recordings/webcam.mp4", label: "linked webcam recording" },
		]);
	});

	it("parses finite and silent FFmpeg volume measurements", () => {
		expect(parseMaxVolumeDb("[Parsed_volumedetect] max_volume: -18.4 dB")).toBe(-18.4);
		expect(parseMaxVolumeDb("[Parsed_volumedetect] max_volume: -inf dB")).toBe(
			Number.NEGATIVE_INFINITY,
		);
		expect(parseMaxVolumeDb("no volume measurement")).toBeNull();
	});
});
