import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { app, dialog, ipcMain } from "electron";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
	app: {
		getAppPath: () => process.cwd(),
		getPath: () => process.env.TEMP ?? process.cwd(),
		isPackaged: false,
	},
	BrowserWindow: {
		fromWebContents: () => null,
	},
	dialog: {
		showSaveDialog: vi.fn(),
	},
	ipcMain: {
		handle: vi.fn(),
		on: vi.fn(),
	},
	powerSaveBlocker: {
		isStarted: () => true,
		start: () => 1,
		stop: vi.fn(),
	},
}));

vi.mock("../ffmpeg/binary", () => ({
	getFfmpegBinaryPath: () => "ffmpeg",
}));

import { registerOwnedExportPath, releaseOwnedExportPath } from "../export/exportStream";
import { moveExportedTempFile, registerExportHandlers } from "./export";

const tempDirs: string[] = [];

async function makeTempDir() {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "recordly-export-move-"));
	tempDirs.push(dir);
	return dir;
}

afterEach(async () => {
	vi.restoreAllMocks();
	await Promise.allSettled(
		tempDirs.splice(0).map((dir) => fs.rm(dir, { force: true, recursive: true })),
	);
});

describe("export save dialog names", () => {
	it("suggests the next available filename without opening a save dialog", async () => {
		const downloads = await makeTempDir();
		vi.spyOn(app, "getPath").mockReturnValue(downloads);
		await fs.writeFile(path.join(downloads, "clip.mp4"), "existing video");
		await fs.writeFile(path.join(downloads, "clip 1.mp4"), "existing video");
		await fs.writeFile(path.join(downloads, "clip 2.srt"), "existing captions");
		vi.mocked(dialog.showSaveDialog).mockClear();
		vi.mocked(ipcMain.handle).mockClear();
		registerExportHandlers();
		const handler = vi
			.mocked(ipcMain.handle)
			.mock.calls.find(([name]) => name === "suggest-export-file-name")![1];
		const event = { sender: {} } as Electron.IpcMainInvokeEvent;
		await expect(handler(event, "clip.mp4")).resolves.toBe("clip 2.mp4");
		await expect(handler(event, "clip.mp4", "both")).resolves.toBe("clip 3.mp4");
		await expect(handler(event, "../clip.mp4")).resolves.toBeNull();
		expect(dialog.showSaveDialog).not.toHaveBeenCalled();
	});

	it.each([
		"save-exported-video",
		"finalize-exported-video",
	])("%s lets the user choose a working folder when Downloads cannot be inspected", async (channel) => {
		const dir = await makeTempDir();
		const downloads = path.join(dir, "Downloads");
		const chosen = path.join(dir, "Chosen folder");
		await fs.writeFile(downloads, "not a directory");
		await fs.mkdir(chosen);
		vi.spyOn(app, "getPath").mockImplementation((name) =>
			name === "downloads" ? downloads : dir,
		);
		const destination = path.join(chosen, "clip.mp4");
		const tempPath = path.join(dir, "export-temp.mp4");
		await fs.writeFile(tempPath, "new video");
		registerOwnedExportPath(tempPath);
		vi.mocked(dialog.showSaveDialog)
			.mockClear()
			.mockResolvedValue({ canceled: false, filePath: destination });
		vi.mocked(ipcMain.handle).mockClear();
		registerExportHandlers();
		const handler = vi.mocked(ipcMain.handle).mock.calls.find(([name]) => name === channel)![1];
		try {
			const event = { sender: {} } as Electron.IpcMainInvokeEvent;
			const result =
				channel === "save-exported-video"
					? await handler(event, new TextEncoder().encode("new video").buffer, "clip.mp4")
					: await handler(event, { tempPath, fileName: "clip.mp4" });
			expect(dialog.showSaveDialog).toHaveBeenCalledExactlyOnceWith(
				expect.objectContaining({
					defaultPath: path.join(downloads, "clip.mp4"),
				}),
			);
			expect(result).toMatchObject({ success: true, path: destination });
			await expect(fs.readFile(destination, "utf8")).resolves.toBe("new video");
			await expect(fs.readFile(downloads, "utf8")).resolves.toBe("not a directory");
		} finally {
			releaseOwnedExportPath(tempPath);
		}
	});

	it.each([
		"save-exported-video",
		"finalize-exported-video",
	])("%s still rejects a chosen folder whose destination cannot be inspected", async (channel) => {
		const dir = await makeTempDir();
		const blocked = path.join(dir, "Chosen folder");
		await fs.writeFile(blocked, "not a directory");
		vi.spyOn(app, "getPath").mockReturnValue(dir);
		const destination = path.join(blocked, "clip.mp4");
		const tempPath = path.join(dir, "export-temp.mp4");
		await fs.writeFile(tempPath, "new video");
		registerOwnedExportPath(tempPath);
		vi.mocked(dialog.showSaveDialog)
			.mockClear()
			.mockResolvedValue({ canceled: false, filePath: destination });
		vi.mocked(ipcMain.handle).mockClear();
		registerExportHandlers();
		const handler = vi.mocked(ipcMain.handle).mock.calls.find(([name]) => name === channel)![1];
		try {
			const event = { sender: {} } as Electron.IpcMainInvokeEvent;
			const result =
				channel === "save-exported-video"
					? await handler(event, new TextEncoder().encode("new video").buffer, "clip.mp4")
					: await handler(event, { tempPath, fileName: "clip.mp4" });
			expect(dialog.showSaveDialog).toHaveBeenCalledTimes(1);
			expect(result).toMatchObject({
				success: false,
				error: expect.stringContaining("ENOTDIR"),
			});
			await expect(fs.readFile(blocked, "utf8")).resolves.toBe("not a directory");
			await expect(fs.readFile(tempPath, "utf8")).resolves.toBe("new video");
		} finally {
			releaseOwnedExportPath(tempPath);
		}
	});

	it.each([
		["save-exported-video", "srt"],
		["finalize-exported-video", "srt"],
		["save-exported-video", "vtt"],
		["finalize-exported-video", "vtt"],
		["save-exported-video", "both"],
		["finalize-exported-video", "both"],
	] as const)("%s preserves orphan %s captions when numbering an export", async (channel, format) => {
		const dir = await makeTempDir();
		vi.spyOn(app, "getPath").mockReturnValue(dir);
		const original = path.join(dir, "clip.mp4");
		await fs.writeFile(original, "original video");
		const orphan = path.join(dir, `clip 1.${format === "both" ? "srt" : format}`);
		await fs.writeFile(orphan, "unrelated captions");
		if (format === "both") await fs.writeFile(path.join(dir, "clip 2.vtt"), "other captions");
		const tempPath = path.join(dir, "export-temp.mp4");
		await fs.writeFile(tempPath, "new video");
		registerOwnedExportPath(tempPath);
		vi.mocked(dialog.showSaveDialog).mockImplementation(async (options) => ({
			canceled: false,
			filePath: (options as Electron.SaveDialogOptions).defaultPath!,
		}));
		vi.mocked(ipcMain.handle).mockClear();
		registerExportHandlers();
		const handler = vi.mocked(ipcMain.handle).mock.calls.find(([name]) => name === channel)![1];
		const captionSidecar = {
			format,
			cues: [{ startMs: 0, endMs: 1000, text: "New captions" }],
		};
		try {
			const event = { sender: {} } as Electron.IpcMainInvokeEvent;
			const result =
				channel === "save-exported-video"
					? await handler(
							event,
							new TextEncoder().encode("new video").buffer,
							"clip.mp4",
							captionSidecar,
						)
					: await handler(event, { tempPath, fileName: "clip.mp4", captionSidecar });
			const destination = path.join(dir, `clip ${format === "both" ? 3 : 2}.mp4`);
			expect(result).toMatchObject({ success: true, path: destination });
			await expect(fs.readFile(original, "utf8")).resolves.toBe("original video");
			await expect(fs.readFile(orphan, "utf8")).resolves.toBe("unrelated captions");
			if (format === "both") {
				await expect(fs.readFile(path.join(dir, "clip 2.vtt"), "utf8")).resolves.toBe(
					"other captions",
				);
			}
			await expect(fs.readFile(destination, "utf8")).resolves.toBe("new video");
			for (const extension of format === "both" ? ["srt", "vtt"] : [format]) {
				await expect(
					fs.readFile(destination.replace(/\.mp4$/, `.${extension}`), "utf8"),
				).resolves.toContain("New captions");
			}
		} finally {
			releaseOwnedExportPath(tempPath);
		}
	});

	it.each([
		"save-exported-video",
		"finalize-exported-video",
	])("%s keeps the video successful when a caption appears after its name is reserved", async (channel) => {
		const dir = await makeTempDir();
		vi.spyOn(app, "getPath").mockReturnValue(dir);
		const destination = path.join(dir, "clip.mp4");
		const existingCaption = path.join(dir, "clip.vtt");
		const tempPath = path.join(dir, "export-temp.mp4");
		await fs.writeFile(tempPath, "new video");
		registerOwnedExportPath(tempPath);
		vi.mocked(dialog.showSaveDialog).mockResolvedValue({
			canceled: false,
			filePath: destination,
		});
		vi.mocked(ipcMain.handle).mockClear();
		registerExportHandlers();
		const handler = vi.mocked(ipcMain.handle).mock.calls.find(([name]) => name === channel)![1];
		const write = fs.writeFile.bind(fs);
		if (channel === "save-exported-video") {
			vi.spyOn(fs, "writeFile").mockImplementation(async (...args) => {
				await write(...args);
				if (String(args[0]) === destination)
					await write(existingCaption, "concurrent captions", { flag: "wx" });
			});
		} else {
			const rename = fs.rename.bind(fs);
			vi.spyOn(fs, "rename").mockImplementation(async (from, to) => {
				await rename(from, to);
				if (String(to) === destination)
					await write(existingCaption, "concurrent captions", { flag: "wx" });
			});
		}
		const captionSidecar = {
			format: "both",
			cues: [{ startMs: 0, endMs: 1000, text: "New captions" }],
		};
		try {
			const event = { sender: {} } as Electron.IpcMainInvokeEvent;
			const result =
				channel === "save-exported-video"
					? await handler(
							event,
							new TextEncoder().encode("new video").buffer,
							"clip.mp4",
							captionSidecar,
						)
					: await handler(event, { tempPath, fileName: "clip.mp4", captionSidecar });
			expect(result).toMatchObject({
				success: true,
				path: destination,
				message: expect.stringContaining("Captions could not be saved"),
				captionSidecarFailed: true,
			});
			await expect(fs.readFile(destination, "utf8")).resolves.toBe("new video");
			await expect(fs.readFile(existingCaption, "utf8")).resolves.toBe("concurrent captions");
			await expect(fs.readFile(path.join(dir, "clip.srt"), "utf8")).resolves.toContain(
				"New captions",
			);
		} finally {
			releaseOwnedExportPath(tempPath);
		}
	});

	it.each([
		"save-exported-video",
		"finalize-exported-video",
	])("%s suggests the next numbered name and saves there", async (channel) => {
		const dir = await makeTempDir();
		vi.spyOn(app, "getPath").mockReturnValue(dir);
		const originalPath = path.join(dir, "Untitled Project.mp4");
		const numberedPath = path.join(dir, "Untitled Project 1.mp4");
		const tempPath = path.join(dir, "export-temp.mp4");
		await fs.writeFile(originalPath, "original-export");
		await fs.writeFile(tempPath, "new-export");
		registerOwnedExportPath(tempPath);
		vi.mocked(dialog.showSaveDialog).mockResolvedValue({
			canceled: false,
			filePath: numberedPath,
		});
		vi.mocked(ipcMain.handle).mockClear();
		registerExportHandlers();
		const handler = vi
			.mocked(ipcMain.handle)
			.mock.calls.find(([name]) => name === channel)?.[1];
		expect(handler).toBeDefined();
		try {
			const event = { sender: {} } as Electron.IpcMainInvokeEvent;
			const result =
				channel === "save-exported-video"
					? await handler!(
							event,
							new TextEncoder().encode("new-export").buffer,
							"Untitled Project.mp4",
						)
					: await handler!(event, { tempPath, fileName: "Untitled Project.mp4" });
			expect(dialog.showSaveDialog).toHaveBeenLastCalledWith(
				expect.objectContaining({
					defaultPath: numberedPath,
					properties: ["createDirectory", "showOverwriteConfirmation"],
				}),
			);
			expect(result).toMatchObject({ success: true, path: numberedPath });
			await expect(fs.readFile(originalPath, "utf8")).resolves.toBe("original-export");
			await expect(fs.readFile(numberedPath, "utf8")).resolves.toBe("new-export");
		} finally {
			releaseOwnedExportPath(tempPath);
		}
	});

	it.each([
		["save-exported-video", "mp4"],
		["finalize-exported-video", "mp4"],
		["save-exported-video", "gif"],
		["finalize-exported-video", "gif"],
	])("%s numbers repeated %s exports in the folder selected by the user", async (channel, ext) => {
		const dir = await makeTempDir();
		const downloads = path.join(dir, "Downloads");
		const selectedFolder = path.join(dir, "Chosen folder");
		await fs.mkdir(downloads);
		await fs.mkdir(selectedFolder);
		vi.spyOn(app, "getPath").mockImplementation((name) =>
			name === "downloads" ? downloads : dir,
		);
		const fileName = `Untitled Project.${ext}`;
		await fs.writeFile(path.join(downloads, fileName), "download");
		await fs.writeFile(path.join(downloads, `Untitled Project 1.${ext}`), "download 1");
		vi.mocked(dialog.showSaveDialog).mockResolvedValue({
			canceled: false,
			filePath: path.join(selectedFolder, `Untitled Project 2.${ext}`),
		});
		vi.mocked(ipcMain.handle).mockClear();
		registerExportHandlers();
		const handler = vi.mocked(ipcMain.handle).mock.calls.find(([name]) => name === channel)![1];
		const tempPath = path.join(dir, `export-temp.${ext}`);
		const captionSidecar = {
			format: "srt",
			cues: [{ startMs: 0, endMs: 1000, text: "Caption" }],
		};
		try {
			for (const [index, suffix] of ["", " 1", " 2"].entries()) {
				await fs.writeFile(tempPath, `export ${index}`);
				registerOwnedExportPath(tempPath);
				const event = { sender: {} } as Electron.IpcMainInvokeEvent;
				const result =
					channel === "save-exported-video"
						? await handler(
								event,
								new TextEncoder().encode(`export ${index}`).buffer,
								fileName,
								captionSidecar,
							)
						: await handler(event, { tempPath, fileName, captionSidecar });
				const destination = path.join(selectedFolder, `Untitled Project${suffix}.${ext}`);
				expect(result).toMatchObject({ success: true, path: destination });
				await expect(fs.readFile(destination, "utf8")).resolves.toBe(`export ${index}`);
				await expect(
					fs.readFile(path.join(selectedFolder, `Untitled Project${suffix}.srt`), "utf8"),
				).resolves.toContain("Caption");
			}
			await expect(fs.readFile(path.join(selectedFolder, fileName), "utf8")).resolves.toBe(
				"export 0",
			);
			await expect(
				fs.readFile(path.join(selectedFolder, `Untitled Project 1.${ext}`), "utf8"),
			).resolves.toBe("export 1");
			await expect(fs.readFile(path.join(downloads, fileName), "utf8")).resolves.toBe(
				"download",
			);
			// A filename entered by the user is retained and numbered in that folder.
			const renamedPath = path.join(selectedFolder, `My presentation.${ext}`);
			await fs.writeFile(renamedPath, "existing presentation");
			vi.mocked(dialog.showSaveDialog).mockResolvedValue({
				canceled: false,
				filePath: renamedPath,
			});
			await fs.writeFile(tempPath, "renamed export");
			registerOwnedExportPath(tempPath);
			const event = { sender: {} } as Electron.IpcMainInvokeEvent;
			const renamedResult =
				channel === "save-exported-video"
					? await handler(
							event,
							new TextEncoder().encode("renamed export").buffer,
							fileName,
						)
					: await handler(event, { tempPath, fileName });
			expect(renamedResult).toMatchObject({
				success: true,
				path: path.join(selectedFolder, `My presentation 1.${ext}`),
			});
			await expect(fs.readFile(renamedPath, "utf8")).resolves.toBe("existing presentation");

			vi.mocked(dialog.showSaveDialog).mockResolvedValue({ canceled: true, filePath: "" });
			await fs.writeFile(tempPath, "canceled export");
			registerOwnedExportPath(tempPath);
			const filesBefore = await fs.readdir(selectedFolder);
			const canceledResult =
				channel === "save-exported-video"
					? await handler(
							event,
							new TextEncoder().encode("canceled export").buffer,
							fileName,
						)
					: await handler(event, { tempPath, fileName });
			expect(canceledResult).toMatchObject({ success: false, canceled: true });
			expect(await fs.readdir(selectedFolder)).toEqual(filesBefore);
			await expect(fs.readFile(tempPath, "utf8")).resolves.toBe("canceled export");
		} finally {
			releaseOwnedExportPath(tempPath);
		}
	});
});

