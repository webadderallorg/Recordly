import { execFile } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { IpcMain } from "electron";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentActivityLog } from "./agentActivity";

vi.mock("electron", () => ({
	app: { getPath: () => os.tmpdir(), isPackaged: false },
	ipcMain: { on: vi.fn() },
}));

const {
	contactSheetArgs,
	createRemoteReview,
	freezeArgs,
	longestStill,
	normalizeClips,
	parseFreezes,
	pickEvenly,
	planSheet,
	summarize,
} = await import("./reviewRecording");
const { loadFfmpegStatic } = await import("../ipc/ffmpeg/binary");

const VIDEO = path.resolve("/rec/recording-1.mp4");

function timeline(
	keep: [number, number][] = [],
	overrides: Partial<RemoteReviewTimeline> = {},
): RemoteReviewTimeline {
	let cursor = 0;
	const clips = keep.map(([from, to]) => {
		const clip = { startMs: cursor, endMs: cursor + to - from, sourceStartMs: from, speed: 1 };
		cursor = clip.endMs;
		return clip;
	});
	const sourceDurationMs = overrides.sourceDurationMs ?? 10_000;
	return {
		clips,
		zooms: 0,
		captions: 0,
		durationMs: clips.length > 0 ? cursor : sourceDurationMs,
		sourceDurationMs,
		width: 1920,
		height: 1080,
		...overrides,
	};
}

const log = (failed: boolean[]): AgentActivityLog => ({
	version: 1,
	spans: [],
	scenes: failed.map((sceneFailed, index) => ({
		startMs: index * 1000,
		endMs: index * 1000 + 500,
		failed: sceneFailed,
	})),
});

