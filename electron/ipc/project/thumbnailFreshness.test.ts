import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { hasFreshProjectThumbnail } from "./thumbnailFreshness";

it("rejects legacy, stale, missing and broken previews while accepting a fresh current-size or larger PNG", async () => {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "recordly-preview-"));
	const file = path.join(dir, "preview.png");
	try {
		expect(await hasFreshProjectThumbnail(file, 0)).toBe(false);
		const header = Buffer.alloc(24);
		Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(header);
		header.writeUInt32BE(320, 16);
		header.writeUInt32BE(180, 20);
		await fs.writeFile(file, header);
		expect(await hasFreshProjectThumbnail(file, 0)).toBe(false);
		header.writeUInt32BE(640, 16);
		header.writeUInt32BE(480, 20);
		await fs.writeFile(file, header);
		expect(await hasFreshProjectThumbnail(file, 0)).toBe(true);
		header.writeUInt32BE(1600, 16);
		header.writeUInt32BE(1200, 20);
		await fs.writeFile(file, header);
		expect(await hasFreshProjectThumbnail(file, 0)).toBe(true);
		expect(await hasFreshProjectThumbnail(file, Date.now() + 10000)).toBe(false);
		await fs.writeFile(file, "broken");
		expect(await hasFreshProjectThumbnail(file, 0)).toBe(false);
	} finally {
		await fs.rm(dir, { recursive: true, force: true });
	}
});
