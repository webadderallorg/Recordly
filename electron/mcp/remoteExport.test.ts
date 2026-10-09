import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { IpcMain } from "electron";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
	app: { getPath: () => os.tmpdir(), isPackaged: false },
	ipcMain: { on: vi.fn() },
}));

const {
	buildChapterMetadata,
	buildPadFilter,
	buildPostArgs,
	buildPostSpec,
	createRemoteExport,
	escapeChapterTitle,
	isSameFile,
	rebaseChapters,
} = await import("./remoteExport");
type LoadScenes = import("./remoteExport").LoadScenes;
type ExportedInfo = import("./remoteExport").ExportedVideoInfo;
type VerifyFrames = import("./remoteExport").VerifyFrames;

let dir: string;
let videoPath: string;

beforeEach(async () => {
	dir = await fs.mkdtemp(path.join(os.tmpdir(), "recordly-remote-export-"));
	videoPath = path.join(dir, "recording-1.mp4");
	await fs.writeFile(videoPath, "");
});
afterEach(async () => {
	vi.useRealTimers();
	await fs.rm(dir, { recursive: true, force: true });
});

function fakeEditor() {
	return Object.assign(new EventEmitter(), {
		send: vi.fn(),
		isDestroyed: () => false,
		isCrashed: () => false,
	});
}

const info = { width: 1920, height: 1080, durationMs: 60_000, fps: 30 };

function setup(
	runFfmpeg: (args: string[]) => Promise<void> = async () => undefined,
	probeVideo: (path: string) => Promise<ExportedInfo> = async () => info,
	verifyFrames: VerifyFrames = async () => ({ warnings: [] }),
	loadScenes?: LoadScenes,
) {
	const ipc = new EventEmitter();
	const remote = createRemoteExport({
		ipc: ipc as unknown as IpcMain,
		recordingsDir: async () => dir,
		runFfmpeg,
		probeVideo,
		verifyFrames,
		loadScenes,
	});
	const editor = fakeEditor();
	const ready = (target: string | null, sender = editor) =>
		ipc.emit("remote-editor-ready", { sender }, { videoPath: target, ready: target !== null });
	const sent = (times = 1) => vi.waitFor(() => expect(editor.send).toHaveBeenCalledTimes(times));
	const lastRequest = () => editor.send.mock.lastCall?.[1] as RemoteExportRequest;
	const reply = (result: Omit<RemoteExportResult, "id">) =>
		ipc.emit("remote-export-result", {}, { id: lastRequest().id, ...result });
	const progress = (value: number) =>
		ipc.emit("remote-export-progress", {}, { id: lastRequest().id, progress: value });
	return { remote, editor, ready, sent, lastRequest, reply, progress };
}

describe("output path validation", () => {
	it.each([
		[{ outputPath: "out.mp4" }, /absolute/],
		[{ outputPath: "/tmp/out.mov" }, /\.mp4/],
		[{ outputPath: "/tmp/out.mp4", format: "gif" as const }, /\.gif/],
		[{ outputPath: "/no/such/dir/out.mp4" }, /folder does not exist/],
	])("rejects %o", async (args, message) => {
		const { remote } = setup();
		await expect(remote.exportVideo({ videoPath, ...args })).rejects.toThrow(message);
		expect(remote.getStatus().state).toBe("idle");
	});

	it("rejects a whitespace-only path and a folder", async () => {
		const { remote } = setup();
		await expect(remote.exportVideo({ videoPath, outputPath: "   " })).rejects.toThrow(/empty/);
		const folder = path.join(dir, "folder.mp4");
		await fs.mkdir(folder);
		await expect(
			remote.exportVideo({ videoPath, outputPath: folder, overwrite: true }),
		).rejects.toThrow(/not a regular file/);
		expect(remote.getStatus().state).toBe("idle");
	});

	it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
		"rejects an unwritable folder",
		async () => {
			const { remote } = setup();
			const locked = path.join(dir, "locked");
			await fs.mkdir(locked, { mode: 0o500 });
			await expect(
				remote.exportVideo({ videoPath, outputPath: path.join(locked, "out.mp4") }),
			).rejects.toThrow(/cannot write/);
			expect(remote.getStatus().state).toBe("idle");
		},
	);

	it("keeps surrounding spaces in a real file name", async () => {
		const { remote, ready, sent, lastRequest, reply } = setup();
		const spaced = path.join(dir, " demo .mp4");
		ready(videoPath);
		const pending = remote.exportVideo({ videoPath, outputPath: spaced });
		await sent();
		expect(lastRequest().outputPath).toBe(spaced);
		reply({ ok: true, path: spaced });
		await pending;
	});

	it("rejects when there is no recording", async () => {
		const { remote } = setup();
		await expect(remote.exportVideo({ videoPath: null })).rejects.toThrow(/no recording/);
	});

	it("rejects a recording file that is not on disk", async () => {
		const { remote } = setup();
		await expect(remote.exportVideo({ videoPath: path.join(dir, "gone.mp4") })).rejects.toThrow(
			/no recording file at/,
		);
		expect(remote.getStatus().state).toBe("idle");
	});

	it("refuses to overwrite unless asked, and never the recording itself", async () => {
		const { remote, ready, sent, reply } = setup();
		const existing = path.join(dir, "taken.mp4");
		await fs.writeFile(existing, "");
		await expect(remote.exportVideo({ videoPath, outputPath: existing })).rejects.toThrow(
			/already exists/,
		);
		await expect(
			remote.exportVideo({ videoPath, outputPath: videoPath, overwrite: true }),
		).rejects.toThrow(/recording itself/);
		const alias = path.join(dir, "alias.mp4");
		await fs.link(videoPath, alias);
		await expect(
			remote.exportVideo({ videoPath, outputPath: alias, overwrite: true }),
		).rejects.toThrow(/recording itself/);
		ready(videoPath);
		const pending = remote.exportVideo({ videoPath, outputPath: existing, overwrite: true });
		await sent();
		reply({ ok: true, path: existing });
		await expect(pending).resolves.toEqual({ status: "done", path: existing, ...info });
	});

	it("defaults to the recordings dir and infers gif from the extension", async () => {
		const { remote, ready, sent, lastRequest, reply } = setup();
		ready(videoPath);
		const first = remote.exportVideo({ videoPath });
		await sent();
		expect(lastRequest()).toEqual({
			id: expect.any(String),
			outputPath: path.join(dir, "recording-1-export.mp4"),
			format: "mp4",
			quality: undefined,
		});
		reply({ ok: true, path: lastRequest().outputPath });
		await first;

		const gifPath = path.join(dir, "clip.gif");
		const second = remote.exportVideo({ videoPath, outputPath: gifPath, quality: "high" });
		await sent(2);
		expect(lastRequest()).toMatchObject({
			format: "gif",
			outputPath: gifPath,
			quality: "high",
		});
		reply({ ok: true, path: gifPath });
		await second;
	});
});

