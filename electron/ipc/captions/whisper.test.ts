import { expect, it, vi } from "vitest";
import { sendWhisperModelDownloadProgress } from "./whisper";

vi.mock("../constants", () => ({}));
vi.mock("./modelDownloadTransport", () => ({ receiveCaptionDownload: vi.fn() }));

const progress = { status: "downloading", progress: 42 } as const;

it("sends Whisper progress only while the window is alive", () => {
	const send = vi.fn();
	const isDestroyed = vi.fn().mockReturnValueOnce(false).mockReturnValue(true);
	const sender = { send, isDestroyed } as unknown as Electron.WebContents;
	sendWhisperModelDownloadProgress(sender, progress);
	sendWhisperModelDownloadProgress(sender, progress);
	expect(send).toHaveBeenCalledExactlyOnceWith("whisper-small-model-download-progress", progress);
});

it("keeps downloading if the window closes between the check and the IPC send", () => {
	const send = vi.fn(() => {
		throw new Error("Object has been destroyed");
	});
	const sender = { send, isDestroyed: () => false } as unknown as Electron.WebContents;
	expect(() => sendWhisperModelDownloadProgress(sender, progress)).not.toThrow();
});

it("no-ops safely when webContents is null or undefined", () => {
	expect(() => sendWhisperModelDownloadProgress(null, progress)).not.toThrow();
	expect(() => sendWhisperModelDownloadProgress(undefined, progress)).not.toThrow();
});
