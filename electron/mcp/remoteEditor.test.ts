import { EventEmitter } from "node:events";
import type { IpcMain } from "electron";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
	app: { getPath: () => "/tmp", isPackaged: false },
	ipcMain: { on: vi.fn() },
}));

const { createRemoteEditor, frameArgs, sampleSheetArgs, timelineToSourceMs } = await import(
	"./remoteEditor"
);

afterEach(() => vi.useRealTimers());

function setup(options: Parameters<typeof createRemoteEditor>[0] = {}) {
	const ipc = new EventEmitter();
	const editor = Object.assign(new EventEmitter(), {
		send: vi.fn(),
		isDestroyed: () => false,
		isCrashed: () => false,
	});
	const remote = createRemoteEditor({ ipc: ipc as unknown as IpcMain, ...options });
	const ready = () =>
		ipc.emit("remote-editor-ready", { sender: editor }, { videoPath: "/v/a.mp4", ready: true });
	const request = (index: number) => editor.send.mock.calls[index][1] as RemoteEditorRequest;
	const reply = (index: number, result: Omit<RemoteEditorResult, "id">) =>
		ipc.emit("remote-editor-result", {}, { id: request(index).id, ...result });
	const sent = (times: number) =>
		vi.waitFor(() => expect(editor.send).toHaveBeenCalledTimes(times));
	return { remote, editor, ready, request, reply, sent };
}

const state = {
	videoPath: "/v/a.mp4",
	durationMs: 8000,
	sourceDurationMs: 10_000,
	clips: [
		{ id: "c1", startMs: 0, endMs: 2000, sourceStartMs: 0, speed: 1 },
		{ id: "c2", startMs: 2000, endMs: 8000, sourceStartMs: 4000, speed: 1 },
	],
	zooms: [],
	annotations: [],
	audio: [],
	captions: [],
};

describe("requestEditor", () => {
	it("times out when the editor never becomes ready", async () => {
		vi.useFakeTimers();
		const { remote, editor } = setup({ readyTimeoutMs: 1000 });
		const result = remote.requestEditor("get_state");
		const expectation = expect(result).rejects.toThrow(/did not finish loading/);
		await vi.advanceTimersByTimeAsync(1001);
		await expectation;
		expect(editor.send).not.toHaveBeenCalled();
	});

	it("settles two concurrent requests to the right callers", async () => {
		const { remote, ready, sent, request, reply } = setup();
		ready();
		const first = remote.requestEditor("a");
		const second = remote.requestEditor("b");
		await sent(2);
		expect([request(0).op, request(1).op]).toEqual(["a", "b"]);
		reply(1, { ok: true, data: "for-b" });
		reply(0, { ok: true, data: "for-a" });
		await expect(first).resolves.toBe("for-a");
		await expect(second).resolves.toBe("for-b");
	});

	it("surfaces a renderer error as a failure", async () => {
		const { remote, ready, sent, reply } = setup();
		ready();
		const result = remote.requestEditor("nope");
		await sent(1);
		reply(0, { ok: false, error: 'The editor does not support "nope".' });
		await expect(result).rejects.toThrow('does not support "nope"');
	});

	it("rejects at once when the signal is already aborted", async () => {
		const { remote, editor } = setup();
		const result = remote.requestEditor("get_state", undefined, {
			signal: AbortSignal.abort(),
		});
		await expect(result).rejects.toThrow(/canceled/);
		expect(editor.send).not.toHaveBeenCalled();
	});

	it("reports why the editor could not be reached when send throws", async () => {
		const { remote, ready, editor } = setup();
		ready();
		editor.send.mockImplementation(() => {
			throw new Error("Object has been destroyed");
		});
		await expect(remote.requestEditor("get_state")).rejects.toThrow(
			/could not be reached: Object has been destroyed/,
		);
	});

	it("does not treat a truthy but non-true ok as success", async () => {
		const { remote, ready, sent, reply } = setup();
		ready();
		const result = remote.requestEditor("get_state");
		await sent(1);
		reply(0, { ok: "yes" as unknown as boolean, data: 1 });
		await expect(result).rejects.toThrow(/could not run get_state/);
	});

	it("fails when the editor does not answer", async () => {
		vi.useFakeTimers();
		const { remote, ready } = setup({ replyTimeoutMs: 500 });
		ready();
		const result = remote.requestEditor("get_state");
		const expectation = expect(result).rejects.toThrow(/did not answer get_state/);
		await vi.advanceTimersByTimeAsync(501);
		await expectation;
	});
});

