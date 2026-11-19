import path from "node:path";
import { expect, it, vi } from "vitest";
import { trashLibraryProjects } from "./trashProjects";

const projectAPath = path.resolve("/private/tmp/a.recordly");
const projectBPath = path.resolve("/private/tmp/b.recordly");

it("rejects paths outside the project library before touching files", async () => {
	const trash = vi.fn();
	await expect(
		trashLibraryProjects([projectAPath, path.resolve("/private/tmp/private.txt")], {
			list: async () => ({ entries: [{ path: projectAPath }] }),
			trash,
			thumbnailPath: (p) => p + ".png",
		}),
	).rejects.toThrow("not in the library");
	expect(trash).not.toHaveBeenCalled();
});
it("trashes only selected project files, deduplicates paths, and reports partial failures", async () => {
	const trash = vi.fn(async (p: string) => {
		if (p.endsWith("b.recordly")) throw Error("locked");
	});
	const result = await trashLibraryProjects([projectAPath, projectAPath, projectBPath], {
		list: async () => ({
			entries: [{ path: projectAPath }, { path: projectBPath }],
		}),
		trash,
		thumbnailPath: (p) => p + ".missing.png",
	});
	expect(result.deleted).toEqual([projectAPath]);
	expect(result.errors).toEqual(["Could not trash b.recordly"]);
	expect(trash.mock.calls.map(([p]) => p)).toEqual([projectAPath, projectBPath]);
});
