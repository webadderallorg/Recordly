import fs from "node:fs/promises";
import type { Server } from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";

let directory: string;
let server: Server | undefined;
afterEach(async () => {
	server?.closeAllConnections();
	if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
	vi.unstubAllEnvs();
	vi.resetModules();
	vi.doUnmock("electron");
	if (directory) await fs.rm(directory, { recursive: true, force: true });
});

it("resolves and range-serves native M4A companions with audio MIME and capability protection", async () => {
	directory = await fs.mkdtemp(path.join(os.tmpdir(), "recordly-m4a-transport-"));
	vi.stubEnv("VITE_DEV_SERVER_URL", "http://localhost:5173/");
	vi.doMock("electron", () => ({
		app: {
			isPackaged: false,
			getAppPath: () => directory,
			getPath: () => directory,
			setPath: () => undefined,
		},
	}));
	const { resolveApprovedLocalMediaPath, rememberApprovedLocalReadPath } = await import(
		"./ipc/project/manager"
	);
	const { createMediaServer, buildMediaUrl } = await import("./mediaServer");
	server = createMediaServer();
	await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("Missing server address");
	for (const suffix of ["system.m4a", "mic.m4a"]) {
		const file = path.join(directory, `recording.${suffix}`);
		await fs.writeFile(file, "native-aac-content");
		await rememberApprovedLocalReadPath(file);
		const resolved = await resolveApprovedLocalMediaPath(file);
		expect(resolved).toBe(await fs.realpath(file));
		const url = buildMediaUrl(`http://127.0.0.1:${address.port}`, resolved!);
		const response = await fetch(url, {
			headers: { Origin: "http://localhost:5173", Range: "bytes=0-5" },
		});
		expect(response.status).toBe(206);
		expect(response.headers.get("content-type")).toBe("audio/mp4");
		expect(await response.text()).toBe("native");
		const unapproved = new URL(url);
		unapproved.searchParams.delete("token");
		expect((await fetch(unapproved)).status).toBe(403);
	}
});
