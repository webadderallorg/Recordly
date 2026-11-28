import fs from "node:fs/promises";
import type { Server } from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createPackagedRendererServer } from "./rendererServer";

describe("packaged renderer assets", () => {
	let root: string | undefined;
	let server: Server | undefined;

	async function setupTestServer(assetFiles: Record<string, string> = {}) {
		root = await fs.mkdtemp(path.join(os.tmpdir(), "recordly-renderer-test-"));
		const dist = path.join(root, "dist");
		const assets = path.join(root, "assets");
		await fs.mkdir(dist);
		await fs.mkdir(path.join(assets, "wallpapers"), { recursive: true });
		await fs.writeFile(path.join(dist, "index.html"), "<html>Recordly</html>");
		await fs.writeFile(path.join(assets, "wallpapers", "test.mp4"), "video");
		await fs.writeFile(path.join(root, "private.txt"), "secret");
		for (const [relativePath, contents] of Object.entries(assetFiles)) {
			const targetPath = path.join(assets, relativePath);
			await fs.mkdir(path.dirname(targetPath), { recursive: true });
			await fs.writeFile(targetPath, contents);
		}
		server = createPackagedRendererServer(dist, assets);
		await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
		const address = server.address();
		if (!address || typeof address === "string") throw new Error("Missing address");
		return `http://127.0.0.1:${address.port}`;
	}

	afterEach(async () => {
		if (server) {
			server.closeAllConnections();
			await new Promise<void>((resolve) => server!.close(() => resolve()));
			server = undefined;
		}
		if (root) {
			await fs.rm(root, { recursive: true, force: true });
			root = undefined;
		}
	});

	it("serves bundled wallpaper media over HTTP without exposing sibling resources", async () => {
		const base = await setupTestServer();
		const media = await fetch(`${base}/__recordly_assets/wallpapers/test.mp4`);
		expect(media.status).toBe(200);
		expect(media.headers.get("content-type")).toBe("video/mp4");
		expect(media.headers.get("x-content-type-options")).toBe("nosniff");
		expect(media.headers.get("content-length")).toBe("5");
		expect(media.headers.get("accept-ranges")).toBe("bytes");
		expect(await media.text()).toBe("video");
		const document = await fetch(base);
		expect(document.headers.get("content-security-policy")).toBe("frame-ancestors 'none'");
		expect(document.headers.get("content-length")).toBe(
			String(Buffer.byteLength("<html>Recordly</html>")),
		);
		expect(await document.text()).toContain("Recordly");
		const escaped = await fetch(`${base}/__recordly_assets/%2e%2e%2fprivate.txt`);
		expect(await escaped.text()).not.toContain("secret");
		expect(
			(await fetch(`${base}/__recordly_assets/wallpapers/test.mp4`, { method: "POST" }))
				.status,
		).toBe(405);
	});

	it("supports HEAD and HTTP byte-range requests for bundled media", async () => {
		const base = await setupTestServer({
			"wallpapers/seek.mp4": "0123456789",
			"wallpapers/empty.mp4": "",
		});

		const head = await fetch(`${base}/__recordly_assets/wallpapers/seek.mp4`, {
			method: "HEAD",
		});
		expect(head.status).toBe(200);
		expect(head.headers.get("content-length")).toBe("10");
		expect(head.headers.get("accept-ranges")).toBe("bytes");
		expect(head.headers.get("content-type")).toBe("video/mp4");
		expect(await head.text()).toBe("");

		const rangeCases = [
			{ header: "bytes=0-3", range: "bytes 0-3/10", length: "4", body: "0123" },
			{ header: "bytes=2-", range: "bytes 2-9/10", length: "8", body: "23456789" },
			{ header: "bytes=-3", range: "bytes 7-9/10", length: "3", body: "789" },
			{ header: "bytes=2-999", range: "bytes 2-9/10", length: "8", body: "23456789" },
		];
		for (const testCase of rangeCases) {
			const res = await fetch(`${base}/__recordly_assets/wallpapers/seek.mp4`, {
				headers: { Range: testCase.header },
			});
			expect(res.status).toBe(206);
			expect(res.headers.get("content-range")).toBe(testCase.range);
			expect(res.headers.get("content-length")).toBe(testCase.length);
			expect(res.headers.get("accept-ranges")).toBe("bytes");
			expect(res.headers.get("x-content-type-options")).toBe("nosniff");
			expect(await res.text()).toBe(testCase.body);
		}

		const headRange = await fetch(`${base}/__recordly_assets/wallpapers/seek.mp4`, {
			method: "HEAD",
			headers: { Range: "bytes=0-3" },
		});
		expect(headRange.status).toBe(206);
		expect(headRange.headers.get("content-range")).toBe("bytes 0-3/10");
		expect(headRange.headers.get("content-length")).toBe("4");
		expect(headRange.headers.get("accept-ranges")).toBe("bytes");
		expect(await headRange.text()).toBe("");

		for (const badRange of ["bytes=100-200", "bytes=0-1,2-3"]) {
			const unsatisfiable = await fetch(`${base}/__recordly_assets/wallpapers/seek.mp4`, {
				headers: { Range: badRange },
			});
			expect(unsatisfiable.status).toBe(416);
			expect(unsatisfiable.headers.get("content-range")).toBe("bytes */10");
		}

		const emptyFull = await fetch(`${base}/__recordly_assets/wallpapers/empty.mp4`);
		expect(emptyFull.status).toBe(200);
		expect(emptyFull.headers.get("content-length")).toBe("0");
		expect(await emptyFull.text()).toBe("");

		const emptyRange = await fetch(`${base}/__recordly_assets/wallpapers/empty.mp4`, {
			headers: { Range: "bytes=0-0" },
		});
		expect(emptyRange.status).toBe(416);
		expect(emptyRange.headers.get("content-range")).toBe("bytes */0");

		const dirRes = await fetch(`${base}/__recordly_assets/wallpapers`);
		expect(dirRes.status).toBe(404);
	});
});
