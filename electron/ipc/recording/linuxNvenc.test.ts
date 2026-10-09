import { describe, expect, it, vi } from "vitest";

vi.mock("../ffmpeg/binary", () => ({
	resolveSystemFfmpegBinaryPath: () => "/usr/bin/ffmpeg",
	getFfmpegBinaryPath: () => "/app/ffmpeg-static/ffmpeg",
}));

import {
	findNvidiaDeviceNode,
	parseNvencEncoderSupport,
	pickNvencCapableFfmpeg,
	runLinuxNvencProbe,
} from "./linuxNvenc";
import { parseX11grabDeviceSupport } from "./linuxVaapi";

const encoderList = [
	" V....D h264_nvenc           NVIDIA NVENC H.264 encoder (codec h264)",
	" V....D libx264              libx264 H.264",
].join("\n");

const encoderListWithoutNvenc = " V....D libx264              libx264 H.264";
const deviceList = " x11grab           X11 screen capture, using XFixes";
const okDeps = {
	readdir: async () => ["nvidia0", "nvidiactl", "nvidia-modeset", "dri"],
	listEncoders: async () => encoderList,
	listDevices: async () => deviceList,
	encodeTest: async () => true,
};

describe("findNvidiaDeviceNode", () => {
	it("finds the driver device nodes in a /dev listing", () => {
		expect(findNvidiaDeviceNode(["nvidia0", "nvidiactl", "dri"])).toBe("nvidia0");
		expect(findNvidiaDeviceNode(["dri", "snd"])).toBeNull();
	});
});

describe("parseNvencEncoderSupport", () => {
	it("detects h264_nvenc", () => {
		expect(parseNvencEncoderSupport(encoderList)).toBe(true);
	});

	it("rejects builds without h264_nvenc", () => {
		expect(parseNvencEncoderSupport(encoderListWithoutNvenc)).toBe(false);
	});
});

describe("parseX11grabDeviceSupport (shared with the VAAPI probe)", () => {
	it("rejects builds without x11grab", () => {
		expect(parseX11grabDeviceSupport(" pulse            PulseAudio")).toBe(false);
	});
});

describe("pickNvencCapableFfmpeg", () => {
	it("returns the first candidate that can encode with nvenc", async () => {
		await expect(
			pickNvencCapableFfmpeg(
				["/usr/bin/ffmpeg", "/app/ffmpeg-static/ffmpeg"],
				async (path) => path === "/usr/bin/ffmpeg",
			),
		).resolves.toBe("/usr/bin/ffmpeg");
	});

	it("falls through to a later candidate and skips duplicates", async () => {
		const hasNvenc = vi.fn(async (path: string) => path.includes("static"));
		await expect(
			pickNvencCapableFfmpeg(
				["/missing", "/usr/bin/ffmpeg", "/app/ffmpeg-static/ffmpeg", "/app/ffmpeg-static/ffmpeg"],
				hasNvenc,
			),
		).resolves.toBe("/app/ffmpeg-static/ffmpeg");
		expect(hasNvenc.mock.calls.map((args) => args[0])).toEqual([
			"/missing",
			"/usr/bin/ffmpeg",
			"/app/ffmpeg-static/ffmpeg",
		]);
	});

	it("returns null when no candidate qualifies", async () => {
		await expect(
			pickNvencCapableFfmpeg(["/a", null, undefined], async () => false),
		).resolves.toBeNull();
	});
});

describe("runLinuxNvencProbe", () => {
	it("succeeds with a device node, nvenc-capable ffmpeg, and a passing encode test", async () => {
		const result = await runLinuxNvencProbe(okDeps);
		expect(result).toEqual({
			available: true,
			ffmpegPath: "/usr/bin/ffmpeg",
		});
	});

	it("fails before touching ffmpeg when no NVIDIA device exists", async () => {
		const listEncoders = vi.fn(async () => encoderList);
		const amdMachine = await runLinuxNvencProbe({
			...okDeps,
			readdir: async () => ["dri", "snd", "input"],
			listEncoders,
		});
		expect(amdMachine).toEqual({ available: false, reason: "no-nvidia-device" });
		const brokenDev = await runLinuxNvencProbe({
			...okDeps,
			readdir: async () => {
				throw new Error("gone");
			},
			listEncoders,
		});
		expect(brokenDev).toEqual({ available: false, reason: "no-nvidia-device" });
		expect(listEncoders).not.toHaveBeenCalled();
	});

	it("falls back when no candidate ffmpeg ships h264_nvenc", async () => {
		const result = await runLinuxNvencProbe({
			...okDeps,
			listEncoders: async () => encoderListWithoutNvenc,
		});
		expect(result).toEqual({ available: false, reason: "no-encoder" });
	});

	it("falls back when the encoder probe command itself fails", async () => {
		const result = await runLinuxNvencProbe({
			...okDeps,
			listEncoders: async () => {
				throw new Error("spawn gone");
			},
		});
		expect(result).toEqual({ available: false, reason: "no-encoder" });
	});

	it("falls back when the chosen ffmpeg lacks x11grab", async () => {
		const result = await runLinuxNvencProbe({
			...okDeps,
			listDevices: async () => " pulse            PulseAudio",
		});
		expect(result).toEqual({ available: false, reason: "no-x11grab" });
	});

	it("falls back when the encode test fails (driver present, encode blocked)", async () => {
		const result = await runLinuxNvencProbe({ ...okDeps, encodeTest: async () => false });
		expect(result).toEqual({ available: false, reason: "encode-test-failed" });
	});
});