describe("summary", () => {
	it("treats an untouched timeline as one clip with no cuts", () => {
		const { summary } = summarize(VIDEO, timeline(), null);
		expect(summary).toMatchObject({
			rawDurationMs: 10_000,
			finalDurationMs: 10_000,
			removedMs: 0,
			cuts: 0,
			scenes: 0,
			failedScenes: 0,
			frames: [
				{ timeMs: 0, label: "start" },
				{ timeMs: 9800, label: "end" },
			],
		});
	});

	it("counts the lead-in, gaps and tail of a director's cut, with a frame before each cut", () => {
		const { summary, frames } = summarize(
			VIDEO,
			timeline(
				[
					[2000, 5000],
					[8000, 12_000],
					[15_000, 18_000],
				],
				{ sourceDurationMs: 20_000, zooms: 3, captions: 2 },
			),
			log([false, true, false]),
		);
		expect(summary).toMatchObject({
			rawDurationMs: 20_000,
			finalDurationMs: 10_000,
			removedMs: 10_000,
			cuts: 4,
			zooms: 3,
			captions: 2,
			scenes: 3,
			failedScenes: 1,
		});
		expect(frames).toEqual([
			{ timeMs: 0, sourceMs: 2000, label: "start" },
			{ timeMs: 2800, sourceMs: 4800, label: "before cut 1" },
			{ timeMs: 6800, sourceMs: 11_800, label: "before cut 2" },
			{ timeMs: 9800, sourceMs: 17_800, label: "end" },
		]);
	});

	it("handles every clip cut except one", () => {
		const { summary, frames } = summarize(VIDEO, timeline([[4000, 6000]]), null);
		expect(summary).toMatchObject({ finalDurationMs: 2000, removedMs: 8000, cuts: 2 });
		expect(frames).toEqual([
			{ timeMs: 0, sourceMs: 4000, label: "start" },
			{ timeMs: 1800, sourceMs: 5800, label: "end" },
		]);
	});

	it("handles videos shorter than a second", () => {
		expect(summarize(VIDEO, timeline([], { sourceDurationMs: 500 }), null).frames).toEqual([
			{ timeMs: 0, sourceMs: 0, label: "start" },
			{ timeMs: 300, sourceMs: 300, label: "end" },
		]);
		expect(summarize(VIDEO, timeline([], { sourceDurationMs: 150 }), null).frames).toEqual([
			{ timeMs: 0, sourceMs: 0, label: "start" },
		]);
	});

	it("does not count a split that keeps the source continuous as a cut", () => {
		const { summary } = summarize(
			VIDEO,
			timeline([
				[0, 5000],
				[5000, 10_000],
			]),
			null,
		);
		expect(summary.cuts).toBe(0);
		expect(summary.frames.map((frame) => frame.label)).toEqual(["start", "end"]);
	});

	it("maps sped-up clips between source and timeline time", () => {
		const { frames } = summarize(
			VIDEO,
			{
				...timeline(),
				clips: [{ startMs: 0, endMs: 5000, sourceStartMs: 0, speed: 2 }],
				durationMs: 5000,
			},
			null,
		);
		expect(frames.at(-1)).toEqual({ timeMs: 4900, sourceMs: 9800, label: "end" });
	});

	it("picks at most nine frames evenly, keeping the first and last", () => {
		const keep = Array.from({ length: 12 }, (_, index): [number, number] => [
			index * 2000,
			index * 2000 + 1000,
		]);
		const { frames } = summarize(VIDEO, timeline(keep, { sourceDurationMs: 24_000 }), null);
		expect(frames).toHaveLength(9);
		expect(frames[0].label).toBe("start");
		expect(frames.at(-1)?.label).toBe("end");
		expect(new Set(frames.map((frame) => frame.timeMs)).size).toBe(9);
		expect(pickEvenly([1, 2, 3], 9)).toEqual([1, 2, 3]);
		expect(pickEvenly([0, 1, 2, 3, 4], 3)).toEqual([0, 2, 4]);
	});

	it("drops broken clips, clamps to the source and defaults the speed", () => {
		expect(
			normalizeClips({
				...timeline(),
				clips: [
					{ startMs: 0, endMs: 0, sourceStartMs: 0, speed: 1 },
					{ startMs: Number.NaN, endMs: 10, sourceStartMs: 0, speed: 1 },
					{ startMs: 0, endMs: 20_000, sourceStartMs: 0, speed: 0 },
				],
			}),
		).toEqual([{ startMs: 0, endMs: 20_000, sourceStartMs: 0, sourceEndMs: 10_000, speed: 1 }]);
	});
});

describe("stills", () => {
	const clips = normalizeClips(
		timeline(
			[
				[0, 5000],
				[10_000, 15_000],
			],
			{ sourceDurationMs: 20_000 },
		),
	);

	it("parses freeze intervals, closing an open one at the end", () => {
		const stderr = [
			"[freezedetect @ 0x1] lavfi.freezedetect.freeze_end: 0.5",
			"[freezedetect @ 0x1] lavfi.freezedetect.freeze_start: 1.25",
			"[freezedetect @ 0x1] lavfi.freezedetect.freeze_duration: 2",
			"[freezedetect @ 0x1] lavfi.freezedetect.freeze_end: 3.25",
			"[freezedetect @ 0x1] lavfi.freezedetect.freeze_start: 8",
		].join("\n");
		expect(parseFreezes(stderr, 10_000)).toEqual([
			{ startMs: 1250, endMs: 3250 },
			{ startMs: 8000, endMs: 10_000 },
		]);
		expect(parseFreezes("", 10_000)).toEqual([]);
	});

	it("keeps only the kept part of a freeze and joins it across a cut", () => {
		expect(longestStill([], clips)).toBe(0);
		expect(longestStill([{ startMs: 1000, endMs: 2500 }], clips)).toBe(1500);
		expect(longestStill([{ startMs: 6000, endMs: 9000 }], clips)).toBe(0);
		expect(longestStill([{ startMs: 3000, endMs: 12_000 }], clips)).toBe(4000);
		expect(
			longestStill(
				[
					{ startMs: 4000, endMs: 5000 },
					{ startMs: 10_000, endMs: 11_000 },
				],
				clips,
			),
		).toBe(1000);
	});

	it("measures sped-up stills in timeline time", () => {
		const fast = normalizeClips({
			...timeline(),
			clips: [{ startMs: 0, endMs: 5000, sourceStartMs: 0, speed: 2 }],
		});
		expect(longestStill([{ startMs: 0, endMs: 4000 }], fast)).toBe(2000);
	});
});