describe("get_state", () => {
	it("returns the editor's state untouched", async () => {
		const { remote, ready, sent, reply } = setup();
		ready();
		const result = remote.getState();
		await sent(1);
		reply(0, { ok: true, data: state });
		await expect(result).resolves.toEqual(state);
	});
});

describe("get_state validation", () => {
	it.each([
		["no video loaded", { ...state, videoPath: null }],
		["clips that are not a list", { ...state, clips: undefined }],
		["no data at all", undefined],
	])("rejects %s", async (_name, data) => {
		const { remote, ready, sent, reply } = setup();
		ready();
		const result = remote.getState();
		await sent(1);
		reply(0, { ok: true, data });
		await expect(result).rejects.toThrow(/no recording loaded/);
	});
});

describe("get_frame", () => {
	const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
	const frame = async (args: { atMs: number; source?: "edited" | "raw" }) => {
		const runFfmpeg = vi.fn(async () => png);
		const ctx = setup({ ffmpegPath: () => "ffmpeg", runFfmpeg });
		ctx.ready();
		const result = ctx.remote.getFrame(args);
		await ctx.sent(1);
		ctx.reply(0, { ok: true, data: state });
		return { result, runFfmpeg };
	};

	it("returns a PNG data URL, mapping edited time through the cuts", async () => {
		const { result, runFfmpeg } = await frame({ atMs: 3000, source: "edited" });
		const out = await result;
		expect(out.dataUrl).toBe(`data:image/png;base64,${png.toString("base64")}`);
		expect(out.sourceMs).toBe(5000);
		expect(runFfmpeg).toHaveBeenCalledWith(
			"ffmpeg",
			frameArgs("/v/a.mp4", 5000),
			expect.any(Object),
		);
	});

	it("reads raw time straight from the recording", async () => {
		const { result } = await frame({ atMs: 3000, source: "raw" });
		expect((await result).sourceMs).toBe(3000);
	});

	it("returns the last frame at exactly the end of the edited video", async () => {
		const { result } = await frame({ atMs: 8000, source: "edited" });
		expect((await result).sourceMs).toBe(9960);
	});

	it("names the reason when ffmpeg fails", async () => {
		const cases: [Record<string, unknown>, RegExp][] = [
			[{ killed: true, message: "Command failed" }, /took longer than 30 s/],
			[{ code: "ENOENT", message: "spawn ffmpeg ENOENT" }, /FFmpeg was not found/],
			[
				{ message: "Command failed: /bin/ffmpeg", stderr: Buffer.from("Invalid data\n") },
				/Invalid data/,
			],
		];
		for (const [failure, pattern] of cases) {
			const runFfmpeg = vi.fn(async () => {
				throw Object.assign(new Error(String(failure.message)), failure);
			});
			const ctx = setup({ ffmpegPath: () => "ffmpeg", runFfmpeg });
			ctx.ready();
			const result = ctx.remote.getFrame({ atMs: 100 });
			await ctx.sent(1);
			ctx.reply(0, { ok: true, data: state });
			await expect(result).rejects.toThrow(pattern);
		}
	});

	it("rejects output that is not a PNG", async () => {
		const ctx = setup({
			ffmpegPath: () => "ffmpeg",
			runFfmpeg: async () => Buffer.from("junk!"),
		});
		ctx.ready();
		const result = ctx.remote.getFrame({ atMs: 100 });
		await ctx.sent(1);
		ctx.reply(0, { ok: true, data: state });
		await expect(result).rejects.toThrow(/did not return an image/);
	});

	it("rejects a time past the end", async () => {
		const { result } = await frame({ atMs: 9000, source: "edited" });
		await expect(result).rejects.toThrow(/past the end/);
	});
});

