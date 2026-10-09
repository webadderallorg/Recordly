import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const identity = (value: string) => (value.startsWith("file://") ? value.slice(7) : value);
const findProjectsReferencing = (video: string, projects: { name: string; path: string }[]) =>
	find(video, projects, identity);

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findProjectsReferencing as find } from "./recordingReferences";

let dir: string;
beforeEach(async () => {
	dir = await fs.mkdtemp(path.join(os.tmpdir(), "recordly-refs-"));
});
afterEach(() => fs.rm(dir, { recursive: true, force: true }));

const project = (name: string) => ({ name, path: path.join(dir, `${name}.recordly`) });
const write = (name: string, body: unknown) =>
	fs.writeFile(project(name).path, typeof body === "string" ? body : JSON.stringify(body));

describe("findProjectsReferencing", () => {
	it("returns nothing for an empty library", async () => {
		expect(await findProjectsReferencing("/r/a.mp4", [])).toEqual({
			referencing: [],
			unchecked: [],
		});
	});

	it("finds zero, one, or several projects that point at the same recording", async () => {
		const video = path.join(dir, "a.mp4");
		await fs.writeFile(video, "x");
		await write("One", { videoPath: video });
		await write("Two", { videoPath: `file://${video}` });
		await write("Other", { videoPath: path.join(dir, "b.mp4") });
		const result = await findProjectsReferencing(video, [
			project("One"),
			project("Two"),
			project("Other"),
		]);
		expect(result.referencing.map((entry) => entry.name)).toEqual(["One", "Two"]);
		expect((await findProjectsReferencing(video, [project("Other")])).referencing).toEqual([]);
	});

	it("matches a recording that is already gone from disk", async () => {
		const video = path.join(dir, "gone.mp4");
		await write("Orphan", { videoPath: video });
		expect(
			(await findProjectsReferencing(video, [project("Orphan")])).referencing,
		).toHaveLength(1);
	});

	it("reports an unreadable or corrupt project as unchecked rather than skipping it silently", async () => {
		await write("Corrupt", "{ not json");
		const result = await findProjectsReferencing("/r/a.mp4", [
			project("Corrupt"),
			project("Missing"),
		]);
		expect(result.referencing).toEqual([]);
		expect(result.unchecked.map((entry) => entry.name)).toEqual(["Corrupt", "Missing"]);
	});

	it("ignores a project with no video path", async () => {
		await write("Blank", { editor: {} });
		expect((await findProjectsReferencing("/r/a.mp4", [project("Blank")])).referencing).toEqual(
			[],
		);
	});
});