describe("contact sheet", () => {
	it.each([
		[1, 1, 1],
		[2, 2, 1],
		[3, 2, 2],
		[4, 2, 2],
		[5, 3, 2],
		[9, 3, 3],
	])("lays out %i tiles as %ix%i within the vision caps", (count, cols, rows) => {
		for (const [width, height] of [
			[3456, 2234],
			[1080, 1920],
			[5120, 1440],
		]) {
			const plan = planSheet(count, width, height);
			expect(plan).toMatchObject({ cols, rows });
			expect(Math.max(plan.width, plan.height)).toBeLessThanOrEqual(1568);
			expect(plan.width * plan.height).toBeLessThanOrEqual(1_150_000);
			expect(plan.tileWidth % 2).toBe(0);
			expect(plan.tileHeight % 2).toBe(0);
		}
	});

	it("does not upscale a small video", () => {
		expect(planSheet(1, 320, 200)).toMatchObject({ width: 320, height: 200 });
	});

	it("seeks each input and tiles the frames into one JPEG on stdout", () => {
		const plan = planSheet(2, 1920, 1080);
		const args = contactSheetArgs(VIDEO, [-5, 1234.4], plan);
		expect(args.slice(4, 18)).toEqual([
			"-threads",
			"1",
			"-noaccurate_seek",
			"-ss",
			"0.000",
			"-i",
			VIDEO,
			"-threads",
			"1",
			"-noaccurate_seek",
			"-ss",
			"1.234",
			"-i",
			VIDEO,
		]);
		const graph = args[args.indexOf("-filter_complex") + 1];
		expect(graph).toContain(
			`[1:v:0]tpad=stop=-1:stop_mode=clone,fps=fps=1000:start_time=0,trim=end_frame=1,setpts=PTS-STARTPTS,scale=${plan.tileWidth}:${plan.tileHeight},setsar=1[f1]`,
		);
		expect(graph).toContain("[f0][f1]concat=n=2:v=1:a=0,tile=2x1:nb_frames=2:");
		expect(args.slice(-5)).toEqual(["-f", "image2pipe", "-c:v", "mjpeg", "pipe:1"]);
	});
});

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);

function fakeEditor() {
	return Object.assign(new EventEmitter(), {
		send: vi.fn(),
		isDestroyed: () => false,
		isCrashed: () => false,
	});
}

function setup(overrides: Partial<Parameters<typeof createRemoteReview>[0]> = {}) {
	const ipc = new EventEmitter();
	const status = { state: "idle", lastRecordingPath: VIDEO as string | null };
	const runFfmpeg = vi.fn(async (_binary: string, args: string[]) =>
		args.includes("-filter_complex")
			? { stdout: JPEG, stderr: "" }
			: {
					stdout: Buffer.alloc(0),
					stderr: "lavfi.freezedetect.freeze_start: 1\nlavfi.freezedetect.freeze_end: 3.5\n",
				},
	);
	const readActivity = vi.fn(async () => log([false, true]) as AgentActivityLog | null);
	const review = createRemoteReview({
		remote: { getStatus: () => status } as never,
		ipc: ipc as unknown as IpcMain,
		ffmpegPath: () => "/ffmpeg",
		runFfmpeg,
		readActivity,
		...overrides,
	});
	const editor = fakeEditor();
	const ready = (target: string | null, sender = editor) =>
		ipc.emit("remote-editor-ready", { sender }, { videoPath: target, ready: target !== null });
	const sent = (times = 1) => vi.waitFor(() => expect(editor.send).toHaveBeenCalledTimes(times));
	const reply = (result: Omit<RemoteReviewResult, "id">) =>
		ipc.emit("remote-review-result", {}, { id: editor.send.mock.lastCall?.[1].id, ...result });
	return { review, status, runFfmpeg, readActivity, editor, ready, sent, reply };
}

