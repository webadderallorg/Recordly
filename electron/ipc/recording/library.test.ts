import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ root: "", approved: new Set<string>() }));
vi.mock("electron", () => ({
	app: { getPath: () => state.root },
	shell: {
		trashItem: vi.fn(async (file: string) => {
			await fs.mkdir(path.join(state.root, ".test-trash"), { recursive: true });
			await fs.rename(file, path.join(state.root, ".test-trash", path.basename(file)));
		}),
	},
}));
vi.mock("../../appPaths", () => ({
	USER_DATA_PATH: "/tmp/recordly-test",
	RECORDINGS_DIR: "/tmp/recordly-test",
}));
vi.mock("../utils", () => ({
	getRecordingsDir: async () => state.root,
	getTelemetryPathForVideo: (file: string) => `${file}.cursor.json`,
	parseJsonWithByteOrderMark: JSON.parse,
	normalizeVideoSourcePath: (file: string) => file,
	getScreen: vi.fn(),
}));
vi.mock("../../mediaServer", () => ({
	getMediaServerBaseUrl: () => "http://127.0.0.1:9999",
	buildMediaUrl: (server: string, file: string) =>
		`${server}/video?path=${encodeURIComponent(file)}`,
}));
vi.mock("../project/manager", () => ({
	rememberApprovedLocalReadPath: async (file: string) => {
		state.approved.add(file);
	},
	resolveApprovedLocalMediaPath: async (file: string) => (state.approved.has(file) ? file : null),
	isPathInsideDirectory: (file: string, root: string) => file.startsWith(`${root}${path.sep}`),
}));
vi.mock("../ffmpeg/binary", async () => {
	const require = createRequire(import.meta.url);
	return {
		getFfmpegBinaryPath: () => require("ffmpeg-static"),
		getFfprobeBinaryPath: () => require("ffprobe-static").path,
	};
});
import { listRecordings, setRecordingsRemoved, clearRecordingTrashUndo } from "./library";
import { importRecording, discardRecordingImport } from "./importRecording";
import { getRecordingThumbnail } from "./thumbnail";
import { getCompanionAudioFallbackInfo } from "./diagnostics";
const require = createRequire(import.meta.url);
const ffmpeg = require("ffmpeg-static") as string;
const run = promisify(execFile);
beforeEach(async () => {
	state.root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "recordly-library-")));
	state.approved.clear();
});
afterEach(async () => {
	await clearRecordingTrashUndo();
	await fs.rm(state.root, { recursive: true, force: true });
});

it("lists recordings, moves recordings and their companions to Trash with reversible removals, and excludes companion media and symlinks", async () => {
	const first = path.join(state.root, "recording-old.mp4");
	const second = path.join(state.root, "recording-new.mov");
	for (const name of [
		first,
		second,
		path.join(state.root, "recording-new.webcam.mp4"),
		path.join(state.root, "recording-new.mic.wav"),
	])
		await fs.writeFile(name, "fixture");
	await fs.symlink(first, path.join(state.root, "linked.mp4"));
	expect((await listRecordings()).map((entry) => entry.path).sort()).toEqual(
		[first, second].sort(),
	);
	await setRecordingsRemoved([first, second], true);
	expect(await listRecordings()).toEqual([]);
	await expect(fs.access(first)).rejects.toThrow();
	await expect(fs.access(path.join(state.root, "recording-new.mic.wav"))).rejects.toThrow();
	expect(
		(await fs.readdir(state.root)).filter((name) => name.startsWith(".recordly-trash-")),
	).toHaveLength(1);
	await setRecordingsRemoved([first, second], false);
	expect(await listRecordings()).toHaveLength(2);
	expect(await fs.readFile(first, "utf8")).toBe("fixture");
	expect(await fs.readFile(path.join(state.root, "recording-new.mic.wav"), "utf8")).toBe(
		"fixture",
	);
	await expect(setRecordingsRemoved(["/tmp/outside.mp4"], true)).rejects.toThrow("outside");
});

