import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { getProjectBackupPath, writeProjectFileAtomically } from "./atomicSave";

const policy = vi.hoisted(() => ({ require: vi.fn() }));
vi.mock("./manager", () => ({
	requireLibraryProject: policy.require,
	isLoadableProjectData: (value: { videoPath?: unknown; editor?: unknown }) =>
		typeof value?.videoPath === "string" && Boolean(value.editor),
}));
vi.mock("../ffmpeg/binary", () => ({ getFfmpegBinaryPath: () => "ffmpeg" }));
vi.mock("../utils", () => ({
	normalizeVideoSourcePath: (value: string) => value,
	parseJsonWithByteOrderMark: (value: string) => JSON.parse(value.replace(/^\uFEFF/, "")),
}));
import { relinkProjectRecording, requiredRecordingDurationMs } from "./relinkRecording";

let directory: string;
let target: string;
let replacement: string;
let project: Record<string, unknown>;
const probe = vi.fn();
beforeEach(async () => {
	directory = await fs.mkdtemp(path.join(os.tmpdir(), "recordly-relink-"));
	target = path.join(directory, "edited.recordly");
	replacement = path.join(directory, "moved.mp4");
	project = {
		version: 2,
		projectId: "keep-project-identity",
		videoPath: path.join(directory, "missing.mp4"),
		editor: {
			clipRegions: [{ id: "clip", startMs: 0, endMs: 3000, sourceStartMs: 4000, speed: 2 }],
			wallpaper: "#ff0000",
			audioRegions: [{ startMs: 0, endMs: 90000, audioPath: "music.wav" }],
		},
		history: {
			version: 1,
			values: [
				{ id: "previous", startMs: 0, endMs: 12000, speed: 1 },
				{ startMs: 0, endMs: 12000, speed: 4 },
			],
			past: [{ clipRegions: [0], speedRegions: [1] }],
		},
		futureMetadata: { preserve: true },
	};
	await fs.writeFile(target, JSON.stringify(project));
	await fs.writeFile(replacement, "fixture video; metadata injected");
	policy.require.mockReset().mockResolvedValue(target);
	probe.mockReset().mockResolvedValue({ width: 1920, height: 1080, duration: 12, frameRate: 60 });
});
afterEach(async () => {
	await fs.rm(directory, { recursive: true, force: true });
});

it("reconnects only the source path, preserves edits/history/identity and backs up the original", async () => {
	const original = await fs.readFile(target, "utf-8");
	const choose = vi.fn().mockResolvedValue(replacement);
	await expect(relinkProjectRecording(target, choose, probe)).resolves.toEqual({
		success: true,
		path: target,
	});
	expect(choose).toHaveBeenCalledWith(project.videoPath);
	expect(JSON.parse(await fs.readFile(target, "utf-8"))).toEqual({
		...project,
		videoPath: replacement,
	});
	await expect(fs.readFile(getProjectBackupPath(target), "utf-8")).resolves.toBe(original);
});

it("cancellation leaves the project and backups untouched", async () => {
	await expect(relinkProjectRecording(target, async () => null, probe)).resolves.toEqual({
		success: false,
		canceled: true,
	});
	expect(probe).not.toHaveBeenCalled();
	expect(JSON.parse(await fs.readFile(target, "utf-8"))).toEqual(project);
	await expect(fs.access(getProjectBackupPath(target))).rejects.toMatchObject({ code: "ENOENT" });
});

it("does not replace a source that is already accessible", async () => {
	await fs.writeFile(project.videoPath as string, "restored");
	const choose = vi.fn();
	await expect(relinkProjectRecording(target, choose, probe)).rejects.toThrow(
		"already available",
	);
	expect(choose).not.toHaveBeenCalled();
});

it("validates the project boundary before presenting a file chooser", async () => {
	policy.require.mockRejectedValueOnce(new Error("Project is not in the library"));
	const choose = vi.fn();
	await expect(relinkProjectRecording(target, choose, probe)).rejects.toThrow(
		"not in the library",
	);
	expect(choose).not.toHaveBeenCalled();
});

