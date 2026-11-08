import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("../../appPaths", () => ({ USER_DATA_PATH: "/unused-recordly-test-user-data" }));

import { createFirstRecordingAutoZoomStore } from "./firstRecordingAutoZooms";

let directory: string;
let file: string;
beforeEach(async () => {
	directory = await fs.mkdtemp(path.join(os.tmpdir(), "recordly-first-zooms-"));
	file = path.join(directory, "trial.json");
});
afterEach(async () => {
	vi.restoreAllMocks();
	await fs.rm(directory, { recursive: true, force: true });
});

it("persists exactly three distinct validated recordings across store restarts", async () => {
	for (const source of ["one.mp4", "one.mp4", "two.mp4", "three.mp4", "four.mp4"])
		await createFirstRecordingAutoZoomStore(file).register(source);
	expect(JSON.parse(await fs.readFile(file, "utf8"))).toEqual({
		recordings: ["one.mp4", "two.mp4", "three.mp4"],
		handled: [],
	});
});

it("shares a three-recording limit across concurrent instances without spending slots on retries", async () => {
	await Promise.all(
		["one.mp4", "one.mp4", "two.mp4", "three.mp4", "four.mp4"].map((source) =>
			createFirstRecordingAutoZoomStore(file).register(source),
		),
	);
	const state = JSON.parse(await fs.readFile(file, "utf8"));
	expect(state.recordings).toHaveLength(3);
	expect(new Set(state.recordings).size).toBe(3);
	expect(state.handled).toEqual([]);
});

it("only one instance can claim each recording and undo/restarts cannot reclaim it", async () => {
	const first = createFirstRecordingAutoZoomStore(file),
		second = createFirstRecordingAutoZoomStore(file);
	await first.register("one.mp4");
	expect(
		(await Promise.all([first.claim("one.mp4"), second.claim("one.mp4")])).filter(Boolean),
	).toHaveLength(1);
	await second.register("two.mp4");
	expect(await createFirstRecordingAutoZoomStore(file).claim("one.mp4")).toBe(false);
	expect(await first.claim("import.mp4")).toBe(false);
	expect(await second.claim("two.mp4")).toBe(true);
});

it("does not overwrite an unreadable ledger and releases its lock after a failure", async () => {
	await fs.writeFile(file, "{broken");
	await expect(createFirstRecordingAutoZoomStore(file).register("one.mp4")).rejects.toThrow();
	expect(await fs.readFile(file, "utf8")).toBe("{broken");
	await fs.rm(file);
	expect(await createFirstRecordingAutoZoomStore(file).register("one.mp4")).toBe(true);
});

it("recovers from an interrupted atomic write without claiming success or leaking a lock", async () => {
	const rename = vi.spyOn(fs, "rename").mockRejectedValueOnce(new Error("disk full"));
	const store = createFirstRecordingAutoZoomStore(file);
	await expect(store.register("one.mp4")).rejects.toThrow("disk full");
	rename.mockRestore();
	expect(await fs.readdir(directory)).toEqual([]);
	expect(await store.register("one.mp4")).toBe(true);
});

it("recovers an expired lock left by an interrupted process", async () => {
	await fs.mkdir(`${file}.lock`);
	const expired = new Date(Date.now() - 30000);
	await fs.utimes(`${file}.lock`, expired, expired);
	expect(await createFirstRecordingAutoZoomStore(file).register("one.mp4")).toBe(true);
});
