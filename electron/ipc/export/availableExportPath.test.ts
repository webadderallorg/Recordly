import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getAvailableExportPath, saveExportToAvailablePath } from "./availableExportPath";

const tempDirs: string[] = [];

async function makeTempDir() {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "recordly-export-name-"));
	tempDirs.push(dir);
	return dir;
}

afterEach(async () => {
	vi.restoreAllMocks();
	await Promise.all(
		tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })),
	);
});

describe("getAvailableExportPath", () => {
	it.each([
		"mp4",
		"gif",
	])("numbers repeated %s exports and preserves previous files", async (ext) => {
		const dir = await makeTempDir();
		const requested = path.join(dir, `Untitled Project.${ext}`);
		for (const suffix of ["", " 1", " 2"]) {
			const available = await getAvailableExportPath(requested);
			expect(available).toBe(path.join(dir, `Untitled Project${suffix}.${ext}`));
			await fs.writeFile(available, `export${suffix}`, { flag: "wx" });
		}
		await expect(fs.readFile(requested, "utf8")).resolves.toBe("export");
		await expect(
			fs.readFile(path.join(dir, `Untitled Project 1.${ext}`), "utf8"),
		).resolves.toBe("export 1");
	});

	it("uses an available gap and preserves dots and numbers in project titles", async () => {
		const dir = await makeTempDir();
		const requested = path.join(dir, "Demo.v2 2026.mp4");
		await fs.writeFile(requested, "original");
		await fs.writeFile(path.join(dir, "Demo.v2 2026 2.mp4"), "other");
		await expect(getAvailableExportPath(requested)).resolves.toBe(
			path.join(dir, "Demo.v2 2026 1.mp4"),
		);
	});

	it.skipIf(process.platform === "win32")(
		"treats directories and dangling symlinks as occupied names",
		async () => {
			const dir = await makeTempDir();
			const requested = path.join(dir, "Untitled Project.mp4");
			await fs.mkdir(requested);
			await fs.symlink(
				path.join(dir, "missing.mp4"),
				path.join(dir, "Untitled Project 1.mp4"),
			);
			await expect(getAvailableExportPath(requested)).resolves.toBe(
				path.join(dir, "Untitled Project 2.mp4"),
			);
		},
	);

	it("does not treat filesystem access failures as a free filename", async () => {
		const error = Object.assign(new Error("Permission denied"), { code: "EACCES" });
		vi.spyOn(fs, "lstat").mockRejectedValueOnce(error);
		await expect(getAvailableExportPath("/exports/Untitled Project.mp4")).rejects.toBe(error);
	});

	it("gives concurrent saves different names without overwriting either export", async () => {
		const dir = await makeTempDir();
		const requested = path.join(dir, "Untitled Project.mp4");
		const paths = await Promise.all(
			["first", "second"].map((content) =>
				saveExportToAvailablePath(requested, (destination) =>
					fs.writeFile(destination, content),
				),
			),
		);
		expect(new Set(paths).size).toBe(2);
		expect(await Promise.all(paths.map((file) => fs.readFile(file, "utf8")))).toEqual([
			"first",
			"second",
		]);
	});

	it("removes a failed save reservation and preserves the existing export", async () => {
		const dir = await makeTempDir();
		const requested = path.join(dir, "Untitled Project.mp4");
		await fs.writeFile(requested, "original");
		await expect(
			saveExportToAvailablePath(requested, async () => {
				throw new Error("disk full");
			}),
		).rejects.toThrow("disk full");
		expect(await fs.readdir(dir)).toEqual(["Untitled Project.mp4"]);
		await expect(fs.readFile(requested, "utf8")).resolves.toBe("original");
	});
});
