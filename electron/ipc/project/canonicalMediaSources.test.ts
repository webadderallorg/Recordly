import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("../utils", () => ({
	normalizeVideoSourcePath: (value: string) =>
		value.startsWith("file://") ? fileURLToPath(value) : value,
}));

import { canonicalMediaSources } from "./canonicalMediaSources";

let root: string;
beforeEach(async () => {
	root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "recordly-source-alias-")));
});
afterEach(async () => {
	vi.restoreAllMocks();
	await fs.rm(root, { recursive: true, force: true });
});

it("resolves custom-folder and individual audio aliases without changing project data", async () => {
	const actual = path.join(root, "actual");
	const alias = path.join(root, "alias");
	await fs.mkdir(actual);
	await fs.symlink(actual, alias);
	for (const file of ["screen.mp4", "extra.wav"])
		await fs.writeFile(path.join(actual, file), "media");
	const project = {
		videoPath: path.join(alias, "screen.mp4"),
		editor: {
			audioRegions: [{ audioPath: pathToFileURL(path.join(alias, "extra.wav")).href }],
			wallpaper: "gradient(blue, red)",
			missing: path.join(alias, "old.wav"),
		},
	};
	const result = await canonicalMediaSources(project);
	expect(result.sourcePaths.sort()).toEqual([
		path.join(actual, "extra.wav"),
		path.join(actual, "screen.mp4"),
	]);
	expect(result.sourcePathsComplete).toBe(true);
	expect(project.videoPath).toBe(path.join(alias, "screen.mp4"));
});

it("marks dependencies incomplete on access failure without failing ordinary previews", async () => {
	vi.spyOn(fs, "realpath").mockRejectedValue(
		Object.assign(new Error("Denied"), { code: "EACCES" }),
	);
	expect(await canonicalMediaSources({ videoPath: "/private/source.mp4" })).toEqual({
		sourcePaths: [],
		sourcePathsComplete: false,
	});
});

it("protects a nearby webcam even if the primary recording is still missing", async () => {
	const camera = path.join(root, "camera.mp4");
	await fs.writeFile(camera, "video");
	const project = {
		videoPath: path.join(root, "old", "missing.mp4"),
		editor: { webcam: { sourcePath: path.join(root, "old", "camera.mp4") } },
	};
	expect(
		await canonicalMediaSources(project, { projectPath: path.join(root, "work.recordly") }),
	).toEqual({ sourcePaths: [camera], sourcePathsComplete: true });
});

it("marks dependencies incomplete when a nearby file cannot be inspected", async () => {
	const candidate = path.join(root, "video.mp4");
	await fs.writeFile(candidate, "video");
	vi.spyOn(fs, "lstat").mockRejectedValue(Object.assign(new Error("Denied"), { code: "EACCES" }));
	const videoPath = path.join(root, "old", "video.mp4");
	expect(
		await canonicalMediaSources(
			{ videoPath },
			{ preserveMissing: true, projectPath: path.join(root, "work.recordly") },
		),
	).toEqual({ sourcePaths: [videoPath], sourcePathsComplete: false });
});

it("opt-in deletion references retain missing main capture families through canonical parents", async () => {
	const actual = path.join(root, "actual"),
		alias = path.join(root, "alias");
	await fs.mkdir(actual);
	await fs.symlink(actual, alias);
	const mic = path.join(actual, "capture.mic.wav");
	await fs.writeFile(mic, "audio");
	const project = { videoPath: path.join(alias, "capture.mp4") };
	expect(await canonicalMediaSources(project, { preserveMissing: true })).toEqual({
		sourcePaths: [path.join(actual, "capture.mp4")],
		sourcePathsComplete: true,
	});
	const { prepareLibraryDeletion } = await import("./libraryDeletion");
	const plan = await prepareLibraryDeletion(["/p/selected"], {
		list: async () => ({ entries: [{ path: "/p/selected" }, { path: "/p/unselected" }] }),
		backupPaths: () => [],
		recordings: async () => [{ path: mic }],
		readSources: async (p) =>
			canonicalMediaSources(p === "/p/selected" ? { videoPath: mic } : project, {
				preserveMissing: true,
			}),
	});
	expect(plan.sourceOwners).toEqual({});
	expect(plan.preservedSources).toEqual([mic]);
});