describe("export flow", () => {
	it("waits for the editor to be ready for the requested recording", async () => {
		const { remote, editor, ready, sent, reply } = setup();
		const other = fakeEditor();
		ready(path.join(dir, "older.mp4"), other);
		const pending = remote.exportVideo({ videoPath });
		await vi.waitFor(() => expect(remote.getStatus().state).toBe("waiting-for-editor"));
		expect(editor.send).not.toHaveBeenCalled();
		ready(videoPath);
		await sent();
		expect(other.send).not.toHaveBeenCalled();
		expect(remote.getStatus().state).toBe("exporting");
		reply({ ok: true, path: "/out/final.mp4" });
		await expect(pending).resolves.toEqual({ status: "done", path: "/out/final.mp4", ...info });
		expect(remote.getStatus()).toEqual({
			state: "done",
			progress: 100,
			outputPath: "/out/final.mp4",
			error: null,
		});
	});

	it("fails when the editor never becomes ready", async () => {
		vi.useFakeTimers();
		const { remote } = setup();
		const pending = remote.exportVideo({ videoPath });
		const assertion = expect(pending).rejects.toThrow(/did not finish loading/);
		await vi.waitFor(() => expect(remote.getStatus().state).toBe("waiting-for-editor"));
		await vi.advanceTimersByTimeAsync(45_000);
		await assertion;
		expect(remote.getStatus().state).toBe("failed");
	});

	it("reports an editor error and frees the slot", async () => {
		const { remote, ready, sent, reply } = setup();
		ready(videoPath);
		const pending = remote.exportVideo({ videoPath });
		await sent();
		reply({ ok: false, error: "Encoder crashed" });
		await expect(pending).rejects.toThrow("Encoder crashed");
		expect(remote.getStatus()).toMatchObject({ state: "failed", error: "Encoder crashed" });
		const next = remote.exportVideo({ videoPath });
		await sent(2);
		reply({ ok: true, path: "/out/x.mp4" });
		await expect(next).resolves.toMatchObject({ status: "done" });
	});

	it("fails when the editor reloads mid-export, then retries once it is ready again", async () => {
		const { remote, editor, ready, sent, reply } = setup();
		ready(videoPath);
		ready(videoPath);
		expect(editor.listenerCount("did-start-navigation")).toBe(1);
		const pending = remote.exportVideo({ videoPath });
		await sent();
		editor.emit("did-start-navigation", {}, "app://editor", false, true);
		await expect(pending).rejects.toThrow(/reloaded/);
		const retry = remote.exportVideo({ videoPath });
		await vi.waitFor(() => expect(remote.getStatus().state).toBe("waiting-for-editor"));
		expect(editor.send).toHaveBeenCalledTimes(1);
		ready(videoPath);
		await sent(2);
		reply({ ok: true, path: "/out/retry.mp4" });
		await expect(retry).resolves.toEqual({ status: "done", path: "/out/retry.mp4", ...info });
	});

	it("ignores in-page navigation and skips crashed editors", async () => {
		const { remote, editor, ready, sent, reply } = setup();
		const crashed = Object.assign(fakeEditor(), { isCrashed: () => true });
		ready(videoPath, crashed);
		ready(videoPath);
		editor.emit("did-start-navigation", {}, "app://editor#x", true, true);
		const pending = remote.exportVideo({ videoPath });
		await sent();
		expect(crashed.send).not.toHaveBeenCalled();
		reply({ ok: true, path: "/out/ok.mp4" });
		await expect(pending).resolves.toMatchObject({ status: "done" });
	});

	it("allows one export at a time", async () => {
		const { remote, ready, sent, reply } = setup();
		ready(videoPath);
		const first = remote.exportVideo({ videoPath });
		await expect(remote.exportVideo({ videoPath })).rejects.toThrow(/already running/);
		await sent();
		reply({ ok: true, path: "/out/a.mp4" });
		await first;
	});

	it("forwards progress, deduped and clamped", async () => {
		const { remote, ready, sent, progress, reply } = setup();
		ready(videoPath);
		const onProgress = vi.fn();
		const pending = remote.exportVideo({ videoPath }, { onProgress });
		await sent();
		progress(10.2);
		progress(10.4);
		progress(55);
		progress(40);
		progress(140);
		expect(onProgress.mock.calls).toEqual([[10], [55], [100]]);
		expect(remote.getStatus().progress).toBe(100);
		reply({ ok: true, path: "/out/p.mp4" });
		await pending;
	});

	it("stops waiting for the editor when aborted and frees the slot", async () => {
		const { remote, ready, sent, reply } = setup();
		const controller = new AbortController();
		const pending = remote.exportVideo({ videoPath }, { signal: controller.signal });
		await vi.waitFor(() => expect(remote.getStatus().state).toBe("waiting-for-editor"));
		controller.abort();
		await expect(pending).rejects.toThrow(/canceled/);
		expect(remote.getStatus().state).toBe("failed");
		ready(videoPath);
		const next = remote.exportVideo({ videoPath });
		await sent();
		reply({ ok: true, path: "/out/next.mp4" });
		await expect(next).resolves.toMatchObject({ status: "done" });
	});

	it("detaches from a running export when aborted", async () => {
		const { remote, ready, sent, reply } = setup();
		const controller = new AbortController();
		ready(videoPath);
		const pending = remote.exportVideo({ videoPath }, { signal: controller.signal });
		await sent();
		controller.abort();
		await expect(pending).resolves.toEqual({ status: "still-exporting" });
		expect(remote.getStatus().state).toBe("exporting");
		reply({ ok: true, path: "/out/after.mp4" });
		expect(remote.getStatus()).toMatchObject({ state: "done", outputPath: "/out/after.mp4" });
	});

	it("rejects a signal that is already aborted", async () => {
		const { remote } = setup();
		await expect(
			remote.exportVideo({ videoPath }, { signal: AbortSignal.abort() }),
		).rejects.toThrow();
		expect(remote.getStatus().state).toBe("idle");
	});

	it("returns still-exporting after the cap and keeps tracking", async () => {
		vi.useFakeTimers();
		const { remote, ready, sent, progress, reply } = setup();
		ready(videoPath);
		const onProgress = vi.fn();
		const pending = remote.exportVideo({ videoPath }, { onProgress });
		await sent();
		await vi.advanceTimersByTimeAsync(5 * 60_000);
		await expect(pending).resolves.toEqual({ status: "still-exporting" });
		progress(80);
		expect(onProgress).not.toHaveBeenCalled();
		expect(remote.getStatus()).toMatchObject({ state: "exporting", progress: 80 });
		await expect(remote.exportVideo({ videoPath })).rejects.toThrow(/already running/);
		reply({ ok: true, path: "/out/late.mp4" });
		expect(remote.getStatus()).toMatchObject({ state: "done", outputPath: "/out/late.mp4" });
		expect(vi.getTimerCount()).toBe(0);
	});
});

