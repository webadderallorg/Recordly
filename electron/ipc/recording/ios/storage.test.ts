import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	allocateIOSSessionStorage,
	checkIOSStorageCapacity,
	readIOSJournal,
	resolveIOSArtifact,
	updateIOSJournal,
} from "./storage";
const id = "3d594650-3436-4a5a-b6a7-5ff45ecf73d0";
const roots: string[] = [];
async function root() {
	const p = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "ios-storage-")));
	roots.push(p);
	return p;
}
afterEach(async () => {
	await Promise.all(roots.splice(0).map((p) => fs.rm(p, { recursive: true, force: true })));
});
describe("iOS storage", () => {
	it("allocates unique UUID directories and refuses collisions and traversal", async () => {
		const p = await root();
		const s = await allocateIOSSessionStorage(p, id);
		expect(s.directory).toBe(path.join(p, `ios-${id}`));
		expect((await readIOSJournal(s)).state).toBe("allocated");
		await expect(allocateIOSSessionStorage(p, id)).rejects.toThrow();
		await expect(allocateIOSSessionStorage(p, "../escape")).rejects.toThrow();
	});
	it("rejects symlink roots and artifacts", async () => {
		const p = await root();
		const other = await root();
		await fs.symlink(other, path.join(p, "link"));
		await expect(allocateIOSSessionStorage(path.join(p, "link"), id)).rejects.toThrow();
		const s = await allocateIOSSessionStorage(p, id);
		await fs.symlink(other, path.join(s.directory, "source-video.mov"));
		await expect(resolveIOSArtifact(s, "source-video.mov")).rejects.toThrow();
		await expect(resolveIOSArtifact(s, "../source-video.mov")).rejects.toThrow();
	});
	it("replaces journals atomically and cannot downgrade a committed source", async () => {
		const s = await allocateIOSSessionStorage(await root(), id);
		await updateIOSJournal(s, { state: "committed", committedFile: "source-video.mov" });
		await expect(updateIOSJournal(s, { state: "recording" })).rejects.toThrow();
		expect((await readIOSJournal(s)).state).toBe("committed");
		expect((await fs.readdir(s.directory)).filter((n) => n.endsWith(".tmp"))).toEqual([]);
	});
	it("reserves incoming bytes and second video capacity only when mixing", async () => {
		expect(
			checkIOSStorageCapacity({
				availableBytes: 1024 ** 3,
				videoBytes: 800 * 1024 ** 2,
				observedBytes: 0,
				elapsedMs: 0,
				mixing: false,
			}),
		).toBe(true);
		expect(
			checkIOSStorageCapacity({
				availableBytes: 1024 ** 3,
				videoBytes: 800 * 1024 ** 2,
				observedBytes: 0,
				elapsedMs: 0,
				mixing: true,
			}),
		).toBe(false);
		await expect(
			allocateIOSSessionStorage(await root(), id, { availableBytes: async () => 100 }),
		).rejects.toThrow("DISK_SPACE_LOW");
	});
});
