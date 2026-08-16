import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { classifyMp4Layout, isUnfinalizedMp4, readMp4TopLevelBoxes } from "./mp4Integrity";

function box(type: string, size: number, payload = 0): Buffer {
	const header = Buffer.alloc(8 + payload);
	header.writeUInt32BE(size, 0);
	header.write(type, 4, "latin1");
	return header;
}

describe("classifyMp4Layout", () => {
	it("treats a file with a moov index as finalized", () => {
		expect(
			classifyMp4Layout(
				[
					{ type: "ftyp", size: 28 },
					{ type: "mdat", size: 3809329 },
					{ type: "moov", size: 1634 },
				],
				3810991,
			),
		).toBe("finalized");
	});

	it("flags the interrupted-writer signature as unfinalized", () => {
		expect(
			classifyMp4Layout(
				[
					{ type: "ftyp", size: 28 },
					{ type: "wide", size: 8 },
					{ type: "mdat", size: 0 },
				],
				45989367,
			),
		).toBe("unfinalized");
	});

	it("keeps a moov-bearing file finalized even when mdat runs to the end", () => {
		expect(
			classifyMp4Layout(
				[
					{ type: "ftyp", size: 28 },
					{ type: "moov", size: 1634 },
					{ type: "mdat", size: 0 },
				],
				4096,
			),
		).toBe("finalized");
	});

	it("does not guess when the layout is unfamiliar", () => {
		expect(classifyMp4Layout([{ type: "ftyp", size: 28 }], 28)).toBe("unknown");
		expect(
			classifyMp4Layout(
				[
					{ type: "ftyp", size: 28 },
					{ type: "moof", size: 512 },
				],
				540,
			),
		).toBe("unknown");
	});

	it("does not classify an empty or unreadable box table", () => {
		expect(classifyMp4Layout([], 1024)).toBe("unknown");
		expect(classifyMp4Layout([{ type: "mdat", size: 0 }], 0)).toBe("unknown");
	});
});

describe("readMp4TopLevelBoxes / isUnfinalizedMp4", () => {
	let dir: string;

	beforeAll(async () => {
		dir = await mkdtemp(path.join(tmpdir(), "recordly-mp4-"));
	});

	afterAll(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	it("walks the box table of a finalized file", async () => {
		const file = path.join(dir, "finalized.mp4");
		await writeFile(
			file,
			Buffer.concat([box("ftyp", 16, 8), box("mdat", 24, 16), box("moov", 16, 8)]),
		);

		expect(await readMp4TopLevelBoxes(file)).toEqual([
			{ type: "ftyp", size: 16 },
			{ type: "mdat", size: 24 },
			{ type: "moov", size: 16 },
		]);
		expect(await isUnfinalizedMp4(file)).toBe(false);
	});

	it("stops at an open-ended mdat and reports the file as unfinalized", async () => {
		const file = path.join(dir, "interrupted.mp4");
		await writeFile(
			file,
			Buffer.concat([
				box("ftyp", 16, 8),
				box("wide", 8),
				box("mdat", 0),
				Buffer.alloc(4096, 7),
			]),
		);

		expect(await readMp4TopLevelBoxes(file)).toEqual([
			{ type: "ftyp", size: 16 },
			{ type: "wide", size: 8 },
			{ type: "mdat", size: 0 },
		]);
		expect(await isUnfinalizedMp4(file)).toBe(true);
	});

	it("reports missing files as not-unfinalized so callers keep their fallback", async () => {
		expect(await isUnfinalizedMp4(path.join(dir, "nope.mp4"))).toBe(false);
	});
});