afterEach(() => {
	vi.useRealTimers();
});

describe("review flow", () => {
	it("asks the ready editor for its timeline and returns the summary and sheet", async () => {
		const { review, runFfmpeg, editor, ready, sent, reply } = setup();
		ready(VIDEO);
		const pending = review.reviewRecording();
		await sent();
		expect(editor.send).toHaveBeenCalledWith("remote-review-request", {
			id: expect.any(String),
		});
		reply({ ok: true, timeline: timeline([[0, 5000]], { zooms: 2 }) });
		const result = await pending;
		expect(result.summary).toMatchObject({
			videoPath: VIDEO,
			rawDurationMs: 10_000,
			finalDurationMs: 5000,
			removedMs: 5000,
			cuts: 1,
			zooms: 2,
			scenes: 2,
			failedScenes: 1,
			longestStillMs: 2500,
		});
		expect(result.summary.longestStillNote).toBeUndefined();
		expect(result.image).toEqual({
			data: JPEG.toString("base64"),
			mimeType: "image/jpeg",
			...(({ width, height }) => ({ width, height }))(planSheet(2, 1920, 1080)),
		});
		expect(runFfmpeg).toHaveBeenCalledTimes(2);
		expect(runFfmpeg.mock.calls.map((call) => call[0])).toEqual(["/ffmpeg", "/ffmpeg"]);
		expect(runFfmpeg).toHaveBeenCalledWith("/ffmpeg", freezeArgs(VIDEO), expect.anything());
	});

	it("refuses while recording, and before there is a recording", async () => {
		const { review, status } = setup();
		status.state = "recording";
		await expect(review.reviewRecording()).rejects.toThrow(/Recordly is recording/);
		status.state = "idle";
		status.lastRecordingPath = null;
		await expect(review.reviewRecording()).rejects.toThrow(/no recording to review/);
	});

	it("refuses without FFmpeg and frees the slot", async () => {
		const { review } = setup({
			ffmpegPath: () => {
				throw new Error("FFmpeg binary is unavailable.");
			},
		});
		await expect(review.reviewRecording()).rejects.toThrow(/without FFmpeg. FFmpeg binary/);
		await expect(review.reviewRecording()).rejects.toThrow(/without FFmpeg/);
	});

	it("waits for the editor of the latest recording, then times out", async () => {
		vi.useFakeTimers();
		const { review, editor, ready } = setup();
		ready(path.resolve("/rec/older.mp4"));
		const pending = review.reviewRecording();
		const assertion = expect(pending).rejects.toThrow(/did not finish loading/);
		await vi.advanceTimersByTimeAsync(45_000);
		await assertion;
		expect(editor.send).not.toHaveBeenCalled();
	});

	it("passes on the editor's refusal and times out a silent editor", async () => {
		const { review, ready, sent, reply } = setup();
		ready(VIDEO);
		const refused = review.reviewRecording();
		await sent();
		reply({ ok: false, error: "The editor is still loading the recording." });
		await expect(refused).rejects.toThrow("The editor is still loading the recording.");

		vi.useFakeTimers();
		const silent = review.reviewRecording();
		const assertion = expect(silent).rejects.toThrow(/did not answer/);
		await vi.advanceTimersByTimeAsync(10_000);
		await assertion;
	});

	it("fails when the editor reloads mid-review", async () => {
		const { review, editor, ready, sent } = setup();
		ready(VIDEO);
		const pending = review.reviewRecording();
		await sent();
		editor.emit("did-start-navigation", {}, "app://editor", false, true);
		await expect(pending).rejects.toThrow(/closed or reloaded/);
	});

	it("allows one review at a time", async () => {
		const { review, ready, sent, reply } = setup();
		ready(VIDEO);
		const first = review.reviewRecording();
		await expect(review.reviewRecording()).rejects.toThrow("A review is already running.");
		await sent();
		reply({ ok: true, timeline: timeline() });
		await expect(first).resolves.toMatchObject({ summary: { cuts: 0 } });
	});

	it("counts no scenes when the activity log is missing or unreadable", async () => {
		const readActivity = vi
			.fn<(videoPath: string) => Promise<AgentActivityLog | null>>()
			.mockResolvedValueOnce(null)
			.mockRejectedValueOnce(new Error("bad json"));
		const { review, ready, sent, reply } = setup({ readActivity });
		ready(VIDEO);
		for (const times of [1, 2]) {
			const pending = review.reviewRecording();
			await sent(times);
			reply({ ok: true, timeline: timeline() });
			await expect(pending).resolves.toMatchObject({
				summary: { scenes: 0, failedScenes: 0 },
			});
		}
	});

	it("fails with FFmpeg's error when the sheet cannot be built, then frees the slot", async () => {
		const runFfmpeg = vi.fn(async (_binary: string, args: string[]) => {
			if (args.includes("-filter_complex")) {
				throw Object.assign(new Error("Command failed"), {
					stderr: Buffer.from("noise\n[mjpeg] Invalid argument\nConversion failed!\n"),
				});
			}
			return { stdout: Buffer.alloc(0), stderr: "" };
		});
		const { review, ready, sent, reply } = setup({ runFfmpeg });
		ready(VIDEO);
		const pending = review.reviewRecording();
		await sent();
		reply({ ok: true, timeline: timeline() });
		await expect(pending).rejects.toThrow(
			"Recordly could not build the contact sheet: noise [mjpeg] Invalid argument Conversion failed!",
		);
		runFfmpeg.mockResolvedValue({ stdout: Buffer.alloc(0), stderr: "" });
		const empty = review.reviewRecording();
		await sent(2);
		reply({ ok: true, timeline: timeline() });
		await expect(empty).rejects.toThrow(/returned no image/);
	});

	it("still reviews when the still check fails or the video is too long", async () => {
		const runFfmpeg = vi.fn(async (_binary: string, args: string[]) => {
			if (args.includes("-filter_complex")) return { stdout: JPEG, stderr: "" };
			throw Object.assign(new Error("timeout"), { killed: true });
		});
		const { review, ready, sent, reply } = setup({ runFfmpeg });
		ready(VIDEO);
		const timedOut = review.reviewRecording();
		await sent();
		reply({ ok: true, timeline: timeline() });
		await expect(timedOut).resolves.toMatchObject({
			summary: { longestStillMs: 0, longestStillNote: "Not checked: FFmpeg took too long." },
		});

		const long = review.reviewRecording();
		await sent(2);
		reply({ ok: true, timeline: timeline([], { sourceDurationMs: 11 * 60_000 }) });
		await expect(long).resolves.toMatchObject({
			summary: {
				longestStillMs: 0,
				longestStillNote: expect.stringMatching(/longer than 10 min/),
			},
		});
		expect(runFfmpeg).toHaveBeenCalledTimes(3);
	});

	it("stops when canceled and kills running FFmpeg", async () => {
		let ffmpegSignal: AbortSignal | undefined;
		const runFfmpeg = vi.fn(
			(_binary: string, _args: string[], opts: { signal: AbortSignal }) =>
				new Promise<{ stdout: Buffer; stderr: string }>((_resolve, reject) => {
					ffmpegSignal = opts.signal;
					opts.signal.addEventListener("abort", () => reject(new Error("aborted")));
				}),
		);
		const { review, ready, sent, reply } = setup({ runFfmpeg });
		ready(VIDEO);
		const controller = new AbortController();
		const pending = review.reviewRecording({ signal: controller.signal });
		await sent();
		reply({ ok: true, timeline: timeline() });
		await vi.waitFor(() => expect(runFfmpeg).toHaveBeenCalledTimes(2));
		controller.abort();
		await expect(pending).rejects.toThrow("The review was canceled.");
		expect(ffmpegSignal?.aborted).toBe(true);
	});
});

