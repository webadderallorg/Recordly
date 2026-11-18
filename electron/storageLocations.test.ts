import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const userDataPath = path.join(os.tmpdir(), `recordly-storage-${process.pid}`);
const systemPaths: Record<string, string> = {
	temp: path.join(os.tmpdir(), "recordly-system-temp"),
	downloads: path.join(os.tmpdir(), "recordly-system-downloads"),
};

// `vi.hoisted` keeps the mocked module in place before the import graph runs.
const mocked = vi.hoisted(() => ({ userDataPath: "", systemTemp: "", downloads: "" }));

vi.mock("electron", () => ({
	app: {
		getPath: (name: string) => {
			if (name === "userData") return mocked.userDataPath;
			if (name === "temp") return mocked.systemTemp;
			if (name === "downloads") return mocked.downloads;
			return path.join(mocked.userDataPath, name);
		},
	},
}));

mocked.userDataPath = userDataPath;
mocked.systemTemp = systemPaths.temp;
mocked.downloads = systemPaths.downloads;

const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(
		temporaryDirectories.splice(0).map((directory) =>
			fs.rm(directory, { recursive: true, force: true }),
		),
	);
});

async function freshModule() {
	vi.resetModules();
	const directory = await fs.mkdtemp(path.join(os.tmpdir(), "recordly-storage-locations-"));
	temporaryDirectories.push(directory);
	mocked.userDataPath = directory;
	mocked.systemTemp = path.join(directory, "system-temp");
	mocked.downloads = path.join(directory, "system-downloads");
	return import("./storageLocations");
}

describe("storage locations", () => {
	it("falls back to the OS locations Recordly used before this setting", async () => {
		const storage = await freshModule();
		const folders = storage.describeStorageLocations();
		expect(folders.exports.value).toBe(mocked.downloads);
		expect(folders.temp.value).toBe(mocked.systemTemp);
		expect(folders.captionModels.value).toBe(path.join(mocked.userDataPath, "captions"));
		expect(folders.cache.value).toBe(mocked.userDataPath);
		for (const value of Object.values(folders)) expect(value.configured).toBe(false);
	});

	it("persists a chosen folder and reads it back on a later load", async () => {
		const storage = await freshModule();
		const target = path.join(mocked.userDataPath, "custom", "exports");
		const result = await storage.updateStorageLocations({ exports: target });

		expect(result.warnings).toEqual([]);
		expect(result.values.exports).toMatchObject({
			value: path.resolve(target),
			configured: true,
		});

		// A new module instance (next app launch) must see the stored value.
		vi.resetModules();
		const reloaded = await import("./storageLocations");
		expect(reloaded.getStorageLocation("exports")).toBe(path.resolve(target));
	});

	it("reports a folder it cannot create and keeps the previous value", async () => {
		const storage = await freshModule();
		const good = path.join(mocked.userDataPath, "good-temp");
		await storage.updateStorageLocations({ temp: good });

		// A file in the parent path makes creating the child directory impossible.
		const blocker = path.join(mocked.userDataPath, "blocker");
		await fs.writeFile(blocker, "not-a-directory");
		const result = await storage.updateStorageLocations({
			temp: path.join(blocker, "nested"),
		});

		expect(result.warnings).toHaveLength(1);
		expect(result.values.temp.value).toBe(path.resolve(good));
	});

	it("clears a single key and every key without touching the others", async () => {
		const storage = await freshModule();
		await storage.updateStorageLocations({
			exports: path.join(mocked.userDataPath, "out"),
			temp: path.join(mocked.userDataPath, "scratch"),
		});

		const single = await storage.updateStorageLocations({ exports: null });
		expect(single.values.exports.configured).toBe(false);
		expect(single.values.temp.configured).toBe(true);

		const reset = await storage.resetStorageLocations();
		expect(Object.values(reset.values).every((value) => !value.configured)).toBe(true);
	});

	it("exposes configured folders so local reads stay allowlisted", async () => {
		const storage = await freshModule();
		const target = path.join(mocked.userDataPath, "media");
		await storage.updateStorageLocations({ exports: target });
		expect(storage.getConfiguredStorageLocations()).toContain(path.resolve(target));
	});
});
