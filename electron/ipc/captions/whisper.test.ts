import type Electron from "electron";
import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
	app: {
		getPath: () => "/mock-user-data",
	},
}));

import {
	downloadFileWithProgress,
	downloadWhisperSmallModel,
	sendWhisperModelDownloadProgress,
} from "./whisper";

describe("sendWhisperModelDownloadProgress", () => {
	it("no-ops safely when webContents is null or undefined", () => {
		expect(() =>
			sendWhisperModelDownloadProgress(null, {
				status: "downloading",
				progress: 50,
			}),
		).not.toThrow();

		expect(() =>
			sendWhisperModelDownloadProgress(undefined, {
				status: "downloading",
				progress: 50,
			}),
		).not.toThrow();
	});

	it("no-ops safely when webContents is destroyed", () => {
		const sendMock = vi.fn();
		const mockWebContents = {
			isDestroyed: () => true,
			send: sendMock,
		} as unknown as Electron.WebContents;

		expect(() =>
			sendWhisperModelDownloadProgress(mockWebContents, {
				status: "downloading",
				progress: 50,
			}),
		).not.toThrow();

		expect(sendMock).not.toHaveBeenCalled();
	});

	it("safely catches error if webContents is destroyed during send", () => {
		const mockWebContents = {
			isDestroyed: () => false,
			send: vi.fn(() => {
				throw new Error("Object has been destroyed");
			}),
		} as unknown as Electron.WebContents;

		expect(() =>
			sendWhisperModelDownloadProgress(mockWebContents, {
				status: "downloading",
				progress: 50,
			}),
		).not.toThrow();
	});

	it("sends IPC progress when webContents is alive", () => {
		const sendMock = vi.fn();
		const mockWebContents = {
			isDestroyed: () => false,
			send: sendMock,
		} as unknown as Electron.WebContents;

		sendWhisperModelDownloadProgress(mockWebContents, {
			status: "downloading",
			progress: 75,
			path: null,
		});

		expect(sendMock).toHaveBeenCalledWith("whisper-small-model-download-progress", {
			status: "downloading",
			progress: 75,
			path: null,
		});
	});
});

describe("downloadWhisperSmallModel", () => {
	it("rejects immediately if webContents is already destroyed", async () => {
		const mockWebContents = {
			isDestroyed: () => true,
			once: vi.fn(),
			removeListener: vi.fn(),
			send: vi.fn(),
		} as unknown as Electron.WebContents;

		await expect(downloadWhisperSmallModel(mockWebContents)).rejects.toThrow(
			"Window was closed before Whisper model download could start.",
		);
	});
});

describe("downloadFileWithProgress", () => {
	it("rejects immediately when passed an already-aborted signal", async () => {
		const abortController = new AbortController();
		abortController.abort();

		await expect(
			downloadFileWithProgress(
				"https://example.com/test.bin",
				"/tmp/test.bin",
				vi.fn(),
				abortController.signal,
			),
		).rejects.toThrow("Download aborted");
	});
});
