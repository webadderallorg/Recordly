import { describe, expect, it, vi } from "vitest";
import { pickFirstCapableFfmpeg } from "./ffmpegProbe";

describe("pickFirstCapableFfmpeg", () => {
	it("returns the first candidate that passes the support check", async () => {
		const hasSupport = vi.fn(async (path: string) => path === "/usr/bin/ffmpeg");
		await expect(
			pickFirstCapableFfmpeg(["/missing", "/usr/bin/ffmpeg"], hasSupport),
		).resolves.toBe("/usr/bin/ffmpeg");
	});

	it("falls through to a later candidate and probes each path at most once", async () => {
		const hasSupport = vi.fn(async (path: string) => path.includes("static"));
		await expect(
			pickFirstCapableFfmpeg(
				["/missing", "/usr/bin/ffmpeg", "/app/ffmpeg-static/ffmpeg", "/app/ffmpeg-static/ffmpeg"],
				hasSupport,
			),
		).resolves.toBe("/app/ffmpeg-static/ffmpeg");
		expect(hasSupport.mock.calls.map((args) => args[0])).toEqual([
			"/missing",
			"/usr/bin/ffmpeg",
			"/app/ffmpeg-static/ffmpeg",
		]);
	});

	it("skips null candidates and returns null when nothing qualifies", async () => {
		const hasSupport = vi.fn(async () => false);
		await expect(
			pickFirstCapableFfmpeg([null, undefined, "/usr/bin/ffmpeg"], hasSupport),
		).resolves.toBeNull();
		expect(hasSupport).toHaveBeenCalledTimes(1);
	});
});
