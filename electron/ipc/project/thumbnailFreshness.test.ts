import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { encodeComposedThumbnail } from "./composedThumbnail";
import { hasFreshProjectThumbnail } from "./thumbnailFreshness";

it("rejects legacy, stale, missing and broken previews while accepting a fresh current-size or larger PNG", async () => {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "recordly-preview-"));
	const file = path.join(dir, "preview.png");
	try {
		expect(await hasFreshProjectThumbnail(file, 0)).toBe(false);
		const header = Buffer.alloc(45);
		Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(header);
		header.write("IHDR", 12);
		header.writeUInt32BE(320, 16);
		header.writeUInt32BE(180, 20);
		await fs.writeFile(file, header);
		expect(await hasFreshProjectThumbnail(file, 0)).toBe(false);
		header.writeUInt32BE(640, 16);
		header.writeUInt32BE(480, 20);
		await fs.writeFile(file, header);
		// A matching size is insufficient: old renders recomposed the scene as 4:3.
		expect(await hasFreshProjectThumbnail(file, 0)).toBe(false);
		const composed = encodeComposedThumbnail(
			`data:image/png;base64,${header.toString("base64")}`,
		);
		await fs.writeFile(file, composed);
		expect(await hasFreshProjectThumbnail(file, 0)).toBe(true);
		composed.writeUInt32BE(1600, 16);
		composed.writeUInt32BE(1200, 20);
		await fs.writeFile(file, composed);
		expect(await hasFreshProjectThumbnail(file, 0)).toBe(true);
		expect(await hasFreshProjectThumbnail(file, Date.now() + 10000)).toBe(false);
		const cursorless = Buffer.from(composed);
		cursorless.fill(0, 41);
		Buffer.from("RecordlyThumbnail\0composed-cover-v2").copy(cursorless, 41);
		await fs.writeFile(file, cursorless);
		expect(await hasFreshProjectThumbnail(file, 0)).toBe(false);
		const legacy = Buffer.from(composed);
		legacy.fill(0, 41);
		Buffer.from("RecordlyThumbnail\0composed-v1").copy(legacy, 41);
		await fs.writeFile(file, legacy);
		expect(await hasFreshProjectThumbnail(file, 0)).toBe(false);
		await fs.writeFile(file, "broken");
		expect(await hasFreshProjectThumbnail(file, 0)).toBe(false);
	} finally {
		await fs.rm(dir, { recursive: true, force: true });
	}
});