describe("caption status for export destinations", () => {
	it.each([
		{ channel: "save-exported-video", outputPath: false },
		{ channel: "write-exported-video-to-path", outputPath: true },
		{ channel: "finalize-exported-video", outputPath: false },
		{ channel: "finalize-exported-video", outputPath: true },
	] as const)("$channel with explicit path $outputPath returns a safe caption failure flag without failing the video", async ({
		channel,
		outputPath,
	}) => {
		const dir = await makeTempDir();
		vi.spyOn(app, "getPath").mockReturnValue(dir);
		const destination = path.join(dir, "export.mp4");
		const tempPath = path.join(dir, "export-temp.mp4");
		const captionSidecar = {
			format: "both",
			cues: [{ startMs: 0, endMs: 1000, text: "Caption" }],
		};
		vi.mocked(ipcMain.handle).mockClear();
		registerExportHandlers();
		vi.mocked(dialog.showSaveDialog).mockResolvedValue({
			canceled: false,
			filePath: destination,
		});
		const handler = vi.mocked(ipcMain.handle).mock.calls.find(([name]) => name === channel)![1];
		const write = fs.writeFile.bind(fs);
		let failCaptions = false;
		vi.spyOn(fs, "writeFile").mockImplementation(async (...args) => {
			if (failCaptions && String(args[0]).endsWith(".vtt"))
				throw new Error("EACCES: /private/captions/transcript.vtt");
			return write(...args);
		});
		try {
			for (const failed of [false, true]) {
				failCaptions = failed;
				await fs.rm(destination, { force: true });
				await fs.rm(destination.replace(/\.mp4$/, ".srt"), { force: true });
				await fs.rm(destination.replace(/\.mp4$/, ".vtt"), { force: true });
				await fs.writeFile(tempPath, "video");
				registerOwnedExportPath(tempPath);
				const event = { sender: {} } as Electron.IpcMainInvokeEvent;
				const result =
					channel === "finalize-exported-video"
						? await handler(event, {
								tempPath,
								fileName: "export.mp4",
								outputPath: outputPath ? destination : undefined,
								captionSidecar,
							})
						: await handler(
								event,
								new TextEncoder().encode("video").buffer,
								outputPath ? destination : "export.mp4",
								captionSidecar,
							);
				expect(result).toMatchObject({
					success: true,
					path: destination,
					captionSidecarFailed: failed,
				});
				expect(result.message).not.toContain("/private/captions");
				expect(result.error).toBeUndefined();
				await expect(fs.readFile(destination, "utf8")).resolves.toBe("video");
			}
		} finally {
			releaseOwnedExportPath(tempPath);
		}
	});
});

