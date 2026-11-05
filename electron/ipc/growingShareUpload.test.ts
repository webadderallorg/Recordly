import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MULTIPART_PART_BYTES } from "./cloudShareMultipart";
import {
	observeShareExportSource,
	progressiveShareFfmpegArgs,
	replaceShareExportSource,
	startGrowingShareUpload,
} from "./growingShareUpload";

const json = (body: unknown) => new Response(JSON.stringify(body));
const endpoint = "http://localhost:8787/api/upload";
const ticket = {
	shareCode: "abc123",
	uploadURL: "http://localhost:8787/api/upload-data/abc123",
	shareURL: "http://localhost:8787/s/abc123",
};

describe("growing share upload orchestration", () => {
	let directory: string;
	let nextOwner = 500;
	const running: {
		controller: AbortController;
		upload: ReturnType<typeof startGrowingShareUpload>;
	}[] = [];
	beforeEach(async () => {
		directory = await fs.mkdtemp(path.join(os.tmpdir(), "recordly-growing-share-"));
	});
	afterEach(async () => {
		for (const { controller } of running) controller.abort();
		await Promise.all(running.splice(0).map(({ upload }) => upload.cancel()));
		vi.unstubAllGlobals();
		await fs.rm(directory, { recursive: true, force: true });
	});
	function start(ownerId = nextOwner++) {
		const controller = new AbortController();
		const onProgress = vi.fn();
		const upload = startGrowingShareUpload({
			ownerId,
			endpoint,
			title: "Exported video",
			getToken: () => "secret-token",
			signal: controller.signal,
			onProgress,
		});
		running.push({ controller, upload });
		return { ownerId, controller, upload, onProgress };
	}
	function server(progressiveUpload = true, partBytes?: number) {
		const paths: string[] = [];
		const parts: { partNumber: number; hash: string; size: number }[] = [];
		let completed:
			| { parts: { partNumber: number; etag: string }[]; finalSize: number }
			| undefined;
		vi.stubGlobal(
			"fetch",
			vi.fn(async (input: URL | string, init: RequestInit) => {
				const url = new URL(input);
				paths.push(url.pathname);
				if (url.pathname === "/api/upload")
					return json({
						...ticket,
						progressiveUpload,
						parallelUploads: true,
						reservationBytes: 1_000_000_000,
					});
				if (url.pathname.includes("upload-multipart"))
					return json({ uploadId: "multipart", ...(partBytes ? { partBytes } : {}) });
				if (url.pathname.includes("upload-part/")) {
					const partNumber = Number(url.pathname.split("/").at(-1));
					const hash = createHash("sha256");
					let size = 0;
					for await (const chunk of init.body as unknown as AsyncIterable<Buffer>) {
						hash.update(chunk);
						size += chunk.length;
					}
					parts.push({ partNumber, hash: hash.digest("hex"), size });
					return json({ partNumber, etag: `version-${parts.length}` });
				}
				if (url.pathname.includes("upload-complete"))
					completed = JSON.parse(String(init.body));
				return json({});
			}),
		);
		return {
			paths,
			parts,
			get completed() {
				return completed;
			},
		};
	}

	it("uploads a complete range before export finishes and corrects bytes from a final remux path", async () => {
		const original = path.join(directory, "growing.mp4");
		const final = path.join(directory, "remuxed.mp4");
		const fileSize = MULTIPART_PART_BYTES + 8;
		await fs.writeFile(original, "");
		await fs.truncate(original, fileSize);
		await fs.copyFile(original, final);
		const handle = await fs.open(final, "r+");
		await handle.write(Buffer.from("final header"), 0, 12, 0);
		await handle.write(Buffer.from("new tail"), 0, 8, MULTIPART_PART_BYTES);
		await handle.close();
		const remote = server();
		const { ownerId, upload, onProgress } = start();
		observeShareExportSource(ownerId, original);
		await vi.waitFor(() => expect(remote.parts).toHaveLength(1), { timeout: 3000 });
		expect(remote.parts[0].size).toBe(MULTIPART_PART_BYTES);
		expect(remote.completed).toBeUndefined();
		expect(onProgress).not.toHaveBeenCalled();
		const result = await upload.finish(final);
		expect(result?.shareCode).toBe("abc123");
		// Already-uploaded bytes must be rebased onto the video, not the 1 GB reservation.
		expect(onProgress.mock.calls[0]).toEqual([MULTIPART_PART_BYTES, fileSize]);
		expect(onProgress).toHaveBeenLastCalledWith(fileSize, fileSize);
		expect(remote.parts.filter((part) => part.partNumber === 1)).toHaveLength(2);
		const finalBytes = await fs.readFile(final);
		for (const partNumber of [1, 2]) {
			const latest = remote.parts.filter((part) => part.partNumber === partNumber).at(-1);
			const expected = createHash("sha256")
				.update(
					finalBytes.subarray(
						(partNumber - 1) * MULTIPART_PART_BYTES,
						partNumber * MULTIPART_PART_BYTES,
					),
				)
				.digest("hex");
			expect(latest?.hash).toBe(expected);
		}
		expect(remote.completed?.finalSize).toBe(fileSize);
		expect(remote.completed?.parts.map((part) => part.partNumber)).toEqual([1, 2]);
		expect(
			remote.paths.some(
				(item) => item.includes("upload-abort") || item.includes("/api/delete/"),
			),
		).toBe(false);
	});
	it("reports progress against the final size for a video smaller than one part", async () => {
		const final = path.join(directory, "small.mp4");
		await fs.writeFile(final, Buffer.alloc(256 * 1024));
		server();
		const { upload, onProgress } = start();
		expect((await upload.finish(final))?.shareCode).toBe("abc123");
		expect(onProgress).toHaveBeenLastCalledWith(256 * 1024, 256 * 1024);
		expect(
			onProgress.mock.calls.every(([bytes, total]) => bytes <= total && total === 256 * 1024),
		).toBe(true);
	});

	it("starts transferring at 5 MiB when the server supports smaller parts", async () => {
		const partBytes = 5 * 1024 * 1024;
		const original = path.join(directory, "early.mp4");
		const fileSize = partBytes + 8;
		await fs.writeFile(original, "");
		await fs.truncate(original, fileSize);
		const remote = server(true, partBytes);
		const { ownerId, upload } = start();
		observeShareExportSource(ownerId, original);
		// This file is below the old 25 MiB threshold and export is still active.
		await vi.waitFor(() => expect(remote.parts).toHaveLength(1), { timeout: 3000 });
		expect(remote.parts[0].size).toBe(partBytes);
		expect(remote.completed).toBeUndefined();
		expect((await upload.finish(original))?.shareCode).toBe("abc123");
		expect(remote.parts.map((part) => part.size)).toEqual([partBytes, 8]);
		expect(remote.completed?.finalSize).toBe(fileSize);
	});

	it("deletes the reserved recording and returns fallback when the server lacks capability", async () => {
		const remote = server(false);
		const { upload } = start();
		expect(await upload.finish(path.join(directory, "unused.mp4"))).toBeUndefined();
		expect(remote.paths).toEqual(["/api/upload", "/api/delete/abc123"]);
		const calls = vi.mocked(fetch).mock.calls;
		expect(calls[1][1]?.method).toBe("DELETE");
	});

	it("aborts multipart and deletes the reservation when cancelled while waiting for export bytes", async () => {
		const remote = server();
		const { upload } = start();
		await vi.waitFor(() => expect(remote.paths).toContain("/api/upload-multipart/abc123"));
		await upload.cancel();
		expect(remote.parts).toHaveLength(0);
		expect(remote.paths).toContain("/api/upload-abort/abc123/multipart");
		expect(remote.paths).toContain("/api/delete/abc123");
		expect(remote.paths.some((item) => item.includes("upload-complete"))).toBe(false);
	});

	it("only observes export paths from the owning renderer and releases its observer", async () => {
		const original = path.join(directory, "owner.mp4");
		await fs.writeFile(original, "");
		await fs.truncate(original, MULTIPART_PART_BYTES);
		const remote = server();
		const { ownerId, upload, controller } = start();
		observeShareExportSource(ownerId + 1, original);
		await vi.waitFor(() => expect(remote.paths).toContain("/api/upload-multipart/abc123"));
		await new Promise((resolve) => setTimeout(resolve, 275));
		expect(remote.parts).toHaveLength(0);
		expect(() => start(ownerId)).toThrow("already active");
		observeShareExportSource(ownerId, original);
		await vi.waitFor(() => expect(remote.parts).toHaveLength(1), { timeout: 3000 });
		controller.abort();
		await upload.cancel();
		// A completed/cancelled owner can start another export without leaking paths.
		const replacement = start(ownerId);
		replacement.controller.abort();
		await replacement.upload.cancel();
	});
	it("removes faststart only for the observed export and restores it after cancellation", async () => {
		const observed = path.join(directory, "active.mp4");
		const other = path.join(directory, "other.mp4");
		const args = ["-i", "input.mp4", "-movflags", "+faststart", "-c:v", "copy", observed];
		const remote = server();
		const { ownerId, upload, controller } = start();
		observeShareExportSource(ownerId + 1, observed);
		expect(progressiveShareFfmpegArgs(args)).toEqual(args);
		observeShareExportSource(ownerId, observed);
		expect(progressiveShareFfmpegArgs(args)).toEqual([
			"-i",
			"input.mp4",
			"-c:v",
			"copy",
			observed,
		]);
		const otherArgs = [...args.slice(0, -1), other];
		expect(progressiveShareFfmpegArgs(otherArgs)).toEqual(otherArgs);
		// Different movflags remain meaningful for the observed file.
		const fragmented = ["-movflags", "+frag_keyframe", observed];
		expect(progressiveShareFfmpegArgs(fragmented)).toEqual(fragmented);
		await vi.waitFor(() => expect(remote.paths).toContain("/api/upload-multipart/abc123"));
		controller.abort();
		await upload.cancel();
		expect(progressiveShareFfmpegArgs(args)).toEqual(args);
	});
	it("transfers the observed output to the trusted audio remux successor", async () => {
		server();
		const { ownerId, upload } = start();
		const videoOnly = path.join(directory, "video-only.mp4");
		const finalAudio = path.join(directory, "final-audio.mp4");
		const args = (filePath: string) => ["-y", "-movflags", "+faststart", filePath];
		observeShareExportSource(ownerId, videoOnly);
		replaceShareExportSource(videoOnly, finalAudio);
		expect(progressiveShareFfmpegArgs(args(videoOnly))).toEqual(args(videoOnly));
		expect(progressiveShareFfmpegArgs(args(finalAudio))).toEqual(["-y", finalAudio]);
		await upload.cancel();
	});
});