describe("sample_frames", () => {
	const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]);
	const run = async (
		args: { everyMs?: number; count?: number; source?: "edited" | "raw" },
		options: {
			runFfmpeg?: ReturnType<typeof vi.fn>;
			data?: unknown;
			signal?: AbortSignal;
			ffmpegPath?: () => string;
		} = {},
	) => {
		const runFfmpeg = options.runFfmpeg ?? vi.fn(async () => jpeg);
		const probeVideo = vi.fn(async () => ({ width: 1920, height: 1080 }));
		const ctx = setup({
			ffmpegPath: options.ffmpegPath ?? (() => "ffmpeg"),
			runFfmpeg,
			probeVideo,
		});
		ctx.ready();
		const result = ctx.remote.sampleFrames(args, { signal: options.signal });
		const settled = result.catch(() => undefined);
		await ctx.sent(1);
		ctx.reply(0, { ok: true, data: options.data ?? state });
		await settled;
		return { result, runFfmpeg, probeVideo, ctx };
	};

	it("returns one sheet and where each tile came from, mapping edited time through the cuts", async () => {
		const { result, runFfmpeg } = await run({ count: 3 });
		const out = await result;
		expect(out.frames).toEqual([
			{ atMs: 0, sourceMs: 0 },
			{ atMs: 4000, sourceMs: 6000 },
			{ atMs: 8000, sourceMs: 9960 },
		]);
		expect(out.image.mimeType).toBe("image/jpeg");
		expect(out.image.data).toBe(jpeg.toString("base64"));
		expect([out.cols, out.rows]).toEqual([2, 2]);
		const args = runFfmpeg.mock.calls[0][1] as string[];
		expect(args).not.toContain("-noaccurate_seek");
		expect(args.filter((arg) => arg === "-i")).toHaveLength(3);
	});

	it("samples every N ms from the start and never past the end", async () => {
		const out = await (await run({ everyMs: 3000, source: "raw" })).result;
		expect(out.frames.map((frame) => frame.atMs)).toEqual([0, 3000, 6000, 9000]);
		expect(out.frames.map((frame) => frame.sourceMs)).toEqual([0, 3000, 6000, 9000]);
	});

	it("keeps accurate seeking, which the review sheet turns off", () => {
		const args = sampleSheetArgs("/v/a.mp4", [100], {
			cols: 1,
			rows: 1,
			tileWidth: 320,
			tileHeight: 180,
			width: 320,
			height: 180,
		});
		expect(args).not.toContain("-noaccurate_seek");
		expect(args).toContain("0.100");
	});

	it.each([
		["both", { everyMs: 1000, count: 4 }, /exactly one of everyMs or count/],
		["neither", {}, /exactly one of everyMs or count/],
		["count 0", { count: 0 }, /count must be a whole number from 2 to 12/],
		["count 1", { count: 1 }, /count must be a whole number from 2 to 12/],
		["count 13", { count: 13 }, /from 2 to 12/],
		["count 2.5", { count: 2.5 }, /whole number/],
		["everyMs under a frame", { everyMs: 5 }, /at least 17 ms/],
		["everyMs NaN", { everyMs: Number.NaN }, /at least 17 ms/],
		["unknown source", { count: 3, source: "x" as "raw" }, /source must be/],
	])("rejects %s before it reads the editor or runs ffmpeg", async (_name, args, message) => {
		const runFfmpeg = vi.fn(async () => jpeg);
		const ctx = setup({ runFfmpeg });
		ctx.ready();
		await expect(ctx.remote.sampleFrames(args)).rejects.toThrow(message);
		expect(runFfmpeg).not.toHaveBeenCalled();
		expect(ctx.editor.send).not.toHaveBeenCalled();
	});

	it("rejects an everyMs that needs too many frames or outlasts the video", async () => {
		const many = await run({ everyMs: 100 });
		await expect(many.result).rejects.toThrow(/would need 81 frames .* the most is 12/);
		const long = await run({ everyMs: 20_000 });
		await expect(long.result).rejects.toThrow(/longer than the edited video/);
		expect(many.runFfmpeg).not.toHaveBeenCalled();
		expect(long.runFfmpeg).not.toHaveBeenCalled();
	});

	it("rejects when nothing is loaded in the editor", async () => {
		const { result } = await run({ count: 3 }, { data: { ...state, videoPath: null } });
		await expect(result).rejects.toThrow(/no recording loaded/);
	});

	it("rejects a video with no length", async () => {
		const { result, runFfmpeg } = await run(
			{ count: 3 },
			{ data: { ...state, durationMs: 0, clips: [] } },
		);
		await expect(result).rejects.toThrow(/no length/);
		expect(runFfmpeg).not.toHaveBeenCalled();
	});

	it("samples a video with no clips as if nothing were cut", async () => {
		const out = await (
			await run({ count: 2 }, { data: { ...state, durationMs: 1000, clips: [] } })
		).result;
		expect(out.frames.map((frame) => frame.sourceMs)).toEqual([0, 1000]);
	});

	it("skips moments that fall in a gap and says which", async () => {
		const gap = {
			...state,
			durationMs: 3000,
			clips: [
				{ startMs: 0, endMs: 1000, sourceStartMs: 0, speed: 1 },
				{ startMs: 2000, endMs: 3000, sourceStartMs: 5000, speed: 1 },
			],
		};
		const out = await (await run({ count: 4 }, { data: gap })).result;
		expect(out.frames.map((frame) => frame.atMs)).toEqual([0, 2000, 3000]);
		expect(out.skippedAtMs).toEqual([1000]);
	});

	it("rejects when fewer than two moments play anything", async () => {
		const gap = {
			...state,
			durationMs: 3000,
			clips: [{ startMs: 0, endMs: 1000, sourceStartMs: 0, speed: 1 }],
		};
		const { result } = await run({ count: 2 }, { data: { ...gap, durationMs: 3000 } });
		await expect(result).rejects.toThrow(/Fewer than two/);
	});

	it("names the reason when ffmpeg fails", async () => {
		const cases: [Record<string, unknown>, RegExp][] = [
			[{ killed: true, message: "x" }, /took longer than 60 s/],
			[{ code: "ENOENT", message: "spawn ENOENT" }, /FFmpeg was not found/],
			[{ message: "failed", stderr: Buffer.from("Invalid data\n") }, /Invalid data/],
		];
		for (const [failure, pattern] of cases) {
			const runFfmpeg = vi.fn(async () => {
				throw Object.assign(new Error(String(failure.message)), failure);
			});
			const { result } = await run({ count: 3 }, { runFfmpeg });
			await expect(result).rejects.toThrow(pattern);
		}
	});

	it("reports a missing ffmpeg binary and an unreadable video size", async () => {
		const missing = await run(
			{ count: 3 },
			{
				ffmpegPath: () => {
					throw new Error("No binary.");
				},
			},
		);
		await expect(missing.result).rejects.toThrow(/cannot build a contact sheet without FFmpeg/);
		const ctx = setup({
			ffmpegPath: () => "ffmpeg",
			runFfmpeg: vi.fn(async () => jpeg),
			probeVideo: async () => {
				throw new Error("Unable to parse");
			},
		});
		ctx.ready();
		const result = ctx.remote.sampleFrames({ count: 3 });
		const settled = result.catch(() => undefined);
		await ctx.sent(1);
		ctx.reply(0, { ok: true, data: state });
		await settled;
		await expect(result).rejects.toThrow(/could not read the video's size: Unable to parse/);
	});

	it("rejects output that is empty, not a JPEG, or over the byte limit", async () => {
		const big = Buffer.concat([jpeg, Buffer.alloc(4 * 1024 * 1024)]);
		const cases: [Buffer, RegExp][] = [
			[Buffer.alloc(0), /no image/],
			[Buffer.from("junk!"), /did not return an image/],
			[big, /byte limit/],
		];
		for (const [output, pattern] of cases) {
			const { result } = await run({ count: 3 }, { runFfmpeg: vi.fn(async () => output) });
			await expect(result).rejects.toThrow(pattern);
		}
	});

	it("cancels when the signal aborts mid-run", async () => {
		const controller = new AbortController();
		const runFfmpeg = vi.fn(
			(_binary: string, _args: string[], opts: { signal?: AbortSignal }) =>
				new Promise<Buffer>((_resolve, reject) => {
					opts.signal?.addEventListener("abort", () =>
						reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
					);
					controller.abort();
				}),
		);
		const { result } = await run({ count: 3 }, { runFfmpeg, signal: controller.signal });
		await expect(result).rejects.toThrow(/canceled/);
	});

	it("rejects at once when the signal is already aborted", async () => {
		const ctx = setup();
		ctx.ready();
		await expect(
			ctx.remote.sampleFrames({ count: 3 }, { signal: AbortSignal.abort() }),
		).rejects.toThrow(/canceled/);
		expect(ctx.editor.send).not.toHaveBeenCalled();
	});
});

describe("timelineToSourceMs", () => {
	it("honours speed and returns null in a gap", () => {
		const clips = [{ startMs: 0, endMs: 1000, sourceStartMs: 0, speed: 2 }];
		expect(timelineToSourceMs(clips, 500)).toBe(1000);
		expect(timelineToSourceMs(clips, 1500)).toBeNull();
		expect(timelineToSourceMs([], 700)).toBe(700);
		expect(timelineToSourceMs(clips, 1000)).toBe(2000);
	});

	it("keeps a gap before the last clip a gap", () => {
		const clips = [
			{ startMs: 0, endMs: 1000, sourceStartMs: 0, speed: 1 },
			{ startMs: 2000, endMs: 3000, sourceStartMs: 5000, speed: 1 },
		];
		expect(timelineToSourceMs(clips, 1000)).toBeNull();
		expect(timelineToSourceMs(clips, 3000)).toBe(6000);
	});
});
