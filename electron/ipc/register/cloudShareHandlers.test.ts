import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ipcMain } from "electron";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
	app: { getAppPath: () => "/recordly" },
	ipcMain: { handle: vi.fn() },
}));
vi.mock("../export/exportStream", () => ({ isOwnedExportPath: vi.fn(() => true) }));
vi.mock("../project/manager", () => ({ isAllowedLocalReadPath: vi.fn(() => false) }));
vi.mock("../recording/shareThumbnail", () => ({
	createShareThumbnail: vi.fn(async () => Buffer.from("thumbnail")),
}));

import { isOwnedExportPath } from "../export/exportStream";
import { observeShareExportSource } from "../growingShareUpload";
import { createShareThumbnail } from "../recording/shareThumbnail";
import { registerCloudShareHandlers } from "./cloudShare";

const endpoint = "http://localhost:8787/api/upload";
const json = (value: unknown) => new Response(JSON.stringify(value));
class Sender extends EventEmitter {
	mainFrame = { url: "file:///recordly/dist/index.html?windowType=editor" };
	send = vi.fn();
	isDestroyed = () => false;
	constructor(public id: number) {
		super();
	}
}

describe("cloud share IPC lifecycle", () => {
	let directory: string;
	let finalPath: string;
	let owner: Sender;
	let stranger: Sender;
	let idCounter = 0;
	const senders: Sender[] = [];
	const gates: (() => void)[] = [];
	beforeEach(async () => {
		directory = await fs.mkdtemp(path.join(os.tmpdir(), "recordly-share-ipc-"));
		finalPath = path.join(directory, "export.mp4");
		await fs.writeFile(finalPath, "final video bytes");
		owner = new Sender(++idCounter);
		stranger = new Sender(++idCounter);
		senders.push(owner, stranger);
		vi.mocked(ipcMain.handle).mockClear();
		vi.mocked(isOwnedExportPath).mockReturnValue(true);
		vi.mocked(createShareThumbnail).mockReset().mockResolvedValue(Buffer.from("thumbnail"));
		registerCloudShareHandlers();
	});
	afterEach(async () => {
		for (const release of gates.splice(0)) release();
		for (const sender of senders.splice(0)) sender.emit("destroyed");
		await new Promise((resolve) => setTimeout(resolve, 20));
		vi.unstubAllGlobals();
		await fs.rm(directory, { recursive: true, force: true });
	});
	function call(channel: string, sender: Sender, input: unknown) {
		const handler = vi
			.mocked(ipcMain.handle)
			.mock.calls.find(([name]) => name === channel)?.[1];
		if (!handler) throw new Error(`Missing IPC handler ${channel}`);
		return handler(
			{ sender, senderFrame: sender.mainFrame } as unknown as Electron.IpcMainInvokeEvent,
			input,
		);
	}
	it.each([
		"cloud-share-begin-export",
		"cloud-share-manage",
		"cloud-share-upload",
	])("rejects foreign or embedded senders for %s", async (channel) => {
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
		const handler = vi.mocked(ipcMain.handle).mock.calls.find(([name]) => name === channel)![1];
		for (const foreign of [false, true]) {
			const frame = { url: foreign ? "https://foreign.test/" : owner.mainFrame.url };
			const senderFrame = frame;
			const sender = foreign ? Object.assign(owner, { mainFrame: frame }) : owner;
			expect(
				await handler({ sender, senderFrame } as unknown as Electron.IpcMainInvokeEvent, {
					endpoint,
					token: "token",
					action: "list",
					uploadId: crypto.randomUUID(),
				}),
			).toMatchObject({ success: false });
		}
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("does not let embedded frames cancel or replace credentials on an active upload", () => {
		server();
		const id = uploadId();
		expect(begin(id)).toEqual({ success: true });
		const foreignEvent = {
			sender: owner,
			senderFrame: { ...owner.mainFrame },
		} as unknown as Electron.IpcMainInvokeEvent;
		const update = vi
			.mocked(ipcMain.handle)
			.mock.calls.find(([name]) => name === "cloud-share-update-token")![1];
		const cancel = vi
			.mocked(ipcMain.handle)
			.mock.calls.find(([name]) => name === "cloud-share-cancel")![1];
		expect(update(foreignEvent, { uploadId: id, token: "foreign-token" })).toEqual({
			success: false,
		});
		expect(cancel(foreignEvent, id)).toEqual({ success: false });
		expect(
			call("cloud-share-update-token", owner, { uploadId: id, token: "new-token" }),
		).toEqual({ success: true });
		expect(call("cloud-share-cancel", owner, id)).toEqual({ success: true });
	});

	function uploadId() {
		return crypto.randomUUID();
	}
	function begin(id: string, sender = owner) {
		return call("cloud-share-begin-export", sender, {
			endpoint,
			token: "token",
			uploadId: id,
			title: "Video",
		});
	}
	function finish(id: string, sender = owner, filePath = finalPath) {
		return call("cloud-share-upload", sender, {
			endpoint,
			token: "token",
			uploadId: id,
			filePath,
			title: "Final title",
			notes: "Final notes",
		});
	}
	function server(holdMetadata = false, partBytes?: number) {
		const requests: { path: string; method?: string; body?: string }[] = [];
		let releaseMetadata: (() => void) | undefined;
		const metadataGate = holdMetadata
			? new Promise<void>((resolve) => {
					releaseMetadata = resolve;
					gates.push(resolve);
				})
			: Promise.resolve();
		vi.stubGlobal(
			"fetch",
			vi.fn(async (input: string | URL, init: RequestInit) => {
				const url = new URL(input);
				requests.push({
					path: url.pathname,
					method: init.method,
					body: typeof init.body === "string" ? init.body : undefined,
				});
				if (url.pathname === "/api/upload")
					return json({
						shareCode: "abc123",
						uploadURL: "http://localhost:8787/api/upload-data/abc123",
						shareURL: "http://localhost:8787/s/abc123",
						progressiveUpload: true,
						parallelUploads: true,
						reservationBytes: 100_000_000,
					});
				if (url.pathname.includes("upload-multipart"))
					return json({ uploadId: "multipart", ...(partBytes ? { partBytes } : {}) });
				if (url.pathname.includes("upload-part/")) {
					for await (const _chunk of init.body as unknown as AsyncIterable<Buffer>) {
						/* Drain the actual file range. */
					}
					return json({
						partNumber: Number(url.pathname.split("/").at(-1)),
						etag: "etag",
					});
				}
				if (url.pathname.includes("/api/metadata/")) await metadataGate;
				return json({});
			}),
		);
		return { requests, release: () => releaseMetadata?.() };
	}

	it("aborts a standalone upload when its owning renderer closes", async () => {
		const paths: string[] = [];
		let uploadSignal: AbortSignal | undefined;
		vi.stubGlobal(
			"fetch",
			vi.fn(async (input: string | URL, init: RequestInit) => {
				const url = new URL(input);
				paths.push(url.pathname);
				if (url.pathname === "/api/upload")
					return json({
						shareCode: "abc123",
						uploadURL: "http://localhost:8787/api/upload-data/abc123",
						shareURL: "http://localhost:8787/s/abc123",
					});
				if (url.pathname.includes("upload-data/")) {
					for await (const _chunk of init.body as unknown as AsyncIterable<Buffer>) {
						/* Drain the real file. */
					}
					uploadSignal = init.signal as AbortSignal;
					await new Promise<void>((_resolve, reject) => {
						const abort = () => reject(uploadSignal!.reason);
						gates.push(() => reject(new Error("Upload aborted during test cleanup")));
						if (uploadSignal!.aborted) abort();
						else uploadSignal!.addEventListener("abort", abort, { once: true });
					});
				}
				return json({});
			}),
		);
		const id = uploadId();
		const pending = finish(id);
		await vi.waitFor(() => expect(uploadSignal).toBeDefined());
		owner.emit("destroyed");
		expect(uploadSignal!.aborted).toBe(true);
		expect(await pending).toMatchObject({ success: false, canceled: true });
		expect(paths).not.toContain("/api/metadata/abc123");
		expect(owner.listenerCount("destroyed")).toBe(0);
		expect(call("cloud-share-update-token", owner, { uploadId: id, token: "new" })).toEqual({
			success: false,
		});
	});

	it.each([
		"success",
		"invalid file",
	])("cleans up standalone lifetime tracking after %s", async (outcome) => {
		server();
		const id = uploadId();
		const pending = finish(id, owner, outcome === "invalid file" ? "" : finalPath);
		// The listener must already exist before fs.realpath or any network await.
		// Invalid input may settle synchronously and have removed it already.
		if (outcome === "success") expect(owner.listenerCount("destroyed")).toBe(1);
		expect(await pending).toMatchObject({ success: outcome === "success" });
		expect(owner.listenerCount("destroyed")).toBe(0);
		expect(call("cloud-share-update-token", owner, { uploadId: id, token: "new" })).toEqual({
			success: false,
		});
	});

	it("hands one reservation from begin/export-source to final upload and publishes metadata", async () => {
		const remote = server();
		const id = uploadId();
		expect(await begin(id)).toEqual({ success: true });
		observeShareExportSource(owner.id, finalPath);
		expect(await finish(id)).toEqual({
			success: true,
			uploadId: id,
			shareUrl: "http://localhost:8787/s/abc123",
		});
		expect(remote.requests.filter((request) => request.path === "/api/upload")).toHaveLength(1);
		expect(
			remote.requests.filter((request) => request.path.includes("upload-multipart")),
		).toHaveLength(1);
		const metadata = remote.requests.find((request) => request.path === "/api/metadata/abc123");
		expect(JSON.parse(metadata?.body ?? "{}")).toEqual({
			title: "Final title",
			summary: "Final notes",
		});
		expect(
			remote.requests.findIndex((request) => request.path.includes("upload-complete")),
		).toBeLessThan(
			remote.requests.findIndex((request) => request.path.includes("/api/metadata/")),
		);
		expect(owner.send).toHaveBeenCalledWith(
			"cloud-share-progress",
			expect.objectContaining({ uploadId: id }),
		);
		expect(owner.listenerCount("destroyed")).toBe(0);
	});

	it("uses parallel multipart for finished clips below the old 50 MiB cutoff", async () => {
		const partBytes = 5 * 1024 * 1024;
		await fs.truncate(finalPath, partBytes * 2 + 16);
		const remote = server(false, partBytes);
		expect(await finish(uploadId())).toMatchObject({ success: true });
		expect(
			remote.requests.filter((request) => request.path.includes("upload-part/")),
		).toHaveLength(3);
		expect(remote.requests.some((request) => request.path.includes("upload-data/"))).toBe(
			false,
		);
	});

	it("prepares the poster while the video is still publishing", async () => {
		const remote = server(true);
		const id = uploadId();
		await begin(id);
		const pending = finish(id);
		await vi.waitFor(() =>
			expect(remote.requests.some((request) => request.path === "/api/metadata/abc123")).toBe(
				true,
			),
		);
		// The metadata request is blocked; sequential poster generation would not start yet.
		expect(createShareThumbnail).toHaveBeenCalledWith(
			await fs.realpath(finalPath),
			expect.any(AbortSignal),
		);
		remote.release();
		expect(await pending).toMatchObject({ success: true });
	});

	it("cancels and deletes a reservation before the export produces a final result", async () => {
		const remote = server();
		const id = uploadId();
		await begin(id);
		await vi.waitFor(() =>
			expect(
				remote.requests.some((request) => request.path.includes("upload-multipart")),
			).toBe(true),
		);
		expect(await call("cloud-share-cancel", owner, id)).toEqual({ success: true });
		await vi.waitFor(() =>
			expect(remote.requests.some((request) => request.path === "/api/delete/abc123")).toBe(
				true,
			),
		);
		expect(remote.requests.some((request) => request.path.includes("upload-abort"))).toBe(true);
		expect(remote.requests.some((request) => request.path.includes("/api/metadata/"))).toBe(
			false,
		);
		expect(owner.listenerCount("destroyed")).toBe(0);
		expect(
			await call("cloud-share-update-token", owner, { uploadId: id, token: "new" }),
		).toEqual({ success: false });
	});

	it("rejects another owner's finalize/cancel without disrupting the owner's reservation", async () => {
		const remote = server();
		const id = uploadId();
		await begin(id);
		expect(await finish(id, stranger)).toMatchObject({
			success: false,
			error: "This upload is already in progress.",
		});
		expect(await call("cloud-share-cancel", stranger, id)).toEqual({ success: false });
		expect(
			await call("cloud-share-update-token", owner, { uploadId: id, token: "refreshed" }),
		).toEqual({ success: true });
		expect(await finish(id)).toMatchObject({ success: true });
		expect(remote.requests.filter((request) => request.path === "/api/upload")).toHaveLength(1);
	});

	it("rejects duplicate begin and concurrent finalize while the first request publishes", async () => {
		const remote = server(true);
		const id = uploadId();
		await begin(id);
		expect(await begin(id)).toEqual({ success: false });
		expect(await begin(uploadId())).toEqual({ success: false });
		const pending = finish(id);
		await vi.waitFor(() =>
			expect(remote.requests.some((request) => request.path === "/api/metadata/abc123")).toBe(
				true,
			),
		);
		expect(await finish(id)).toMatchObject({
			success: false,
			error: "This upload is already in progress.",
		});
		remote.release();
		expect(await pending).toMatchObject({ success: true });
		expect(
			remote.requests.filter((request) => request.path === "/api/metadata/abc123"),
		).toHaveLength(1);
	});

	it.each([
		"missing",
		"unapproved",
		"empty",
	])("cleans up a progressive session after a %s final path", async (kind) => {
		const remote = server();
		const id = uploadId();
		await begin(id);
		await vi.waitFor(() =>
			expect(
				remote.requests.some((request) => request.path.includes("upload-multipart")),
			).toBe(true),
		);
		if (kind === "unapproved") vi.mocked(isOwnedExportPath).mockReturnValue(false);
		const filePath =
			kind === "missing"
				? path.join(directory, "missing.mp4")
				: kind === "empty"
					? ""
					: finalPath;
		expect(await finish(id, owner, filePath)).toMatchObject({ success: false });
		await vi.waitFor(() =>
			expect(remote.requests.some((request) => request.path === "/api/delete/abc123")).toBe(
				true,
			),
		);
		expect(owner.listenerCount("destroyed")).toBe(0);
	});
	it.each([
		"upload error",
		"cancel",
		"cleanup failure",
	])("discards a standalone reservation after %s before finalization", async (failure) => {
		const id = uploadId();
		const requests: { path: string; init: RequestInit }[] = [];
		vi.stubGlobal(
			"fetch",
			vi.fn(async (input: string | URL, init: RequestInit) => {
				const url = new URL(input);
				requests.push({ path: url.pathname, init });
				if (url.pathname === "/api/upload")
					return json({
						shareCode: "abc123",
						uploadURL: "http://localhost:8787/api/upload-data/abc123",
						shareURL: "http://localhost:8787/s/abc123",
					});
				if (url.pathname.includes("upload-data/")) {
					for await (const _chunk of init.body as unknown as AsyncIterable<Buffer>) {
						/* Drain actual bytes. */
					}
					expect(
						call("cloud-share-update-token", owner, {
							uploadId: id,
							token: "fresh-owner-token",
						}),
					).toEqual({ success: true });
					if (failure === "cancel") {
						call("cloud-share-cancel", owner, id);
						throw init.signal!.reason;
					}
					return new Response(JSON.stringify({ error: "Injected upload error" }), {
						status: 503,
					});
				}
				if (failure === "cleanup failure" && url.pathname.startsWith("/api/delete/"))
					return new Response("Cleanup unavailable", { status: 503 });
				return json({});
			}),
		);
		const result = await finish(id);
		expect(result).toMatchObject({ success: false });
		if (failure !== "cancel") expect(result.error).toBe("Injected upload error");
		else expect(result.canceled).toBe(true);
		const cleanup = requests.filter((request) => request.path === "/api/delete/abc123");
		expect(cleanup).toHaveLength(1);
		expect(cleanup[0].init).toMatchObject({
			method: "DELETE",
			headers: { authorization: "Bearer fresh-owner-token" },
			redirect: "error",
		});
		expect(cleanup[0].init.signal!.aborted).toBe(false);
		expect(requests.some((request) => request.path.includes("/api/metadata/"))).toBe(false);
	});

	it.each([
		"success",
		"finalization failure",
		"lost finalization response",
	])("preserves a recording after %s", async (outcome) => {
		const paths: string[] = [];
		vi.stubGlobal(
			"fetch",
			vi.fn(async (input: string | URL, init: RequestInit) => {
				const url = new URL(input);
				paths.push(url.pathname);
				if (url.pathname === "/api/upload")
					return json({
						shareCode: "abc123",
						uploadURL: "http://localhost:8787/api/upload-data/abc123",
						shareURL: "http://localhost:8787/s/abc123",
					});
				if (url.pathname.includes("upload-data/"))
					for await (const _chunk of init.body as unknown as AsyncIterable<Buffer>) {
						/* Drain actual bytes. */
					}
				if (url.pathname.includes("/api/metadata/")) {
					if (outcome === "finalization failure")
						return new Response("failed", { status: 503 });
					if (outcome === "lost finalization response")
						throw new Error("Connection lost after metadata may have committed");
				}
				return json({});
			}),
		);
		expect(await finish(uploadId())).toMatchObject({ success: outcome === "success" });
		expect(paths).toContain("/api/metadata/abc123");
		expect(paths.some((path) => path.includes("/api/delete/"))).toBe(false);
	});

	it.each([
		"view",
		"finalization",
		"upload",
	])("never sends reservation cleanup for an external %s URL", async (external) => {
		const paths: string[] = [];
		vi.stubGlobal(
			"fetch",
			vi.fn(async (input: string | URL, init: RequestInit) => {
				const url = new URL(input);
				paths.push(url.pathname);
				if (url.pathname === "/api/upload")
					return json({
						shareCode: "abc123",
						uploadURL: `${external === "upload" ? "https://external.test" : "http://localhost:8787"}/api/upload-data/abc123`,
						shareURL: `${external === "view" ? "https://external.test" : "http://localhost:8787"}/s/abc123`,
						...(external === "finalization"
							? { finalizeUrl: "https://external.test/finalize" }
							: {}),
					});
				if (url.hostname === "external.test") {
					expect((init.headers as Record<string, string>).authorization).toBeUndefined();
					for await (const _chunk of init.body as unknown as AsyncIterable<Buffer>) {
						/* Drain actual bytes. */
					}
					throw new Error("External upload failed");
				}
				return json({});
			}),
		);
		expect(await finish(uploadId())).toMatchObject({ success: false });
		expect(paths.some((path) => path.includes("/api/delete/"))).toBe(false);
	});

	it("cleans the fresh standalone fallback reservation separately from the failed progressive session", async () => {
		const paths: string[] = [];
		let reservations = 0;
		vi.stubGlobal(
			"fetch",
			vi.fn(async (input: string | URL, init: RequestInit) => {
				const url = new URL(input);
				paths.push(url.pathname);
				if (url.pathname === "/api/upload") {
					const code = ++reservations === 1 ? "abc123" : "def456";
					return json({
						shareCode: code,
						uploadURL: `http://localhost:8787/api/upload-data/${code}`,
						shareURL: `http://localhost:8787/s/${code}`,
						progressiveUpload: false,
					});
				}
				if (url.pathname.includes("upload-data/")) {
					for await (const _chunk of init.body as unknown as AsyncIterable<Buffer>) {
						/* Drain actual bytes. */
					}
					return new Response(JSON.stringify({ error: "Fallback upload failed" }), {
						status: 503,
					});
				}
				return json({});
			}),
		);
		const id = uploadId();
		expect(begin(id)).toEqual({ success: true });
		expect(await finish(id)).toMatchObject({ success: false, error: "Fallback upload failed" });
		expect(paths.filter((path) => path === "/api/delete/abc123")).toHaveLength(1);
		expect(paths.filter((path) => path === "/api/delete/def456")).toHaveLength(1);
	});
});
