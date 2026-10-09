import path from "node:path";
import { expect, it, vi } from "vitest";
import { trashLibraryProjects } from "./trashProjects";

const at = (name: string) => path.resolve("/private/tmp", name);
it("rejects paths outside the project library before touching files", async () => {
	const trash = vi.fn();
	await expect(
		trashLibraryProjects([at("a.recordly"), at("private.txt")], {
			list: async () => ({ entries: [{ path: at("a.recordly") }] }),
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
	const result = await trashLibraryProjects(
		[at("a.recordly"), at("a.recordly"), at("b.recordly")],
		{
			list: async () => ({
				entries: [{ path: at("a.recordly") }, { path: at("b.recordly") }],
			}),
			trash,
			thumbnailPath: (p) => p + ".missing.png",
		},
	);
	expect(result.deleted).toEqual([at("a.recordly")]);
	expect(result.errors).toEqual(["Could not trash b.recordly"]);
	expect(trash.mock.calls.map(([p]) => p)).toEqual([
		at("a.recordly"),
		at("b.recordly"),
	]);
});
