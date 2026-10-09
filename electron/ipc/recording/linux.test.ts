import { EventEmitter } from "node:events";
import { execFile } from "node:child_process";
import { PassThrough } from "node:stream";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setLinuxCaptureOutputBuffer, setLinuxCaptureStopRequested } from "../state";
import {
	buildLinuxConcatListContent,
	stitchLinuxSegments,
	waitForLinuxCaptureStart,
	waitForLinuxCaptureStop,
} from "./linux";

vi.mock("electron", () => ({
	app: {
		getPath: () => "/tmp/RecordlyTest",
	},
	BrowserWindow: {
		getAllWindows: () => [],
	},
}));

const execFileAsync = promisify(execFile);

async function createTestSegment(name: string, seconds: number) {
	const segmentPath = path.join(tmpdir(), `${name}.mp4`);
	await execFileAsync(
		"ffmpeg",
		[
			"-y",
			"-hide_banner",
			"-f",
			"lavfi",
			"-i",
			`testsrc=duration=${seconds}:size=128x96:rate=15`,
			"-c:v",
			"libx264",
			"-preset",
			"ultrafast",
			"-pix_fmt",
			"yuv420p",
			segmentPath,
		],
		{ timeout: 30_000 },
	);
	return segmentPath;
}

class FakeCaptureProcess extends EventEmitter {
	stdout = new PassThrough();
	stderr = new PassThrough();
	stdin = new PassThrough();
	killed = false;

	kill = vi.fn(() => {
		this.killed = true;
		return true;
	});
}

describe("waitForLinuxCaptureStart", () => {
	it("rejects with buffered output when ffmpeg exits before starting", async () => {
		const proc = new FakeCaptureProcess();
		setLinuxCaptureOutputBuffer("Unable to open display :0\n");

		const started = waitForLinuxCaptureStart(
			proc as unknown as Parameters<typeof waitForLinuxCaptureStart>[0],
		);
		proc.emit("exit", 1);

		await expect(started).rejects.toThrow("Unable to open display :0");
	});

	it("resolves once ffmpeg stays alive through the readiness window", async () => {
		const proc = new FakeCaptureProcess();

		await expect(
			waitForLinuxCaptureStart(
				proc as unknown as Parameters<typeof waitForLinuxCaptureStart>[0],
			),
		).resolves.toBeUndefined();
	});
});

describe("waitForLinuxCaptureStop", () => {
	beforeEach(() => {
		setLinuxCaptureOutputBuffer("");
		setLinuxCaptureStopRequested(false);
	});

	it("resolves the output path when ffmpeg quits cleanly", async () => {
		const proc = new FakeCaptureProcess();
		const outputPath = path.join(tmpdir(), `recordly-linux-test-${Date.now()}.mp4`);
		await fs.writeFile(outputPath, "fake");

		const stopped = waitForLinuxCaptureStop(
			proc as unknown as Parameters<typeof waitForLinuxCaptureStop>[0],
			outputPath,
			1000,
		);
		proc.emit("close", 0);

		await expect(stopped).resolves.toBe(outputPath);
		expect(proc.kill).not.toHaveBeenCalled();
		await fs.rm(outputPath, { force: true });
	});

	it("rejects with buffered output when the output file is missing", async () => {
		const proc = new FakeCaptureProcess();
		setLinuxCaptureOutputBuffer("Encoder error: something broke");

		const stopped = waitForLinuxCaptureStop(
			proc as unknown as Parameters<typeof waitForLinuxCaptureStop>[0],
			path.join(tmpdir(), `recordly-missing-${Date.now()}.mp4`),
			1000,
		);
		proc.emit("close", 1);

		await expect(stopped).rejects.toThrow("Encoder error: something broke");
	});

	it("kills ffmpeg and rejects when stop never completes", async () => {
		const proc = new FakeCaptureProcess();

		await expect(
			waitForLinuxCaptureStop(
				proc as unknown as Parameters<typeof waitForLinuxCaptureStop>[0],
				path.join(tmpdir(), `recordly-never-${Date.now()}.mp4`),
				5,
			),
		).rejects.toThrow("Timed out waiting for native Linux capture to stop");
		expect(proc.kill).toHaveBeenCalledTimes(1);
	});
});

describe("buildLinuxConcatListContent", () => {
	it("lists every segment as a concat entry", () => {
		expect(
			buildLinuxConcatListContent(["/tmp/a.mp4", "/tmp/b.mp4"]),
		).toBe("file '/tmp/a.mp4'\nfile '/tmp/b.mp4'");
	});

	it("escapes single quotes in paths", () => {
		expect(buildLinuxConcatListContent(["/tmp/it's.mp4"])).toBe(
			"file '/tmp/it'\\''s.mp4'",
		);
	});
});

describe("stitchLinuxSegments", () => {
	it("joins segments losslessly without re-encoding", { timeout: 60_000 }, async () => {
		const segmentA = await createTestSegment("recordly-stitch-a", 0.5);
		const segmentB = await createTestSegment("recordly-stitch-b", 0.5);
		const outputPath = path.join(tmpdir(), `recordly-stitch-${Date.now()}.mp4`);

		try {
			await stitchLinuxSegments("ffmpeg", [segmentA, segmentB], outputPath);
			const stitched = await fs.stat(outputPath);
			expect(stitched.size).toBeGreaterThan(0);

			const { stdout } = await execFileAsync(
				"ffprobe",
				[
					"-v",
					"error",
					"-show_entries",
					"format=duration",
					"-of",
					"default=noprint_wrappers=1:nokey=1",
					outputPath,
				],
				{ timeout: 30_000 },
			);
			expect(Number(stdout.trim())).toBeGreaterThanOrEqual(0.9);
			// Segment files are cleaned up by the caller, not by stitch; the concat
			// list must be gone though.
			await expect(fs.access(`${outputPath}.concat.txt`)).rejects.toThrow();
		} finally {
			await Promise.all([
				fs.rm(segmentA, { force: true }),
				fs.rm(segmentB, { force: true }),
				fs.rm(outputPath, { force: true }),
			]);
		}
	});

	it("rejects when fewer than two segments are given", async () => {
		await expect(
			stitchLinuxSegments("ffmpeg", ["/tmp/only.mp4"], "/tmp/out.mp4"),
		).rejects.toThrow("at least two segments");
	});
});
