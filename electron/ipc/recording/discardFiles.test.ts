import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { discardRecordingFiles, stripFileExtension } from "./discardFiles";

it("strips only the trailing extension and preserves extensionless paths", () => {
	expect(stripFileExtension("/recordings/recording-123.mp4")).toBe("/recordings/recording-123");
	expect(stripFileExtension("/recordings/recording-123.take1.mov")).toBe(
		"/recordings/recording-123.take1",
	);
	expect(stripFileExtension("/recordings/recording-123")).toBe("/recordings/recording-123");
});

it("handles extensionless recording paths without resolving companion files relative to cwd", async () => {
	const directory = await fs.mkdtemp(path.join(os.tmpdir(), "recordly-discard-extless-"));
	const companionInCwd = path.join(directory, "cwd-guard");
	const originalCwd = process.cwd();
	try {
		await fs.mkdir(companionInCwd, { recursive: true });
		process.chdir(companionInCwd);
		await fs.writeFile(path.join(companionInCwd, ".mic.m4a"), "keep");

		const extensionless = path.join(directory, "recording-123");
		await Promise.all(
			[
				"recording-123",
				"recording-123.cursor.json",
				"recording-123.system.m4a",
				"recording-123.mic.m4a",
				"recording-123.recordly-session.json",
				"recording-1234.mp4",
			].map((file) => fs.writeFile(path.join(directory, file), "test")),
		);

		await discardRecordingFiles(extensionless);

		expect((await fs.readdir(directory)).sort()).toEqual(["cwd-guard", "recording-1234.mp4"]);
		expect(await fs.readFile(path.join(companionInCwd, ".mic.m4a"), "utf8")).toBe("keep");
	} finally {
		process.chdir(originalCwd);
		await fs.rm(directory, { recursive: true, force: true });
	}
});

it("removes a discarded take and its companion files, preserves other takes, and permits retries", async () => {
	const directory = await fs.mkdtemp(path.join(os.tmpdir(), "recordly-discard-"));
	try {
		const files = [
			"recording-123.mp4",
			"recording-123.mp4.cursor.json",
			"recording-123.system.m4a",
			"recording-123.mic.m4a",
			"recording-123.system.wav",
			"recording-123.mic.wav",
			"recording-123.system.wav.json",
			"recording-123.mic.wav.json",
			"recording-123.recording-diagnostics.json",
			"recording-123.recordly-session.json",
			"recording-1234.mp4",
			"recording-1234.mic.m4a",
		];
		await Promise.all(files.map((file) => fs.writeFile(path.join(directory, file), "test")));
		const video = path.join(directory, "recording-123.mp4");
		await discardRecordingFiles(video);
		expect((await fs.readdir(directory)).sort()).toEqual([
			"recording-1234.mic.m4a",
			"recording-1234.mp4",
		]);
		// Simulate a companion surviving a previous partial deletion.
		await fs.writeFile(path.join(directory, "recording-123.mic.m4a"), "retry");
		await discardRecordingFiles(video);
		expect((await fs.readdir(directory)).sort()).toEqual([
			"recording-1234.mic.m4a",
			"recording-1234.mp4",
		]);
	} finally {
		await fs.rm(directory, { recursive: true, force: true });
	}
});