it("imports different-sized recordings with playable video, separate audio, stable offsets, and untouched originals", async () => {
	const base = path.join(state.root, "recording-base.mp4");
	const added = path.join(state.root, "recording-added.mp4");
	await run(ffmpeg, [
		"-v",
		"error",
		"-f",
		"lavfi",
		"-i",
		"color=c=red:s=160x90:r=30:d=1",
		"-f",
		"lavfi",
		"-i",
		"sine=frequency=440:duration=1",
		"-c:v",
		"libx264",
		"-pix_fmt",
		"yuv420p",
		"-c:a",
		"aac",
		"-shortest",
		base,
	]);
	await run(ffmpeg, [
		"-v",
		"error",
		"-f",
		"lavfi",
		"-i",
		"color=c=blue:s=90x160:r=30:d=1",
		"-c:v",
		"libx264",
		"-pix_fmt",
		"yuv420p",
		added,
	]);
	const webcam = added.replace(".mp4", "-webcam.mp4");
	await run(ffmpeg, [
		"-v",
		"error",
		"-f",
		"lavfi",
		"-i",
		"color=c=lime:s=80x60:r=30:d=0.8",
		"-c:v",
		"libx264",
		"-pix_fmt",
		"yuv420p",
		webcam,
	]);
	await fs.writeFile(
		added.replace(".mp4", ".recordly-session.json"),
		JSON.stringify({ version: 2, webcamFileName: path.basename(webcam), timeOffsetMs: 200 }),
	);
	await fs.writeFile(
		`${added}.cursor.json`,
		JSON.stringify({
			samples: [
				{ timeMs: 200, cx: 0.2, cy: 0.4, interactionType: "click", cursorType: "pointer" },
				{
					timeMs: 260,
					cx: 0.2,
					cy: 0.4,
					interactionType: "mouseup",
					cursorType: "pointer",
				},
				{ timeMs: 600, cx: 0.4, cy: 0.5, interactionType: "right-click" },
			],
		}),
	);
	const original = await fs.readFile(base);
	await listRecordings();
	const thumbnail = await getRecordingThumbnail(base);
	expect(thumbnail).toMatch(/^data:image\/jpeg;base64,/);
	const jpeg = Buffer.from(thumbnail.split(",")[1], "base64");
	expect([...jpeg.subarray(0, 2)]).toEqual([0xff, 0xd8]);
	expect(await getRecordingThumbnail(base)).toBe(thumbnail);
	await expect(getRecordingThumbnail("/tmp/unapproved.mp4")).rejects.toThrow("outside");
	const result = await importRecording(base, added);
	expect(result.sourceStartMs).toBeCloseTo(1000, -1);
	expect(result.durationMs).toBeCloseTo(1000, -1);
	expect(result.webcam?.visibleRanges).toEqual([{ startMs: 1200, endMs: 2000 }]);
	const cursor = JSON.parse(await fs.readFile(`${result.path}.cursor.json`, "utf8")).samples;
	expect(
		cursor.map((point: { timeMs: number; interactionType: string }) => [
			point.timeMs,
			point.interactionType,
		]),
	).toEqual([
		[1200, "click"],
		[1260, "mouseup"],
		[1600, "right-click"],
	]);
	expect(cursor[0].cursorType).toBe("pointer");
	expect(cursor[0].cx).toBeCloseTo(0.405078125);
	const webcamPixels = await run(
		ffmpeg,
		[
			"-v",
			"error",
			"-ss",
			"1.5",
			"-i",
			result.webcam!.sourcePath!,
			"-vf",
			"crop=2:2:40:30",
			"-frames:v",
			"1",
			"-f",
			"rawvideo",
			"-pix_fmt",
			"rgb24",
			"-",
		],
		{ encoding: "buffer" },
	);
	expect(webcamPixels.stdout[1]).toBeGreaterThan(200);
	const companions = await getCompanionAudioFallbackInfo(result.path);
	expect(companions.paths).toHaveLength(2);
	expect(companions.paths.every((file) => file.endsWith(".wav"))).toBe(true);
	await run(ffmpeg, ["-v", "error", "-i", result.path, "-f", "null", "-"]);
	const pixels = await run(
		ffmpeg,
		[
			"-v",
			"error",
			"-ss",
			"1.5",
			"-i",
			result.path,
			"-vf",
			"crop=2:2:80:44",
			"-frames:v",
			"1",
			"-f",
			"rawvideo",
			"-pix_fmt",
			"rgb24",
			"-",
		],
		{ encoding: "buffer" },
	);
	expect(pixels.stdout[2]).toBeGreaterThan(200); // blue centre survives aspect-ratio fitting
	const second = await importRecording(result.path, added);
	expect(second.sourceStartMs).toBeCloseTo(2000, -1);
	expect(second.webcam?.visibleRanges).toEqual([
		{ startMs: 1200, endMs: 2000 },
		{ startMs: 2200, endMs: 3000 },
	]);
	await discardRecordingImport(result.path);
	await expect(fs.access(result.path)).rejects.toThrow();
	await expect(fs.access(result.path.replace(/\.mp4$/, ".mic.wav"))).rejects.toThrow();
	await expect(fs.access(result.path.replace(/\.mp4$/, "-webcam.mp4"))).rejects.toThrow();
	await expect(
		fs.access(result.path.replace(/\.mp4$/, ".recordly-session.json")),
	).rejects.toThrow();
	await expect(fs.access(`${result.path}.webcam-ranges.json`)).rejects.toThrow();
	await expect(fs.access(`${result.path}.cursor.json`)).rejects.toThrow();
	await expect(fs.access(second.path)).resolves.toBeUndefined();
	expect(await fs.readFile(base)).toEqual(original);
	expect((await listRecordings()).map((entry) => entry.path).sort()).toEqual(
		[base, added].sort(),
	);
	await expect(importRecording("/tmp/unapproved.mp4", added)).rejects.toThrow(
		"no longer available",
	);
}, 60000);

