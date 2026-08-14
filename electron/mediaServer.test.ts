import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("media server path policy", () => {
	let tempRoot: string;
	let appDataPath: string;
	let userDataPath: string;
	let tempPath: string;
	let appPath: string;

	beforeEach(async () => {
		tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "recordly-media-server-"));
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

	it("rejects existing media files outside the session directories until they are approved", async () => {
		const downloadsPath = path.join(tempRoot, "Downloads");
		const videoPath = path.join(downloadsPath, "personal-video.mp4");
		await fs.mkdir(downloadsPath, { recursive: true });
		await fs.writeFile(videoPath, "test-video");

		const { isAllowedMediaPath } = await import("./mediaServer");
		const { rememberApprovedLocalReadPath } = await import("./ipc/project/manager");

		await expect(isAllowedMediaPath(videoPath)).resolves.toBe(false);

		await rememberApprovedLocalReadPath(videoPath);

		await expect(isAllowedMediaPath(videoPath)).resolves.toBe(true);
	});

	it("rejects missing media files outside the allowed directories", async () => {
		const missingPath = path.join(tempRoot, "Downloads", "missing.mp4");
		const { isAllowedMediaPath } = await import("./mediaServer");

		await expect(isAllowedMediaPath(missingPath)).resolves.toBe(false);
	});
});

describe("pending media URL serve-time authorization (real HTTP)", () => {
	let tempRoot: string;
	let appDataPath: string;
	let userDataPath: string;
	let tempPath: string;
	let appPath: string;

	beforeEach(async () => {
		tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "recordly-media-server-http-"));
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

	async function mintPendingUrl(candidatePath: string) {
		const { resolveLocalMediaUrlPath } = await import("./ipc/project/manager");
		const { ensureMediaServer, buildMediaUrl } = await import("./mediaServer");

		const resolution = await resolveLocalMediaUrlPath(candidatePath);
		expect(resolution.status).toBe("pending");
		const baseUrl = await ensureMediaServer();
		return buildMediaUrl(baseUrl, resolution.path);
	}

	it("serves a pending in-root sidecar whose file appears during the request", async () => {
		const recordingsPath = path.join(userDataPath, "recordings");
		const m4aPath = path.join(recordingsPath, "recording-2026-08-03.system.m4a");
		await fs.mkdir(recordingsPath, { recursive: true });

		const pendingUrl = await mintPendingUrl(m4aPath);

		// The renderer fetch races ahead of the mux rename: the file is still
		// missing when the request arrives and appears while it is in flight.
		const fetchPromise = fetch(pendingUrl);
		await new Promise((resolve) => setTimeout(resolve, 150));
		await fs.writeFile(m4aPath, "test-audio");

		const response = await fetchPromise;
		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toBe("audio/mp4");
		expect(await response.text()).toBe("test-audio");
	});

	it("serves a pending sidecar under a custom recordings root once it appears", async () => {
		const customRecordingsPath = path.join(tempRoot, "Custom Recordings");
		const webmPath = path.join(customRecordingsPath, "recording-2026-08-03.mic.webm");
		await fs.mkdir(customRecordingsPath, { recursive: true });
		await fs.writeFile(
			path.join(userDataPath, "recordings-settings.json"),
			JSON.stringify({ recordingsDir: customRecordingsPath }),
			"utf-8",
		);

		const pendingUrl = await mintPendingUrl(webmPath);

		const fetchPromise = fetch(pendingUrl);
		await new Promise((resolve) => setTimeout(resolve, 150));
		await fs.writeFile(webmPath, "test-audio");

		const response = await fetchPromise;
		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toBe("video/webm");
	});

	it("returns 404 for a pending-approved in-root path that never appears", async () => {
		const recordingsPath = path.join(userDataPath, "recordings");
		const wavPath = path.join(recordingsPath, "recording-2026-08-03.system.wav");
		await fs.mkdir(recordingsPath, { recursive: true });

		const pendingUrl = await mintPendingUrl(wavPath);
		const { setPendingMediaAppearTimeoutMsForTests } = await import("./mediaServer");
		setPendingMediaAppearTimeoutMsForTests(150);

		const response = await fetch(pendingUrl);
		expect(response.status).toBe(404);
	});

	it("rejects an outside path over HTTP even when the file exists", async () => {
		const downloadsPath = path.join(tempRoot, "Downloads");
		const videoPath = path.join(downloadsPath, "personal-video.mp4");
		await fs.mkdir(downloadsPath, { recursive: true });
		await fs.writeFile(videoPath, "outside-bytes");

		const { ensureMediaServer, buildMediaUrl } = await import("./mediaServer");
		const baseUrl = await ensureMediaServer();
		const response = await fetch(buildMediaUrl(baseUrl, videoPath));

		expect(response.status).toBe(403);
	});

	it("rejects a pending in-root symlink whose target appears outside the roots", async () => {
		const outsideTarget = path.join(tempRoot, "outside-secret.m4a");
		const symlinkInsideUserData = path.join(
			userDataPath,
			"recordings",
			"recording-2026-08-03.system.m4a",
		);
		await fs.mkdir(path.dirname(symlinkInsideUserData), { recursive: true });

		try {
			// The link exists but its target does not yet, so the URL mint sees a
			// missing path and grants a pending URL for the lexical in-root path.
			await fs.symlink(outsideTarget, symlinkInsideUserData);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "EPERM") {
				return;
			}
			throw error;
		}

		const pendingUrl = await mintPendingUrl(symlinkInsideUserData);

		// The target appears after the pending grant; the serve-time realpath now
		// lands outside every allowed root, so the escape must stay blocked.
		await fs.writeFile(outsideTarget, "secret-bytes");
		const response = await fetch(pendingUrl);
		expect(response.status).toBe(403);
	});
});

describe("resolveHttpByteRange", () => {
	it("rejects malformed and multi-range headers", async () => {
		const { resolveHttpByteRange } = await import("./mediaServer");

		expect(resolveHttpByteRange("bytes=0-1,2-3", 100)).toBeNull();
		expect(resolveHttpByteRange("bytes=0-1foo", 100)).toBeNull();
	});

	it("clamps oversized explicit end offsets to EOF", async () => {
		const { resolveHttpByteRange } = await import("./mediaServer");

		expect(resolveHttpByteRange("bytes=0-9999999999", 3_221_225_472)).toEqual({
			start: 0,
			end: 3_221_225_471,
		});
	});

	it("rejects ranges that start beyond EOF", async () => {
		const { resolveHttpByteRange } = await import("./mediaServer");

		expect(resolveHttpByteRange("bytes=500-999", 500)).toBeNull();
	});

	it("preserves suffix range semantics", async () => {
		const { resolveHttpByteRange } = await import("./mediaServer");

		expect(resolveHttpByteRange("bytes=-500", 1_000)).toEqual({
			start: 500,
			end: 999,
		});
	});
});
