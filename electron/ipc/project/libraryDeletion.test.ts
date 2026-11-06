import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
	prepareLibraryDeletion,
	removableLibrarySources,
	protectedLibrarySources,
	type LibraryDeletionDependencies,
} from "./libraryDeletion";
function fixture(overrides: Partial<LibraryDeletionDependencies> = {}) {
	const data: Record<string, string[]> = {
		"/p/a": ["/r/a.mp4", "/external/import.mp4"],
		"/p/b": ["/r/shared.mp4"],
		"/p/a.bak": ["/r/shared.mp4"],
	};
	return {
		list: async () => ({ entries: [{ path: "/p/a" }, { path: "/p/b" }] }),
		backupPaths: (p: string) => [p + ".bak"],
		readSources: async (p: string) =>
			data[p] ? { sourcePaths: data[p], sourcePathsComplete: true } : null,
		recordings: async () =>
			["/r/a.mp4", "/r/a.mic.wav", "/r/shared.mp4", "/r/unrelated.mp4"].map((path) => ({
				path,
			})),
		...overrides,
	} satisfies LibraryDeletionDependencies;
}
describe("library deletion source planning", () => {
	it("includes only selected managed captures and companions, preserving unselected references", async () => {
		const plan = await prepareLibraryDeletion(["/p/a"], fixture());
		expect(Object.keys(plan.sourceOwners)).toEqual(["/r/a.mp4", "/r/a.mic.wav"]);
		expect(plan.preservedSources).toEqual(["/r/shared.mp4"]);
	});
	it("protects sources referenced only by an unselected recovery copy", async () => {
		const deps = fixture({
			readSources: async (p) => ({
				sourcePaths: p === "/p/b.bak" ? ["/r/a.mp4"] : p === "/p/a" ? ["/r/a.mp4"] : [],
				sourcePathsComplete: true,
			}),
		});
		expect(Object.keys((await prepareLibraryDeletion(["/p/a"], deps)).sourceOwners)).toEqual(
			[],
		);
	});
	it("fails closed for unavailable primary or incomplete recovery references and rejects unknown paths", async () => {
		await expect(prepareLibraryDeletion(["/evil"], fixture())).rejects.toThrow(
			"not in the library",
		);
		await expect(
			prepareLibraryDeletion(["/p/a"], fixture({ readSources: async () => null })),
		).rejects.toThrow("could not be checked");
		await expect(
			prepareLibraryDeletion(
				["/p/a"],
				fixture({
					readSources: async (p) => ({
						sourcePaths: [],
						sourcePathsComplete: p !== "/p/b.bak",
					}),
				}),
			),
		).rejects.toThrow("recovery copies");
	});
	it("canonicalizes unsaved active aliases for both raw deletion protection and project planning", async () => {
		const dir = await fs.realpath(
			await fs.mkdtemp(path.join(os.tmpdir(), "recordly-cleanup-")),
		);
		try {
			const source = path.join(dir, "capture.mp4"),
				alias = path.join(dir, "alias.mp4");
			await fs.writeFile(source, "");
			await fs.symlink(source, alias);
			const deps = fixture({
				activeSources: () => [alias],
				recordings: async () => [{ path: source }],
				readSources: async (p) => ({
					sourcePaths: p === "/p/a" ? [source] : [],
					sourcePathsComplete: true,
				}),
			});
			expect((await protectedLibrarySources(deps)).has(source)).toBe(true);
			expect((await prepareLibraryDeletion(["/p/a"], deps)).preservedSources).toEqual([
				source,
			]);
		} finally {
			await fs.rm(dir, { recursive: true, force: true });
		}
	});
});

it("keeps media after a partial project deletion or a new remaining reference", () => {
	const owners = {
		"/r/shared.mp4": ["/p/a", "/p/b"],
		"/r/a.mp4": ["/p/a"],
		"/r/new.mp4": ["/p/a"],
	};
	expect(removableLibrarySources(owners, ["/p/a"], new Set(["/r/new.mp4"]))).toEqual({
		removable: ["/r/a.mp4"],
		kept: ["/r/shared.mp4", "/r/new.mp4"],
	});
});

it("protects companions of a missing active main recording through a symlinked folder", async () => {
	const dir = await fs.realpath(
		await fs.mkdtemp(path.join(os.tmpdir(), "recordly-missing-main-")),
	);
	try {
		const actual = path.join(dir, "actual"),
			alias = path.join(dir, "alias");
		await fs.mkdir(actual);
		await fs.symlink(actual, alias);
		const mic = path.join(actual, "capture.mic.wav");
		await fs.writeFile(mic, "");
		const deps = fixture({
			activeSources: () => [path.join(alias, "capture.mp4")],
			recordings: async () => [{ path: mic }],
			readSources: async () => ({ sourcePaths: [mic], sourcePathsComplete: true }),
		});
		const refs = await protectedLibrarySources(deps);
		expect(refs.has(path.join(actual, "capture.mp4"))).toBe(true);
		expect((await prepareLibraryDeletion(["/p/a"], deps)).preservedSources).toEqual([mic]);
	} finally {
		await fs.rm(dir, { recursive: true, force: true });
	}
});
