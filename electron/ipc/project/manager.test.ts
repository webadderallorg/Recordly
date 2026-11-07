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

	it("serves approved native M4A companions with the MP4 audio content type", async () => {
		const micPath = path.join(userDataPath, "recording.mic.m4a");
		await fs.writeFile(micPath, "audio");
		const { rememberApprovedLocalReadPath, resolveApprovedLocalMediaPath } = await import(
			"./manager"
		);
		const { getMediaContentType } = await import("../../mediaTypes");
		await rememberApprovedLocalReadPath(micPath);
		await expect(resolveApprovedLocalMediaPath(micPath)).resolves.toBe(
			await fs.realpath(micPath),
		);
		expect(getMediaContentType(micPath)).toBe("audio/mp4");
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

	it("rejects cached source-only posters so the renderer can include saved padding", async () => {
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
		expect((await manager.buildProjectLibraryEntry(projectPath, tempRoot))?.thumbnailPath).toBeNull();
		expect(generate).toHaveBeenCalledWith(source);
		await manager.buildProjectLibraryEntry(projectPath, tempRoot);
		expect(generate).toHaveBeenCalledTimes(1);
		expect(await fs.readFile(projectPath, "utf8")).toBe(before);
	});

	it("persists composed previews across listing and rejects a stale revision or unknown project", async () => {
		vi.doMock("../../mediaServer", () => ({
			getMediaServerBaseUrl: () => "http://127.0.0.1:1234",
			buildMediaUrl: (_base: string, file: string) => file,
		}));
		const manager = await import("./manager");
		const source = path.join(tempRoot, "cached-video.mp4");
		const projectPath = path.join(await manager.getProjectsDir(), "cached.recordly");
		await fs.writeFile(source, "video");
		const content = JSON.stringify({ version: 2, videoPath: source, editor: {} });
		await fs.writeFile(projectPath, content);
		// Include an integer revision, which legacy source-only posters used too.
		await fs.utimes(projectPath, new Date(), Math.floor(Date.now() / 1000));
		let preview = await manager.readProjectPreview(projectPath);
		const header = Buffer.alloc(45);
		Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(header);
		header.write("IHDR", 12);
		header.writeUInt32BE(640, 16);
		header.writeUInt32BE(480, 20);
		const dataUrl = `data:image/png;base64,${header.toString("base64")}`;
		const target = await manager.cacheProjectThumbnail(projectPath, preview.revision!, dataUrl);
		expect(target).toBe(manager.getProjectThumbnailPath(projectPath));
		expect((await manager.buildProjectLibraryEntry(projectPath, tempRoot))?.thumbnailPath).toBe(target);
		expect(await fs.readFile(projectPath, "utf8")).toBe(content);
		// Keep the fractional revision in the past so an immediate edit is always newer.
		await fs.utimes(projectPath, new Date(), Math.floor(Date.now() / 1000) - 2 + 0.123456);
		preview = await manager.readProjectPreview(projectPath);
		// A cache volume may retain less timestamp precision than the project volume.
		const writeTimes = fs.utimes.bind(fs);
		const stamp = vi.spyOn(fs, "utimes").mockImplementationOnce((file, accessed, modified) =>
			writeTimes(
				file,
				accessed,
				typeof modified === "number" ? Math.floor(modified * 1000) / 1000 : modified,
			),
		);
		try {
			await manager.cacheProjectThumbnail(projectPath, preview.revision!, dataUrl);
		} finally {
			stamp.mockRestore();
		}
		expect((await manager.buildProjectLibraryEntry(projectPath, tempRoot))?.thumbnailPath).toBe(target);
		const before = await fs.readFile(target!);
		await fs.appendFile(projectPath, " ");
		await expect(manager.cacheProjectThumbnail(projectPath, preview.revision!, dataUrl)).resolves.toBeNull();
		expect(await fs.readFile(target!)).toEqual(before);
		expect((await manager.buildProjectLibraryEntry(projectPath, tempRoot))?.thumbnailPath).toBeNull();
		await expect(manager.cacheProjectThumbnail(path.join(tempRoot, "unknown.recordly"), preview.revision!, dataUrl)).rejects.toThrow();
	});

	it("preserves an existing project thumbnail when no replacement is provided", async () => {
		const projectPath = path.join(tempRoot, "Projects", "demo.recordly");
		const header = Buffer.alloc(45);
		Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(header);
		header.write("IHDR", 12);
		header.writeUInt32BE(640, 16);
		header.writeUInt32BE(480, 20);
		const thumbnailDataUrl = `data:image/png;base64,${header.toString("base64")}`;
		await fs.mkdir(path.dirname(projectPath), { recursive: true });

		const { getProjectThumbnailPath, saveProjectThumbnail } = await import("./manager");
		const thumbnailPath = getProjectThumbnailPath(projectPath);

		await saveProjectThumbnail(projectPath, thumbnailDataUrl);
		const saved = await fs.readFile(thumbnailPath);
		await saveProjectThumbnail(projectPath, undefined);

		await expect(fs.readFile(thumbnailPath)).resolves.toEqual(saved);
		const { hasFreshProjectThumbnail } = await import("./thumbnailFreshness");
		await expect(hasFreshProjectThumbnail(thumbnailPath, 0)).resolves.toBe(true);
	});

	it("approves only a listed external project's current regular thumbnail for media transport", async () => {
		const manager = await import("./manager");
		const external = path.join(tempRoot, "ExternalProjects");
		await fs.mkdir(external);
		const projectPath = path.join(external, "cat.recordly");
		await fs.writeFile(projectPath, JSON.stringify({ version: 1, videoPath: "video.mp4", editor: {} }));
		const header = Buffer.alloc(45);
		Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(header);
		header.write("IHDR", 12);
		header.writeUInt32BE(640, 16);
		header.writeUInt32BE(480, 20);
		await manager.saveProjectThumbnail(projectPath, `data:image/png;base64,${header.toString("base64")}`);
		const thumbnail = manager.getProjectThumbnailPath(projectPath);
		const sibling = path.join(external, "private.png");
		await fs.writeFile(sibling, "private");
		await expect(manager.isAllowedLocalMediaPath(thumbnail)).resolves.toBe(false);
		await manager.saveRecentProjectPaths([projectPath]);
		const { entries } = await manager.listProjectLibraryEntries();
		expect(entries.find((entry) => entry.path === projectPath)?.thumbnailPath).toBe(thumbnail);
		await expect(manager.resolveApprovedLocalMediaPath(thumbnail)).resolves.toBe(await fs.realpath(thumbnail));
		await expect(manager.isAllowedLocalMediaPath(sibling)).resolves.toBe(false);
		await expect(manager.isAllowedLocalMediaPath(external)).resolves.toBe(false);
	});

	it("does not approve linked or obsolete external thumbnail sidecars", async () => {
		const manager = await import("./manager");
		const external = path.join(tempRoot, "ExternalProjects");
		await fs.mkdir(external);
		const projectPath = path.join(external, "cat.recordly");
		await fs.writeFile(projectPath, JSON.stringify({ version: 1, videoPath: "video.mp4", editor: {} }));
		const header = Buffer.alloc(45);
		Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(header);
		header.write("IHDR", 12);
		header.writeUInt32BE(640, 16);
		header.writeUInt32BE(480, 20);
		const thumbnail = manager.getProjectThumbnailPath(projectPath);
		await fs.writeFile(thumbnail, header);
		await manager.saveRecentProjectPaths([projectPath]);
		expect((await manager.listProjectLibraryEntries()).entries[0]?.thumbnailPath).toBeNull();
		await expect(manager.isAllowedLocalMediaPath(thumbnail)).resolves.toBe(false);
		const targetProject = path.join(external, "unlisted.recordly");
		await manager.saveProjectThumbnail(targetProject, `data:image/png;base64,${header.toString("base64")}`);
		const target = manager.getProjectThumbnailPath(targetProject);
		await fs.rm(thumbnail);
		try {
			await fs.symlink(target, thumbnail);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "EPERM") return;
			throw error;
		}
		expect((await manager.listProjectLibraryEntries()).entries[0]?.thumbnailPath).toBeNull();
		await expect(manager.isAllowedLocalMediaPath(target)).resolves.toBe(false);
		await expect(manager.isAllowedLocalMediaPath(thumbnail)).resolves.toBe(false);
	});

	it("distinguishes missing recordings from denied or failed access without changing the active project", async () => {
		const { resolveProjectMediaSources } = await import("./manager");
		const state = await import("../state");
		state.setCurrentProjectPath("active.recordly");
		state.setCurrentVideoPath("active.mp4");
		const access = vi.spyOn(fs, "access");
		try {
			for (const code of ["ENOENT", "EACCES", "EPERM", "EIO"]) {
				access.mockRejectedValueOnce(
					Object.assign(new Error(`${code}: cannot access file`), { code }),
				);
				const result = await resolveProjectMediaSources({
					videoPath: path.join(tempRoot, "video.mp4"),
				});
				expect(result.success).toBe(false);
				if (!result.success) {
					expect(result.message).toContain(
						code === "ENOENT" ? "Project video file not found" : code,
					);
					if (code !== "ENOENT") expect(result.message).not.toContain("not found");
				}
			}
			expect(state.currentProjectPath).toBe("active.recordly");
			expect(state.currentVideoPath).toBe("active.mp4");
		} finally {
			access.mockRestore();
		}
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

	it.each(["editor", "history"])("approves %s audio paths when loading a project", async (location) => {
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
					audioRegions: location === "editor" ? [{ id: "a1", startMs: 0, endMs: 1000, audioPath, volume: 1 }] : [],
				},
				...(location === "history" ? { history: { version: 1, values: [null, {}, { audioPath }] } } : {}),
			}),
			"utf-8",
		);

		const { loadProjectFromPath, resolveApprovedLocalMediaPath } = await import("./manager");
		const resolvedAudioPath = await fs.realpath(audioPath);

		const result = await loadProjectFromPath(projectPath);
		expect(result.success).toBe(true);
		await expect(resolveApprovedLocalMediaPath(audioPath)).resolves.toBe(resolvedAudioPath);
	});
	it("leaves missing previews to the composed renderer without decoding a source-only frame", async () => {
		const generate = vi.fn();
		vi.doMock("./firstFrameThumbnail", () => ({ createProjectFirstFrameThumbnail: generate }));
		const manager = await import("./manager");
		const source = path.join(tempRoot, "source.mp4");
		const projectPath = path.join(tempRoot, "padded.recordly");
		await fs.writeFile(source, "video");
		await fs.writeFile(projectPath, JSON.stringify({ version: 2, videoPath: source, editor: {} }));
		const ready = vi.fn();
		const entry = await manager.buildProjectLibraryEntry(projectPath, tempRoot, ready);
		expect(entry?.thumbnailPath).toBeNull();
		expect(generate).not.toHaveBeenCalled();
		expect(ready).not.toHaveBeenCalled();
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
	it.skipIf(process.platform === "win32")(
		"does not approve a replacement symlink target after validating its previous target",
		async () => {
			const manager = await import("./manager");
			const { approvedLocalReadPaths } = await import("../state");
			const approvedTarget = path.join(tempRoot, "approved.mp4");
			const replacementTarget = path.join(tempRoot, "unapproved.mp4");
			const alias = path.join(tempPath, "changing.mp4");
			await fs.writeFile(approvedTarget, "approved recording");
			await fs.writeFile(replacementTarget, "private recording");
			await fs.symlink(approvedTarget, alias);
			await manager.rememberApprovedLocalReadPath(approvedTarget);
			const canonicalApproved = await fs.realpath(approvedTarget);
			const canonicalReplacement = await fs.realpath(replacementTarget);
			const originalRealpath = fs.realpath.bind(fs);
			const resolve = vi.spyOn(fs, "realpath").mockImplementationOnce(async (value) => {
				const previous = await originalRealpath(value);
				await fs.unlink(alias);
				await fs.symlink(replacementTarget, alias);
				return previous;
			});
			try {
				expect(await manager.resolveApprovedLocalMediaPath(alias)).toBe(canonicalApproved);
				expect(approvedLocalReadPaths.has(alias)).toBe(true);
				expect(approvedLocalReadPaths.has(approvedTarget)).toBe(true);
				expect(approvedLocalReadPaths.has(canonicalReplacement)).toBe(false);
				expect(manager.isAllowedLocalReadPath(alias)).toBe(false);
			} finally {
				resolve.mockRestore();
			}
		},
	);
});