it("retains staged originals for undo when the OS refuses Trash", async () => {
	const { shell } = await import("electron");
	const file = path.join(state.root, "recording-failure.mp4");
	await fs.writeFile(file, "original");
	await setRecordingsRemoved([file], true);
	vi.mocked(shell.trashItem).mockRejectedValueOnce(new Error("Trash unavailable"));
	await expect(clearRecordingTrashUndo()).rejects.toThrow("Trash unavailable");
	await setRecordingsRemoved([file], false);
	expect(await fs.readFile(file, "utf8")).toBe("original");
});

it("undo never overwrites a new file at the original location", async () => {
	const file = path.join(state.root, "recording-conflict.mp4");
	await fs.writeFile(file, "original");
	await setRecordingsRemoved([file], true);
	await fs.writeFile(file, "new recording");
	await expect(setRecordingsRemoved([file], false)).rejects.toThrow("already exists");
	expect(await fs.readFile(file, "utf8")).toBe("new recording");
});

it("cancels an active import and removes partial outputs without changing originals", async () => {
	const base = path.join(state.root, "recording-base.mp4");
	const added = path.join(state.root, "recording-added.mp4");
	await run(ffmpeg, [
		"-v",
		"error",
		"-f",
		"lavfi",
		"-i",
		"color=c=red:s=640x480:r=30:d=10",
		"-c:v",
		"libx264",
		"-pix_fmt",
		"yuv420p",
		base,
	]);
	await fs.copyFile(base, added);
	state.approved.add(base);
	const original = await fs.readFile(base);
	const controller = new AbortController();
	const importing = importRecording(base, added, undefined, controller.signal);
	const rejected = expect(importing).rejects.toMatchObject({ name: "AbortError" });
	await vi.waitFor(async () => {
		const files = await fs.readdir(path.join(state.root, ".recordly-media"));
		expect(files.some((name) => name.startsWith("import-"))).toBe(true);
	});
	controller.abort();
	await rejected;
	expect(await fs.readdir(path.join(state.root, ".recordly-media"))).toEqual([]);
	expect(await fs.readFile(base)).toEqual(original);
	expect(await fs.readFile(added)).toEqual(original);
});

it("restores on volumes without hard links and preserves conflicts", async () => {
	const file = path.join(state.root, "recording-exfat.mp4");
	await fs.writeFile(file, "recording");
	await setRecordingsRemoved([file], true);
	const link = vi
		.spyOn(fs, "link")
		.mockRejectedValue(Object.assign(new Error("unsupported"), { code: "ENOTSUP" }));
	try {
		await setRecordingsRemoved([file], false);
		expect(await fs.readFile(file, "utf8")).toBe("recording");
	} finally {
		link.mockRestore();
	}
});

it("Raw includes camera and audio sources without including metadata or symlinks", async () => {
 const files = ["screen.mp4", "screen.webcam.mp4", "screen.mic.wav", "screen.system.m4a"];
 for (const name of [...files, "screen.cursor.json"]) await fs.writeFile(path.join(state.root, name), "fixture");
 await fs.symlink(path.join(state.root, "screen.mp4"), path.join(state.root, "linked.mp4"));
 expect((await listRecordings(true)).map(entry => entry.name).sort()).toEqual(files.sort());
 expect((await listRecordings()).map(entry => entry.name)).toEqual(["screen.mp4"]);
});
