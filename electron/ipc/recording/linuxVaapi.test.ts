import { describe, expect, it, vi } from "vitest";

vi.mock("../ffmpeg/binary", () => ({
	resolveSystemFfmpegBinaryPath: () => "/usr/bin/ffmpeg",
}));

import {
	findVaapiRenderNode,
	parseVaapiEncoderSupport,
	parseX11grabDeviceSupport,
	runLinuxVaapiProbe,
} from "./linuxVaapi";

const encoderList = [
	" V....D av1_vaapi            AV1 (VAAPI) (codec av1)",
	" V....D h264_vaapi           H.264/AVC (VAAPI) (codec h264)",
	" V....D libx264              libx264 H.264",
].join("\n");

const encoderListWithoutVaapi = " V....D libx264              libx264 H.264";
const deviceList = " x11grab           X11 screen capture, using XFixes";
const okDeps = {
	readdir: async () => ["card1", "renderD128", "by-path"],
	listEncoders: async () => encoderList,
	listDevices: async () => deviceList,
	encodeTest: async () => true,
};

describe("findVaapiRenderNode", () => {
	it("picks the render node from a /dev/dri listing", () => {
		expect(findVaapiRenderNode(["card1", "renderD128", "by-path"])).toBe(
			"/dev/dri/renderD128",
		);
	});

	it("prefers the lowest-numbered render node", () => {
		expect(findVaapiRenderNode(["renderD129", "renderD128"])).toBe("/dev/dri/renderD128");
	});

	it("returns null when no render node exists", () => {
		expect(findVaapiRenderNode(["card1", "by-path"])).toBeNull();
	});
});

describe("parseVaapiEncoderSupport", () => {
	it("detects h264_vaapi", () => {
		expect(parseVaapiEncoderSupport(encoderList)).toBe(true);
	});

	it("rejects builds without h264_vaapi", () => {
		expect(parseVaapiEncoderSupport(encoderListWithoutVaapi)).toBe(false);
	});
});

describe("parseX11grabDeviceSupport", () => {
	it("detects x11grab", () => {
		expect(parseX11grabDeviceSupport(deviceList)).toBe(true);
	});

	it("rejects builds without x11grab", () => {
		expect(parseX11grabDeviceSupport(" pulse            PulseAudio")).toBe(false);
	});
});

describe("runLinuxVaapiProbe", () => {
	it("succeeds with a render node, system ffmpeg, and a passing encode test", async () => {
		const result = await runLinuxVaapiProbe(okDeps);
		expect(result).toEqual({
			available: true,
			ffmpegPath: "/usr/bin/ffmpeg",
			devicePath: "/dev/dri/renderD128",
		});
	});

	it("fails before touching ffmpeg when no render node exists", async () => {
		const listEncoders = vi.fn(async () => encoderList);
		const missingNode = await runLinuxVaapiProbe({
			...okDeps,
			readdir: async () => ["card1"],
			listEncoders,
		});
		expect(missingNode).toEqual({ available: false, reason: "no-render-node" });
		const brokenDev = await runLinuxVaapiProbe({
			...okDeps,
			readdir: async () => {
				throw new Error("gone");
			},
			listEncoders,
		});
		expect(brokenDev).toEqual({ available: false, reason: "no-render-node" });
		expect(listEncoders).not.toHaveBeenCalled();
	});

	it("falls back when the encoder test fails on the device", async () => {
		const result = await runLinuxVaapiProbe({ ...okDeps, encodeTest: async () => false });
		expect(result).toEqual({ available: false, reason: "encode-test-failed" });
	});

	it("falls back when the system ffmpeg lacks h264_vaapi", async () => {
		const result = await runLinuxVaapiProbe({
			...okDeps,
			listEncoders: async () => encoderListWithoutVaapi,
		});
		expect(result).toEqual({ available: false, reason: "no-encoder" });
	});

	it("falls back when the system ffmpeg lacks x11grab", async () => {
		const result = await runLinuxVaapiProbe({
			...okDeps,
			listDevices: async () => " pulse            PulseAudio",
		});
		expect(result).toEqual({ available: false, reason: "no-x11grab" });
	});
});
