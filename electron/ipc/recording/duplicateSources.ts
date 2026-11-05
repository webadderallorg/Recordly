import { createHash } from "node:crypto";
import { constants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { getRecordingsDir } from "../utils";

let activeScan: Promise<string[][]> | null = null;

/** Share an in-flight scan when cleanup is reopened; never cache stale results. */
export function findDuplicateRecordingSources(): Promise<string[][]> {
	activeScan ??= scanSources().finally(() => {
		activeScan = null;
	});
	return activeScan;
}

/** Compare contents, never names or timestamps. Read only regular library media. */
async function scanSources(): Promise<string[][]> {
	const root = await fs.realpath(await getRecordingsDir());
	const sizes = new Map<number, string[]>();
	for (const entry of await fs.readdir(root, { withFileTypes: true })) {
		if (!entry.isFile() || !/\.(mp4|mov|webm|mkv|m4v|wav|m4a|mp3|ogg|flac)$/i.test(entry.name))
			continue;
		const file = path.join(root, entry.name);
		const stat = await fs.lstat(file).catch(() => null);
		if (!stat?.isFile() || !stat.size) continue;
		sizes.set(stat.size, [...(sizes.get(stat.size) ?? []), file]);
	}
	const groups = new Map<string, string[]>();
	for (const [size, files] of sizes) {
		if (files.length < 2) continue;
		for (const file of files) {
			// Streaming keeps memory bounded even for multi-gigabyte recordings.
			const handle = await fs
				.open(file, constants.O_RDONLY | constants.O_NOFOLLOW)
				.catch(() => null);
			if (!handle) continue;
			try {
				const before = await handle.stat();
				if (!before.isFile() || before.size !== size) continue;
				const hash = createHash("sha256");
				for await (const chunk of handle.createReadStream({ autoClose: false }))
					hash.update(chunk);
				const after = await handle.stat();
				const current = await fs.lstat(file);
				if (
					after.size !== before.size ||
					after.mtimeMs !== before.mtimeMs ||
					after.ctimeMs !== before.ctimeMs ||
					current.ino !== before.ino ||
					!current.isFile()
				)
					continue;
				const key = `${size}:${hash.digest("hex")}`;
				groups.set(key, [...(groups.get(key) ?? []), file]);
			} catch {
				// Unreadable or changing files are never suggested for cleanup.
			} finally {
				await handle.close();
			}
		}
	}
	return [...groups.values()].filter((files) => files.length > 1);
}