const ffmpegBinary = loadFfmpegStatic();

describe.skipIf(!ffmpegBinary || !existsSync(ffmpegBinary))("with the bundled FFmpeg", () => {
	it("builds a JPEG contact sheet and finds the still stretch", async () => {
		const run = promisify(execFile);
		const binary = ffmpegBinary as string;
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "recordly-review-"));
		try {
			const video = path.join(dir, "clip.mp4");
			await run(binary, [
				"-hide_banner",
				"-loglevel",
				"error",
				"-f",
				"lavfi",
				"-i",
				"testsrc=size=320x200:rate=30:duration=1",
				"-f",
				"lavfi",
				"-i",
				"color=c=gray:size=320x200:rate=30:duration=1.5",
				"-f",
				"lavfi",
				"-i",
				"testsrc2=size=320x200:rate=30:duration=0.5",
				"-filter_complex",
				"[0][1][2]concat=n=3:v=1:a=0,format=yuv420p",
				video,
			]);
			const plan = planSheet(3, 320, 200);
			const sheet = await run(binary, contactSheetArgs(video, [0, 1500, 2800], plan), {
				encoding: "buffer",
			});
			expect([...sheet.stdout.subarray(0, 2)]).toEqual([0xff, 0xd8]);
			const freeze = await run(binary, freezeArgs(video));
			const [still] = parseFreezes(freeze.stderr, 3000);
			expect(still.startMs).toBeCloseTo(1000, -2);
			expect(still.endMs).toBeCloseTo(2500, -2);
		} finally {
			await fs.rm(dir, { recursive: true, force: true });
		}
	});

	it("shows the frame on screen at each time in a variable frame rate video, even past the last frame", async () => {
		const run = promisify(execFile);
		const binary = ffmpegBinary as string;
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "recordly-review-"));
		try {
			const video = path.join(dir, "vfr.mp4");
			await run(binary, [
				"-hide_banner",
				"-loglevel",
				"error",
				"-f",
				"lavfi",
				"-i",
				"testsrc=size=320x200:rate=30:duration=1",
				"-f",
				"lavfi",
				"-i",
				"color=c=gray:size=320x200:rate=30:duration=2",
				"-f",
				"lavfi",
				"-i",
				"testsrc2=size=320x200:rate=30:duration=0.5",
				"-filter_complex",
				"[0][1][2]concat=n=3:v=1:a=0,mpdecimate=max=0,format=yuv420p",
				"-fps_mode",
				"vfr",
				video,
			]);
			const plan = planSheet(3, 320, 200);
			const sheet = path.join(dir, "sheet.jpg");
			const { stdout } = await run(binary, contactSheetArgs(video, [0, 2000, 5000], plan), {
				encoding: "buffer",
			});
			await fs.writeFile(sheet, stdout);
			const tile = async (x: number, y: number) => {
				const { stdout: pixels } = await run(
					binary,
					[
						"-loglevel",
						"error",
						"-i",
						sheet,
						"-vf",
						`crop=${plan.tileWidth}:${plan.tileHeight}:${x}:${y},format=gray`,
						"-f",
						"rawvideo",
						"pipe:1",
					],
					{ encoding: "buffer" },
				);
				return {
					min: pixels.reduce((a, b) => Math.min(a, b), 255),
					max: pixels.reduce((a, b) => Math.max(a, b), 0),
				};
			};
			const still = await tile(plan.tileWidth + 6, 0);
			expect(still.max - still.min).toBeLessThan(10);
			expect(still.max).toBeLessThan(200);
			const last = await tile(0, plan.tileHeight + 6);
			expect(last.max - last.min).toBeGreaterThan(100);
		} finally {
			await fs.rm(dir, { recursive: true, force: true });
		}
	});
});