it.each([
	"decode",
	"short",
	"invalid",
])("rejects %s media without changing the project", async (mode) => {
	if (mode === "decode") probe.mockRejectedValueOnce(new Error("not a video"));
	if (mode === "short")
		probe.mockResolvedValueOnce({ width: 1920, height: 1080, duration: 10, frameRate: 60 });
	if (mode === "invalid")
		probe.mockResolvedValueOnce({ width: 0, height: 1080, duration: Infinity, frameRate: 60 });
	await expect(relinkProjectRecording(target, async () => replacement, probe)).rejects.toThrow(
		mode === "short" ? "relinkRecordingTooShort" : "relinkRecordingInvalid",
	);
	expect(JSON.parse(await fs.readFile(target, "utf-8"))).toEqual(project);
});

it("protects a project changed while its native file chooser was open", async () => {
	const newer = { ...project, editor: { changedByAnotherSave: true } };
	await expect(
		relinkProjectRecording(
			target,
			async () => {
				await writeProjectFileAtomically(target, JSON.stringify(newer));
				return replacement;
			},
			probe,
		),
	).rejects.toThrow("relinkProjectChanged");
	expect(JSON.parse(await fs.readFile(target, "utf-8"))).toEqual(newer);
});

it("requires source spans at clip speeds and old undo bounds, ignoring long music tracks", () => {
	expect(requiredRecordingDurationMs(project)).toBe(12000);
	(project.editor as Record<string, unknown>).clipRegions = [
		{ startMs: 0, endMs: 1000, sourceStartMs: 5000, sourceMaxMs: 25000, speed: 4 },
	];
	expect(requiredRecordingDurationMs(project)).toBe(25000);
});

it("does not change the project when another session replaces the relink request during probing", async () => {
	let current = true;
	probe.mockImplementationOnce(async () => {
		current = false;
		return { width: 1920, height: 1080, duration: 12, frameRate: 60 };
	});
	await expect(
		relinkProjectRecording(
			target,
			async () => replacement,
			probe,
			() => current,
		),
	).rejects.toThrow("relinkProjectChanged");
	expect(JSON.parse(await fs.readFile(target, "utf-8"))).toEqual(project);
});

it("rejects a supported filename symlink whose target cannot be served by the media bridge", async () => {
	const unsupported = path.join(directory, "movie.dat");
	await fs.rename(replacement, unsupported);
	await fs.symlink(unsupported, replacement);
	await expect(relinkProjectRecording(target, async () => replacement, probe)).rejects.toThrow(
		"relinkRecordingInvalid",
	);
	expect(probe).not.toHaveBeenCalled();
	expect(JSON.parse(await fs.readFile(target, "utf-8"))).toEqual(project);
});

it("reconnects a recovered project with a damaged primary without losing the good backup", async () => {
	const original = JSON.stringify(project);
	await writeProjectFileAtomically(target, original);
	await fs.writeFile(target, "damaged");
	await expect(
		relinkProjectRecording(target, async () => replacement, probe),
	).resolves.toMatchObject({ success: true, path: target });
	expect(JSON.parse(await fs.readFile(target, "utf-8"))).toEqual({
		...project,
		videoPath: replacement,
	});
	expect(await fs.readFile(getProjectBackupPath(target), "utf-8")).toBe(original);
});

it("does not overwrite a newer primary while reconnecting recovered media", async () => {
	await writeProjectFileAtomically(target, JSON.stringify(project));
	await fs.writeFile(target, "damaged");
	const newer = { ...project, editor: { updated: true } };
	await expect(
		relinkProjectRecording(
			target,
			async () => {
				await writeProjectFileAtomically(target, JSON.stringify(newer));
				return replacement;
			},
			probe,
		),
	).rejects.toThrow("relinkProjectChanged");
	expect(JSON.parse(await fs.readFile(target, "utf-8"))).toEqual(newer);
});
