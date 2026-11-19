import { EventEmitter } from "node:events";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	spawn: vi.fn(),
	mkdir: vi.fn(),
	rm: vi.fn(),
	remove: vi.fn(),
	normalize: vi.fn(),
	source: vi.fn(),
	gpu: vi.fn(),
}));
vi.mock("electron", () => ({ app: { getPath: () => path.resolve("/recordly-temp") } }));
vi.mock("node:child_process", () => ({ spawn: mocks.spawn }));
vi.mock("node:fs/promises", () => ({
	default: { mkdir: mocks.mkdir, rm: mocks.rm, stat: vi.fn() },
}));
vi.mock("../../ffmpeg/binary", () => ({ getFfprobeBinaryPath: () => "ffprobe" }));
vi.mock("../../nativeVideoExport", () => ({
	buildNativeStaticLayoutChunks: () => [{ index: 0, startSec: 0, durationSec: 1 }],
	buildNativeVideoExportArgs: () => ["probe"],
	getNativeVideoInputByteSize: () => 64 * 64 * 4,
	getPreferredNativeVideoEncoders: () => ["h264_nvenc"],
	parseAvailableFfmpegEncoders: () => new Set(["h264_nvenc", "libx264"]),
}));
vi.mock("../../state", () => ({
	cachedNativeVideoEncoder: null,
	setCachedNativeVideoEncoder: vi.fn(),
}));
vi.mock("./constants", () => ({
	execFileAsync: async () => ({ stdout: "synthetic encoder list" }),
	NVIDIA_CUDA_ALLOW_AUDIO_EXPORT_ENV: "RECORDLY_TEST_CUDA",
}));
vi.mock("./stream", () => ({ removeTemporaryExportFile: mocks.remove }));
vi.mock("./audio", () => ({ muxNativeVideoExportAudio: vi.fn() }));
vi.mock("./layout", () => ({
	normalizeNativeStaticLayoutBackground: mocks.normalize,
	hasNativeStaticLayoutTimeline: () => false,
	hasNativeStaticLayoutSourceCrop: () => false,
	shouldUsePrecompositedStaticLayout: () => false,
}));
vi.mock("./sourceProxy", () => ({
	prepareNativeStaticLayoutSourceInput: mocks.source,
	prepareWindowsGpuWebcamInput: vi.fn(),
}));
vi.mock("./probe", () => ({ validateNativeVideoOutputFile: vi.fn() }));
vi.mock("./timeline", () => ({ prepareNativeStaticLayoutTimelineMap: vi.fn() }));
vi.mock("./staticFfmpeg", () => ({ renderNativeStaticFfmpeg: vi.fn() }));
vi.mock("./capabilities", () => ({
	getExperimentalNvidiaCudaExportSkipReason: () => "disabled",
	isExplicitNvidiaCudaExportEnabled: () => false,
	isNvidiaCudaForceVideoOnlyEnabled: () => false,
	isValidatedNvidiaCudaFallbackCandidate: () => false,
}));
vi.mock("./gpuArgs", () => ({ canMuxNvidiaCudaSourceAudioInline: () => false }));
vi.mock("./gpuProcess", () => ({
	runExperimentalNvidiaCudaStaticLayoutExport: vi.fn(),
	runExperimentalWindowsGpuStaticLayoutExport: mocks.gpu,
}));
vi.mock("./telemetry", () => ({
	prepareWindowsGpuCursorTelemetry: async () => "cursor.csv",
	prepareWindowsGpuCursorAtlas: async () => null,
	prepareWindowsGpuZoomTelemetry: async () => null,
	prepareNvidiaCudaCursorAtlas: async () => null,
	prepareNvidiaCudaCursorTelemetry: async () => null,
}));

import { probeNativeVideoEncoder, resolveNativeVideoEncoder } from "./encoder";
import { tryNativeStaticGpuExport } from "./gpuAttempt";
import { nativeStaticLayoutExportSessions } from "./sessions";
import { exportNativeStaticLayoutVideo } from "./staticLayout";
import type { NativeStaticLayoutExportOptions } from "./types";

const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
const options: NativeStaticLayoutExportOptions = {
	inputPath: "/selected.mp4",
	width: 64,
	height: 64,
	frameRate: 30,
	bitrate: 1_500_000,
	encodingMode: "balanced",
	durationSec: 1,
	contentWidth: 64,
	contentHeight: 64,
	offsetX: 0,
	offsetY: 0,
	backgroundColor: "#000000",
};

