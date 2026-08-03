import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	cleanupRecordlyTempArtifacts,
	deleteMigratedSourceFiles,
	getActiveWorkspaceLayout,
	getWorkspaceRootFromSelectedDirectory,
	initializeWorkspaceStorage,
	migrateStorageData,
	persistWorkspaceRoot,
	resolveWorkspaceLayout,
} from "./storageSettings";

const temporaryRoots: string[] = [];

afterEach(async () => {
	await Promise.all(
		temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })),
	);
});

async function createTemporaryRoot(prefix: string) {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
	temporaryRoots.push(root);
	return root;
}

describe("workspace storage settings", () => {
	it("creates an isolated layout below the selected workspace", () => {
		const layout = resolveWorkspaceLayout(path.join("tmp", "RecordlyData"));

		expect(layout.recordings).toBe(path.join(layout.root, "Recordings"));
		expect(layout.projects).toBe(path.join(layout.root, "Projects"));
		expect(layout.temp).toBe(path.join(layout.root, "Temp"));
		expect(layout.cache).toBe(path.join(layout.root, "Cache"));
	});

	it("uses an existing RecordlyData folder or creates one below a selected parent", () => {
		const parent = path.resolve("tmp", "DiskD");
		expect(getWorkspaceRootFromSelectedDirectory(parent)).toBe(
			path.join(parent, "RecordlyData"),
		);
		expect(getWorkspaceRootFromSelectedDirectory(path.join(parent, "RecordlyData"))).toBe(
			path.join(parent, "RecordlyData"),
		);
	});

	it("restores temp and cache paths before Electron becomes ready", async () => {
		const root = await createTemporaryRoot("recordly-storage-settings-");
		const userDataPath = path.join(root, "UserData");
		const workspaceRoot = path.join(root, "DiskD", "RecordlyData");
		await persistWorkspaceRoot(userDataPath, workspaceRoot);

		const appliedPaths = new Map<string, string>();
		const layout = initializeWorkspaceStorage(
			{
				getPath: (name) => path.join(root, name),
				setPath: (name, value) => appliedPaths.set(name, value),
			},
			userDataPath,
		);

		expect(layout).toEqual(resolveWorkspaceLayout(workspaceRoot));
		expect(appliedPaths.get("temp")).toBe(path.join(workspaceRoot, "Temp"));
		expect(appliedPaths.get("sessionData")).toBe(path.join(workspaceRoot, "Cache"));
		expect(getActiveWorkspaceLayout()?.root).toBe(path.resolve(workspaceRoot));
	});

	it("removes only stale Recordly temporary artifacts", async () => {
		const root = await createTemporaryRoot("recordly-temp-cleanup-");
		const staleArtifact = path.join(root, "recordly-native-old.mp4");
		const recentArtifact = path.join(root, "recordly-export-current.mp4");
		const unrelatedArtifact = path.join(root, "another-app.tmp");
		await Promise.all([
			fs.writeFile(staleArtifact, "stale-recordly-data"),
			fs.writeFile(recentArtifact, "active-recordly-data"),
			fs.writeFile(unrelatedArtifact, "other-data"),
		]);
		const staleTime = new Date(Date.now() - 2 * 60 * 60 * 1_000);
		await fs.utimes(staleArtifact, staleTime, staleTime);

		const result = await cleanupRecordlyTempArtifacts(root, 60 * 60 * 1_000);

		expect(result.removedCount).toBe(1);
		await expect(fs.access(staleArtifact)).rejects.toThrow();
		await expect(fs.access(recentArtifact)).resolves.toBeUndefined();
		await expect(fs.access(unrelatedArtifact)).resolves.toBeUndefined();
	});

	it("copies existing storage, rewrites project paths, and deletes only copied sources", async () => {
		const root = await createTemporaryRoot("recordly-storage-migration-");
		const sourceRecordings = path.join(root, "old", "recordings");
		const sourceProjects = path.join(sourceRecordings, "Projects");
		const sourceVideo = path.join(sourceRecordings, "session.webm");
		const sourceProject = path.join(sourceProjects, "session.recordly");
		await fs.mkdir(sourceProjects, { recursive: true });
		await fs.writeFile(sourceVideo, "recording-data");
		await fs.writeFile(
			sourceProject,
			JSON.stringify({ videoPath: sourceVideo, nested: { sourcePath: sourceVideo } }),
		);

		const destination = resolveWorkspaceLayout(path.join(root, "new", "RecordlyData"));
		const migration = await migrateStorageData(
			{ recordings: sourceRecordings, projects: sourceProjects },
			destination,
		);

		expect(migration.copiedCount).toBe(2);
		expect(migration.skippedConflicts).toBe(0);
		const migratedProject = JSON.parse(
			await fs.readFile(path.join(destination.projects, "session.recordly"), "utf-8"),
		) as { videoPath: string; nested: { sourcePath: string } };
		const migratedVideo = path.join(destination.recordings, "session.webm");
		expect(migratedProject.videoPath).toBe(migratedVideo);
		expect(migratedProject.nested.sourcePath).toBe(migratedVideo);

		const deleted = await deleteMigratedSourceFiles(migration.copiedFiles, [sourceRecordings]);
		expect(deleted.deletedCount).toBe(2);
		await expect(fs.access(sourceVideo)).rejects.toThrow();
		await expect(fs.access(sourceProject)).rejects.toThrow();
		await expect(fs.access(migratedVideo)).resolves.toBeUndefined();
	});
});
