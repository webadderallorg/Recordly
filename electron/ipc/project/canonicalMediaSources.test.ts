import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("../utils", () => ({
	normalizeVideoSourcePath: (value: string) =>
		value.startsWith("file://") ? decodeURIComponent(new URL(value).pathname) : value,
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
