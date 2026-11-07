import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { getProjectBackupPaths } from "./atomicSave";
import { canonicalMediaSources } from "./canonicalMediaSources";
import {
	prepareLibraryDeletion,
	removableLibrarySources,
	protectedLibrarySources,
	type LibraryDeletionDependencies,
} from "./libraryDeletion";

vi.mock("../utils", () => ({ normalizeVideoSourcePath: (value: string) => value }));

function productionDependencies(projects: string[], recordings: string[]) {
	const declaration = (relativeFile: string, name: string) => {
		const file = ts.createSourceFile(
			relativeFile,
			readFileSync(new URL(relativeFile, import.meta.url), "utf8"),
			ts.ScriptTarget.Latest,
			true,
		);
		const fn = file.statements.find(
			(node) => ts.isFunctionDeclaration(node) && node.name?.text === name,
		);
		if (!fn) throw new Error(`Missing production function: ${name}`);
		return fn.getText(file).replace(/^export /, "");
	};
	// Execute the real main-process reader and validator without booting Electron.
	const source = [
		declaration("./manager.ts", "isLoadableProjectData"),
		declaration("../register/project.ts", "libraryDeletionDependencies"),
		"libraryDeletionDependencies();",
	].join("\n");
	return runInNewContext(
		ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022 } })
			.outputText,
		{
			fs,
			listProjectLibraryEntries: async () => ({
				entries: projects.map((file) => ({ path: file })),
			}),
			getProjectBackupPaths,
			listRecordings: async () => recordings.map((file) => ({ path: file })),
			currentVideoPath: null,
			currentRecordingSession: null,
			normalizeVideoSourcePath: (value: unknown) =>
				typeof value === "string" ? value : null,
			parseJsonWithByteOrderMark: JSON.parse,
			canonicalMediaSources,
		},
	) as LibraryDeletionDependencies;
}

describe.skipIf(process.platform === "win32")("listed primary project symlinks", () => {
	it("keeps canonical media protected while allowing deletion reviews beside a linked recent project", async () => {
		const root = await fs.realpath(
			await fs.mkdtemp(path.join(os.tmpdir(), "recordly-primary-link-")),
		);
		try {
			const media = path.join(root, "media"),
				alias = path.join(root, "media-alias");
			await fs.mkdir(media);
			await fs.symlink(media, alias);
			const shared = path.join(media, "shared.mp4"),
				companion = path.join(media, "shared.mic.wav"),
				unique = path.join(media, "unique.mp4");
			for (const file of [shared, companion, unique]) await fs.writeFile(file, "media bytes");
			const target = path.join(root, "target.recordly"),
				linked = path.join(root, "recent.recordly"),
				selected = path.join(root, "selected.recordly");
			const targetContents = JSON.stringify({
				version: 2,
				videoPath: path.join(alias, "shared.mp4"),
				editor: {},
			});
			await fs.writeFile(target, targetContents);
			await fs.symlink(target, linked);
			await fs.writeFile(
				selected,
				JSON.stringify({
					version: 2,
					videoPath: unique,
					editor: { audioRegions: [{ audioPath: shared }] },
				}),
			);
			const deps = productionDependencies([selected, linked], [shared, companion, unique]);
			const reads = vi.spyOn(deps, "readSources");
			expect((await protectedLibrarySources(deps)).has(shared)).toBe(true);
			const plan = await prepareLibraryDeletion([selected], deps);
			expect(Object.keys(plan.sourceOwners)).toEqual([unique]);
			expect(plan.preservedSources).toEqual([shared, companion]);
			expect((await prepareLibraryDeletion([linked], deps)).preservedSources).toEqual([
				shared,
				companion,
			]);
			// A regular recovery generation continues protecting its own references.
			const backup = getProjectBackupPaths(linked)[0];
			await fs.mkdir(path.dirname(backup), { recursive: true });
			await fs.writeFile(
				backup,
				JSON.stringify({ version: 2, videoPath: unique, editor: {} }),
			);
			expect((await prepareLibraryDeletion([selected], deps)).sourceOwners).toEqual({});
			for (const primary of [selected, linked]) {
				expect(reads).toHaveBeenCalledWith(primary, "primary");
				for (const recovery of getProjectBackupPaths(primary)) {
					expect(reads).toHaveBeenCalledWith(recovery, "recovery");
				}
			}
			expect((await fs.lstat(linked)).isSymbolicLink()).toBe(true);
			await expect(fs.readFile(target, "utf8")).resolves.toBe(targetContents);
			for (const file of [shared, companion, unique])
				await expect(fs.readFile(file, "utf8")).resolves.toBe("media bytes");
		} finally {
			await fs.rm(root, { recursive: true, force: true });
		}
	});

	it.each([
		[0, false],
		[0, true],
		[1, false],
		[1, true],
		[2, false],
		[2, true],
	])("still rejects recovery-copy generation %s symlinks (dangling: %s)", async (generation, dangling) => {
		const root = await fs.realpath(
			await fs.mkdtemp(path.join(os.tmpdir(), "recordly-recovery-link-")),
		);
		try {
			const actual = path.join(root, "actual"),
				alias = path.join(root, "alias");
			await fs.mkdir(actual);
			await fs.symlink(actual, alias);
			const primary = path.join(alias, "primary.recordly"),
				backupTarget = path.join(root, "other.recordly");
			const contents = JSON.stringify({
				version: 2,
				videoPath: path.join(root, "capture.mp4"),
				editor: {},
			});
			await fs.writeFile(primary, contents);
			if (!dangling) await fs.writeFile(backupTarget, contents);
			const backups = getProjectBackupPaths(primary);
			expect(backups).toHaveLength(3);
			const backup = backups[generation as number];
			await fs.mkdir(path.dirname(backup), { recursive: true });
			await fs.symlink(backupTarget, backup);
			await expect(
				protectedLibrarySources(productionDependencies([primary], [])),
			).rejects.toThrow("not a regular file");
			expect((await fs.lstat(backup)).isSymbolicLink()).toBe(true);
			if (!dangling) await expect(fs.readFile(backupTarget, "utf8")).resolves.toBe(contents);
			await expect(fs.readFile(primary, "utf8")).resolves.toBe(contents);
		} finally {
			await fs.rm(root, { recursive: true, force: true });
		}
	});

	it.each([
		"missing",
		"directory",
		"corrupt",
	])("fails closed for a %s primary symlink target", async (kind) => {
		const root = await fs.realpath(
			await fs.mkdtemp(path.join(os.tmpdir(), "recordly-invalid-primary-")),
		);
		try {
			const target = path.join(root, "target"),
				linked = path.join(root, "recent.recordly");
			if (kind === "directory") await fs.mkdir(target);
			if (kind === "corrupt") await fs.writeFile(target, "invalid JSON");
			await fs.symlink(target, linked);
			await expect(
				protectedLibrarySources(productionDependencies([linked], [])),
			).rejects.toThrow();
			expect((await fs.lstat(linked)).isSymbolicLink()).toBe(true);
		} finally {
			await fs.rm(root, { recursive: true, force: true });
		}
	});
});

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
