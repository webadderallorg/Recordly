import { beforeEach, describe, expect, it, vi } from "vitest";

const companionInfo = {
	paths: ["C:\\Recordly\\recording.mic.wav"],
	startDelayMsByPath: {
		"C:\\Recordly\\recording.mic.wav": 143,
	},
	mediaInfoByPath: {
		"C:\\Recordly\\recording.mic.wav": {
			durationMs: 147_360,
			sampleRate: 48_000,
			channels: 1,
			hasAudioStream: true,
		},
	},
};

const getCompanionAudioFallbackInfoMock = vi.fn();
const rememberApprovedLocalReadPathMock = vi.fn(async () => undefined);

vi.mock("electron", () => ({
	app: {
		getAppPath: () => process.cwd(),
		getPath: () => process.cwd(),
		isPackaged: false,
	},
	BrowserWindow: {
		getAllWindows: () => [],
	},
	desktopCapturer: {
		getSources: vi.fn(),
	},
	dialog: {
		showMessageBox: vi.fn(),
	},
	ipcMain: {
		handle: vi.fn(),
	},
	shell: {
		openExternal: vi.fn(),
	},
	systemPreferences: {
		getMediaAccessStatus: vi.fn(),
		askForMediaAccess: vi.fn(),
	},
}));

vi.mock("../recording/diagnostics", () => ({
	getCompanionAudioFallbackInfo: getCompanionAudioFallbackInfoMock,
	getFileSizeIfPresent: vi.fn(),
	recordNativeCaptureDiagnostics: vi.fn(),
	summarizeMicrophoneChunkTiming: vi.fn(),
	validateRecordedVideo: vi.fn(),
	writeRecordingDiagnosticsSnapshot: vi.fn(),
}));

vi.mock("../project/manager", () => ({
	rememberApprovedLocalReadPath: rememberApprovedLocalReadPathMock,
}));

describe("resolveVideoAudioFallbackPathsForIpc", () => {
	beforeEach(() => {
		getCompanionAudioFallbackInfoMock.mockReset();
		rememberApprovedLocalReadPathMock.mockClear();
	});

	it("returns companion media info so renderer playback and waveforms can use probed duration", async () => {
		getCompanionAudioFallbackInfoMock.mockResolvedValue(companionInfo);
		const videoPath = "C:\\Recordly\\recording.mp4";

		const { resolveVideoAudioFallbackPathsForIpc } = await import("./recording");

		await expect(resolveVideoAudioFallbackPathsForIpc(videoPath)).resolves.toEqual({
			success: true,
			...companionInfo,
		});
		expect(rememberApprovedLocalReadPathMock).toHaveBeenCalledWith(videoPath);
		expect(rememberApprovedLocalReadPathMock).toHaveBeenCalledWith(companionInfo.paths[0]);
	});

	it("returns a stable empty shape when no video path is available", async () => {
		const { resolveVideoAudioFallbackPathsForIpc } = await import("./recording");

		await expect(resolveVideoAudioFallbackPathsForIpc("")).resolves.toEqual({
			success: true,
			paths: [],
			startDelayMsByPath: {},
			mediaInfoByPath: {},
		});
		expect(getCompanionAudioFallbackInfoMock).not.toHaveBeenCalled();
	});
});