describe("moveExportedTempFile", () => {
	it("moves an app-managed export temp file to the selected destination", async () => {
		const dir = await makeTempDir();
		const tempPath = path.join(dir, "export-temp.mp4");
		const destinationPath = path.join(dir, "export-final.mp4");
		await fs.writeFile(tempPath, "recordly-export");

		await moveExportedTempFile(tempPath, destinationPath);

		await expect(fs.readFile(destinationPath, "utf8")).resolves.toBe("recordly-export");
		await expect(fs.access(tempPath)).rejects.toThrow();
	});

	it("falls back when Windows reports the destination already exists during initial rename", async () => {
		const dir = await makeTempDir();
		const tempPath = path.join(dir, "export-temp.mp4");
		const destinationPath = path.join(dir, "export-final.mp4");
		await fs.writeFile(tempPath, "new-export");
		await fs.writeFile(destinationPath, "previous-export");

		const originalRename = fs.rename.bind(fs);
		const renameSpy = vi.spyOn(fs, "rename");
		renameSpy.mockImplementation(async (from, to) => {
			if (from === tempPath && to === destinationPath) {
				const error = new Error("destination exists") as NodeJS.ErrnoException;
				error.code = "EEXIST";
				throw error;
			}

			return originalRename(from, to);
		});

		await moveExportedTempFile(tempPath, destinationPath);

		await expect(fs.readFile(destinationPath, "utf8")).resolves.toBe("new-export");
		await expect(fs.access(tempPath)).rejects.toThrow();
	});
});
