import fs from "node:fs/promises";
import type { Server } from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("media server path policy", () => {
	let server: Server | undefined;
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
		if (server) {
			server.closeAllConnections();
			await new Promise<void>((resolve) => server!.close(() => resolve()));
			server = undefined;
		}
		vi.unstubAllEnvs();
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

		expect(isAllowedMediaPath(videoPath)).toBe(false);

		await rememberApprovedLocalReadPath(videoPath);

		expect(isAllowedMediaPath(videoPath)).toBe(true);
	});

	it("requires a per-file capability and trusted origin while preserving range playback", async () => {
		vi.stubEnv("VITE_DEV_SERVER_URL", "http://localhost:5173/");
		const first = path.join(tempRoot, "recording.mp4");
		const second = path.join(tempRoot, "second.mp4");
		await Promise.all([fs.writeFile(first, "test-video"), fs.writeFile(second, "other-video")]);
		const { approvedLocalReadPaths } = await import("./ipc/state");
		approvedLocalReadPaths.add(await fs.realpath(first));
		approvedLocalReadPaths.add(await fs.realpath(second));
		const { createMediaServer, buildMediaUrl } = await import("./mediaServer");
		server = createMediaServer();
		await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
		const address = server.address();
		if (!address || typeof address === "string") throw new Error("Missing TCP address");
		const mediaUrl = buildMediaUrl(`http://127.0.0.1:${address.port}`, first);
		const noToken = new URL(mediaUrl);
		noToken.searchParams.delete("token");
		expect((await fetch(noToken)).status).toBe(403);
		const tampered = new URL(mediaUrl);
		tampered.searchParams.set("path", second);
		expect((await fetch(tampered)).status).toBe(403);
		expect(
			(await fetch(mediaUrl, { headers: { Origin: "https://attacker.example" } })).status,
		).toBe(403);
		expect((await fetch(mediaUrl, { method: "POST" })).status).toBe(405);
		const range = await fetch(mediaUrl, {
			headers: { Origin: "http://localhost:5173", Range: "bytes=0-3" },
		});
		expect(range.status).toBe(206);
		expect(range.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
		expect(range.headers.get("content-range")).toBe("bytes 0-3/10");
		expect(await range.text()).toBe("test");
		const fallback = await fetch(mediaUrl, { headers: { Origin: "null" } });
		expect(fallback.status).toBe(200);
		expect(fallback.headers.get("access-control-allow-origin")).toBe("null");
		expect((await fetch(noToken, { headers: { Origin: "null" } })).status).toBe(403);
		const head = await fetch(mediaUrl, { method: "HEAD" });
		expect(head.status).toBe(200);
		expect(head.headers.get("content-length")).toBe("10");
		expect(await head.text()).toBe("");
		const preflight = await fetch(mediaUrl, {
			method: "OPTIONS",
			headers: { Origin: "http://localhost:5173" },
		});
		expect(preflight.status).toBe(204);
	});

	it("rejects missing media files outside the allowed directories", async () => {
		const missingPath = path.join(tempRoot, "Downloads", "missing.mp4");
		const { isAllowedMediaPath } = await import("./mediaServer");

		expect(isAllowedMediaPath(missingPath)).toBe(false);
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
