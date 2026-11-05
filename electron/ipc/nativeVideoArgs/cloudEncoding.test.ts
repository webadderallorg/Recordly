import { describe, expect, it } from "vitest";
import { buildNativeVideoExportArgs } from "./encoding";

const options = {
	width: 1920,
	height: 1080,
	frameRate: 60,
	bitrate: 6_000_000,
	encodingMode: "fast" as const,
};

describe("cloud delivery encoding", () => {
	it("encodes rendered frames directly with a bounded peak, rather than spending a fixed bitrate", () => {
		const args = buildNativeVideoExportArgs(
			"libx264",
			{ ...options, deliveryProfile: "cloud" },
			"cloud.mp4",
		);
		expect(args).toEqual(
			expect.arrayContaining([
				"-crf",
				"23",
				"-preset",
				"medium",
				"-threads",
				"4",
				"-maxrate",
				"6000000",
				"-bufsize",
				"12000000",
				"-movflags",
				"+faststart",
			]),
		);
		expect(args).not.toContain("-b:v");
		expect(args).not.toContain("zerolatency");
		expect(args).toEqual(
			expect.arrayContaining(["-f", "rawvideo", "-i", "pipe:0", "-pix_fmt", "yuv420p"]),
		);
	});
	it("leaves the existing local encoder, rate control and speed settings alone", () => {
		const args = buildNativeVideoExportArgs("libx264", options, "local.mp4");
		expect(args).toEqual(
			expect.arrayContaining([
				"-b:v",
				"6000000",
				"-preset",
				"ultrafast",
				"-tune",
				"zerolatency",
			]),
		);
		expect(args).not.toContain("-crf");
	});
	it("uses the smaller bitrate budget with a native hardware encoder", () => {
		const args = buildNativeVideoExportArgs(
			"h264_videotoolbox",
			{ ...options, deliveryProfile: "cloud" },
			"out.mp4",
		);
		expect(args).toEqual(
			expect.arrayContaining(["-c:v", "h264_videotoolbox", "-b:v", "6000000"]),
		);
		expect(args).not.toContain("-crf");
		expect(args).not.toContain("-preset");
	});
});
