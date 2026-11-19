import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { createPackagedRendererServer } from "./rendererServer";

describe("packaged renderer assets", () => {
	let root: string;
	let server: Server;
	afterEach(async () => {
		if (server) {
			server.closeAllConnections();
			await new Promise<void>((resolve) => server.close(() => resolve()));
		}
		if (root) await fs.rm(root, { recursive: true, force: true });
	});

	it("serves bundled wallpaper media over HTTP without exposing sibling resources", async () => {
		root = await fs.mkdtemp(path.join(os.tmpdir(), "recordly-renderer-test-"));
		const dist = path.join(root, "dist");
		const assets = path.join(root, "assets");
		await fs.mkdir(dist);
		await fs.mkdir(path.join(assets, "wallpapers"), { recursive: true });
		await fs.writeFile(path.join(dist, "index.html"), "<html>Recordly</html>");
		await fs.writeFile(path.join(assets, "wallpapers", "test.mp4"), "video");
		await fs.writeFile(path.join(root, "private.txt"), "secret");
		server = createPackagedRendererServer(dist, assets);
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		const address = server.address();
		if (!address || typeof address === "string") throw new Error("Missing address");
		const base = `http://127.0.0.1:${address.port}`;
		const media = await fetch(`${base}/__recordly_assets/wallpapers/test.mp4`);
		expect(media.status).toBe(200);
		expect(media.headers.get("content-type")).toBe("video/mp4");
		expect(media.headers.get("x-content-type-options")).toBe("nosniff");
		expect(await media.text()).toBe("video");
		expect(await (await fetch(base)).text()).toContain("Recordly");
		const escaped = await fetch(`${base}/__recordly_assets/%2e%2e%2fprivate.txt`);
		expect(await escaped.text()).not.toContain("secret");
		expect(
			(await fetch(`${base}/__recordly_assets/wallpapers/test.mp4`, { method: "POST" }))
				.status,
		).toBe(405);
	});
});
