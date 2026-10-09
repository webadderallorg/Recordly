import { existsSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
	type AnnotationRegion,
	DEFAULT_ANNOTATION_STYLE,
} from "../../src/components/video-editor/types";
import type { RunFfmpeg } from "./remoteEditor";
import { renderFrameAnnotations } from "./renderedFrame";

function fakePng(width: number, height: number) {
	const png = Buffer.alloc(32);
	Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png, 0);
	png.writeUInt32BE(13, 8);
	png.write("IHDR", 12, "latin1");
	png.writeUInt32BE(width, 16);
	png.writeUInt32BE(height, 20);
	return png;
}

function annotation(over: Partial<AnnotationRegion> = {}): AnnotationRegion {
	return {
		id: "a1",
		startMs: 0,
		endMs: 5000,
		type: "blur",
		content: "",
		position: { x: 10, y: 20 },
		size: { width: 30, height: 40 },
		style: { ...DEFAULT_ANNOTATION_STYLE, borderRadius: 0 },
		zIndex: 0,
		blurIntensity: 20,
		...over,
	};
}

function runner(result: Buffer | Error = fakePng(1920, 1080)) {
	const calls: { binary: string; args: string[]; timeoutMs: number }[] = [];
	const runFfmpeg: RunFfmpeg = vi.fn(async (binary, args, { timeoutMs }) => {
		calls.push({ binary, args, timeoutMs });
		if (result instanceof Error) throw result;
		return result;
	});
	const graph = () => calls[0].args[calls[0].args.indexOf("-filter_complex") + 1];
	const input = () => calls[0].args[calls[0].args.indexOf("-i") + 1];
	return { runFfmpeg, calls, graph, input };
}

const deps = (over: Partial<Parameters<typeof renderFrameAnnotations>[1]> = {}) => ({
	binary: "/ffmpeg",
	runFfmpeg: runner().runFfmpeg,
	...over,
});

