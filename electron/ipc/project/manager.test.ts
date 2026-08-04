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
		if (tempRoot) {
			await fs.rm(tempRoot, { recursive: true, force: true });
		}
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
		await expect(isAllowedMediaPath(videoPath)).resolves.toBe(false);
		await expect(resolveApprovedLocalMediaPath(videoPath)).resolves.toBeNull();

		// Once the user opts in (via dialog/export/etc.) the path is approved.
		await rememberApprovedLocalReadPath(videoPath);

		await expect(resolveApprovedLocalMediaPath(videoPath)).resolves.toBe(resolvedVideoPath);
		await expect(isAllowedMediaPath(videoPath)).resolves.toBe(true);
	});

	it("rejects existing non-media files when resolving local media URLs", async () => {
		const downloadsPath = path.join(tempRoot, "Downloads");
		const textPath = path.join(downloadsPath, "notes.txt");
		await fs.mkdir(downloadsPath, { recursive: true });
		await fs.writeFile(textPath, "not media");

		const { resolveApprovedLocalMediaPath } = await import("./manager");
		const { isAllowedMediaPath } = await import("../../mediaServer");

		await expect(resolveApprovedLocalMediaPath(textPath)).resolves.toBeNull();
		await expect(isAllowedMediaPath(textPath)).resolves.toBe(false);
	});

	it("allows m4a audio assets inside the recordings directory", async () => {
		const recordingsPath = path.join(userDataPath, "recordings");
		const audioPath = path.join(recordingsPath, "recording-2026-08-03.system.m4a");
		await fs.mkdir(recordingsPath, { recursive: true });
		await fs.writeFile(audioPath, "test-audio");

		const { resolveApprovedLocalMediaPath } = await import("./manager");
		const resolvedAudioPath = await fs.realpath(audioPath);

		await expect(resolveApprovedLocalMediaPath(audioPath)).resolves.toBe(resolvedAudioPath);
	});

	it("allows m4a assets inside a configured custom recordings directory", async () => {
		const customRecordingsPath = path.join(tempRoot, "Custom Recordings");
		const audioPath = path.join(customRecordingsPath, "recording-2026-08-03.mic.m4a");
		await fs.mkdir(customRecordingsPath, { recursive: true });
		await fs.writeFile(audioPath, "test-audio");
		await fs.writeFile(
			path.join(userDataPath, "recordings-settings.json"),
			JSON.stringify({ recordingsDir: customRecordingsPath }),
			"utf-8",
		);

		const { resolveApprovedLocalMediaPath } = await import("./manager");
		const resolvedAudioPath = await fs.realpath(audioPath);

		await expect(resolveApprovedLocalMediaPath(audioPath)).resolves.toBe(resolvedAudioPath);
	});

	it("matches policy roots case-insensitively on Windows", async () => {
		const recordingsPath = path.join(userDataPath, "recordings");
		const audioPath = path.join(recordingsPath, "recording-2026-08-03.system.m4a");
		await fs.mkdir(recordingsPath, { recursive: true });
		await fs.writeFile(audioPath, "test-audio");

		const { resolveApprovedLocalMediaPath } = await import("./manager");
		const resolvedAudioPath = await fs.realpath(audioPath);

		if (process.platform === "win32") {
			const caseVariantRoot = recordingsPath.replace(/^([a-zA-Z]):/, (drive) =>
				drive.toLowerCase() === drive ? drive.toUpperCase() : drive.toLowerCase(),
			);
			const caseVariantPath = audioPath.replace(recordingsPath, caseVariantRoot);
			if (caseVariantPath !== audioPath) {
				await expect(resolveApprovedLocalMediaPath(caseVariantPath)).resolves.toBe(
					resolvedAudioPath,
				);
			}
		}
	});

	it("normalizes file:/// URLs in media path approval", async () => {
		const recordingsPath = path.join(userDataPath, "recordings");
		const audioPath = path.join(recordingsPath, "recording-2026-08-03.system.m4a");
		await fs.mkdir(recordingsPath, { recursive: true });
		await fs.writeFile(audioPath, "test-audio");

		const { resolveApprovedLocalMediaPath } = await import("./manager");
		const resolvedAudioPath = await fs.realpath(audioPath);
		const fileUrl =
			process.platform === "win32"
				? `file:///${audioPath.replace(/\\/g, "/")}`
				: `file://${audioPath}`;

		await expect(resolveApprovedLocalMediaPath(fileUrl)).resolves.toBe(resolvedAudioPath);
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

	describe("resolveLocalMediaUrlPath pending sidecar candidates", () => {
		it("grants a pending URL for a missing supported sidecar under the recordings root", async () => {
			const recordingsPath = path.join(userDataPath, "recordings");
			const m4aPath = path.join(recordingsPath, "recording-2026-08-03.system.m4a");
			await fs.mkdir(recordingsPath, { recursive: true });

			const { resolveLocalMediaUrlPath } = await import("./manager");

			await expect(resolveLocalMediaUrlPath(m4aPath)).resolves.toEqual({
				status: "pending",
				path: m4aPath,
			});
		});

		it("grants a pending URL for a missing webm sidecar under a custom recordings root", async () => {
			const customRecordingsPath = path.join(tempRoot, "Custom Recordings");
			const webmPath = path.join(customRecordingsPath, "recording-2026-08-03.mic.webm");
			await fs.mkdir(customRecordingsPath, { recursive: true });
			await fs.writeFile(
				path.join(userDataPath, "recordings-settings.json"),
				JSON.stringify({ recordingsDir: customRecordingsPath }),
				"utf-8",
			);

			const { resolveLocalMediaUrlPath } = await import("./manager");

			await expect(resolveLocalMediaUrlPath(webmPath)).resolves.toEqual({
				status: "pending",
				path: webmPath,
			});
		});

		it("rejects a missing candidate outside the allowed roots", async () => {
			const downloadsPath = path.join(tempRoot, "Downloads");
			const missingPath = path.join(downloadsPath, "recording.system.m4a");
			await fs.mkdir(downloadsPath, { recursive: true });

			const { resolveLocalMediaUrlPath } = await import("./manager");

			await expect(resolveLocalMediaUrlPath(missingPath)).resolves.toEqual({
				status: "rejected",
				reason: "outside-allowed-roots",
			});
		});

		it("rejects a missing candidate with an unsupported extension under a root", async () => {
			const recordingsPath = path.join(userDataPath, "recordings");
			const notesPath = path.join(recordingsPath, "recording-2026-08-03.notes.txt");
			await fs.mkdir(recordingsPath, { recursive: true });

			const { resolveLocalMediaUrlPath } = await import("./manager");

			await expect(resolveLocalMediaUrlPath(notesPath)).resolves.toEqual({
				status: "rejected",
				reason: "unsupported-type",
			});
		});

		it("approves an existing media file through the URL resolver", async () => {
			const recordingsPath = path.join(userDataPath, "recordings");
			const audioPath = path.join(recordingsPath, "recording-2026-08-03.system.wav");
			await fs.mkdir(recordingsPath, { recursive: true });
			await fs.writeFile(audioPath, "test-audio");

			const { resolveLocalMediaUrlPath } = await import("./manager");
			const resolvedAudioPath = await fs.realpath(audioPath);

			await expect(resolveLocalMediaUrlPath(audioPath)).resolves.toEqual({
				status: "approved",
				path: resolvedAudioPath,
			});
		});

		it("approves an existing file:/// media URL through the URL resolver", async () => {
			const recordingsPath = path.join(userDataPath, "recordings");
			const audioPath = path.join(recordingsPath, "recording-2026-08-03.mic.wav");
			await fs.mkdir(recordingsPath, { recursive: true });
			await fs.writeFile(audioPath, "test-audio");

			const { resolveLocalMediaUrlPath } = await import("./manager");
			const resolvedAudioPath = await fs.realpath(audioPath);
			const fileUrl =
				process.platform === "win32"
					? `file:///${audioPath.replace(/\\/g, "/")}`
					: `file://${audioPath}`;

			await expect(resolveLocalMediaUrlPath(fileUrl)).resolves.toEqual({
				status: "approved",
				path: resolvedAudioPath,
			});
		});

		it("rejects a symlink under a root that points outside as a pending/approved URL", async () => {
			const outsideTarget = path.join(tempRoot, "outside-secret.mp4");
			const symlinkInsideUserData = path.join(userDataPath, "shortcut-to-secret.mp4");
			await fs.writeFile(outsideTarget, "secret-bytes");

			try {
				await fs.symlink(outsideTarget, symlinkInsideUserData);
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code === "EPERM") {
					return;
				}
				throw error;
			}

			const { resolveLocalMediaUrlPath } = await import("./manager");

			await expect(resolveLocalMediaUrlPath(symlinkInsideUserData)).resolves.toEqual({
				status: "rejected",
				reason: "symlink-escape",
			});
		});

		it("serves a pending in-root sidecar through mediaServer once the file appears", async () => {
			const recordingsPath = path.join(userDataPath, "recordings");
			const m4aPath = path.join(recordingsPath, "recording-2026-08-03.system.m4a");
			await fs.mkdir(recordingsPath, { recursive: true });

			const { resolveLocalMediaUrlPath } = await import("./manager");
			const { isAllowedMediaPath } = await import("../../mediaServer");

			const resolution = await resolveLocalMediaUrlPath(m4aPath);
			expect(resolution.status).toBe("pending");

			// Simulate the mux rename completing after the pending grant: the
			// media-server serve-time realpath check must now accept the file.
			await fs.writeFile(m4aPath, "test-audio");
			const realPath = await fs.realpath(m4aPath);
			await expect(isAllowedMediaPath(realPath)).resolves.toBe(true);

			// A symlink escape still resolves outside the roots and must stay blocked.
			const outsideTarget = path.join(tempRoot, "outside-secret.m4a");
			await fs.writeFile(outsideTarget, "secret-bytes");
			const escaped = await fs.realpath(outsideTarget);
			await expect(isAllowedMediaPath(escaped)).resolves.toBe(false);
		});
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
});
