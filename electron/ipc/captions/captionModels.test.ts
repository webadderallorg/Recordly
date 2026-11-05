import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	userData: "",
	requests: [] as string[],
	body: "truncated",
	status: 200,
	location: undefined as string | undefined,
	delay: false,
	respond: undefined as (() => void) | undefined,
}));
vi.mock("electron", () => ({ app: { getPath: () => state.userData } }));
vi.mock("node:https", () => ({
	get: (url: string, _options: unknown, callback: (response: unknown) => void) => {
		state.requests.push(url);
		const request = Object.assign(new EventEmitter(), { destroy: vi.fn() });
		const respond = () =>
			callback(
				Object.assign(Readable.from([Buffer.from(state.body)]), {
					statusCode: state.status,
					headers: { location: state.location },
				}),
			);
		if (state.delay) state.respond = respond;
		else queueMicrotask(respond);
		return request;
	},
}));

import {
	deleteCaptionModel,
	downloadCaptionModel,
	downloadVerifiedCaptionFile,
	getCaptionModelStatus,
	resolveInstalledCaptionModel,
	WHISPER_CAPTION_FILES,
	WHISPER_MODEL_REVISION,
} from "./captionModels";

const sender = () =>
	({ isDestroyed: () => false, send: vi.fn() }) as unknown as Electron.WebContents;
beforeEach(async () => {
	state.userData = await fs.mkdtemp(path.join(os.tmpdir(), "recordly-caption-model-test-"));
	state.requests = [];
	state.body = "truncated";
	state.status = 200;
	state.location = undefined;
	state.delay = false;
	state.respond = undefined;
});
afterEach(async () => {
	await fs.rm(state.userData, { recursive: true, force: true });
});
async function installed(id: "whisper-base" | "whisper-small") {
	const dir = path.join(state.userData, "captions", id);
	await fs.mkdir(dir, { recursive: true });
	const file = WHISPER_CAPTION_FILES[id];
	await fs.writeFile(
		path.join(dir, "recordly-model.json"),
		JSON.stringify({ revision: WHISPER_MODEL_REVISION, sha256: file.sha256, verified: true }),
	);
	const handle = await fs.open(path.join(dir, file.name), "w");
	await handle.truncate(file.size);
	await handle.close();
	return { dir, file: file.name, filePath: path.join(dir, file.name) };
}
it("offers only known models and complete installations", async () => {
	await expect(getCaptionModelStatus("../../outside")).rejects.toThrow("Unknown");
	expect(await getCaptionModelStatus("whisper-base")).toEqual({
		success: true,
		exists: false,
		path: null,
	});
	const fixture = await installed("whisper-base");
	expect(await resolveInstalledCaptionModel("whisper-base")).toEqual({
		id: "whisper-base",
		engine: "whisper",
		path: fixture.filePath,
	});
	await fs.truncate(fixture.filePath, 3);
	expect((await getCaptionModelStatus("whisper-base")).exists).toBe(false);
	await expect(resolveInstalledCaptionModel("whisper-base")).rejects.toThrow("Download");
});
it("never exposes failed or truncated downloads and allows a later retry", async () => {
	const window = sender();
	await expect(downloadCaptionModel("whisper-base", window)).rejects.toThrow("integrity");
	expect((await getCaptionModelStatus("whisper-base")).exists).toBe(false);
	expect(await fs.readdir(path.join(state.userData, "captions"))).toEqual([]);
	await expect(downloadCaptionModel("whisper-base", window)).rejects.toThrow("integrity");
	expect(state.requests).toHaveLength(2);
	expect(state.requests[0]).toContain(`/${WHISPER_MODEL_REVISION}/ggml-base.bin`);
	expect(window.send).toHaveBeenCalledWith(
		"caption-model-download-progress",
		expect.objectContaining({ modelId: "whisper-base", status: "error" }),
	);
});
it("shares one download across windows and refuses deletion until it finishes", async () => {
	state.delay = true;
	const first = sender();
	const second = sender();
	const a = downloadCaptionModel("whisper-small", first);
	const b = downloadCaptionModel("whisper-small", second);
	const results = Promise.allSettled([a, b]);
	await vi.waitFor(() => expect(state.respond).toBeTypeOf("function"));
	expect(state.requests).toHaveLength(1);
	await expect(deleteCaptionModel("whisper-small")).rejects.toThrow("download");
	state.respond!();
	expect((await results).map((result) => result.status)).toEqual(["rejected", "rejected"]);
	expect(first.send).toHaveBeenCalledWith(
		"caption-model-download-progress",
		expect.objectContaining({ modelId: "whisper-small", status: "error" }),
	);
	expect(second.send).toHaveBeenCalledWith(
		"caption-model-download-progress",
		expect.objectContaining({ modelId: "whisper-small", status: "error" }),
	);
});
it("reuses installed models and deletes only the selected model", async () => {
	const base = await installed("whisper-base");
	const small = await installed("whisper-small");
	expect(await downloadCaptionModel("whisper-base", sender())).toBe(base.filePath);
	expect(state.requests).toHaveLength(0);
	await deleteCaptionModel("whisper-base");
	expect((await getCaptionModelStatus("whisper-base")).exists).toBe(false);
	expect((await getCaptionModelStatus("whisper-small")).path).toBe(small.filePath);
});
it("verifies both streamed length and SHA256 before accepting a file", async () => {
	state.body = "verified fixture";
	const spec = {
		size: Buffer.byteLength(state.body),
		sha256: createHash("sha256").update(state.body).digest("hex"),
	};
	const file = path.join(state.userData, "model.bin");
	await downloadVerifiedCaptionFile("https://models.test/model", file, spec, () => undefined);
	expect(await fs.readFile(file, "utf8")).toBe(state.body);
	await fs.rm(file);
	await expect(
		downloadVerifiedCaptionFile(
			"https://models.test/model",
			file,
			{ ...spec, sha256: "0".repeat(64) },
			() => undefined,
		),
	).rejects.toThrow("integrity");
});
it("rejects HTTPS downgrades during redirects", async () => {
	state.status = 302;
	state.location = "http://models.test/model";
	await expect(
		downloadVerifiedCaptionFile(
			"https://models.test/model",
			path.join(state.userData, "bad.bin"),
			{ size: 1, sha256: "" },
			() => undefined,
		),
	).rejects.toThrow("HTTPS");
});
