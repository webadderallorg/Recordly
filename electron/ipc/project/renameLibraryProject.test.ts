import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { renameLibraryProject } from "./renameLibraryProject";

it("renames a library project with its preview without overwriting another project", async () => {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "recordly-rename-"));
	const original = path.join(dir, "Original.recordly"),
		target = path.join(dir, "Renamed.recordly");
	const sidecars = (file: string) => [`${file}.png`];
	try {
		await fs.writeFile(original, "project");
		await fs.writeFile(`${original}.png`, "preview");
		await fs.writeFile(target, "keep");
		await expect(
			renameLibraryProject(original, "Renamed", [original], sidecars),
		).rejects.toThrow();
		expect(await fs.readFile(target, "utf8")).toBe("keep");
		await fs.rm(target);
		await expect(
			renameLibraryProject(original, "../escape", [original], sidecars),
		).rejects.toThrow();
		await expect(renameLibraryProject(original, "Renamed", [], sidecars)).rejects.toThrow();
		expect(await renameLibraryProject(original, "Renamed", [original], sidecars)).toBe(target);
		expect(await fs.readFile(target, "utf8")).toBe("project");
		expect(await fs.readFile(`${target}.png`, "utf8")).toBe("preview");
		await expect(fs.access(original)).rejects.toThrow();
	} finally {
		await fs.rm(dir, { recursive: true, force: true });
	}
});

it("moves legacy backups and previews into managed storage while leaving one visible document", async () => {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "recordly-rename-managed-"));
	const original = path.join(dir, "Original.recordly"),
		target = path.join(dir, "Renamed.recordly");
	const cache = path.join(dir, ".managed");
	const sidecars = (file: string) => [
		[path.join(cache, `${path.basename(file)}.png`), `${file}.png`],
		[path.join(cache, `${path.basename(file)}.backup`), `${file}.bak`],
	];
	try {
		await fs.writeFile(original, "project");
		await fs.writeFile(`${original}.png`, "preview");
		await fs.writeFile(`${original}.bak`, "previous project");
		expect(await renameLibraryProject(original, "Renamed", [original], sidecars)).toBe(target);
		expect((await fs.readdir(dir)).filter((name) => !name.startsWith("."))).toEqual([
			"Renamed.recordly",
		]);
		expect(await fs.readFile(sidecars(target)[0][0], "utf8")).toBe("preview");
		expect(await fs.readFile(sidecars(target)[1][0], "utf8")).toBe("previous project");
	} finally {
		await fs.rm(dir, { recursive: true, force: true });
	}
});

it("preserves unique recovery generations when legacy and managed versions conflict", async () => {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "recordly-rename-conflict-"));
	const original = path.join(dir, "Original.recordly"),
		target = path.join(dir, "Renamed.recordly");
	const sidecars = (file: string) => [[`${file}.managed`, `${file}.bak`]];
	try {
		await fs.writeFile(original, "project");
		await fs.writeFile(`${original}.managed`, "generation 1");
		await fs.writeFile(`${original}.bak`, "generation 2");
		await expect(
			renameLibraryProject(original, "Renamed", [original], sidecars),
		).rejects.toThrow("conflict");
		expect(await fs.readFile(original, "utf8")).toBe("project");
		expect(await fs.readFile(`${original}.managed`, "utf8")).toBe("generation 1");
		expect(await fs.readFile(`${original}.bak`, "utf8")).toBe("generation 2");
		await expect(fs.access(target)).rejects.toMatchObject({ code: "ENOENT" });
	} finally {
		await fs.rm(dir, { recursive: true, force: true });
	}
});

it("renames a refreshed managed preview even when its older legacy PNG differs", async () => {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "recordly-rename-previews-"));
	const original = path.join(dir, "Original.recordly"),
		target = path.join(dir, "Renamed.recordly");
	const cache = path.join(dir, ".managed");
	const sidecars = (file: string) => [
		{
			paths: [path.join(cache, `${path.basename(file)}.png`), `${file}.png`],
			kind: "preview" as const,
		},
	];
	try {
		await fs.mkdir(cache);
		await fs.writeFile(original, "project");
		await fs.writeFile(`${original}.png`, "older legacy PNG");
		await fs.writeFile(sidecars(original)[0].paths[0], "refreshed managed PNG");
		await fs.utimes(`${original}.png`, new Date(1000), new Date(1000));
		await fs.utimes(sidecars(original)[0].paths[0], new Date(2000), new Date(2000));
		expect(await renameLibraryProject(original, "Renamed", [original], sidecars)).toBe(target);
		expect(await fs.readFile(sidecars(target)[0].paths[0], "utf8")).toBe(
			"refreshed managed PNG",
		);
		expect((await fs.stat(sidecars(target)[0].paths[0])).mtimeMs).toBe(2000);
		expect((await fs.readdir(dir)).filter((name) => !name.startsWith("."))).toEqual([
			"Renamed.recordly",
		]);
		for (const previous of sidecars(original)[0].paths)
			await expect(fs.access(previous)).rejects.toMatchObject({ code: "ENOENT" });
	} finally {
		await fs.rm(dir, { recursive: true, force: true });
	}
});

