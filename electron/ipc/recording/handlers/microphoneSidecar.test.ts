import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ipcMain } from "electron";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { registerMicrophoneSidecar } from "./microphoneSidecar";

const { encode } = vi.hoisted(() => ({
	encode: vi.fn<(binary: string, args: string[]) => Promise<void>>(),
}));
vi.mock("electron", () => ({ ipcMain: { handle: vi.fn() } }));
vi.mock("node:child_process", async (importOriginal) => ({
	...(await importOriginal<typeof import("node:child_process")>()),
	execFile: (
		binary: string,
		args: string[],
		_options: unknown,
		callback: (error: unknown) => void,
	) => void encode(binary, args).then(() => callback(null), callback),
}));
vi.mock("../../ffmpeg/binary", () => ({ getFfmpegBinaryPath: () => "ffmpeg" }));
vi.mock("../diagnostics", () => ({
	writeRecordingDiagnosticsSnapshot: vi.fn().mockResolvedValue(null),
}));

let directory: string;
let videoPath: string;
let sidecarPath: string;
let invoke: Parameters<typeof ipcMain.handle>[1];
const event = {} as Electron.IpcMainInvokeEvent;

beforeEach(async () => {
	vi.clearAllMocks();
	encode.mockReset();
	directory = await fs.mkdtemp(path.join(os.tmpdir(), "recordly-microphone-sidecar-"));
	videoPath = path.join(directory, "recording.mp4");
	sidecarPath = path.join(directory, "recording.mic.wav");
	registerMicrophoneSidecar();
	invoke = new Map(vi.mocked(ipcMain.handle).mock.calls).get("store-microphone-sidecar")!;
});

afterEach(async () => {
	vi.restoreAllMocks();
	await fs.rm(directory, { recursive: true, force: true });
});

it("publishes the microphone WAV only after the encoder finishes", async () => {
	const encoderStarted = Promise.withResolvers<void>();
	const finishEncoding = Promise.withResolvers<void>();
	encode.mockImplementation(async (_binary, args) => {
		const output = args.at(-1)!;
		await fs.writeFile(output, "partial wav");
		encoderStarted.resolve();
		await finishEncoding.promise;
		await fs.appendFile(output, " completed");
	});

	const saving = invoke(event, new ArrayBuffer(4), videoPath);
	try {
		await encoderStarted.promise;
		await expect(fs.stat(sidecarPath)).rejects.toMatchObject({ code: "ENOENT" });
	} finally {
		finishEncoding.resolve();
		await saving;
	}
	await expect(saving).resolves.toMatchObject({ success: true, path: sidecarPath });
	await expect(fs.readFile(sidecarPath, "utf8")).resolves.toBe("partial wav completed");
});

it("preserves a completed microphone WAV after an unsuccessful save", async () => {
	vi.spyOn(console, "error").mockImplementation(() => {});
	await fs.writeFile(sidecarPath, "previous recording");
	encode.mockImplementation(async (_binary, args) => {
		await fs.writeFile(args.at(-1)!, "incomplete");
		throw new Error("Encoder failed");
	});

	await expect(invoke(event, new ArrayBuffer(4), videoPath)).resolves.toMatchObject({
		success: false,
	});
	await expect(fs.readFile(sidecarPath, "utf8")).resolves.toBe("previous recording");
	await expect(fs.readdir(directory)).resolves.toEqual([path.basename(sidecarPath)]);
});

it("publishes a complete waveform file after a cross-device rename failure", async () => {
	await fs.writeFile(sidecarPath, "old microphone track");
	encode.mockImplementation(async (_binary, args) => {
		await fs.writeFile(args.at(-1)!, "new microphone track");
	});
	vi.spyOn(fs, "rename").mockRejectedValueOnce(
		Object.assign(new Error("redirected"), { code: "EXDEV" }),
	);
	const copyFile = fs.copyFile.bind(fs);
	const copy = vi.spyOn(fs, "copyFile").mockImplementationOnce(async (source, destination) => {
		expect(destination).not.toBe(sidecarPath);
		await copyFile(source, destination);
		await expect(fs.readFile(sidecarPath, "utf8")).resolves.toBe("old microphone track");
	});

	await expect(invoke(event, new ArrayBuffer(4), videoPath)).resolves.toMatchObject({
		success: true,
		path: sidecarPath,
	});
	expect(copy).toHaveBeenCalledOnce();
	await expect(fs.readFile(sidecarPath, "utf8")).resolves.toBe("new microphone track");
	await expect(fs.readdir(directory)).resolves.toEqual([path.basename(sidecarPath)]);
});

it("retains the previous complete WAV and cleans up after an interrupted cross-device copy", async () => {
	vi.spyOn(console, "error").mockImplementation(() => {});
	await fs.writeFile(sidecarPath, "old microphone track");
	encode.mockImplementation(async (_binary, args) => {
		await fs.writeFile(args.at(-1)!, "new microphone track");
	});
	vi.spyOn(fs, "rename").mockRejectedValueOnce(
		Object.assign(new Error("redirected"), { code: "EXDEV" }),
	);
	const copy = vi.spyOn(fs, "copyFile").mockImplementationOnce(async (_source, destination) => {
		await fs.writeFile(destination, "partial");
		throw new Error("copy interrupted");
	});
	await expect(invoke(event, new ArrayBuffer(4), videoPath)).resolves.toMatchObject({
		success: false,
	});
	expect(copy).toHaveBeenCalledOnce();
	await expect(fs.readFile(sidecarPath, "utf8")).resolves.toBe("old microphone track");
	await expect(fs.readdir(directory)).resolves.toEqual([path.basename(sidecarPath)]);
});
