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