it("rolls back a preview replacement when distinct recovery backups still conflict", async () => {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "recordly-rename-mixed-conflict-"));
	const original = path.join(dir, "Original.recordly"),
		target = path.join(dir, "Renamed.recordly");
	const sidecars = (file: string) => [
		{ paths: [`${file}.managed.png`, `${file}.png`], kind: "preview" as const },
		[`${file}.managed.backup`, `${file}.bak`],
	];
	try {
		await fs.writeFile(original, "project");
		await fs.writeFile(`${original}.managed.png`, "new PNG");
		await fs.writeFile(`${original}.png`, "old PNG");
		await fs.writeFile(`${original}.managed.backup`, "generation 1");
		await fs.writeFile(`${original}.bak`, "generation 2");
		await expect(
			renameLibraryProject(original, "Renamed", [original], sidecars),
		).rejects.toThrow("conflict");
		expect(await fs.readFile(original, "utf8")).toBe("project");
		expect(await fs.readFile(`${original}.managed.png`, "utf8")).toBe("new PNG");
		expect(await fs.readFile(`${original}.png`, "utf8")).toBe("old PNG");
		expect(await fs.readFile(`${original}.managed.backup`, "utf8")).toBe("generation 1");
		expect(await fs.readFile(`${original}.bak`, "utf8")).toBe("generation 2");
		await expect(fs.access(target)).rejects.toMatchObject({ code: "ENOENT" });
		await expect(fs.access(`${target}.managed.png`)).rejects.toMatchObject({ code: "ENOENT" });
	} finally {
		await fs.rm(dir, { recursive: true, force: true });
	}
});

it.each([
	true,
	false,
])("retires orphan target previews without following symlinks (source preview: %s)", async (withPreview) => {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "recordly-rename-orphan-"));
	const source = path.join(dir, "Source.recordly"),
		target = path.join(dir, "Target.recordly");
	const victim = path.join(dir, "unrelated.txt");
	const sidecars = (file: string) => [
		{ paths: [`${file}.managed.png`, `${file}.png`], kind: "preview" as const },
	];
	try {
		await fs.writeFile(source, "source project");
		await fs.writeFile(victim, "preserve unrelated contents");
		await fs.symlink(victim, sidecars(target)[0].paths[0]);
		await fs.writeFile(sidecars(target)[0].paths[1], "orphan legacy preview");
		if (withPreview) await fs.writeFile(sidecars(source)[0].paths[0], "source preview");
		expect(await renameLibraryProject(source, "Target", [source], sidecars)).toBe(target);
		expect(await fs.readFile(target, "utf8")).toBe("source project");
		expect(await fs.readFile(victim, "utf8")).toBe("preserve unrelated contents");
		await expect(fs.access(sidecars(target)[0].paths[1])).rejects.toMatchObject({
			code: "ENOENT",
		});
		if (withPreview) {
			expect((await fs.lstat(sidecars(target)[0].paths[0])).isSymbolicLink()).toBe(false);
			expect(await fs.readFile(sidecars(target)[0].paths[0], "utf8")).toBe("source preview");
		} else
			await expect(fs.access(sidecars(target)[0].paths[0])).rejects.toMatchObject({
				code: "ENOENT",
			});
	} finally {
		await fs.rm(dir, { recursive: true, force: true });
	}
});

it("preserves an orphan target recovery generation rather than overwriting it on rename", async () => {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "recordly-rename-target-backup-"));
	const source = path.join(dir, "Source.recordly"),
		target = path.join(dir, "Target.recordly");
	const sidecars = (file: string) => [[`${file}.backup`, `${file}.bak`]];
	try {
		await fs.writeFile(source, "source project");
		await fs.writeFile(sidecars(source)[0][0], "source recovery generation");
		await fs.writeFile(sidecars(target)[0][0], "target recovery generation");
		await expect(
			renameLibraryProject(source, "Target", [source], sidecars),
		).rejects.toMatchObject({ code: "EEXIST" });
		expect(await fs.readFile(source, "utf8")).toBe("source project");
		expect(await fs.readFile(sidecars(source)[0][0], "utf8")).toBe(
			"source recovery generation",
		);
		expect(await fs.readFile(sidecars(target)[0][0], "utf8")).toBe(
			"target recovery generation",
		);
		await expect(fs.access(target)).rejects.toMatchObject({ code: "ENOENT" });
	} finally {
		await fs.rm(dir, { recursive: true, force: true });
	}
});
