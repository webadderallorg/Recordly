import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const TMP_ROOT = path.join(os.tmpdir(), `recordly-export-stream-test-${Date.now()}`);

vi.mock("electron", () => ({
	app: {
		getPath: (key: string) => {
			if (key === "temp") {
				return TMP_ROOT;
			}
			throw new Error(`Unexpected app.getPath key: ${key}`);
		},
	},
}));

import {
	cleanupAllExportStreams,
	closeExportStream,
	hasExportStream,
	isOwnedExportPath,
	openExportStream,
	writeToExportStream,
} from "./exportStream";

async function readBytes(filePath: string): Promise<Uint8Array> {
	return new Uint8Array(await fs.readFile(filePath));
}

describe("exportStream", () => {
	const openedTempPaths: string[] = [];

	beforeAll(async () => {
		await fs.mkdir(TMP_ROOT, { recursive: true });
	});

	afterAll(async () => {
		await fs.rm(TMP_ROOT, { recursive: true, force: true });
	});

	beforeEach(() => {
		openedTempPaths.length = 0;
	});

	afterEach(async () => {
		await cleanupAllExportStreams();
		await Promise.allSettled(
			openedTempPaths.map((tempPath) => fs.rm(tempPath, { force: true })),
		);
	});

	it("persists multiple chunks in order and reports the highest watermark on close", async () => {
		const { streamId, tempPath } = await openExportStream();
		openedTempPaths.push(tempPath);
		expect(hasExportStream(streamId)).toBe(true);

		await writeToExportStream(streamId, 0, new Uint8Array([1, 2, 3, 4]));
		await writeToExportStream(streamId, 4, new Uint8Array([5, 6, 7, 8]));

		const result = await closeExportStream(streamId);
		expect(result.tempPath).toBe(tempPath);
		expect(result.bytesWritten).toBe(8);

		const bytes = await readBytes(tempPath);
		expect(Array.from(bytes)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
		expect(hasExportStream(streamId)).toBe(false);
	});

	it("supports out-of-order writes and keeps the watermark at the highest offset", async () => {
		const { streamId, tempPath } = await openExportStream();
		openedTempPaths.push(tempPath);

		await writeToExportStream(streamId, 16, new Uint8Array([0xff, 0xee]));
		await writeToExportStream(streamId, 0, new Uint8Array([0x01, 0x02]));

		const result = await closeExportStream(streamId);
		expect(result.bytesWritten).toBe(18);

		const bytes = await readBytes(tempPath);
		expect(bytes.byteLength).toBe(18);
		expect(bytes[0]).toBe(0x01);
		expect(bytes[1]).toBe(0x02);
		expect(bytes[16]).toBe(0xff);
		expect(bytes[17]).toBe(0xee);
	});

	it("removes the temp file when closed with abort and returns a null tempPath", async () => {
		const { streamId, tempPath } = await openExportStream();
		openedTempPaths.push(tempPath);
		await writeToExportStream(streamId, 0, new Uint8Array([9, 9, 9]));

		const result = await closeExportStream(streamId, { abort: true });

		await expect(fs.access(tempPath)).rejects.toThrow();
		expect(hasExportStream(streamId)).toBe(false);
		expect(result.tempPath).toBeNull();
		expect(result.bytesWritten).toBe(0);
		expect(isOwnedExportPath(tempPath)).toBe(false);
	});

	it("tracks open temp paths in the owned-path registry until close", async () => {
		const { streamId, tempPath } = await openExportStream();
		openedTempPaths.push(tempPath);

		expect(isOwnedExportPath(tempPath)).toBe(true);
		// Spoofed paths must not satisfy the registry check.
		expect(isOwnedExportPath("/tmp/not-ours.mp4")).toBe(false);

		// A successful close keeps ownership so callers can still move or discard
		// the file via the subsequent IPC call.
		const result = await closeExportStream(streamId);
		expect(result.tempPath).toBe(tempPath);
		expect(isOwnedExportPath(tempPath)).toBe(true);
	});

	it("rejects writes after the stream has been aborted", async () => {
		const { streamId, tempPath } = await openExportStream();
		openedTempPaths.push(tempPath);
		await closeExportStream(streamId, { abort: true });

		await expect(writeToExportStream(streamId, 0, new Uint8Array([1]))).rejects.toThrow(
			/Export stream not found/,
		);
	});

	it("allows the lossless tiled payload extension and persists its stream", async () => {
		const { streamId, tempPath } = await openExportStream({ extension: "tiledrgba" });
		openedTempPaths.push(tempPath);

		expect(tempPath.endsWith(".tiledrgba")).toBe(true);
		expect(hasExportStream(streamId)).toBe(true);

		const tileBytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
		await writeToExportStream(streamId, 0, tileBytes);
		const result = await closeExportStream(streamId);
		expect(result.tempPath).toBe(tempPath);
		expect(result.bytesWritten).toBe(tileBytes.byteLength);
		expect(Array.from(await readBytes(tempPath))).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
	});

	it("rejects an extension that would escape the temp directory", async () => {
		await expect(openExportStream({ extension: "mp4/../etc/passwd" })).rejects.toThrow(
			/Invalid export stream extension/,
		);
		await expect(openExportStream({ extension: ".." })).rejects.toThrow(
			/Invalid export stream extension/,
		);
		await expect(openExportStream({ extension: "MP4" })).rejects.toThrow(
			/Invalid export stream extension/,
		);
		// Arbitrary/long non-alphanumeric extensions must stay rejected even though
		// the length cap was raised to accommodate descriptive payload names.
		await expect(openExportStream({ extension: "tiled.rgba" })).rejects.toThrow(
			/Invalid export stream extension/,
		);
		await expect(openExportStream({ extension: "tiledrgba.exe" })).rejects.toThrow(
			/Invalid export stream extension/,
		);
	});
});