describe("videoPath", () => {
	it("exports the file it is given, not another one the editor has open", async () => {
		const { remote, ready, sent, lastRequest, reply } = setup();
		const other = path.join(dir, "recording-2.mp4");
		await fs.writeFile(other, "");
		ready(videoPath);
		const pending = remote.exportVideo({ videoPath: other });
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(remote.getStatus().state).toBe("waiting-for-editor");
		ready(other);
		await sent();
		expect(lastRequest().outputPath).toBe(path.join(dir, "recording-2-export.mp4"));
		reply({ ok: true, path: lastRequest().outputPath });
		await pending;
	});
});

describe("aspect and padTo", () => {
	it("letterboxes to a fixed size by fitting first, never stretching", () => {
		const { filter } = buildPadFilter({ padTo: "2880x1600" }) ?? { filter: "" };
		expect(filter).toBe(
			"scale=2880:1600:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=2880:1600:(ow-iw)/2:(oh-ih)/2:black",
		);
	});

	it("pads to an aspect ratio by only growing the canvas", () => {
		const { filter } = buildPadFilter({ aspect: "16:9" }) ?? { filter: "" };
		expect(filter).toContain("pad='ceil(max(iw,ih*16/9)/2)*2':'ceil(max(ih,iw/(16/9))/2)*2'");
		expect(filter).not.toMatch(/scale=\d+:\d+(?!:force)/);
	});

	it.each([
		[{ aspect: "wide" }, /aspect must look like/],
		[{ aspect: "16:0" }, /aspect must look like/],
		[{ padTo: "2881x1600" }, /even/],
		[{ padTo: "9000x1600" }, /larger than/],
		[{ aspect: "16:9", padTo: "2880x1600" }, /not both/],
	])("rejects %o before touching the editor", async (args, message) => {
		const { remote } = setup();
		await expect(remote.exportVideo({ videoPath, ...args })).rejects.toThrow(message);
		expect(remote.getStatus().state).toBe("idle");
	});

	it("rejects padding a gif", async () => {
		const { remote } = setup();
		await expect(
			remote.exportVideo({ videoPath, format: "gif", padTo: "2880x1600" }),
		).rejects.toThrow(/only work with mp4/);
	});

	it("renders to a temp file, pads it with ffmpeg, and leaves only the final file", async () => {
		const runFfmpeg = vi.fn(async (args: string[]) => {
			await fs.writeFile(args[args.length - 1], "padded");
		});
		const { remote, ready, sent, lastRequest, reply } = setup(runFfmpeg);
		const out = path.join(dir, "final.mp4");
		ready(videoPath);
		const pending = remote.exportVideo({ videoPath, outputPath: out, padTo: "2880x1600" });
		await sent();
		const rendered = lastRequest().outputPath;
		expect(rendered).not.toBe(out);
		await fs.writeFile(rendered, "raw");
		reply({ ok: true, path: rendered });
		await expect(pending).resolves.toEqual({ status: "done", path: out, ...info });
		const args = runFfmpeg.mock.calls[0][0];
		expect(args[args.indexOf("-vf") + 1]).toContain("pad=2880:1600");
		expect(args[args.indexOf("-i") + 1]).toBe(rendered);
		expect(await fs.readFile(out, "utf8")).toBe("padded");
		expect((await fs.readdir(dir)).sort()).toEqual(["final.mp4", "recording-1.mp4"]);
		expect(remote.getStatus()).toMatchObject({ state: "done", outputPath: out });
	});

	it("reports a padding failure plainly", async () => {
		const { remote, ready, sent, lastRequest, reply } = setup(async () => {
			throw new Error("Invalid argument");
		});
		ready(videoPath);
		const pending = remote.exportVideo({ videoPath, aspect: "1:1" });
		await sent();
		reply({ ok: true, path: lastRequest().outputPath });
		await expect(pending).rejects.toThrow(/padding it failed: Invalid argument/);
		expect(remote.getStatus().state).toBe("failed");
	});

	it("keeps the unpadded video when padding fails", async () => {
		const { remote, ready, sent, lastRequest, reply } = setup(async () => {
			throw new Error("Invalid argument");
		});
		const out = path.join(dir, "final.mp4");
		ready(videoPath);
		const pending = remote.exportVideo({ videoPath, outputPath: out, padTo: "2880x1600" });
		await sent();
		await fs.writeFile(lastRequest().outputPath, "raw");
		reply({ ok: true, path: lastRequest().outputPath });
		await expect(pending).rejects.toThrow(/The unpadded video is at/);
		expect(await fs.readFile(out, "utf8")).toBe("raw");
		expect((await fs.readdir(dir)).sort()).toEqual(["final.mp4", "recording-1.mp4"]);
	});

	it("removes the pre-pad file when the editor's export fails", async () => {
		const { remote, ready, sent, lastRequest, reply } = setup();
		ready(videoPath);
		const pending = remote.exportVideo({
			videoPath,
			outputPath: path.join(dir, "final.mp4"),
			padTo: "2880x1600",
		});
		await sent();
		await fs.writeFile(lastRequest().outputPath, "half");
		reply({ ok: false, error: "Encoder crashed" });
		await expect(pending).rejects.toThrow("Encoder crashed");
		expect(await fs.readdir(dir)).toEqual(["recording-1.mp4"]);
	});

	it("leaves a file that already sits at a temp path alone", async () => {
		const runFfmpeg = vi.fn(async (args: string[]) => {
			await fs.writeFile(args[args.length - 1], "padded");
		});
		const { remote, ready, sent, lastRequest, reply } = setup(runFfmpeg);
		const out = path.join(dir, "final.mp4");
		const prepad = path.join(dir, ".final.prepad.mp4");
		const staged = `${out}.padding.mp4`;
		await fs.writeFile(prepad, "mine");
		await fs.writeFile(staged, "mine");
		ready(videoPath);
		const pending = remote.exportVideo({ videoPath, outputPath: out, padTo: "2880x1600" });
		await sent();
		await fs.writeFile(lastRequest().outputPath, "raw");
		reply({ ok: true, path: lastRequest().outputPath });
		await expect(pending).resolves.toEqual({ status: "done", path: out, ...info });
		expect(await fs.readFile(prepad, "utf8")).toBe("mine");
		expect(await fs.readFile(staged, "utf8")).toBe("mine");
	});
});

