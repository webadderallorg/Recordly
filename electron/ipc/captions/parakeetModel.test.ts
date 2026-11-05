import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ userData: "", requests: 0 }));
vi.mock("electron", () => ({ app: { getPath: () => state.userData } }));
vi.mock("node:https", () => ({
	get: (
		_url: string,
		_options: unknown,
		callback: (response: unknown) => void,
	) => {
		state.requests += 1;
		const request = new EventEmitter();
		queueMicrotask(() => {
			const response = Object.assign(
				Readable.from([Buffer.from("truncated model")]),
				{
					statusCode: 200,
					headers: {},
				},
			);
			callback(response);
		});
		return request;
	},
}));

import {
	assertParakeetModelDirectory,
	deleteParakeetModel,
	downloadParakeetModel,
	getParakeetModelStatus,
	PARAKEET_MODEL_FILES,
	PARAKEET_MODEL_REVISION,
} from "./parakeetModel";

const sender = () =>
	({
		isDestroyed: () => false,
		send: vi.fn(),
	}) as unknown as Electron.WebContents;
const directory = () =>
	path.join(state.userData, "captions", "parakeet-tdt-0.6b-v3-int8");

async function createInstalledModel() {
	await fs.mkdir(directory(), { recursive: true });
	await fs.writeFile(
		path.join(directory(), "recordly-model.json"),
		JSON.stringify({ revision: PARAKEET_MODEL_REVISION, verified: true }),
	);
	// Sparse files verify the readiness/length contract without allocating model data.
	for (const file of PARAKEET_MODEL_FILES) {
		const handle = await fs.open(path.join(directory(), file.name), "w");
		await handle.truncate(file.size);
		await handle.close();
	}
}

beforeEach(async () => {
	state.userData = await fs.mkdtemp(
		path.join(os.tmpdir(), "recordly-parakeet-model-test-"),
	);
	state.requests = 0;
});
afterEach(async () => {
	await fs.rm(state.userData, { recursive: true, force: true });
});

describe("Parakeet model installation", () => {
	it("rejects unverified directories even if their files exist", async () => {
		await createInstalledModel();
		await fs.rm(path.join(directory(), "recordly-model.json"));
		expect(await getParakeetModelStatus()).toEqual({
			success: true,
			exists: false,
			path: null,
		});
		await expect(assertParakeetModelDirectory(directory())).rejects.toThrow();
	});

	it("requires the pinned revision and every complete model component", async () => {
		await createInstalledModel();
		await expect(
			assertParakeetModelDirectory(directory()),
		).resolves.toBeUndefined();
		await fs.truncate(path.join(directory(), "decoder.int8.onnx"), 12);
		await expect(assertParakeetModelDirectory(directory())).rejects.toThrow(
			"decoder.int8.onnx",
		);
		await fs.writeFile(
			path.join(directory(), "recordly-model.json"),
			JSON.stringify({ revision: "old", verified: true }),
		);
		await expect(assertParakeetModelDirectory(directory())).rejects.toThrow(
			"outdated",
		);
	});

	it("shares installation across windows and reuses a ready model without network", async () => {
		await createInstalledModel();
		const first = sender();
		const second = sender();
		expect(
			await Promise.all([
				downloadParakeetModel(first),
				downloadParakeetModel(second),
			]),
		).toEqual([directory(), directory()]);
		expect(state.requests).toBe(0);
		expect(first.send).toHaveBeenCalledWith(
			"parakeet-model-download-progress",
			{ status: "downloaded", progress: 100, path: directory() },
		);
		expect(second.send).toHaveBeenCalledWith(
			"parakeet-model-download-progress",
			{ status: "downloaded", progress: 100, path: directory() },
		);
	});

	it("rejects truncated downloads, removes staging files, and prevents deletion races", async () => {
		const pending = downloadParakeetModel(sender());
		await expect(deleteParakeetModel()).rejects.toThrow("download");
		await expect(pending).rejects.toThrow("integrity check");
		expect(await getParakeetModelStatus()).toEqual({
			success: true,
			exists: false,
			path: null,
		});
		expect(await fs.readdir(path.dirname(directory()))).toEqual([]);
	});

	it("does not abort shared work when its initiating window closes", async () => {
		await createInstalledModel();
		const closed = sender();
		vi.mocked(closed.send).mockImplementation(() => {
			throw new Error("Object has been destroyed");
		});
		await expect(downloadParakeetModel(closed)).resolves.toBe(directory());
	});

	it("deletes only the Parakeet installation", async () => {
		await createInstalledModel();
		await fs.writeFile(
			path.join(state.userData, "keep.txt"),
			"other user data",
		);
		await deleteParakeetModel();
		expect(await getParakeetModelStatus()).toEqual({
			success: true,
			exists: false,
			path: null,
		});
		expect(
			await fs.readFile(path.join(state.userData, "keep.txt"), "utf8"),
		).toBe("other user data");
	});
});