beforeEach(() => {
	vi.clearAllMocks();
	vi.useFakeTimers();
	mocks.mkdir.mockResolvedValue(undefined);
	mocks.rm.mockResolvedValue(undefined);
	mocks.remove.mockResolvedValue(undefined);
	mocks.normalize.mockImplementation(async (value) => value);
	mocks.source.mockRejectedValue(new Error("source preparation reached"));
	mocks.gpu.mockRejectedValue(new Error("GPU unavailable"));
	nativeStaticLayoutExportSessions.clear();
	vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => {
	Object.defineProperty(process, "platform", platform);
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe("native static-layout paths", () => {
	it.each([
		"../private",
		"..\\private",
		"/outside",
		"C:\\outside",
		".",
		"..",
		"",
		"nested/export",
		"bad\0id",
		"x".repeat(129),
	])("rejects unsafe session ID %j before creating, reporting or cleaning paths", async (sessionId) => {
		const output = vi.fn();
		await expect(
			exportNativeStaticLayoutVideo("ffmpeg", { ...options, sessionId }, undefined, output),
		).rejects.toThrow("safe session ID");
		expect(mocks.normalize).not.toHaveBeenCalled();
		expect(mocks.mkdir).not.toHaveBeenCalled();
		expect(mocks.rm).not.toHaveBeenCalled();
		expect(mocks.remove).not.toHaveBeenCalled();
		expect(output).not.toHaveBeenCalled();
		expect(nativeStaticLayoutExportSessions.size).toBe(0);
	});

	it.each([
		"recordly-session_01.v2",
		undefined,
	])("keeps safe and generated session paths under temp (%s)", async (sessionId) => {
		const output = vi.fn();
		await expect(
			exportNativeStaticLayoutVideo("ffmpeg", { ...options, sessionId }, undefined, output),
		).rejects.toThrow("source preparation reached");
		const directory = mocks.mkdir.mock.calls[0][0] as string;
		expect(path.dirname(directory)).toBe(path.resolve("/recordly-temp"));
		expect(path.basename(directory)).toMatch(
			sessionId ? /^recordly-session_01\.v2$/ : /^recordly-static-layout-/,
		);
		expect(output).toHaveBeenCalledWith(`${directory}.mp4`);
		expect(mocks.rm).toHaveBeenCalledWith(directory, { force: true, recursive: true });
		expect(nativeStaticLayoutExportSessions.size).toBe(0);
	});

	it("rejects cursor telemetry when the static backend cannot render it", async () => {
		await expect(
			exportNativeStaticLayoutVideo("ffmpeg", {
				...options,
				cursorTelemetry: [{ timeMs: 0, cx: 1, cy: 1 }],
			}),
		).rejects.toThrow("cursor telemetry requires the Windows GPU compositor");
		expect(mocks.mkdir).not.toHaveBeenCalled();
	});
});

function child() {
	return Object.assign(new EventEmitter(), {
		stdin: Object.assign(new EventEmitter(), { end: vi.fn() }),
		stderr: new EventEmitter(),
		kill: vi.fn(),
	});
}

describe("encoder probe failures", () => {
	it("continues to a usable encoder after an asynchronous stdin failure", async () => {
		const failed = child();
		const successful = child();
		mocks.spawn
			.mockImplementationOnce(() => {
				queueMicrotask(() => failed.stdin.emit("error", new Error("synthetic EPIPE")));
				return failed;
			})
			.mockImplementationOnce(() => {
				queueMicrotask(() => successful.emit("close", 0));
				return successful;
			});
		await expect(resolveNativeVideoEncoder("ffmpeg", "balanced")).resolves.toBe("libx264");
		expect(mocks.spawn).toHaveBeenCalledTimes(2);
		expect(vi.getTimerCount()).toBe(0);
	});

	it.each([
		"process",
		"stdin",
	])("settles false on %s errors and handles teardown errors", async (stream) => {
		const process = child();
		mocks.spawn.mockReturnValueOnce(process);
		const result = probeNativeVideoEncoder("ffmpeg", "libx264", "balanced");
		const emitter = stream === "process" ? process : process.stdin;
		expect(() => emitter.emit("error", new Error("synthetic EPIPE"))).not.toThrow();
		await expect(result).resolves.toBe(false);
		expect(process.kill).toHaveBeenCalledWith("SIGKILL");
		expect(vi.getTimerCount()).toBe(0);
		expect(() => emitter.emit("error", new Error("shutdown error"))).not.toThrow();
		process.emit("close", 0);
		await expect(result).resolves.toBe(false);
	});

	it.each([
		"spawn",
		"write",
	])("treats synchronous %s failures as a failed candidate", async (failure) => {
		const process = child();
		if (failure === "spawn")
			mocks.spawn.mockImplementationOnce(() => {
				throw new Error("spawn failed");
			});
		else {
			process.stdin.end.mockImplementationOnce(() => {
				throw new Error("write failed");
			});
			mocks.spawn.mockReturnValueOnce(process);
		}
		await expect(probeNativeVideoEncoder("ffmpeg", "libx264", "balanced")).resolves.toBe(false);
		expect(mocks.remove).toHaveBeenCalled();
		expect(vi.getTimerCount()).toBe(0);
	});

	it("keeps successful close behavior and bounds a hung probe", async () => {
		const success = child();
		mocks.spawn.mockReturnValueOnce(success);
		const result = probeNativeVideoEncoder("ffmpeg", "libx264", "balanced");
		success.emit("close", 0);
		await expect(result).resolves.toBe(true);
		const hung = child();
		mocks.spawn.mockReturnValueOnce(hung);
		const timeout = probeNativeVideoEncoder("ffmpeg", "libx264", "balanced");
		await vi.advanceTimersByTimeAsync(15_000);
		await expect(timeout).resolves.toBe(false);
		expect(hung.kill).toHaveBeenCalledWith("SIGKILL");
		expect(vi.getTimerCount()).toBe(0);
	});
});

it.each([
	true,
	false,
])("allows FFmpeg fallback only without a requested cursor (cursor=%s)", async (cursor) => {
	Object.defineProperty(process, "platform", { value: "win32" });
	const result = tryNativeStaticGpuExport({
		ffmpegPath: "ffmpeg",
		options: {
			...options,
			experimentalWindowsGpuCompositor: true,
			cursorTelemetry: cursor ? [{ timeMs: 0, cx: 1, cy: 1 }] : [],
		},
		session: { terminating: false, currentProcess: null },
		chunkDirectory: "/recordly-temp/session",
		videoOnlyPath: "/recordly-temp/session.mp4",
		metrics: {
			chunkCount: 1,
			chunkDurationSec: 1,
			chunkExecMs: 0,
			fallbackChunkCount: 0,
			chunks: [],
		},
		validateRenderedVideoOutput: vi.fn(),
	});
	if (cursor) await expect(result).rejects.toThrow("GPU unavailable");
	else
		await expect(result).resolves.toMatchObject({
			didRenderVideo: false,
			didMuxAudioInline: false,
		});
});