describe("renderFrameAnnotations", () => {
	it("returns the frame untouched and says so when there are no annotations", async () => {
		const png = fakePng(1920, 1080);
		const { runFfmpeg } = runner();
		const result = await renderFrameAnnotations(
			{ png, atMs: 1000, annotations: [] },
			deps({ runFfmpeg }),
		);
		expect(result.composited).toBe(false);
		expect(result.png).toBe(png);
		expect(result.annotations).toEqual([]);
		expect(result.note).toMatch(/No annotation covers 1000 ms/);
		expect(runFfmpeg).not.toHaveBeenCalled();
	});

	it("blurs the same rectangle at the same strength as the export", async () => {
		const run = runner();
		const result = await renderFrameAnnotations(
			{ png: fakePng(1920, 1080), atMs: 1000, annotations: [annotation()] },
			deps({ runFfmpeg: run.runFfmpeg }),
		);
		expect(run.graph()).toBe(
			"[0:v]split=2[k0][s0];" +
				"[s0]crop=656:512:152:176,gblur=sigma=20.000,crop=576:432:40:40[p0];" +
				"[k0][p0]overlay=192:216[v0]",
		);
		expect(run.calls[0].args).toContain("[v0]");
		expect(result.composited).toBe(true);
		expect(result.annotations).toEqual([{ id: "a1", type: "blur", drawn: true }]);
	});

	it("scales blur strength by the frame width the way the export does", async () => {
		const run = runner(fakePng(1280, 720));
		await renderFrameAnnotations(
			{ png: fakePng(1280, 720), atMs: 0, annotations: [annotation()] },
			deps({ runFfmpeg: run.runFfmpeg }),
		);
		expect(run.graph()).toContain("gblur=sigma=13.333");
	});

	it.each([
		[1, "gblur=sigma=1.000", "crop=196:112:958:538"],
		[100, "gblur=sigma=100.000", "crop=592:508:760:340"],
	])("handles strength %i at both ends of its range", async (strength, sigma, padded) => {
		const run = runner();
		await renderFrameAnnotations(
			{
				png: fakePng(1920, 1080),
				atMs: 0,
				annotations: [
					annotation({
						position: { x: 50, y: 50 },
						size: { width: 10, height: 10 },
						blurIntensity: strength,
					}),
				],
			},
			deps({ runFfmpeg: run.runFfmpeg }),
		);
		expect(run.graph()).toContain(sigma);
		expect(run.graph()).toContain(padded);
	});

	it("skips an annotation whose range ends before the moment", async () => {
		const { runFfmpeg } = runner();
		const result = await renderFrameAnnotations(
			{
				png: fakePng(1920, 1080),
				atMs: 4000,
				annotations: [annotation({ startMs: 0, endMs: 3000 })],
			},
			deps({ runFfmpeg }),
		);
		expect(result.composited).toBe(false);
		expect(result.annotations).toEqual([]);
		expect(runFfmpeg).not.toHaveBeenCalled();
	});

	it("draws an annotation whose range ends exactly on the moment", async () => {
		const run = runner();
		const result = await renderFrameAnnotations(
			{
				png: fakePng(1920, 1080),
				atMs: 3000,
				annotations: [annotation({ startMs: 0, endMs: 3000 })],
			},
			deps({ runFfmpeg: run.runFfmpeg }),
		);
		expect(result.composited).toBe(true);
	});

	it("marks a text, image or figure annotation as not drawn", async () => {
		const { runFfmpeg } = runner();
		const result = await renderFrameAnnotations(
			{
				png: fakePng(1920, 1080),
				atMs: 0,
				annotations: [
					annotation({ id: "t", type: "text", content: "hi" }),
					annotation({ id: "i", type: "image" }),
					annotation({ id: "f", type: "figure" }),
				],
			},
			deps({ runFfmpeg }),
		);
		expect(result.annotations.map((item) => [item.type, item.drawn])).toEqual([
			["text", false],
			["image", false],
			["figure", false],
		]);
		expect(result.annotations[0].note).toMatch(/cannot draw it faithfully/);
		expect(result.composited).toBe(false);
		expect(result.note).toMatch(/Nothing could be drawn at 0 ms/);
		expect(runFfmpeg).not.toHaveBeenCalled();
	});

	it("marks a blur that lies entirely outside the frame as not drawn", async () => {
		const { runFfmpeg } = runner();
		const result = await renderFrameAnnotations(
			{
				png: fakePng(1920, 1080),
				atMs: 0,
				annotations: [annotation({ position: { x: 140, y: 10 } })],
			},
			deps({ runFfmpeg }),
		);
		expect(result.annotations[0]).toMatchObject({ drawn: false });
		expect(result.annotations[0].note).toMatch(/outside the frame/);
		expect(runFfmpeg).not.toHaveBeenCalled();
	});

	it("marks a zero-size blur as not drawn", async () => {
		const { runFfmpeg } = runner();
		const result = await renderFrameAnnotations(
			{
				png: fakePng(1920, 1080),
				atMs: 0,
				annotations: [annotation({ size: { width: 0, height: 0 } })],
			},
			deps({ runFfmpeg }),
		);
		expect(result.annotations[0].note).toMatch(/less than one pixel/);
		expect(runFfmpeg).not.toHaveBeenCalled();
	});

	it("clips a blur that hangs off the edge and says it clipped it", async () => {
		const run = runner();
		const result = await renderFrameAnnotations(
			{
				png: fakePng(1920, 1080),
				atMs: 0,
				annotations: [
					annotation({ position: { x: 90, y: 90 }, size: { width: 30, height: 30 } }),
				],
			},
			deps({ runFfmpeg: run.runFfmpeg }),
		);
		expect(run.graph()).toBe(
			"[0:v]split=2[k0][s0];" +
				"[s0]crop=232:148:1688:932,gblur=sigma=20.000,crop=192:108:40:40[p0];" +
				"[k0][p0]overlay=1728:972[v0]",
		);
		expect(result.annotations[0]).toMatchObject({ drawn: true });
		expect(result.annotations[0].note).toMatch(/clipped/);
	});

	it("chains overlapping blurs so each one samples the one before it", async () => {
		const run = runner();
		await renderFrameAnnotations(
			{
				png: fakePng(1920, 1080),
				atMs: 0,
				annotations: [
					annotation({ id: "b2", zIndex: 2 }),
					annotation({ id: "b1", zIndex: 1 }),
					annotation({ id: "b0", zIndex: 0 }),
				],
			},
			deps({ runFfmpeg: run.runFfmpeg }),
		);
		const graph = run.graph();
		expect(graph).toContain("[0:v]split=2[k0][s0]");
		expect(graph).toContain("[v0]split=2[k1][s1]");
		expect(graph).toContain("[v1]split=2[k2][s2]");
		expect(run.calls[0].args).toContain("[v2]");
	});

	it("draws the blurs in zIndex order, not array order", async () => {
		const run = runner();
		const result = await renderFrameAnnotations(
			{
				png: fakePng(1920, 1080),
				atMs: 0,
				annotations: [
					annotation({ id: "top", zIndex: 9 }),
					annotation({ id: "bottom", zIndex: 1 }),
				],
			},
			deps({ runFfmpeg: run.runFfmpeg }),
		);
		expect(result.annotations.map((item) => item.id)).toEqual(["bottom", "top"]);
	});

	it("fills a hex blurColor the way the export does", async () => {
		const run = runner();
		await renderFrameAnnotations(
			{
				png: fakePng(1920, 1080),
				atMs: 0,
				annotations: [annotation({ blurColor: "#1A2b3C" })],
			},
			deps({ runFfmpeg: run.runFfmpeg }),
		);
		expect(run.graph()).toContain("drawbox=0:0:576:432:color=0x1A2b3C:t=fill");
	});

	it("says so when a blurColor it cannot express was left off", async () => {
		const run = runner();
		const result = await renderFrameAnnotations(
			{
				png: fakePng(1920, 1080),
				atMs: 0,
				annotations: [annotation({ blurColor: "rgba(0,0,0,0.5)" })],
			},
			deps({ runFfmpeg: run.runFfmpeg }),
		);
		expect(run.graph()).not.toContain("drawbox");
		expect(result.annotations[0]).toMatchObject({ drawn: true });
		expect(result.annotations[0].note).toMatch(/fill was not drawn/);
	});

	it("says so when it squared off rounded corners", async () => {
		const run = runner();
		const result = await renderFrameAnnotations(
			{
				png: fakePng(1920, 1080),
				atMs: 0,
				annotations: [
					annotation({ style: { ...DEFAULT_ANNOTATION_STYLE, borderRadius: 12 } }),
				],
			},
			deps({ runFfmpeg: run.runFfmpeg }),
		);
		expect(result.annotations[0].note).toMatch(/rounded corners were drawn square/);
	});

	it("refuses a frame that is not a PNG", async () => {
		const { runFfmpeg } = runner();
		await expect(
			renderFrameAnnotations(
				{ png: Buffer.from("not an image"), atMs: 0, annotations: [annotation()] },
				deps({ runFfmpeg }),
			),
		).rejects.toThrow(/not a readable PNG image/);
		expect(runFfmpeg).not.toHaveBeenCalled();
	});

	it("refuses a negative atMs", async () => {
		await expect(
			renderFrameAnnotations(
				{ png: fakePng(1920, 1080), atMs: -1, annotations: [annotation()] },
				deps(),
			),
		).rejects.toThrow("atMs must be 0 or more.");
	});

	it.each([
		[Object.assign(new Error("spawn failed"), { code: "ENOENT" }), /FFmpeg was not found/],
		[Object.assign(new Error("killed"), { killed: true }), /longer than 30 s/],
		[Object.assign(new Error("abort"), { name: "AbortError" }), /was canceled/],
		[Object.assign(new Error("boom"), { stderr: "Invalid argument" }), /Invalid argument/],
	])("reports an ffmpeg failure in plain words", async (failure, expected) => {
		const run = runner(failure);
		await expect(
			renderFrameAnnotations(
				{ png: fakePng(1920, 1080), atMs: 0, annotations: [annotation()] },
				deps({ runFfmpeg: run.runFfmpeg }),
			),
		).rejects.toThrow(expected);
		expect(existsSync(run.input())).toBe(false);
	});

	it("refuses output that is not an image", async () => {
		const run = runner(Buffer.from("garbage bytes that are not a png at all"));
		await expect(
			renderFrameAnnotations(
				{ png: fakePng(1920, 1080), atMs: 0, annotations: [annotation()] },
				deps({ runFfmpeg: run.runFfmpeg }),
			),
		).rejects.toThrow(/did not return an image/);
	});

	it("refuses empty output", async () => {
		const run = runner(Buffer.alloc(0));
		await expect(
			renderFrameAnnotations(
				{ png: fakePng(1920, 1080), atMs: 0, annotations: [annotation()] },
				deps({ runFfmpeg: run.runFfmpeg }),
			),
		).rejects.toThrow(/no image/);
	});

	it("refuses output over the byte limit", async () => {
		const big = Buffer.concat([fakePng(1920, 1080), Buffer.alloc(16 * 1024 * 1024)]);
		const run = runner(big);
		await expect(
			renderFrameAnnotations(
				{ png: fakePng(1920, 1080), atMs: 0, annotations: [annotation()] },
				deps({ runFfmpeg: run.runFfmpeg }),
			).then(() => "it returned the oversized frame"),
		).rejects.toThrow(/over the 16777216 byte limit/);
	});

	it("stops before writing anything when the signal is already aborted", async () => {
		const { runFfmpeg } = runner();
		await expect(
			renderFrameAnnotations(
				{ png: fakePng(1920, 1080), atMs: 0, annotations: [annotation()] },
				deps({ runFfmpeg, signal: AbortSignal.abort() }),
			),
		).rejects.toThrow("The request was canceled.");
		expect(runFfmpeg).not.toHaveBeenCalled();
	});

	it("passes the signal and the timeout to ffmpeg", async () => {
		const controller = new AbortController();
		const run = runner();
		const runFfmpeg: RunFfmpeg = vi.fn(async (binary, args, opts) => {
			expect(opts.signal).toBe(controller.signal);
			return run.runFfmpeg(binary, args, opts);
		});
		await renderFrameAnnotations(
			{ png: fakePng(1920, 1080), atMs: 0, annotations: [annotation()] },
			deps({ runFfmpeg, signal: controller.signal }),
		);
		expect(run.calls[0].timeoutMs).toBe(30_000);
	});

	it("removes the temp frame after a successful composite", async () => {
		const run = runner();
		await renderFrameAnnotations(
			{ png: fakePng(1920, 1080), atMs: 0, annotations: [annotation()] },
			deps({ runFfmpeg: run.runFfmpeg }),
		);
		expect(run.input()).toMatch(/recordly-annotated-.*\.png$/);
		expect(existsSync(run.input())).toBe(false);
	});

	it("removes the temp frame when it is aborted part-way", async () => {
		const controller = new AbortController();
		let seen = "";
		const runFfmpeg: RunFfmpeg = vi.fn(async (_binary, args) => {
			seen = args[args.indexOf("-i") + 1];
			expect(existsSync(seen)).toBe(true);
			controller.abort();
			throw Object.assign(new Error("aborted"), { code: "ABORT_ERR" });
		});
		await expect(
			renderFrameAnnotations(
				{ png: fakePng(1920, 1080), atMs: 0, annotations: [annotation()] },
				deps({ runFfmpeg, signal: controller.signal }),
			),
		).rejects.toThrow("The request was canceled.");
		expect(existsSync(seen)).toBe(false);
	});
});
