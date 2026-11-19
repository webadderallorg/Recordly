import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ipcMain } from "electron";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	directory: "",
	finish: vi.fn(),
	finalize: vi.fn(),
	approve: vi.fn(),
	trusted: vi.fn(),
}));
vi.mock("electron", () => ({ ipcMain: { handle: vi.fn() } }));
vi.mock("../../../trustedRenderer", () => ({ isTrustedRenderer: mocks.trusted }));
vi.mock("../../ffmpeg/binary", () => ({ getFfmpegBinaryPath: () => "/ffmpeg" }));
vi.mock("../../project/manager", () => ({ rememberApprovedLocalReadPath: mocks.approve }));
vi.mock("../../utils", () => ({ getRecordingsDir: async () => mocks.directory }));
vi.mock("../diagnostics", () => ({ validateRecordedVideo: vi.fn() }));
vi.mock("../mac", () => ({ finalizeStoredVideo: mocks.finalize }));
vi.mock("../webmDuration", () => ({ finishWebmRecording: mocks.finish }));
import { registerRecordingFiles } from "./recordingFiles";

let invoke: Parameters<typeof ipcMain.handle>[1];
beforeEach(async () => {
	vi.clearAllMocks();
	mocks.trusted.mockReturnValue(true);
	mocks.directory = await fs.mkdtemp(path.join(os.tmpdir(), "recordly-store-finalize-"));
	mocks.finish.mockReset().mockImplementation(async (_ffmpeg, source) => source);
	mocks.finalize
		.mockReset()
		.mockImplementation(async (source) => ({ success: true, path: source }));
	vi.spyOn(console, "warn").mockImplementation(() => {});
	vi.spyOn(console, "error").mockImplementation(() => {});
	registerRecordingFiles();
	invoke = new Map(vi.mocked(ipcMain.handle).mock.calls).get("store-recorded-video")!;
});
afterEach(async () => {
	vi.restoreAllMocks();
	await fs.rm(mocks.directory, { recursive: true, force: true });
});
const data = () => new TextEncoder().encode("captured webcam bytes").buffer;
const event = {} as Electron.IpcMainInvokeEvent;
it("rejects an untrusted whole-file store before creating or approving a recording", async () => {
	mocks.trusted.mockReturnValue(false);
	await expect(invoke(event, data(), "recording-1-webcam.webm")).resolves.toMatchObject({
		success: false,
		error: expect.stringContaining("Untrusted recording caller"),
	});
	expect(await fs.readdir(mocks.directory)).toEqual([]);
	expect(mocks.finish).not.toHaveBeenCalled();
	expect(mocks.approve).not.toHaveBeenCalled();
});
it.each([
	"data",
	[1, 2],
	null,
	new Uint8Array([1]),
])("rejects non-ArrayBuffer recording data %j without writing it", async (input) => {
	await expect(invoke(event, input, "recording-1-webcam.webm")).resolves.toMatchObject({
		success: false,
		error: expect.stringContaining("Invalid recording data"),
	});
	expect(await fs.readdir(mocks.directory)).toEqual([]);
	expect(mocks.finish).not.toHaveBeenCalled();
	expect(mocks.approve).not.toHaveBeenCalled();
});
it("rejects a whole-file payload beyond the transport limit before writing", async () => {
	const oversized = new ArrayBuffer(512 * 1024 * 1024 + 1);
	await expect(invoke(event, oversized, "recording-1-webcam.webm")).resolves.toMatchObject({
		success: false,
		error: expect.stringContaining("Invalid recording data"),
	});
	expect(await fs.readdir(mocks.directory)).toEqual([]);
	expect(mocks.finish).not.toHaveBeenCalled();
	expect(mocks.approve).not.toHaveBeenCalled();
});
it("publishes the remuxed webcam path and approves it for the editor", async () => {
	const source = path.join(mocks.directory, "recording-1-webcam.webm");
	const mp4 = source.replace(/\.webm$/, ".mp4");
	mocks.finish.mockImplementationOnce(async (_ffmpeg, sourcePath) => {
		expect(await fs.readFile(sourcePath, "utf8")).toBe("captured webcam bytes");
		return mp4;
	});
	await expect(invoke(event, data(), "recording-1-webcam.webm")).resolves.toEqual({
		success: true,
		path: mp4,
	});
	expect(mocks.finish).toHaveBeenCalledWith("/ffmpeg", source);
	expect(mocks.finalize).toHaveBeenCalledWith(mp4);
	expect(mocks.approve).toHaveBeenCalledWith(mp4);
});
it("preserves and publishes the original when remuxing throws", async () => {
	mocks.finish.mockRejectedValueOnce(new Error("ffmpeg unavailable"));
	const source = path.join(mocks.directory, "recording-1-webcam.webm");
	await expect(invoke(event, data(), "recording-1-webcam.webm")).resolves.toEqual({
		success: true,
		path: source,
	});
	expect(await fs.readFile(source, "utf8")).toBe("captured webcam bytes");
	expect(mocks.finalize).toHaveBeenCalledWith(source);
});
it("leaves an existing MP4 container unchanged", async () => {
	const source = path.join(mocks.directory, "recording-1-webcam.mp4");
	await expect(invoke(event, data(), "recording-1-webcam.mp4")).resolves.toEqual({
		success: true,
		path: source,
	});
	expect(mocks.finish).not.toHaveBeenCalled();
	expect(mocks.finalize).toHaveBeenCalledWith(source);
	expect(await fs.readFile(source, "utf8")).toBe("captured webcam bytes");
});
it("reports the saved path when post-remux finalization fails", async () => {
	const mp4 = path.join(mocks.directory, "recording-1-webcam.mp4");
	mocks.finish.mockResolvedValueOnce(mp4);
	mocks.finalize.mockRejectedValueOnce(new Error("editor metadata unavailable"));
	await expect(invoke(event, data(), "recording-1-webcam.webm")).resolves.toMatchObject({
		success: false,
		path: mp4,
	});
});
it.each([
	false,
	true,
])("does not overwrite an existing recording or symlink target (symlink: %s)", async (symlink) => {
	const source = path.join(mocks.directory, "recording-1-webcam.webm");
	const existing = symlink ? path.join(mocks.directory, "older-recording.webm") : source;
	await fs.writeFile(existing, "earlier recording");
	if (symlink) await fs.symlink(existing, source);
	await expect(invoke(event, data(), "recording-1-webcam.webm")).resolves.toMatchObject({
		success: false,
	});
	expect(await fs.readFile(existing, "utf8")).toBe("earlier recording");
	expect(mocks.finish).not.toHaveBeenCalled();
	expect(mocks.finalize).not.toHaveBeenCalled();
});
