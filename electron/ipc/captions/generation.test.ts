import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	exec: vi.fn(),
	readFile: vi.fn(),
	rm: vi.fn(),
	companions: vi.fn(),
	delay: vi.fn(),
	session: vi.fn(),
}));
vi.mock("node:child_process", () => ({
	execFile: (...args: unknown[]) => {
		const callback = args.pop() as (error: Error | null, result: unknown) => void;
		Promise.resolve()
			.then(() => mocks.exec(...args))
			.then(
				(result) => callback(null, result ?? { stderr: "" }),
				(error) => callback(error, undefined),
			);
	},
	spawnSync: vi.fn(),
}));
vi.mock("node:fs/promises", () => ({
	default: {
		access: vi.fn().mockResolvedValue(undefined),
		readFile: mocks.readFile,
		rm: mocks.rm,
	},
}));
vi.mock("electron", () => ({ app: { getPath: () => "/tmp" } }));
vi.mock("../ffmpeg/binary", () => ({ getFfmpegBinaryPath: () => "/ffmpeg" }));
vi.mock("../paths/binaries", () => ({ getBundledWhisperExecutableCandidates: () => ["/whisper"] }));
vi.mock("../project/session", () => ({ resolveRecordingSession: mocks.session }));
vi.mock("../recording/diagnostics", () => ({
	getUsableCompanionAudioCandidates: mocks.companions,
	getCompanionAudioStartDelayMs: mocks.delay,
}));
vi.mock("../utils", () => ({ normalizeVideoSourcePath: (value: string) => value }));

import { generateAutoCaptionsFromVideo } from "./generate";

const options = { videoPath: "/video.mp4", whisperModelPath: "/model.bin" };
const srt = "1\n00:00:00,000 --> 00:00:02,000\nHello world.\n";
const json = JSON.stringify({
	transcription: [
		{
			offsets: { from: 0, to: 2000 },
			text: "Hello world.",
			tokens: [
				{ text: "Hello", offsets: { from: 0, to: 900 } },
				{ text: " world.", offsets: { from: 900, to: 2000 } },
			],
		},
	],
});

beforeEach(() => {
	vi.clearAllMocks();
	mocks.session.mockReset().mockResolvedValue(null);
	mocks.companions.mockReset().mockResolvedValue([]);
	mocks.delay.mockReset().mockResolvedValue(null);
	mocks.exec.mockReset().mockResolvedValue({ stderr: "" });
	mocks.readFile
		.mockReset()
		.mockImplementation(async (file: string) => (file.endsWith(".json") ? json : srt));
	mocks.rm.mockResolvedValue(undefined);
});

const whisperCalls = () => mocks.exec.mock.calls.filter(([file]) => file === "/whisper");

describe("caption generation pipeline", () => {
	it("transcribes both sidecars independently, preserving the microphone delay", async () => {
		mocks.companions.mockResolvedValue([
			{
				platform: "mac",
				micPath: "/video.mic.wav",
				systemPath: "/video.system.wav",
				usablePaths: ["/video.system.wav", "/video.mic.wav"],
			},
		]);
		mocks.delay.mockResolvedValue(450);
		const result = await generateAutoCaptionsFromVideo(options);
		expect(result.audioSourceLabel).toBe("microphone and system audio");
		expect(whisperCalls()).toHaveLength(2);
		expect(mocks.exec.mock.calls.some(([, args]) => args.includes("/video.system.wav"))).toBe(
			true,
		);
		expect(mocks.exec.mock.calls[0][1]).toEqual(
			expect.arrayContaining(["-i", "/video.mic.wav", "-af", "adelay=450:all=1"]),
		);
	});

	it("falls back to embedded audio when the microphone cannot be extracted", async () => {
		mocks.companions.mockResolvedValue([
			{
				platform: "mac",
				micPath: "/video.mic.wav",
				systemPath: "/video.system.wav",
				usablePaths: ["/video.mic.wav"],
			},
		]);
		mocks.exec.mockImplementation(async (_file: string, args: string[]) => {
			if (args.includes("/video.mic.wav")) throw new Error("unreadable microphone");
			return { stderr: "" };
		});
		expect((await generateAutoCaptionsFromVideo(options)).cues[0].text).toBe("Hello world.");
	});

	it("extracts mono audio, transcribes, segments word timings and cleans up", async () => {
		const result = await generateAutoCaptionsFromVideo(options);
		expect(result.cues[0].text).toBe("Hello world.");
		expect(result.cues[0].words).toHaveLength(2);
		expect(mocks.exec.mock.calls[0][1]).toEqual(
			expect.arrayContaining(["-ac", "1", "-ar", "16000"]),
		);
		expect(whisperCalls()).toHaveLength(1);
		expect(whisperCalls()[0][1]).toEqual(expect.arrayContaining(["-mc", "0"]));
		expect(mocks.rm).toHaveBeenCalledTimes(3);
	});

	it("retries SRT only for a runtime that rejects full JSON", async () => {
		mocks.exec.mockImplementation(async (file: string, args: string[]) => {
			if (file === "/whisper" && args.includes("-ojf"))
				throw new Error("unknown argument: -ojf");
			return { stderr: "" };
		});
		expect((await generateAutoCaptionsFromVideo(options)).cues).toHaveLength(1);
		expect(whisperCalls()).toHaveLength(2);
		expect(whisperCalls()[1][1]).not.toContain("-ojf");
	});

	it("keeps transcription when optional silence detection fails", async () => {
		mocks.exec.mockImplementation(async (_file: string, args: string[]) => {
			if (args.includes("-af")) throw new Error("silence filter failed");
			return { stderr: "" };
		});
		expect((await generateAutoCaptionsFromVideo(options)).cues[0].text).toBe("Hello world.");
	});
});

it("falls back to linked webcam audio when mic exists and other secondary sources fail", async () => {
	mocks.session.mockResolvedValue({ webcamPath: "/webcam.mp4" });
	mocks.companions.mockResolvedValue([
		{
			platform: "mac",
			micPath: "/video.mic.wav",
			systemPath: "/video.system.wav",
			usablePaths: ["/video.mic.wav", "/video.system.wav"],
		},
	]);
	mocks.exec.mockImplementation(async (file: string, args: string[]) => {
		if (file === "/ffmpeg" && args.includes("pcm_s16le")) {
			const source = args[args.indexOf("-i") + 1];
			if (source === "/video.mp4" || source === "/video.system.wav")
				throw new Error("No audio");
		}
		return { stderr: "" };
	});
	const result = await generateAutoCaptionsFromVideo(options);
	expect(result.cues.length).toBeGreaterThan(0);
	expect(
		mocks.exec.mock.calls.some(
			([file, args]) => file === "/ffmpeg" && args.includes("/webcam.mp4"),
		),
	).toBe(true);
});
