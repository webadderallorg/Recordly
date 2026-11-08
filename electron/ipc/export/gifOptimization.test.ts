import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import {
	buildGifOptimizationArgs,
	compressGifBuffer,
	inspectGifAnimation,
	nextGifTargetDimensions,
} from "./gifOptimization";

const require = createRequire(import.meta.url);
const ffmpegPath: string = require("ffmpeg-static");

function largeAnimation(): Uint8Array {
	const generated = spawnSync(
		ffmpegPath,
		[
			"-v",
			"error",
			"-f",
			"lavfi",
			"-i",
			"testsrc2=size=1280x720:rate=10:duration=0.6",
			"-gifflags",
			"0",
			"-loop",
			"0",
			"-f",
			"gif",
			"pipe:1",
		],
		{ maxBuffer: 64 * 1024 * 1024 },
	);
	expect(generated.status).toBe(0);
	return new Uint8Array(generated.stdout);
}

// Each image is independently LZW encoded. Variable/very short delays exercise
// values that FFmpeg would otherwise normalize, and loop extension omission matters.
function animation(delays = [0, 1, 7, 13], loopCount: number | null = 0): Uint8Array {
	const parts = [
		Buffer.from("GIF89a", "ascii"),
		Buffer.from([1, 0, 1, 0, 0x80, 0, 0, 0, 0, 0, 255, 255, 255]),
	];
	if (loopCount !== null) {
		parts.push(
			Buffer.from([0x21, 0xff, 11]),
			Buffer.from("NETSCAPE2.0"),
			Buffer.from([3, 1, loopCount & 255, loopCount >> 8, 0]),
		);
	}
	for (const [index, delay] of delays.entries()) {
		parts.push(Buffer.from([0x21, 0xf9, 4, 4, delay & 255, delay >> 8, 0, 0]));
		parts.push(
			Buffer.from([0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 2, index % 2 ? 0x4c : 0x44, 0x01, 0]),
		);
	}
	parts.push(Buffer.from([0x3b]));
	return new Uint8Array(Buffer.concat(parts));
}

describe("GIF animation metadata", () => {
	it("bounds target resolution changes without upscaling small GIFs", () => {
		expect(nextGifTargetDimensions(100, 100, 1000, 100)).toBeNull();
		expect(nextGifTargetDimensions(1920, 1080, 100, 100)).toBeNull();
		expect(nextGifTargetDimensions(640, 360, 10000, 1)).toEqual({ width: 320, height: 180 });
		expect(nextGifTargetDimensions(360, 640, 10000, 1)).toEqual({ width: 180, height: 320 });
	});
	it.each([
		null,
		0,
		4,
		65535,
	])("preserves the loop setting %s and centisecond delays", (loopCount) => {
		expect(inspectGifAnimation(animation([0, 1, 7, 65535], loopCount))).toEqual({
			width: 1,
			height: 1,
			delays: [0, 1, 7, 65535],
			loopCount,
		});
	});
	it.each([
		new Uint8Array(),
		new Uint8Array(Buffer.from("GIF89a")),
		animation().subarray(0, 25),
		animation().subarray(0, animation().length - 1),
		new Uint8Array(Buffer.from("not a gif at all")),
	])("rejects malformed data", (data) => {
		expect(() => inspectGifAnimation(data)).toThrow("Invalid or unsupported GIF");
	});
	it("rejects out-of-canvas images", () => {
		const data = animation();
		const offset = data.indexOf(0x2c);
		data[offset + 5] = 2;
		expect(() => inspectGifAnimation(data)).toThrow();
	});
	it("builds fixed palette encoding arguments without resizing or frame-rate changes", () => {
		const args = buildGifOptimizationArgs(
			"/managed/input.gif",
			"/managed/output.gif",
			inspectGifAnimation(animation()),
			"/managed/palette.png",
		);
		expect(args).toContain("[0:v][1:v]paletteuse=dither=none:diff_mode=rectangle[out]");
		expect(args).toContain("+transdiff+offsetting");
		expect(args).toContain("passthrough");
		expect(args).not.toContain("-r");
		expect(args.join(" ")).not.toMatch(/(?:^|[;,])scale=/);
	});
});