describe("scale, fps and posterAtMs", () => {
	it("chains pad, then scale, then fps into one filter", () => {
		const spec = buildPostSpec({ videoPath, aspect: "16:9", scale: 0.5, fps: 24 });
		const filter = spec?.filter ?? "";
		expect(filter.indexOf("pad=")).toBeLessThan(filter.indexOf("scale=trunc(iw*0.5/2)*2"));
		expect(filter.indexOf("scale=trunc")).toBeLessThan(filter.indexOf("fps=24"));
		expect(buildPostSpec({ videoPath })).toBeNull();
		expect(buildPostSpec({ videoPath, fps: 30 })?.label).toBe("post-processing");
	});

	it.each([
		[{ scale: 0 }, /scale must be a number from 0.05 to 1/],
		[{ scale: -1 }, /scale must be/],
		[{ scale: Number.NaN }, /scale must be/],
		[{ scale: Number.POSITIVE_INFINITY }, /scale must be/],
		[{ scale: 2 }, /scale must be/],
		[{ scale: "half" as unknown as number }, /scale must be/],
		[{ fps: 0 }, /fps must be a number from 1 to 120/],
		[{ fps: -30 }, /fps must be/],
		[{ fps: Number.NaN }, /fps must be/],
		[{ fps: 1000 }, /fps must be a number from 1 to 120/],
		[{ posterAtMs: -1 }, /posterAtMs must be 0 or more/],
		[{ posterAtMs: Number.NaN }, /posterAtMs must be/],
		[{ padTo: "2880x1600", scale: 0.5 }, /either padTo or scale/],
	])("rejects %o before touching the editor", async (args, message) => {
		const { remote, editor } = setup();
		await expect(remote.exportVideo({ videoPath, ...args })).rejects.toThrow(message);
		expect(remote.getStatus().state).toBe("idle");
		expect(editor.send).not.toHaveBeenCalled();
		expect(await fs.readdir(dir)).toEqual(["recording-1.mp4"]);
	});

	it("rejects a gif export with any of them", async () => {
		const { remote } = setup();
		for (const extra of [{ scale: 0.5 }, { fps: 24 }, { posterAtMs: 100 }]) {
			await expect(
				remote.exportVideo({ videoPath, format: "gif", ...extra }),
			).rejects.toThrow(/only work with mp4/);
		}
	});

	it("reports frames the exported file is missing", async () => {
		const verify = vi.fn(async () => ({
			warnings: ["14.0 s of frames are a single flat colour with no video content (38.0 s)"],
		}));
		const { remote, ready, sent, lastRequest, reply } = setup(undefined, undefined, verify);
		const out = path.join(dir, "blank.mp4");
		ready(videoPath);
		const pending = remote.exportVideo({ videoPath, outputPath: out });
		await sent();
		await fs.writeFile(lastRequest().outputPath, "raw");
		reply({ ok: true, path: lastRequest().outputPath });
		await expect(pending).resolves.toMatchObject({
			status: "done",
			warnings: ["14.0 s of frames are a single flat colour with no video content (38.0 s)"],
		});
		expect(verify).toHaveBeenCalledWith(out, info.durationMs, undefined, undefined);
	});

	it("says nothing extra when every sampled frame has a picture", async () => {
		const { remote, ready, sent, lastRequest, reply } = setup();
		const out = path.join(dir, "fine.mp4");
		ready(videoPath);
		const pending = remote.exportVideo({ videoPath, outputPath: out });
		await sent();
		await fs.writeFile(lastRequest().outputPath, "raw");
		reply({ ok: true, path: lastRequest().outputPath });
		const result = await pending;
		expect(result).toMatchObject({ status: "done" });
		expect(result).not.toHaveProperty("warnings");
	});

	it("keeps a finished export when the frame check itself fails", async () => {
		const verify = vi.fn(async () => {
			throw new Error("ffmpeg is missing");
		});
		const { remote, ready, sent, lastRequest, reply } = setup(undefined, undefined, verify);
		const out = path.join(dir, "unchecked.mp4");
		ready(videoPath);
		const pending = remote.exportVideo({ videoPath, outputPath: out });
		await sent();
		await fs.writeFile(lastRequest().outputPath, "raw");
		reply({ ok: true, path: lastRequest().outputPath });
		await expect(pending).resolves.toMatchObject({
			status: "done",
			path: out,
			warnings: ["The exported frames could not be checked: ffmpeg is missing"],
		});
	});

	it("scales and resamples in one pass and reports what it wrote", async () => {
		const runFfmpeg = vi.fn(async (args: string[]) => {
			await fs.writeFile(args[args.length - 1], "small");
		});
		const probe = vi.fn(async () => ({ width: 960, height: 540, durationMs: 59_900, fps: 24 }));
		const { remote, ready, sent, lastRequest, reply } = setup(runFfmpeg, probe);
		const out = path.join(dir, "small.mp4");
		ready(videoPath);
		const pending = remote.exportVideo({ videoPath, outputPath: out, scale: 0.5, fps: 24 });
		await sent();
		await fs.writeFile(lastRequest().outputPath, "raw");
		reply({ ok: true, path: lastRequest().outputPath });
		await expect(pending).resolves.toEqual({
			status: "done",
			path: out,
			width: 960,
			height: 540,
			durationMs: 59_900,
			fps: 24,
		});
		expect(runFfmpeg).toHaveBeenCalledTimes(1);
		const args = runFfmpeg.mock.calls[0][0];
		expect(args[args.indexOf("-vf") + 1]).toBe(
			"scale=trunc(iw*0.5/2)*2:trunc(ih*0.5/2)*2,fps=24",
		);
		expect(probe).toHaveBeenCalledWith(out, undefined);
		expect((await fs.readdir(dir)).sort()).toEqual(["recording-1.mp4", "small.mp4"]);
	});

	it("still reports done, with a note, when the file cannot be read back", async () => {
		const { remote, ready, sent, lastRequest, reply } = setup(undefined, async () => {
			throw new Error("FFmpeg did not report a video stream.");
		});
		ready(videoPath);
		const pending = remote.exportVideo({ videoPath, outputPath: path.join(dir, "o.mp4") });
		await sent();
		reply({ ok: true, path: lastRequest().outputPath });
		const result = await pending;
		expect(result).toMatchObject({ status: "done", path: path.join(dir, "o.mp4") });
		expect(result).toHaveProperty(
			"probeNote",
			expect.stringContaining("could not be read back"),
		);
		expect(result).not.toHaveProperty("width");
	});

	it("attaches the poster frame in the same pass, backing off the very end", () => {
		const args = buildPostArgs("/in.mp4", "/out.mp4", { filter: "fps=24", posterAtMs: 40_000 });
		expect(args[args.indexOf("-ss") + 1]).toBe("40.000");
		expect(args).toContain("attached_pic");
		expect(args[args.indexOf("-filter_complex") + 1]).toBe(
			"[0:v]fps=24[v];[1:v]format=yuvj420p,trim=end_frame=1,setpts=PTS-STARTPTS[p]",
		);
		expect(args).toContain("0:a?");
	});

	it("rejects a poster past the end of the export and keeps the unprocessed video", async () => {
		const runFfmpeg = vi.fn(async () => undefined);
		const { remote, ready, sent, lastRequest, reply } = setup(runFfmpeg, async () => info);
		const out = path.join(dir, "final.mp4");
		ready(videoPath);
		const pending = remote.exportVideo({ videoPath, outputPath: out, posterAtMs: 90_000 });
		await sent();
		await fs.writeFile(lastRequest().outputPath, "raw");
		reply({ ok: true, path: lastRequest().outputPath });
		await expect(pending).rejects.toThrow(/posterAtMs 90000 is past the end .*60000 ms/);
		await expect(pending).rejects.toThrow(/The unprocessed video is at/);
		expect(runFfmpeg).not.toHaveBeenCalled();
		expect(await fs.readFile(out, "utf8")).toBe("raw");
		expect((await fs.readdir(dir)).sort()).toEqual(["final.mp4", "recording-1.mp4"]);
	});

	it("seeks the poster at the requested time and leaves no temp files", async () => {
		const runFfmpeg = vi.fn(async (args: string[]) => {
			await fs.writeFile(args[args.length - 1], "with poster");
		});
		const { remote, ready, sent, lastRequest, reply } = setup(runFfmpeg);
		const out = path.join(dir, "final.mp4");
		ready(videoPath);
		const pending = remote.exportVideo({ videoPath, outputPath: out, posterAtMs: 60_000 });
		await sent();
		await fs.writeFile(lastRequest().outputPath, "raw");
		reply({ ok: true, path: lastRequest().outputPath });
		await expect(pending).resolves.toMatchObject({ status: "done", path: out });
		const args = runFfmpeg.mock.calls[0][0];
		expect(args[args.indexOf("-ss") + 1]).toBe("59.960");
		expect((await fs.readdir(dir)).sort()).toEqual(["final.mp4", "recording-1.mp4"]);
	});

	it("keeps the unprocessed video and removes temp files when the pass fails", async () => {
		const { remote, ready, sent, lastRequest, reply } = setup(async () => {
			throw new Error("Invalid argument");
		});
		const out = path.join(dir, "final.mp4");
		ready(videoPath);
		const pending = remote.exportVideo({ videoPath, outputPath: out, fps: 24 });
		await sent();
		await fs.writeFile(lastRequest().outputPath, "raw");
		reply({ ok: true, path: lastRequest().outputPath });
		await expect(pending).rejects.toThrow(
			/post-processing it failed: Invalid argument. The unprocessed video is at/,
		);
		expect((await fs.readdir(dir)).sort()).toEqual(["final.mp4", "recording-1.mp4"]);
	});
});

