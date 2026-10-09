import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { inspectVideoFile, undecodableVideoMessage } from "./videoFile";

let dir: string;
beforeEach(async () => {
	dir = await fs.mkdtemp(path.join(os.tmpdir(), "recordly-videofile-"));
});
afterEach(() => fs.rm(dir, { recursive: true, force: true }));

describe("inspectVideoFile", () => {
	it("accepts a file with content", async () => {
		const file = path.join(dir, "a.mp4");
		await fs.writeFile(file, "x");
		expect(await inspectVideoFile(file)).toEqual({ ok: true, sizeBytes: 1 });
	});

	it("keeps the edit_project wording for a deleted file", async () => {
		const file = path.join(dir, "gone.mp4");
		expect(await inspectVideoFile(file)).toEqual({
			ok: false,
			problem: "missing",
			message: `Project video file not found: ${file}`,
		});
	});

	it("tells a zero-length file apart from a missing one", async () => {
		const file = path.join(dir, "empty.mp4");
		await fs.writeFile(file, "");
		const result = await inspectVideoFile(file);
		expect(result).toMatchObject({ ok: false, problem: "empty" });
		expect(result.ok === false && result.message).toMatch(/is empty \(0 bytes\)/);
	});

	it("rejects a directory and a path through a file", async () => {
		expect(await inspectVideoFile(dir)).toMatchObject({ ok: false, problem: "not-a-file" });
		const file = path.join(dir, "f.mp4");
		await fs.writeFile(file, "x");
		expect(await inspectVideoFile(path.join(file, "inner.mp4"))).toMatchObject({
			ok: false,
			problem: "missing",
		});
	});

	it("says the drive is unavailable when the mount point itself is gone", async () => {
		const result = await inspectVideoFile("/Volumes/recordly-no-such-drive/take.mp4");
		if (process.platform === "win32") return;
		expect(result).toMatchObject({ ok: false, problem: "volume-not-mounted" });
		expect(result.ok === false && result.message).toMatch(/unplugged or unmounted/);
	});

	it("does not blame a drive when the folder exists but the file does not", async () => {
		expect(await inspectVideoFile(path.join(dir, "nope.mp4"))).toMatchObject({
			problem: "missing",
		});
	});

	it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
		"reports an unreadable parent folder as unreadable, not missing",
		async () => {
			const locked = path.join(dir, "locked");
			await fs.mkdir(locked);
			await fs.writeFile(path.join(locked, "a.mp4"), "x");
			await fs.chmod(locked, 0);
			try {
				expect(await inspectVideoFile(path.join(locked, "a.mp4"))).toMatchObject({
					ok: false,
					problem: "unreadable",
				});
			} finally {
				await fs.chmod(locked, 0o700);
			}
		},
	);

	it("describes a found-but-undecodable file separately from the other two", () => {
		expect(undecodableVideoMessage("/r/a.mp4", 12)).toMatch(
			/was found \(12 bytes\) but could not be decoded/,
		);
	});
});
