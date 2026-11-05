import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MULTIPART_PART_BYTES, uploadMultipart } from "./cloudShareMultipart";

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function consume(init?: RequestInit) {
	let size = 0;
	for await (const chunk of init?.body as unknown as AsyncIterable<Buffer>) size += chunk.length;
	return size;
}

describe("parallel multipart upload", () => {
	let directory: string;
	let filePath: string;
	beforeEach(async () => {
		directory = await fs.mkdtemp(path.join(os.tmpdir(), "recordly-upload-"));
		filePath = path.join(directory, "video.mp4");
		await fs.writeFile(filePath, "");
	});
	afterEach(async () => {
		vi.unstubAllGlobals();
		await fs.rm(directory, { recursive: true, force: true });
	});
	function options(fileSize: number) {
		return {
			endpoint: "http://localhost:8787/api/upload",
			shareCode: "video",
			filePath,
			fileSize,
			contentType: "video/mp4",
			getToken: () => "token",
			signal: new AbortController().signal,
			onProgress: vi.fn(),
		};
	}

	it("keeps three parts in flight, uploads exact ranges, and completes in sorted order", async () => {
		const fileSize = MULTIPART_PART_BYTES * 3 + 17;
		await fs.truncate(filePath, fileSize);
		let active = 0;
		let peak = 0;
		const sizes: number[] = [];
		const completed: number[] = [];
		let manifest: unknown;
		vi.stubGlobal(
			"fetch",
			vi.fn(async (input: URL, init: RequestInit) => {
				if (input.pathname.includes("upload-multipart")) return json({ uploadId: "id" });
				if (input.pathname.includes("upload-part/")) {
					const partNumber = Number(input.pathname.split("/").at(-1));
					active += 1;
					peak = Math.max(peak, active);
					sizes[partNumber - 1] = await consume(init);
					await delay(partNumber === 1 ? 40 : 1);
					active -= 1;
					completed.push(partNumber);
					return json({ partNumber, etag: `etag-${partNumber}` });
				}
				manifest = JSON.parse(String(init.body));
				return json({});
			}),
		);
		const input = options(fileSize);
		await uploadMultipart(input);
		expect(peak).toBe(3);
		expect(sizes).toEqual([
			MULTIPART_PART_BYTES,
			MULTIPART_PART_BYTES,
			MULTIPART_PART_BYTES,
			17,
		]);
		expect(completed[0]).not.toBe(1);
		expect(manifest).toEqual({
			parts: [1, 2, 3, 4].map((partNumber) => ({ partNumber, etag: `etag-${partNumber}` })),
		});
		const progress = input.onProgress.mock.calls.map(([bytes]) => bytes);
		expect(progress.at(-1)).toBe(fileSize);
		expect(progress.every((bytes, index) => index === 0 || bytes >= progress[index - 1])).toBe(
			true,
		);
	});

	it("retries a transient error with refreshed auth without counting bytes twice", async () => {
		await fs.writeFile(filePath, Buffer.alloc(100));
		let token = "old";
		const tokens: string[] = [];
		let attempts = 0;
		vi.stubGlobal(
			"fetch",
			vi.fn(async (input: URL, init: RequestInit) => {
				if (input.pathname.includes("upload-multipart")) return json({ uploadId: "id" });
				if (input.pathname.includes("upload-part/")) {
					tokens.push((init.headers as Record<string, string>).authorization);
					await consume(init);
					if (++attempts === 1) {
						token = "fresh";
						return json({ error: "expired" }, 401);
					}
					return json({ partNumber: 1, etag: "ok" });
				}
				return json({});
			}),
		);
		const input = { ...options(100), getToken: () => token };
		await uploadMultipart(input);
		expect(tokens).toEqual(["Bearer old", "Bearer fresh"]);
		expect(input.onProgress.mock.calls.map(([bytes]) => bytes)).toEqual([100]);
	});

	it("aborts and settles sibling requests before cleaning up a fatal upload", async () => {
		await fs.truncate(filePath, MULTIPART_PART_BYTES * 3);
		let active = 0;
		let aborts = 0;
		let completed = false;
		vi.stubGlobal(
			"fetch",
			vi.fn(async (input: URL, init: RequestInit) => {
				if (input.pathname.includes("upload-multipart")) return json({ uploadId: "id" });
				if (input.pathname.includes("upload-part/")) {
					const partNumber = Number(input.pathname.split("/").at(-1));
					active += 1;
					try {
						await consume(init);
						if (partNumber === 1) return json({ error: "forbidden" }, 403);
						await new Promise<void>((_resolve, reject) => {
							if (init.signal?.aborted) reject(init.signal.reason);
							else
								init.signal?.addEventListener(
									"abort",
									() => reject(init.signal?.reason),
									{ once: true },
								);
						});
						return json({ partNumber, etag: "ok" });
					} finally {
						active -= 1;
					}
				}
				if (input.pathname.includes("upload-abort")) {
					expect(active).toBe(0);
					aborts += 1;
				}
				if (input.pathname.includes("upload-complete")) completed = true;
				return json({});
			}),
		);
		await expect(uploadMultipart(options(MULTIPART_PART_BYTES * 3))).rejects.toThrow(
			"forbidden",
		);
		expect(aborts).toBe(1);
		expect(completed).toBe(false);
	});

	it("compares uploaded content with the final artifact and replaces patched parts", async () => {
		await fs.writeFile(filePath, "original");
		const finalPath = path.join(directory, "final.mp4");
		await fs.writeFile(finalPath, "finalized");
		const bodies: string[] = [];
		let manifest: unknown;
		vi.stubGlobal(
			"fetch",
			vi.fn(async (input: URL, init: RequestInit) => {
				if (input.pathname.includes("upload-multipart")) return json({ uploadId: "id" });
				if (input.pathname.includes("upload-part/")) {
					const chunks: Buffer[] = [];
					for await (const chunk of init.body as unknown as AsyncIterable<Buffer>)
						chunks.push(chunk);
					bodies.push(Buffer.concat(chunks).toString());
					return json({ partNumber: 1, etag: `version-${bodies.length}` });
				}
				manifest = JSON.parse(String(init.body));
				return json({});
			}),
		);
		await uploadMultipart({
			...options(MULTIPART_PART_BYTES),
			source: {
				getPart: async () => ({ filePath, size: 8 }),
				finalize: async () => ({ fileSize: 9, filePath: finalPath }),
			},
		});
		expect(bodies).toEqual(["original", "finalized"]);
		expect(manifest).toEqual({ parts: [{ partNumber: 1, etag: "version-2" }], finalSize: 9 });
	});
	it("uploads missing final parts while retaining unchanged uploaded parts", async () => {
		await fs.writeFile(filePath, "same");
		let uploads = 0;
		let getPartCalls = 0;
		vi.stubGlobal(
			"fetch",
			vi.fn(async (input: URL, init: RequestInit) => {
				if (input.pathname.includes("upload-multipart")) return json({ uploadId: "id" });
				if (input.pathname.includes("upload-part/")) {
					await consume(init);
					uploads += 1;
					return json({ partNumber: 1, etag: "same" });
				}
				return json({});
			}),
		);
		const source = {
			getPart: async () => {
				getPartCalls += 1;
				return { filePath, size: 4 };
			},
			finalize: async () => ({ filePath, fileSize: 4 }),
		};
		await uploadMultipart({ ...options(MULTIPART_PART_BYTES), source });
		expect(uploads).toBe(1);
		expect(getPartCalls).toBe(1);
		await uploadMultipart({
			...options(MULTIPART_PART_BYTES),
			source: { ...source, getPart: async () => null },
		});
		expect(uploads).toBe(2);
	});

	it("cancels sources waiting for more export data before remote cleanup", async () => {
		const controller = new AbortController();
		let cleanup = false;
		vi.stubGlobal(
			"fetch",
			vi.fn(async (input: URL) => {
				if (input.pathname.includes("upload-multipart")) return json({ uploadId: "id" });
				if (input.pathname.includes("upload-abort")) cleanup = true;
				return json({});
			}),
		);
		const promise = uploadMultipart({
			...options(MULTIPART_PART_BYTES),
			signal: controller.signal,
			source: {
				getPart: async (_index, signal) => {
					controller.abort(new Error("User cancelled"));
					signal.throwIfAborted();
					return null;
				},
				finalize: vi.fn(),
			},
		});
		await expect(promise).rejects.toThrow("User cancelled");
		expect(cleanup).toBe(true);
	});
	it("detects a final patch beyond the header without reuploading unchanged ranges", async () => {
		const fileSize = MULTIPART_PART_BYTES + 8;
		await fs.truncate(filePath, fileSize);
		const finalPath = path.join(directory, "patched.mp4");
		await fs.copyFile(filePath, finalPath);
		const handle = await fs.open(finalPath, "r+");
		await handle.write(Buffer.from("patched!"), 0, 8, MULTIPART_PART_BYTES);
		await handle.close();
		const uploads: number[] = [];
		vi.stubGlobal(
			"fetch",
			vi.fn(async (input: URL, init: RequestInit) => {
				if (input.pathname.includes("upload-multipart")) return json({ uploadId: "id" });
				if (input.pathname.includes("upload-part/")) {
					const partNumber = Number(input.pathname.split("/").at(-1));
					await consume(init);
					uploads.push(partNumber);
					return json({ partNumber, etag: `version-${uploads.length}` });
				}
				return json({});
			}),
		);
		await uploadMultipart({
			...options(fileSize),
			source: {
				getPart: async (index) => ({
					filePath,
					size: Math.min(MULTIPART_PART_BYTES, fileSize - index * MULTIPART_PART_BYTES),
				}),
				finalize: async () => ({ filePath: finalPath, fileSize }),
			},
		});
		expect(uploads.filter((part) => part === 1)).toHaveLength(1);
		expect(uploads.filter((part) => part === 2)).toHaveLength(2);
	});
});
