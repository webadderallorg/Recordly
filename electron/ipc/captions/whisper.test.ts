import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import { get as httpsGet } from "node:https";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import type Electron from "electron";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
	app: {
		getPath: () => "/mock-user-data",
	},
}));

vi.mock("node:https", () => ({
	get: vi.fn(),
}));

import {
	downloadFileWithProgress,
	downloadWhisperSmallModel,
	sendWhisperModelDownloadProgress,
} from "./whisper";

const tempFiles: string[] = [];

afterEach(async () => {
	vi.clearAllMocks();
	await Promise.all(tempFiles.splice(0).map((file) => fs.rm(file, { force: true })));
});

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

	it("aborts and cleans up when webContents is destroyed during an in-flight download", async () => {
		const webContentsEmitter = new EventEmitter();
		let isDestroyed = false;

		const mockWebContents = Object.assign(webContentsEmitter, {
			isDestroyed: () => isDestroyed,
			send: vi.fn(),
		}) as unknown as Electron.WebContents;

		const req = Object.assign(new EventEmitter(), {
			destroy: vi.fn(),
		});

		const mockedGet = vi.mocked(httpsGet);
		mockedGet.mockImplementationOnce(() => {
			setImmediate(() => {
				isDestroyed = true;
				webContentsEmitter.emit("destroyed");
			});
			return req as unknown as ReturnType<typeof httpsGet>;
		});

		await expect(downloadWhisperSmallModel(mockWebContents)).rejects.toThrow(
			"Download aborted",
		);
		expect(req.destroy).toHaveBeenCalled();
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

	it("completes redirected download and ignores late events from original request", async () => {
		const tempPath = path.join(os.tmpdir(), `whisper-test-${Date.now()}.bin`);
		tempFiles.push(tempPath);

		const req1 = Object.assign(new EventEmitter(), {
			destroy: vi.fn(),
		});
		const res1 = Object.assign(new EventEmitter(), {
			statusCode: 302,
			headers: { location: "https://example.com/redirected.bin" },
			resume: vi.fn(),
			destroy: vi.fn(),
		});

		const req2 = Object.assign(new EventEmitter(), {
			destroy: vi.fn(),
		});
		const res2 = Object.assign(new PassThrough(), {
			statusCode: 200,
			headers: { "content-length": "4" },
		});

		const mockedGet = vi.mocked(httpsGet);
		mockedGet.mockImplementationOnce((_url, _options, callback) => {
			setImmediate(() => {
				if (typeof callback === "function") {
					callback(res1 as unknown as Parameters<typeof callback>[0]);
				}
			});
			return req1 as unknown as ReturnType<typeof httpsGet>;
		});

		mockedGet.mockImplementationOnce((_url, _options, callback) => {
			setImmediate(() => {
				if (typeof callback === "function") {
					callback(res2 as unknown as Parameters<typeof callback>[0]);
					res2.end(Buffer.from("test"));
				}
			});
			return req2 as unknown as ReturnType<typeof httpsGet>;
		});

		const progressSpy = vi.fn();
		const downloadPromise = downloadFileWithProgress(
			"https://example.com/initial.bin",
			tempPath,
			progressSpy,
		);

		// Wait for redirect response to be processed
		await new Promise((resolve) => setTimeout(resolve, 50));

		// Emit late timeout and error events on original request after redirect handoff
		req1.emit("timeout");
		req1.emit("error", new Error("Late socket error"));

		await expect(downloadPromise).resolves.toBeUndefined();
		expect(res1.resume).toHaveBeenCalled();
		expect(res1.destroy).toHaveBeenCalled();
		expect(progressSpy).toHaveBeenCalledWith(100);
	});

	it("destroys output fileStream and rejects on request error", async () => {
		const tempPath = path.join(os.tmpdir(), `whisper-test-err-${Date.now()}.bin`);
		tempFiles.push(tempPath);

		const req = Object.assign(new EventEmitter(), {
			destroy: vi.fn(),
		});

		const mockedGet = vi.mocked(httpsGet);
		mockedGet.mockImplementationOnce(() => {
			setImmediate(() => {
				req.emit("error", new Error("Network unreachable"));
			});
			return req as unknown as ReturnType<typeof httpsGet>;
		});

		await expect(
			downloadFileWithProgress("https://example.com/file.bin", tempPath, vi.fn()),
		).rejects.toThrow("Network unreachable");
	});

	it("destroys output fileStream and rejects on request timeout", async () => {
		const tempPath = path.join(os.tmpdir(), `whisper-test-timeout-${Date.now()}.bin`);
		tempFiles.push(tempPath);

		const req = Object.assign(new EventEmitter(), {
			destroy: vi.fn(),
		});

		const mockedGet = vi.mocked(httpsGet);
		mockedGet.mockImplementationOnce(() => {
			setImmediate(() => {
				req.emit("timeout");
			});
			return req as unknown as ReturnType<typeof httpsGet>;
		});

		await expect(
			downloadFileWithProgress("https://example.com/file.bin", tempPath, vi.fn()),
		).rejects.toThrow("Whisper model download timed out.");
		expect(req.destroy).toHaveBeenCalled();
	});
});
