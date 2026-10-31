import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it, vi } from "vitest";
import ffmpeg from "ffmpeg-static";

vi.mock("../ffmpeg/binary", () => ({ getFfmpegBinaryPath: () => ffmpeg }));
import { createShareThumbnail } from "./shareThumbnail";
const run = promisify(execFile);

describe("shared recording preview", () => {
	it("extracts the first frame, preserving aspect ratio and bounding its size", async () => {
		const dir = await mkdtemp(path.join(tmpdir(), "recordly-poster-test-"));
		try {
			const video = path.join(dir, "red-then-blue.mp4");
			await run(ffmpeg!, [
				"-hide_banner",
				"-loglevel",
				"error",
				"-f",
				"lavfi",
				"-i",
				"color=red:s=1280x720:d=0.1:r=30",
				"-f",
				"lavfi",
				"-i",
				"color=blue:s=1280x720:d=0.1:r=30",
				"-filter_complex",
				"[0:v][1:v]concat=n=2:v=1:a=0",
				"-c:v",
				"libx264",
				"-pix_fmt",
				"yuv420p",
				video,
			]);
			const poster = await createShareThumbnail(video, new AbortController().signal);
			expect(poster.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
			const decoded = await new Promise<Buffer>((resolve, reject) => {
				const child = execFile(
					ffmpeg!,
					[
						"-hide_banner",
						"-loglevel",
						"error",
						"-i",
						"pipe:0",
						"-f",
						"rawvideo",
						"-pix_fmt",
						"rgb24",
						"pipe:1",
					],
					{ encoding: "buffer", maxBuffer: 1024 * 1024 },
					(error, stdout) => (error ? reject(error) : resolve(stdout)),
				);
				child.stdin!.end(poster);
			});
			expect(decoded.length).toBe(640 * 360 * 3);
			expect(decoded[0]).toBeGreaterThan(220);
			expect(decoded[1]).toBeLessThan(30);
			expect(decoded[2]).toBeLessThan(30);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	}, 20000);
});