describe("isSameFile", () => {
	const real = { dev: 1n, ino: 42n };
	const other = { dev: 1n, ino: 43n };
	const unknown = { dev: 0n, ino: 0n };

	it("matches the same inode under another name", () => {
		expect(isSameFile("/rec/a.mp4", real, "/rec/b.mp4", real)).toBe(true);
		expect(isSameFile("/rec/a.mp4", real, "/rec/b.mp4", other)).toBe(false);
	});

	it("falls back to the resolved path when the inode is unknown", () => {
		expect(isSameFile("/rec/a.mp4", unknown, "/rec/b.mp4", unknown)).toBe(false);
		expect(isSameFile("/rec/x/../a.mp4", unknown, "/rec/a.mp4", unknown)).toBe(true);
	});

	it("compares paths case-insensitively only on Windows", () => {
		expect(isSameFile("/Rec/A.mp4", unknown, "/rec/a.mp4", unknown, "win32")).toBe(true);
		expect(isSameFile("/Rec/A.mp4", unknown, "/rec/a.mp4", unknown, "linux")).toBe(false);
	});
});

describe("fromMs and toMs", () => {
	it.each([
		[{ fromMs: 1_000 }, /both fromMs and toMs/],
		[{ toMs: 1_000 }, /both fromMs and toMs/],
		[{ fromMs: -1, toMs: 5_000 }, /fromMs must be 0 or more/],
		[{ fromMs: 5_000, toMs: 5_000 }, /must be greater than fromMs/],
		[{ fromMs: 5_000, toMs: 4_000 }, /must be greater than fromMs/],
		[{ fromMs: 1_000, toMs: 1_050 }, /at least 100 ms/],
		[{ fromMs: Number.NaN, toMs: 5_000 }, /fromMs must be a number of milliseconds/],
		[{ fromMs: 0, toMs: Number.POSITIVE_INFINITY }, /toMs must be a number of milliseconds/],
		[
			{ fromMs: 8_000, toMs: 18_000, posterAtMs: 20_000 },
			/posterAtMs 20000 is outside the range being rendered \(8000 to 18000 ms\)/,
		],
		[{ fromMs: 8_000, toMs: 18_000, posterAtMs: 1_000 }, /outside the range being rendered/],
	])("rejects %o before touching the editor", async (args, message) => {
		const { remote, editor } = setup();
		await expect(remote.exportVideo({ videoPath, ...args })).rejects.toThrow(message);
		expect(remote.getStatus().state).toBe("idle");
		expect(editor.send).not.toHaveBeenCalled();
		expect(await fs.readdir(dir)).toEqual(["recording-1.mp4"]);
	});

	it("asks the editor for the range and reports the fragment it got back", async () => {
		const { remote, ready, sent, lastRequest, reply } = setup();
		const out = path.join(dir, "fragment.mp4");
		ready(videoPath);
		const pending = remote.exportVideo({
			videoPath,
			outputPath: out,
			fromMs: 8_000,
			toMs: 18_000,
		});
		await sent();
		expect(lastRequest()).toMatchObject({ fromMs: 8_000, toMs: 18_000 });
		reply({
			ok: true,
			path: out,
			fromMs: 8_000,
			toMs: 18_000,
			timelineDurationMs: 21_000,
			warnings: ["A zoom was already under way at 8000 ms."],
		});
		const done = await pending;
		expect(done).toMatchObject({
			status: "done",
			fragment: true,
			fragmentFromMs: 8_000,
			fragmentToMs: 18_000,
			warnings: ["A zoom was already under way at 8000 ms."],
		});
		expect((done as { fragmentNote: string }).fragmentNote).toMatch(
			/10000 ms fragment of the edited timeline, from 8000 ms to 18000 ms of 21000 ms/,
		);
		expect((done as { fragmentNote: string }).fragmentNote).toMatch(/not the finished/);
	});

	it("keeps the frame check's own warnings alongside the range warning", async () => {
		const verify = vi.fn(async () => ({ warnings: ["2.0 s of frames are black (1.0 s)"] }));
		const { remote, ready, sent, lastRequest, reply } = setup(undefined, undefined, verify);
		const out = path.join(dir, "fragment.mp4");
		ready(videoPath);
		const pending = remote.exportVideo({ videoPath, outputPath: out, fromMs: 0, toMs: 5_000 });
		await sent();
		reply({ ok: true, path: out, fromMs: 0, toMs: 5_000, timelineDurationMs: 21_000 });
		expect(await pending).toMatchObject({
			fragment: true,
			warnings: ["2.0 s of frames are black (1.0 s)"],
		});
		expect(lastRequest().fromMs).toBe(0);
		expect(verify).toHaveBeenCalledWith(out, info.durationMs, undefined, undefined);
	});

	it("does not call a range over the whole timeline a fragment", async () => {
		const { remote, ready, sent, reply } = setup();
		const out = path.join(dir, "whole.mp4");
		ready(videoPath);
		const pending = remote.exportVideo({ videoPath, outputPath: out, fromMs: 0, toMs: 21_000 });
		await sent();
		reply({ ok: true, path: out, fromMs: 0, toMs: 21_000, timelineDurationMs: 21_000 });
		const done = await pending;
		expect(done).not.toHaveProperty("fragment");
		expect(done).not.toHaveProperty("fragmentNote");
	});

	it("says nothing about a fragment for an ordinary export", async () => {
		const { remote, ready, sent, lastRequest, reply } = setup();
		const out = path.join(dir, "all.mp4");
		ready(videoPath);
		const pending = remote.exportVideo({ videoPath, outputPath: out });
		await sent();
		expect(lastRequest().fromMs).toBeUndefined();
		reply({ ok: true, path: out });
		expect(await pending).not.toHaveProperty("fragment");
	});

	it("seeks the poster relative to the fragment, not the timeline", async () => {
		const calls: string[][] = [];
		const { remote, ready, sent, reply } = setup(async (args) => {
			calls.push(args);
			await fs.writeFile(args[args.length - 1], "");
		});
		const out = path.join(dir, "poster.mp4");
		ready(videoPath);
		const pending = remote.exportVideo({
			videoPath,
			outputPath: out,
			fromMs: 8_000,
			toMs: 18_000,
			posterAtMs: 12_500,
		});
		await sent();
		reply({ ok: true, fromMs: 8_000, toMs: 18_000, timelineDurationMs: 21_000 });
		await pending;
		expect(calls[0]).toContain("4.500");
		expect(calls[0]).not.toContain("12.500");
	});

	it("renders a range for a gif too", async () => {
		const { remote, ready, sent, lastRequest, reply } = setup();
		const out = path.join(dir, "fragment.gif");
		ready(videoPath);
		const pending = remote.exportVideo({
			videoPath,
			outputPath: out,
			fromMs: 8_000,
			toMs: 18_000,
		});
		await sent();
		expect(lastRequest()).toMatchObject({ format: "gif", fromMs: 8_000, toMs: 18_000 });
		reply({ ok: true, path: out, fromMs: 8_000, toMs: 18_000, timelineDurationMs: 21_000 });
		expect(await pending).toMatchObject({ status: "done", fragment: true });
	});

	it("refuses a range while another export is running", async () => {
		const { remote, ready, sent, reply } = setup();
		const out = path.join(dir, "one.mp4");
		ready(videoPath);
		const first = remote.exportVideo({ videoPath, outputPath: out });
		await sent();
		await expect(
			remote.exportVideo({
				videoPath,
				outputPath: path.join(dir, "two.mp4"),
				fromMs: 0,
				toMs: 1_000,
			}),
		).rejects.toThrow(/already running/);
		reply({ ok: true, path: out });
		await first;
	});
});

