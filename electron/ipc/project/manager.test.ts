import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("local media path policy", () => {
	let tempRoot: string;
	let appDataPath: string;
	let userDataPath: string;
	let tempPath: string;
	let appPath: string;

	beforeEach(async () => {
		tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "recordly-media-policy-"));
		appDataPath = path.join(tempRoot, "AppData");
		userDataPath = path.join(tempRoot, "UserData");
		tempPath = path.join(tempRoot, "Temp");
		appPath = path.join(tempRoot, "App");

		await Promise.all(
			[appDataPath, userDataPath, tempPath, appPath].map((dirPath) =>
				fs.mkdir(dirPath, { recursive: true }),
			),
		);

		vi.resetModules();
		vi.doMock("electron", () => ({
			app: {
				isPackaged: false,
				getAppPath: () => appPath,
				getPath: (name: string) => {
					if (name === "appData") return appDataPath;
					if (name === "userData") return userDataPath;
					if (name === "temp") return tempPath;
					return tempRoot;
				},
				setPath: () => undefined,
			},
		}));
	});

	afterEach(async () => {
		vi.resetModules();
		vi.doUnmock("electron");
		vi.doUnmock("../../mediaServer");
		vi.doUnmock("./firstFrameThumbnail");
		if (tempRoot) {
			await fs.rm(tempRoot, { recursive: true, force: true });
		}
	});

	it("reads library previews without switching the active project and rejects unknown projects", async () => {
		vi.doMock("../../mediaServer", () => ({
			getMediaServerBaseUrl: () => "http://127.0.0.1:1234",
			buildMediaUrl: (base: string, file: string) =>
				`${base}/media?path=${encodeURIComponent(file)}`,
		}));
		const manager = await import("./manager");
		const state = await import("../state");
		const source = path.join(tempRoot, "video.mp4");
		await fs.writeFile(source, "video");
		const projectsDir = await manager.getProjectsDir();
		const projectPath = path.join(projectsDir, "preview.recordly");
		await fs.writeFile(
			projectPath,
			JSON.stringify({ version: 1, videoPath: source, editor: {} }),
		);
		state.setCurrentProjectPath("active.recordly");
		state.setCurrentVideoPath("active.mp4");
		const result = await manager.readProjectPreview(projectPath);
		expect(result.videoUrl).toContain(encodeURIComponent(source));
		expect(result.webcamUrl).toBeNull();
		expect(state.currentProjectPath).toBe("active.recordly");
		expect(state.currentVideoPath).toBe("active.mp4");
		await expect(
			manager.readProjectPreview(path.join(tempRoot, "unknown.recordly")),
		).rejects.toThrow("not in the library");
	});

	it("rejects existing media files outside allowed directories until they are approved", async () => {
		const downloadsPath = path.join(tempRoot, "Downloads");
		const exportPath = path.join(downloadsPath, "export-test.mp4");
		await fs.mkdir(downloadsPath, { recursive: true });
		await fs.writeFile(exportPath, "test-video");

		const { isAllowedLocalMediaPath, rememberApprovedLocalReadPath } = await import(
			"./manager"
		);

		await expect(isAllowedLocalMediaPath(exportPath)).resolves.toBe(false);

		await rememberApprovedLocalReadPath(exportPath);

		await expect(isAllowedLocalMediaPath(exportPath)).resolves.toBe(true);
	});

	it("rejects missing media files outside the allowed directories", async () => {
		const missingPath = path.join(tempRoot, "Downloads", "missing.mp4");
		const { isAllowedLocalMediaPath } = await import("./manager");

		await expect(isAllowedLocalMediaPath(missingPath)).resolves.toBe(false);
	});

	it("allows approved media paths before the file exists", async () => {
		const pendingExportPath = path.join(tempRoot, "Downloads", "pending-export.mp4");
		const { isAllowedLocalMediaPath, rememberApprovedLocalReadPath } = await import(
			"./manager"
		);

		await rememberApprovedLocalReadPath(pendingExportPath);

		await expect(isAllowedLocalMediaPath(pendingExportPath)).resolves.toBe(true);
	});

	it("approves media-server access for approved external files resolved through the URL policy", async () => {
		const downloadsPath = path.join(tempRoot, "Downloads");
		const videoPath = path.join(downloadsPath, "external-video.mp4");
		await fs.mkdir(downloadsPath, { recursive: true });
		await fs.writeFile(videoPath, "test-video");
		const resolvedVideoPath = await fs.realpath(videoPath);

		const { resolveApprovedLocalMediaPath, rememberApprovedLocalReadPath } = await import(
			"./manager"
		);
		const { isAllowedMediaPath } = await import("../../mediaServer");

		// Unapproved external paths are rejected before they ever reach the media server.
		expect(isAllowedMediaPath(videoPath)).toBe(false);
		await expect(resolveApprovedLocalMediaPath(videoPath)).resolves.toBeNull();

		// Once the user opts in (via dialog/export/etc.) the path is approved.
		await rememberApprovedLocalReadPath(videoPath);

		await expect(resolveApprovedLocalMediaPath(videoPath)).resolves.toBe(resolvedVideoPath);
		expect(isAllowedMediaPath(videoPath)).toBe(true);
	});

	it("rejects existing non-media files when resolving local media URLs", async () => {
		const downloadsPath = path.join(tempRoot, "Downloads");
		const textPath = path.join(downloadsPath, "notes.txt");
		await fs.mkdir(downloadsPath, { recursive: true });
		await fs.writeFile(textPath, "not media");

		const { resolveApprovedLocalMediaPath } = await import("./manager");
		const { isAllowedMediaPath } = await import("../../mediaServer");

		await expect(resolveApprovedLocalMediaPath(textPath)).resolves.toBeNull();
		expect(isAllowedMediaPath(textPath)).toBe(false);
	});

	it("rejects symlinks under allowed prefixes that point outside the allowlist", async () => {
		const outsideTarget = path.join(tempRoot, "outside-secret.mp4");
		const symlinkInsideUserData = path.join(userDataPath, "shortcut-to-secret.mp4");
		await fs.writeFile(outsideTarget, "secret-bytes");

		try {
			await fs.symlink(outsideTarget, symlinkInsideUserData);
		} catch (error) {
			// Windows requires Developer Mode or admin to create file symlinks. If
			// we can't create one, the bypass we're guarding against also can't be
			// crafted on this machine, so skipping is safe.
			if ((error as NodeJS.ErrnoException).code === "EPERM") {
				return;
			}
			throw error;
		}

		const { isAllowedLocalMediaPath, resolveApprovedLocalMediaPath } = await import(
			"./manager"
		);

		await expect(isAllowedLocalMediaPath(symlinkInsideUserData)).resolves.toBe(false);
		await expect(resolveApprovedLocalMediaPath(symlinkInsideUserData)).resolves.toBeNull();
	});

	it("generates a missing project poster once and keeps it cached", async () => {
		const png = Buffer.alloc(24);
		Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png);
		png.writeUInt32BE(640, 16);
		png.writeUInt32BE(480, 20);
		const generate = vi.fn().mockResolvedValue(png);
		vi.doMock("./firstFrameThumbnail", () => ({ createProjectFirstFrameThumbnail: generate }));
		const manager = await import("./manager");
		const source = path.join(tempRoot, "source.mp4");
		const projectPath = path.join(tempRoot, "test.recordly");
		await fs.writeFile(source, "video");
		await fs.writeFile(
			projectPath,
			JSON.stringify({ version: 2, videoPath: source, editor: {} }),
		);
		const before = await fs.readFile(projectPath, "utf8");
		const entry = await manager.buildProjectLibraryEntry(projectPath, tempRoot);
		expect(entry?.thumbnailPath).toBeNull();
		await manager.refreshProjectThumbnail(projectPath, await fs.stat(projectPath));
		expect((await manager.buildProjectLibraryEntry(projectPath, tempRoot))?.thumbnailPath).toBe(
			manager.getProjectThumbnailPath(projectPath),
		);
		expect(generate).toHaveBeenCalledWith(source);
		await manager.buildProjectLibraryEntry(projectPath, tempRoot);
		expect(generate).toHaveBeenCalledTimes(1);
		expect(await fs.readFile(projectPath, "utf8")).toBe(before);
	});

	it("preserves an existing project thumbnail when no replacement is provided", async () => {
		const projectPath = path.join(tempRoot, "Projects", "demo.recordly");
		const thumbnailDataUrl = `data:image/png;base64,${Buffer.from("png-thumbnail").toString("base64")}`;
		await fs.mkdir(path.dirname(projectPath), { recursive: true });

		const { getProjectThumbnailPath, saveProjectThumbnail } = await import("./manager");
		const thumbnailPath = getProjectThumbnailPath(projectPath);

		await saveProjectThumbnail(projectPath, thumbnailDataUrl);
		await saveProjectThumbnail(projectPath, undefined);

		await expect(fs.readFile(thumbnailPath, "utf8")).resolves.toBe("png-thumbnail");
	});

	it("loads project files that start with a UTF-8 byte order mark", async () => {
		const videoPath = path.join(tempPath, "recording.mp4");
		const projectPath = path.join(tempPath, "recording.recordly");
		await fs.writeFile(videoPath, "test-video");
		await fs.writeFile(
			projectPath,
			`\uFEFF${JSON.stringify({
				version: 1,
				videoPath,
				editor: {},
			})}`,
			"utf-8",
		);

		const { loadProjectFromPath } = await import("./manager");

		const result = await loadProjectFromPath(projectPath);
		expect(result.success).toBe(true);
		expect(result.path).toBe(projectPath);
		expect(result.project).toMatchObject({ videoPath });
	});

	it("rejects invalid project payloads before approving media paths", async () => {
		const downloadsPath = path.join(tempRoot, "Downloads");
		const videoPath = path.join(downloadsPath, "recording.mp4");
		const projectPath = path.join(tempPath, "invalid.recordly");
		await fs.mkdir(downloadsPath, { recursive: true });
		await fs.writeFile(videoPath, "test-video");
		await fs.writeFile(
			projectPath,
			JSON.stringify({
				videoPath,
				editor: {},
			}),
			"utf-8",
		);

		const { loadProjectFromPath, resolveApprovedLocalMediaPath } = await import("./manager");

		const result = await loadProjectFromPath(projectPath);
		expect(result.success).toBe(false);
		expect(result.message).toBe("Invalid project file format");
		await expect(resolveApprovedLocalMediaPath(videoPath)).resolves.toBeNull();
	});

	it("names a deleted, empty or non-file project video instead of loading it", async () => {
		const { loadProjectFromPath } = await import("./manager");
		const write = async (name: string, videoPath: string) => {
			const projectPath = path.join(tempPath, `${name}.recordly`);
			await fs.writeFile(
				projectPath,
				JSON.stringify({ version: 1, videoPath, editor: {} }),
				"utf-8",
			);
			return loadProjectFromPath(projectPath);
		};
		const gone = path.join(tempPath, "gone.mp4");
		const empty = path.join(tempPath, "empty.mp4");
		await fs.writeFile(empty, "");
		const missing = await write("missing", gone);
		expect(missing).toMatchObject({
			success: false,
			reason: "missing",
			videoPath: gone,
			message: `Project video file not found: ${gone}`,
		});
		expect(await write("empty", empty)).toMatchObject({
			success: false,
			reason: "empty",
			message: expect.stringContaining("is empty (0 bytes)"),
		});
		expect(await write("folder", tempPath)).toMatchObject({
			success: false,
			reason: "not-a-file",
		});
	});

	it("approves editor audioRegions audioPath entries when loading a project", async () => {
		const downloadsPath = path.join(tempRoot, "Downloads");
		const videoPath = path.join(tempPath, "recording.mp4");
		const audioPath = path.join(downloadsPath, "music.ogg");
		const projectPath = path.join(tempPath, "recording.recordly");
		await fs.mkdir(downloadsPath, { recursive: true });
		await fs.writeFile(videoPath, "test-video");
		await fs.writeFile(audioPath, "test-audio");
		await fs.writeFile(
			projectPath,
			JSON.stringify({
				version: 1,
				videoPath,
				editor: {
					audioRegions: [{ id: "a1", startMs: 0, endMs: 1000, audioPath, volume: 1 }],
				},
			}),
			"utf-8",
		);

		const { loadProjectFromPath, resolveApprovedLocalMediaPath } = await import("./manager");
		const resolvedAudioPath = await fs.realpath(audioPath);

		const result = await loadProjectFromPath(projectPath);
		expect(result.success).toBe(true);
		await expect(resolveApprovedLocalMediaPath(audioPath)).resolves.toBe(resolvedAudioPath);
	});
	it("returns a library entry while a thumbnail decode is still pending", async () => {
		let release!: (data: Buffer) => void;
		const pending = new Promise<Buffer>((resolve) => {
			release = resolve;
		});
		const generate = vi.fn(() => pending);
		vi.doMock("./firstFrameThumbnail", () => ({ createProjectFirstFrameThumbnail: generate }));
		const manager = await import("./manager");
		const source = path.join(tempRoot, "slow.mp4");
		const projectPath = path.join(tempRoot, "slow.recordly");
		await fs.writeFile(source, "video");
		await fs.writeFile(
			projectPath,
			JSON.stringify({ version: 2, videoPath: source, editor: {} }),
		);
		const ready = vi.fn();
		const entry = await manager.buildProjectLibraryEntry(projectPath, tempRoot, ready);
		expect(entry?.path).toBe(projectPath);
		expect(entry?.thumbnailPath).toBeNull();
		const task = manager.refreshProjectThumbnail(projectPath, await fs.stat(projectPath));
		expect(ready).not.toHaveBeenCalled();
		release(Buffer.from("fixture thumbnail"));
		await task;
		expect(generate).toHaveBeenCalledTimes(1);
		expect(ready).toHaveBeenCalledWith(expect.objectContaining({ path: projectPath }));
	});

	it("replaces a thumbnail symlink without overwriting its target", async () => {
		vi.doMock("./firstFrameThumbnail", () => ({
			createProjectFirstFrameThumbnail: vi.fn().mockResolvedValue(Buffer.from("new poster")),
		}));
		const manager = await import("./manager");
		const source = path.join(tempRoot, "source.mp4");
		const projectPath = path.join(tempRoot, "linked.recordly");
		const target = path.join(tempRoot, "private.txt");
		await fs.writeFile(source, "video");
		await fs.writeFile(
			projectPath,
			JSON.stringify({ version: 2, videoPath: source, editor: {} }),
		);
		await fs.writeFile(target, "must remain intact");
		const thumbnail = manager.getProjectThumbnailPath(projectPath);
		try {
			await fs.symlink(target, thumbnail);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "EPERM") return;
			throw error;
		}
		await manager.refreshProjectThumbnail(projectPath, await fs.stat(projectPath));
		expect(await fs.readFile(target, "utf8")).toBe("must remain intact");
		expect((await fs.lstat(thumbnail)).isSymbolicLink()).toBe(false);
		expect(await fs.readFile(thumbnail, "utf8")).toBe("new poster");
	});

	it("discards a thumbnail when the project changes during decoding", async () => {
		let release!: (data: Buffer) => void;
		const pending = new Promise<Buffer>((resolve) => {
			release = resolve;
		});
		const generate = vi.fn(() => pending);
		vi.doMock("./firstFrameThumbnail", () => ({ createProjectFirstFrameThumbnail: generate }));
		const manager = await import("./manager");
		const source = path.join(tempRoot, "source.mp4");
		const projectPath = path.join(tempRoot, "edited.recordly");
		await fs.writeFile(source, "video");
		await fs.writeFile(
			projectPath,
			JSON.stringify({ version: 2, videoPath: source, editor: {} }),
		);
		const task = manager.refreshProjectThumbnail(projectPath, await fs.stat(projectPath));
		await vi.waitFor(() => expect(generate).toHaveBeenCalled());
		await fs.appendFile(projectPath, " ");
		release(Buffer.from("obsolete poster"));
		expect(await task).toBeNull();
		await expect(fs.stat(manager.getProjectThumbnailPath(projectPath))).rejects.toMatchObject({
			code: "ENOENT",
		});
	});
});