describe("bundled FFmpeg GIF compression", () => {
	it.each([
		false,
		true,
	])("keeps an earlier valid result on a later failure, but honors user cancellation=%s", async (cancel) => {
		const input = largeAnimation();
		const controller = new AbortController();
		const originalStat = fs.stat.bind(fs);
		const stat = vi
			.spyOn(fs, "stat")
			.mockImplementationOnce(originalStat)
			.mockImplementationOnce(async () => {
				if (cancel) controller.abort(new Error("User canceled during a later pass"));
				throw new Error("Later pass unavailable");
			});
		try {
			const pending = compressGifBuffer(input, { ffmpegPath, signal: controller.signal });
			if (cancel) await expect(pending).rejects.toThrow();
			else {
				const result = await pending;
				expect(result.byteLength).toBeLessThan(input.byteLength);
				expect(inspectGifAnimation(result).width).toBe(1280);
				expect(inspectGifAnimation(result).delays).toEqual(
					inspectGifAnimation(input).delays,
				);
			}
			expect(stat).toHaveBeenCalledTimes(2);
		} finally {
			stat.mockRestore();
		}
	}, 20_000);
	it("targets one tenth of a large GIF using smaller dimensions without changing playback", async () => {
		const generated = spawnSync(
			ffmpegPath,
			[
				"-v",
				"error",
				"-f",
				"lavfi",
				"-i",
				"testsrc2=size=1280x720:rate=10:duration=0.6",
				"-gifflags",
				"0",
				"-loop",
				"0",
				"-f",
				"gif",
				"pipe:1",
			],
			{ maxBuffer: 64 * 1024 * 1024 },
		);
		expect(generated.status).toBe(0);
		const input = new Uint8Array(generated.stdout);
		const output = await compressGifBuffer(input, { ffmpegPath });
		const before = inspectGifAnimation(input);
		const after = inspectGifAnimation(output);
		expect(output.byteLength).toBeLessThanOrEqual(Math.floor(input.byteLength * 0.1));
		expect(after.width).toBeLessThan(before.width);
		expect(Math.max(after.width, after.height)).toBeGreaterThanOrEqual(320);
		expect(after.width / after.height).toBeCloseTo(before.width / before.height, 1);
		expect(after.delays).toEqual(before.delays);
		expect(after.loopCount).toBe(before.loopCount);
	}, 20_000);

	it("keeps the original when an already tiny GIF cannot be reduced", async () => {
		const input = animation();
		const output = await compressGifBuffer(input, { ffmpegPath });
		expect(output.byteLength).toBeLessThanOrEqual(input.byteLength);
		expect(inspectGifAnimation(output)).toEqual(inspectGifAnimation(input));
	});
	it("retains decoded image contents and frame order when colors fit the palette", async () => {
		const input = animation([3, 7, 10, 17], 0);
		const output = await compressGifBuffer(input, { ffmpegPath });
		const decode = (data: Uint8Array) => {
			const result = spawnSync(
				ffmpegPath,
				[
					"-v",
					"error",
					"-min_delay",
					"0",
					"-ignore_loop",
					"1",
					"-i",
					"pipe:0",
					"-fps_mode",
					"passthrough",
					"-f",
					"rawvideo",
					"-pix_fmt",
					"rgba",
					"pipe:1",
				],
				{ input: data },
			);
			expect(result.status).toBe(0);
			return result.stdout;
		};
		expect(decode(output)).toEqual(decode(input));
	});
	it.each([
		null,
		0,
		4,
	])("retains dimensions, all frames, exact timing and loop setting %s", async (loopCount) => {
		const input = animation([0, 1, 7, 13], loopCount);
		const output = await compressGifBuffer(input, { ffmpegPath });
		expect(inspectGifAnimation(output)).toEqual(inspectGifAnimation(input));
	}, 10_000);
	it("retains long final frame delays", async () => {
		const input = animation([3, 65535], 0);
		const output = await compressGifBuffer(input, { ffmpegPath });
		expect(inspectGifAnimation(output).delays).toEqual([3, 65535]);
	}, 10_000);
	it("does not launch when already canceled", async () => {
		const controller = new AbortController();
		controller.abort(new Error("Canceled before launch"));
		await expect(
			compressGifBuffer(animation(), {
				ffmpegPath: "/must-not-run",
				signal: controller.signal,
			}),
		).rejects.toThrow("Canceled before launch");
	});
	it("honors cancellation during asynchronous setup", async () => {
		const controller = new AbortController();
		const pending = compressGifBuffer(animation(), { ffmpegPath, signal: controller.signal });
		controller.abort(new Error("Canceled while preparing"));
		await expect(pending).rejects.toThrow("Canceled while preparing");
	});
	it("fails safely when the native binary is missing", async () => {
		await expect(
			compressGifBuffer(animation(), { ffmpegPath: "/missing-recordly-ffmpeg" }),
		).rejects.toThrow();
	});
	it("enforces the deadline", async () => {
		await expect(compressGifBuffer(animation(), { ffmpegPath, timeoutMs: 1 })).rejects.toThrow(
			"timed out",
		);
	});
});