describe("chapters", () => {
	const scene = (title: string | null, startMs: number, endMs: number) => ({
		title,
		startMs,
		endMs,
	});

	it("escapes the characters that would corrupt the metadata file", () => {
		expect(escapeChapterTitle("a=b;c#d\\e")).toBe("a\\=b\\;c\\#d\\\\e");
		expect(escapeChapterTitle("line one\nline two\r\n[CHAPTER]")).toBe(
			"line one line two [CHAPTER]",
		);
		expect(escapeChapterTitle('say "hi"')).toBe('say "hi"');
		const long = escapeChapterTitle("x".repeat(5000));
		expect(Array.from(long).length).toBe(200);
		expect(long.endsWith("…")).toBe(true);
	});

	it("keeps an injected title on one line of the file", () => {
		const text = buildChapterMetadata([
			{ title: "a\nSTART=999\n[CHAPTER]\ntitle=x", startMs: 0, endMs: 1000 },
		]);
		const lines = text.trimEnd().split("\n");
		expect(lines).toEqual([
			";FFMETADATA1",
			"[CHAPTER]",
			"TIMEBASE=1/1000",
			"START=0",
			"END=1000",
			"title=a START\\=999 [CHAPTER] title\\=x",
		]);
	});

	it("names a blank title by its position", () => {
		expect(
			rebaseChapters([scene(null, 0, 100), scene("  ", 100, 200)]).map((c) => c.title),
		).toEqual(["Scene 1", "Scene 2"]);
	});

	it("rebases scenes onto a fragment, clamping and dropping those outside", () => {
		const scenes = [
			scene("Before", 0, 8_000),
			scene("Straddles start", 7_000, 10_000),
			scene("Inside", 10_000, 15_000),
			scene("Straddles end", 15_000, 25_000),
			scene("After", 25_000, 30_000),
		];
		expect(rebaseChapters(scenes, { fromMs: 8_000, toMs: 18_000 })).toEqual([
			{ title: "Straddles start", startMs: 0, endMs: 2_000 },
			{ title: "Inside", startMs: 2_000, endMs: 7_000 },
			{ title: "Straddles end", startMs: 7_000, endMs: 10_000 },
		]);
	});

	it("keeps a scene that touches the fragment edge only if it has length inside it", () => {
		const scenes = [scene("Ends at from", 0, 8_000), scene("Starts at to", 18_000, 20_000)];
		expect(rebaseChapters(scenes, { fromMs: 8_000, toMs: 18_000 })).toEqual([]);
	});

	it("drops zero-length scenes and stops overlaps", () => {
		expect(
			rebaseChapters([scene("Cut", 500, 500), scene("A", 0, 1_000), scene("B", 800, 2_000)]),
		).toEqual([
			{ title: "A", startMs: 0, endMs: 800 },
			{ title: "B", startMs: 800, endMs: 2_000 },
		]);
	});

	it("writes one chapter into the existing pass alongside padTo and a poster", async () => {
		const calls: string[][] = [];
		let meta = "";
		const loadScenes = vi.fn(async () => [
			scene("Intro", 0, 5_000),
			scene("Demo = 1", 5_000, 20_000),
		]);
		const { remote, ready, sent, reply } = setup(
			async (args) => {
				calls.push(args);
				meta = await fs.readFile(args[args.lastIndexOf("-i") + 1], "utf8");
				await fs.writeFile(args[args.length - 1], "");
			},
			undefined,
			undefined,
			loadScenes,
		);
		const out = path.join(dir, "chapters.mp4");
		ready(videoPath);
		const pending = remote.exportVideo({
			videoPath,
			outputPath: out,
			chapters: true,
			posterAtMs: 1_000,
			padTo: "1920x1080",
		});
		await sent();
		reply({ ok: true });
		const result = await pending;
		expect(calls).toHaveLength(1);
		const args = calls[0];
		expect(args[args.indexOf("-map_chapters") + 1]).toBe("2");
		expect(args).toContain("attached_pic");
		expect(args.join(" ")).toContain("pad=1920:1080");
		expect(meta).toContain("START=5000\nEND=20000\ntitle=Demo \\= 1\n");
		expect(result).toMatchObject({ status: "done", chapters: 2 });
		expect((await fs.readdir(dir)).sort()).toEqual(["chapters.mp4", "recording-1.mp4"]);
	});

	it("remuxes without re-encoding when chapters are the only change", async () => {
		const calls: string[][] = [];
		const { remote, ready, sent, reply } = setup(
			async (args) => {
				calls.push(args);
				await fs.writeFile(args[args.length - 1], "");
			},
			undefined,
			undefined,
			async () => [scene("Only", 0, 60_000)],
		);
		ready(videoPath);
		const pending = remote.exportVideo({
			videoPath,
			outputPath: path.join(dir, "o.mp4"),
			chapters: true,
		});
		await sent();
		reply({ ok: true });
		expect(await pending).toMatchObject({ chapters: 1 });
		expect(calls[0]).toContain("copy");
		expect(calls[0]).not.toContain("libx264");
		expect(calls[0][calls[0].indexOf("-map_chapters") + 1]).toBe("1");
	});

	it("rebases onto the fragment it renders", async () => {
		let meta = "";
		const { remote, ready, sent, reply } = setup(
			async (args) => {
				meta = await fs.readFile(args[args.lastIndexOf("-i") + 1], "utf8");
				await fs.writeFile(args[args.length - 1], "");
			},
			undefined,
			undefined,
			async () => [scene("A", 0, 10_000), scene("B", 10_000, 30_000)],
		);
		ready(videoPath);
		const pending = remote.exportVideo({
			videoPath,
			outputPath: path.join(dir, "f.mp4"),
			chapters: true,
			fromMs: 8_000,
			toMs: 18_000,
		});
		await sent();
		reply({ ok: true, fromMs: 8_000, toMs: 18_000, timelineDurationMs: 30_000 });
		await pending;
		expect(meta).toContain("START=0\nEND=2000\ntitle=A");
		expect(meta).toContain("START=2000\nEND=10000\ntitle=B");
	});

	it("says so, and skips the pass, when the recording has no scenes", async () => {
		const runFfmpeg = vi.fn(async () => undefined);
		const { remote, ready, sent, lastRequest, reply } = setup(
			runFfmpeg,
			undefined,
			undefined,
			async () => ({
				unavailable: "Scene times are only available for a recording an agent drove.",
			}),
		);
		ready(videoPath);
		const out = path.join(dir, "n.mp4");
		const pending = remote.exportVideo({ videoPath, outputPath: out, chapters: true });
		await sent();
		expect(lastRequest().outputPath).toBe(out);
		reply({ ok: true, path: out });
		expect(await pending).toMatchObject({
			status: "done",
			chapters: 0,
			chaptersNote: expect.stringContaining("No chapters were written"),
		});
		expect(runFfmpeg).not.toHaveBeenCalled();
	});

	it("says so when a fragment holds no scene", async () => {
		const runFfmpeg = vi.fn(async () => undefined);
		const { remote, ready, sent, reply } = setup(runFfmpeg, undefined, undefined, async () => [
			scene("Early", 0, 5_000),
		]);
		ready(videoPath);
		const pending = remote.exportVideo({
			videoPath,
			outputPath: path.join(dir, "n.mp4"),
			chapters: true,
			fromMs: 8_000,
			toMs: 18_000,
		});
		await sent();
		reply({ ok: true, fromMs: 8_000, toMs: 18_000, timelineDurationMs: 30_000 });
		expect(await pending).toMatchObject({
			chapters: 0,
			chaptersNote: expect.stringContaining("inside the exported range"),
		});
		expect(runFfmpeg).not.toHaveBeenCalled();
	});

	it("refuses a gif before touching anything", async () => {
		const { remote } = setup(undefined, undefined, undefined, async () => []);
		await expect(
			remote.exportVideo({ videoPath, outputPath: path.join(dir, "a.gif"), chapters: true }),
		).rejects.toThrow(/chapters only work with mp4.*gif/);
		await expect(
			remote.exportVideo({ videoPath, format: "gif", chapters: true }),
		).rejects.toThrow(/chapters only work with mp4/);
		expect(remote.getStatus().state).toBe("idle");
	});

	it("rejects a non-boolean chapters value", async () => {
		const { remote } = setup();
		await expect(
			remote.exportVideo({ videoPath, chapters: "yes" as unknown as boolean }),
		).rejects.toThrow(/chapters must be true or false/);
	});

	it("fails before rendering when the scenes cannot be read", async () => {
		const { remote, ready, editor } = setup(undefined, undefined, undefined, async () => {
			throw new Error("Timed out waiting for the activity log.");
		});
		ready(videoPath);
		await expect(
			remote.exportVideo({ videoPath, outputPath: path.join(dir, "x.mp4"), chapters: true }),
		).rejects.toThrow(/activity log/);
		expect(editor.send).not.toHaveBeenCalled();
		expect(remote.getStatus().state).toBe("failed");
	});

	it("keeps the unprocessed video and cleans up when the chapter pass fails", async () => {
		const { remote, ready, sent, lastRequest, reply } = setup(
			async () => {
				throw new Error("boom");
			},
			undefined,
			undefined,
			async () => [scene("A", 0, 1_000)],
		);
		const out = path.join(dir, "final.mp4");
		ready(videoPath);
		const pending = remote.exportVideo({ videoPath, outputPath: out, chapters: true });
		await sent();
		await fs.writeFile(lastRequest().outputPath, "raw");
		reply({ ok: true, path: lastRequest().outputPath });
		await expect(pending).rejects.toThrow(
			/post-processing it failed: boom.*unprocessed video is at/,
		);
		expect((await fs.readdir(dir)).sort()).toEqual(["final.mp4", "recording-1.mp4"]);
	});

	it("refuses a non-string aspect instead of crashing on it", async () => {
		const { remote, ready } = setup();
		ready(videoPath);
		await expect(
			remote.exportVideo({
				videoPath,
				outputPath: path.join(dir, "bad.mp4"),
				aspect: 16 as unknown as string,
			}),
		).rejects.toThrow(/aspect must look like 16:9/);
	});
});
