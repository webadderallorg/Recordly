import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock("./process", () => ({ runFfmpegWithMetrics: state.run }));
vi.mock("../../ffmpeg/metadata", () => ({ probeNativeVideoMetadata: vi.fn() }));

import { buildWindowsGpuWebcamProxyArgs, prepareWindowsGpuWebcamInput } from "./sourceProxy";
import type { NativeStaticLayoutExportOptions } from "./types";

const base: NativeStaticLayoutExportOptions = {
	inputPath: "/screen.mp4",
	webcamInputPath: "/camera.webm",
	width: 1920,
	height: 1080,
	frameRate: 30,
	bitrate: 12000000,
	durationSec: 10,
	contentWidth: 1920,
	contentHeight: 1080,
	offsetX: 0,
	offsetY: 0,
	backgroundColor: "#000000",
	encodingMode: "balanced",
};
const segment = (start: number, end: number, outputStart = 0, speed = 1) => ({
	sourceStartMs: start * 1000,
	sourceEndMs: end * 1000,
	outputStartMs: outputStart * 1000,
	outputEndMs: (outputStart + (end - start) / speed) * 1000,
	speed,
});
const flag = (args: string[], name: string) => args[args.indexOf(name) + 1];
beforeEach(() => {
	state.run.mockReset().mockResolvedValue({ success: true, elapsedMs: 5 });
});
it.each([
	["unedited", {}, "10"],
	["later trimmed source", { timelineSegments: [segment(60, 70)] }, "70"],
	["speed-up", { timelineSegments: [segment(60, 80, 0, 2)] }, "80"],
	["slow-down", { timelineSegments: [segment(60, 65, 0, 0.5)] }, "65"],
	["negative webcam offset", { webcamTimeOffsetMs: -500 }, "10.5"],
	[
		"trim with webcam delay",
		{ timelineSegments: [segment(60, 70)], webcamTimeOffsetMs: 3000 },
		"67",
	],
	[
		"nonmonotonic source ranges",
		{ timelineSegments: [segment(60, 65), segment(10, 15, 5)] },
		"65",
	],
	["original coverage with positive offset", { webcamTimeOffsetMs: 5000 }, "10"],
] as const)("covers required camera samples for %s without changing proxy encoding", (_name, changes, duration) => {
	const args = buildWindowsGpuWebcamProxyArgs(
		{
			...base,
			...changes,
			timelineSegments: changes.timelineSegments ? [...changes.timelineSegments] : undefined,
		},
		"/proxy.mp4",
	);
	expect(flag(args, "-t")).toBe(duration);
	const reference = [
		"-y",
		"-hide_banner",
		"-loglevel",
		"error",
		"-i",
		"/camera.webm",
		"-map",
		"0:v:0",
		"-an",
		"-t",
		duration,
		"-vf",
		"scale=trunc(iw/2)*2:trunc(ih/2)*2,setsar=1,fps=30",
		"-c:v",
		"libx264",
		"-preset",
		"ultrafast",
		"-tune",
		"zerolatency",
		"-b:v",
		"4000000",
		"-maxrate",
		"4800000",
		"-bufsize",
		"8000000",
		"-pix_fmt",
		"yuv420p",
		"-movflags",
		"+faststart",
		"/proxy.mp4",
	];
	expect(args).toEqual(reference);
});
it("passes mapped coverage and a matching processing deadline to the actual proxy process", async () => {
	const options = { ...base, durationSec: 60, timelineSegments: [segment(60, 660, 0, 10)] };
	await prepareWindowsGpuWebcamInput("ffmpeg", options, "/proxy.mp4", {
		terminating: false,
		currentProcess: null,
	});
	const call = state.run.mock.calls[0];
	expect(flag(call[1], "-t")).toBe("660");
	expect(call[2]).toBe(660000);
});
it("keeps supported native webcam files unchanged", async () => {
	const result = await prepareWindowsGpuWebcamInput(
		"ffmpeg",
		{ ...base, webcamInputPath: "/camera.mp4" },
		"/proxy.mp4",
		{ terminating: false, currentProcess: null },
	);
	expect(result.inputPath).toBe("/camera.mp4");
	expect(state.run).not.toHaveBeenCalled();
});
