import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ root: "" }));
vi.mock("../utils", () => ({ getRecordingsDir: async () => state.root }));
import { findDuplicateRecordingSources } from "./duplicateSources";

beforeEach(async () => {
	state.root = await fs.mkdtemp(path.join(os.tmpdir(), "recordly-duplicates-"));
});
afterEach(async () => {
	await fs.rm(state.root, { recursive: true, force: true });
});

it("compares file contents, excludes same-size different media, symlinks, empty files and non-media", async () => {
	for (const [name, content] of Object.entries({
		"first.mp4": "same",
		"copy.mov": "same",
		"other.mp4": "diff",
		"empty.mp4": "",
		"project.recordly": "same",
		"mic.wav": "audio",
		"mic-copy.wav": "audio",
	}))
		await fs.writeFile(path.join(state.root, name), content);
	await fs.symlink(path.join(state.root, "first.mp4"), path.join(state.root, "link.mp4"));
	await fs.mkdir(path.join(state.root, "folder.mp4"));
	const groups = (await findDuplicateRecordingSources()).map((files) =>
		files.map((file) => path.basename(file)).sort(),
	);
	expect(groups).toContainEqual(["copy.mov", "first.mp4"]);
	expect(groups).toContainEqual(["mic-copy.wav", "mic.wav"]);
	expect(groups).toHaveLength(2);
	expect(await fs.readFile(path.join(state.root, "first.mp4"), "utf8")).toBe("same");
});
