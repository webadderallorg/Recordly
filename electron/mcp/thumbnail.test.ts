import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createThumbnail } from "./thumbnail";

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const okReply = {
	image: { data: JPEG.toString("base64"), width: 1280, height: 720 },
	rendered: ["look"],
	notRendered: [],
};

let dir: string;
beforeEach(async () => {
	dir = await fs.mkdtemp(path.join(os.tmpdir(), "recordly-thumb-"));
});
afterEach(async () => {
	await fs.rm(dir, { recursive: true, force: true });
});

function setup(requestEditor = vi.fn(async (): Promise<unknown> => okReply)) {
	const runFfmpeg = vi.fn(async (_bin: string, args: string[]) => {
		await fs.writeFile(args[args.length - 1], "png-bytes");
		return Buffer.alloc(0);
	});
	const thumbnail = createThumbnail({ requestEditor, runFfmpeg, ffmpegBinary: () => "ffmpeg" });
	return { thumbnail, requestEditor, runFfmpeg };
}

describe("thumbnail", () => {
	it("writes the editor's composited frame as a jpg and leaves no temp files", async () => {
		const { thumbnail, requestEditor, runFfmpeg } = setup();
		const out = path.join(dir, "still.jpg");
		const result = await thumbnail({ atMs: 1500, outputPath: out });
		expect(requestEditor).toHaveBeenCalledWith(
			"render_preview",
			{ atMs: 1500 },
			expect.anything(),
		);
		expect(await fs.readFile(out)).toEqual(JPEG);
		expect(runFfmpeg).not.toHaveBeenCalled();
		expect(result).toMatchObject({ path: out, width: 1280, height: 720 });
		expect(result.note).toMatch(/not the recorded screen/);
		expect(await fs.readdir(dir)).toEqual(["still.jpg"]);
	});

	it("converts to png through ffmpeg with a timeout", async () => {
		const { thumbnail, runFfmpeg } = setup();
		const out = path.join(dir, "still.png");
		await thumbnail({ atMs: 0, outputPath: out });
		expect(runFfmpeg.mock.calls[0][2]).toMatchObject({ timeoutMs: expect.any(Number) });
		expect(await fs.readFile(out, "utf8")).toBe("png-bytes");
		expect(await fs.readdir(dir)).toEqual(["still.png"]);
	});

	it("reports a failed png conversion and cleans up", async () => {
		const { thumbnail, runFfmpeg } = setup();
		runFfmpeg.mockRejectedValueOnce(new Error("bad"));
		await expect(thumbnail({ atMs: 0, outputPath: path.join(dir, "a.png") })).rejects.toThrow(
			/could not be converted to PNG: bad/,
		);
		expect(await fs.readdir(dir)).toEqual([]);
	});

	it.each([
		[{ atMs: 0, outputPath: "still.jpg" }, /absolute/],
		[{ atMs: 0, outputPath: "/tmp/still.gif" }, /\.png, \.jpg/],
		[{ atMs: 0, outputPath: "  " }, /empty/],
		[{ atMs: -1, outputPath: "/tmp/a.jpg" }, /atMs must be 0 or more/],
		[{ atMs: Number.NaN, outputPath: "/tmp/a.jpg" }, /atMs must be/],
		[{ atMs: 0, outputPath: "/no/such/dir/a.jpg" }, /folder does not exist/],
	])("rejects %o before asking the editor", async (args, message) => {
		const { thumbnail, requestEditor } = setup();
		await expect(thumbnail(args)).rejects.toThrow(message);
		expect(requestEditor).not.toHaveBeenCalled();
	});

	it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
		"rejects an unwritable folder",
		async () => {
			const { thumbnail, requestEditor } = setup();
			const locked = path.join(dir, "locked");
			await fs.mkdir(locked, { mode: 0o500 });
			await expect(
				thumbnail({ atMs: 0, outputPath: path.join(locked, "a.jpg") }),
			).rejects.toThrow(/cannot write/);
			expect(requestEditor).not.toHaveBeenCalled();
		},
	);

	it("refuses an existing file unless overwrite is set", async () => {
		const { thumbnail, requestEditor } = setup();
		const out = path.join(dir, "taken.jpg");
		await fs.writeFile(out, "old");
		await expect(thumbnail({ atMs: 0, outputPath: out })).rejects.toThrow(/already exists/);
		expect(requestEditor).not.toHaveBeenCalled();
		expect(await fs.readFile(out, "utf8")).toBe("old");
		await thumbnail({ atMs: 0, outputPath: out, overwrite: true });
		expect(await fs.readFile(out)).toEqual(JPEG);
	});

	it("does not clobber a file that appears while the frame renders", async () => {
		const out = path.join(dir, "race.jpg");
		const { thumbnail } = setup(
			vi.fn(async () => {
				await fs.writeFile(out, "late");
				return okReply;
			}),
		);
		await expect(thumbnail({ atMs: 0, outputPath: out })).rejects.toThrow(/already exists/);
		expect(await fs.readFile(out, "utf8")).toBe("late");
		expect(await fs.readdir(dir)).toEqual(["race.jpg"]);
	});

	it.each([
		"atMs 99999 is past the end of the edited timeline (60000 ms).",
		"Nothing plays at 5000 ms; it falls in a gap between clips.",
		"There is no recording loaded in the editor, so there is nothing to preview.",
		"The editor did not finish loading a recording within 45 s. Is the editor open?",
	])("passes the editor's refusal through and writes nothing: %s", async (message) => {
		const { thumbnail } = setup(
			vi.fn(async () => {
				throw new Error(message);
			}),
		);
		await expect(
			thumbnail({ atMs: 5000, outputPath: path.join(dir, "a.jpg") }),
		).rejects.toThrow(message);
		expect(await fs.readdir(dir)).toEqual([]);
	});

	it("rejects a reply with no picture", async () => {
		const { thumbnail } = setup(vi.fn(async () => ({ image: { data: "" } })));
		await expect(thumbnail({ atMs: 0, outputPath: path.join(dir, "a.jpg") })).rejects.toThrow(
			/no picture/,
		);
		expect(await fs.readdir(dir)).toEqual([]);
	});
});
